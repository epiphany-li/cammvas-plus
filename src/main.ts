import { Plugin, Notice, TFile, TFolder, Menu, Platform, debounce, WorkspaceLeaf, setIcon, ItemView, addIcon } from "obsidian";
import type { Canvas, CanvasNode, CanvasEdge, CreateNodeOptions } from "./types/canvas-internal";
import { CanvasAPI, writeCanvasDataKey } from "./canvas/canvas-api";
import { NodeOperations } from "./mindmap/node-operations";
import { LayoutEngine, LayoutOrientation } from "./mindmap/layout-engine";
import { BranchColors } from "./mindmap/branch-colors";
import { KeyboardHandler } from "./ui/keyboard-handler";

import { Navigation } from "./ui/navigation";
import {
	MindMapSettings,
	DEFAULT_SETTINGS,
	MindMapSettingTab,
	normalizeSettings,
} from "./settings";
import { registerDragEndHandler } from "./canvas/edge-updater";
import { registerSubtreeDragHandler } from "./canvas/subtree-drag";
import { registerDragReparent } from "./canvas/drag-reparent";
import { registerGroupDragHandler } from "./canvas/group-drag";
import { registerAutoLayoutOnMove } from "./canvas/auto-layout-on-move";
import {
	registerNodeResizeHandler,
	syncWidthsAtSameDepth,
	getManualMinHeight,
	setManualMinHeight,
} from "./canvas/node-resize";
import { createMindmapPdf } from "./export/pdf-export";
import { PdfExportModal } from "./export/pdf-export-modal";
import { registerBranchCollapse, BranchCollapseHandle } from "./canvas/branch-collapse";
import { registerAutoResize, AutoResizeHandle, getEditorElements } from "./ui/auto-resize";
import { findNavigableHistoryIndex } from "./ui/navigation-history";
import { OutlineView, OUTLINE_VIEW_TYPE } from "./ui/outline-view";
import { isHtmlElement } from "./ui/dom";
import { copyText } from "./ui/clipboard";
import { registerMobileEditingBar, MobileEditingBarHandle } from "./ui/mobile-editing-bar";
import { computeOrderedListRenumberChanges } from "./ui/ordered-list-renumber";
import { freemindToCanvas } from "./import/freemind-import";
import { getGroupIds, buildForest, findTreeForNode } from "./mindmap/tree-model";
import {
	registerSummaries,
	SummaryHandle,
	getSummaryBracketIds,
	getSummaryRecords,
} from "./summary/summary-controller";
import { tr } from "./i18n";

/** On the canvas wrapper while nodes glide to a new layout. */
export const LAYOUT_ANIMATING_CLASS = "cammvas-layout-animating";

export default class CanvasMindMapPlugin extends Plugin {
	settings: MindMapSettings = DEFAULT_SETTINGS;

	private canvasApi!: CanvasAPI;
	private nodeOps!: NodeOperations;
	private layoutEngine!: LayoutEngine;
	private branchColors!: BranchColors;
	private keyboardHandler!: KeyboardHandler;

	private navigation!: Navigation;
	private cleanupClickHandler: (() => void) | null = null;
	private cleanupDragHandler: (() => void) | null = null;
	private cleanupSubtreeDragHandler: (() => void) | null = null;
	private cleanupDragReparentHandler: (() => void) | null = null;
	private cleanupGroupDragHandler: (() => void) | null = null;
	private cleanupAutoLayoutOnMoveHandler: (() => void) | null = null;
	private cleanupNodeResizeHandler: (() => void) | null = null;
	private autoResizeHandle: AutoResizeHandle | null = null;
	private branchCollapseHandle: BranchCollapseHandle | null = null;
	private summaryHandle: SummaryHandle | null = null;
	private interceptedCanvas: Canvas | null = null;
	private toggleBtnEl: HTMLElement | null = null;
	private dragReparentBtnEl: HTMLElement | null = null;
	private autoLayoutOnEditBtnEl: HTMLElement | null = null;
	private layoutBtnEl: HTMLElement | null = null;
	private exportPdfBtnEl: HTMLElement | null = null;
	private enterTabBtnEl: HTMLElement | null = null;
	private mobileActionsBtnEl: HTMLElement | null = null;
	private mobileEditingBarHandle: MobileEditingBarHandle | null = null;
	private cleanupGroupBoundsHandler: (() => void) | null = null;
	private cleanupSelectionSyncHandler: (() => void) | null = null;
	private cleanupInsertNodeHandler: (() => void) | null = null;
	/** Pending timers/observers/RAFs to cancel on unload or canvas switch. */
	private pendingTimers = new Set<{ id: number; win: Window }>();
	private pendingRafs = new Set<{ id: number; win: Window }>();
	private pendingObservers: Set<MutationObserver> = new Set();
	private pendingOrderedListRenumberNodes = new Set<string>();
	private editExitGeneration = 0;
	/** Original canvas methods for unwrapping on cleanup. */
	private origCanvasMethods: {
		requestSave?: () => void;
		createGroupNode?: (options: CreateNodeOptions & { label?: string }) => import("./types/canvas-internal").CanvasNode;
		undo?: () => void;
		redo?: () => void;
		selectOnly?: (item: CanvasNode | CanvasEdge) => void;
		showCreationMenu?: (menu: Menu, pos: { x: number; y: number }) => void;
	} = {};
	/** Node ids at the last save, to notice nodes deleted natively (Delete key). */
	private knownNodeIds: Set<string> | null = null;
	private removalRelayoutPending = false;
	/** Set to true on unload to prevent deferred callbacks from running. */
	private unloaded = false;
	/** Navigation history for back/forward. */
	private navHistory: string[] = [];
	private navHistoryIndex = -1;
	private navSkipTracking = false;
	private lastNavCanvas: Canvas | null = null;
	private cleanupNavHandler: (() => void) | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerBranchColorIcons();

		// Initialize core services
		this.canvasApi = new CanvasAPI(this.app);
		this.nodeOps = new NodeOperations(this.canvasApi, {
			nodeWidth: this.settings.defaultNodeWidth,
			nodeHeight: this.settings.defaultNodeHeight,
			horizontalGap: this.settings.horizontalGap,
			verticalGap: this.settings.verticalGap,
		});
		this.layoutEngine = new LayoutEngine({
			horizontalGap: this.settings.horizontalGap,
			verticalGap: this.settings.verticalGap,
			nodeWidth: this.settings.defaultNodeWidth,
			nodeHeight: this.settings.defaultNodeHeight,
		});
		this.branchColors = new BranchColors(
			this.canvasApi,
			this.settings.branchPalette,
			this.settings.colorLeafNodes
		);
		this.navigation = new Navigation(this.canvasApi);

		// Register keyboard shortcuts
		this.keyboardHandler = new KeyboardHandler(
			this,
			this.canvasApi,
			this.nodeOps,
			this.layoutEngine,
			this.branchColors,
			() => this.settings.autoColor,
			() => this.settings.autoLayout,
			() => this.settings.autoLayoutOnEdit,
			() => this.settings.arrowKeyNavigation,
			() => this.settings.centerNodeOnArrowNavigation,
			() => this.settings.enterCreatesSibling,
			(canvas: Canvas) => this.isMindmapCanvas(canvas),
			(canvas: Canvas) => this.updateGroupBounds(canvas)
		);
		this.keyboardHandler.zoomPadding = this.settings.navigationZoomPadding;
		this.keyboardHandler.isSummaryNode = (canvas, node) =>
			getSummaryRecords(canvas).some((record) => record.summaryNodeId === node.id);
		this.keyboardHandler.register();

		// Summaries follow their members after every layout pass.
		this.layoutEngine.afterApply = (canvas) => {
			if (canvas === this.interceptedCanvas) this.summaryHandle?.syncNow();
		};

		this.addCommand({
			id: "mindmap-create-summary",
			name: tr("Create summary from selected siblings", "为选中的兄弟节点创建概要"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || !this.summaryHandle || canvas !== this.interceptedCanvas) return false;
				const selected = this.getSelectedNodeIds(canvas);
				if (selected.length < 2) return false;
				if (checking) return true;
				this.summaryHandle.create(selected);
			},
		});

		this.addCommand({
			id: "mindmap-remove-summary",
			name: tr("Remove summary bracket (keep content node)", "移除概要括号（保留内容）"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || !this.summaryHandle || canvas !== this.interceptedCanvas) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				const record = node ? this.summaryHandle.findByContentNode(node.id) : null;
				if (!record) return false;
				if (checking) return true;
				this.summaryHandle.removeBracket(record.id);
			},
		});

		this.addCommand({
			id: "mindmap-toggle-branch",
			name: tr("Toggle selected branch", "折叠/展开选中分支"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || !this.branchCollapseHandle || canvas !== this.interceptedCanvas) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node || !this.branchCollapseHandle.canToggle(node.id)) return false;
				if (checking) return true;
				this.branchCollapseHandle.toggle(node.id);
			},
		});

		// Command: Re-layout entire mind map
		this.addCommand({
			id: "mindmap-relayout",
			name: tr("Re-layout mind map", "重新排版导图"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapCanvas(canvas)) return false;
				if (checking) return true;
				this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
			},
		});

		this.addCommand({
			id: "mindmap-relayout-selected-branch",
			name: tr("Re-layout selected branch", "重新排版选中分支"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || !this.isMindmapCanvas(canvas)) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node || this.canvasApi.getChildNodes(canvas, node).length === 0) return false;
				if (checking) return true;
				this.relayoutSelectedBranch(canvas);
			},
		});

		// Command: Create an independent root at the center of the visible canvas
		this.addCommand({
			id: "mindmap-create-root",
			name: tr("Create root node", "新建根节点"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || !this.isMindmapCanvas(canvas)) return false;
				if (this.canvasApi.getSelectedNode(canvas)?.isEditing) return false;
				if (checking) return true;
				this.createRootNode();
			},
		});

		// Command: Layout forest (arrange trees within a group)
		this.addCommand({
			id: "mindmap-layout-forest",
			name: tr("Layout forest", "整理多棵树"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapCanvas(canvas)) return false;

				// Find the group containing the selected node
				const selected = this.canvasApi.getSelectedNode(canvas);
				if (!selected) return false;

				const groupIds = getGroupIds(canvas);
				for (const bracketId of getSummaryBracketIds(canvas)) groupIds.delete(bracketId);
				const cx = selected.x + selected.width / 2;
				const cy = selected.y + selected.height / 2;
				let targetGroupId: string | null = null;
				let smallestArea = Infinity;

				for (const gid of groupIds) {
					const g = canvas.nodes.get(gid);
					if (!g) continue;
					if (cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height) {
						const area = g.width * g.height;
						if (area < smallestArea) {
							smallestArea = area;
							targetGroupId = gid;
						}
					}
				}

				if (!targetGroupId) return false;
				if (checking) return true;
				this.layoutEngine.layoutForest(canvas, targetGroupId);
			},
		});

		// Command: Detach subtree as independent tree
		this.addCommand({
			id: "mindmap-detach-subtree",
			name: tr("Detach subtree as independent tree", "把子树拆分为独立的树"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapCanvas(canvas)) return false;

				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node) return false;

				const parent = this.canvasApi.getParentNode(canvas, node);
				if (!parent) return false;

				if (checking) return true;

				const edges = this.canvasApi.getOutgoingEdges(canvas, parent.id);
				const edge = edges.find(e => e.to.node.id === node.id);
				if (!edge) return;

				canvas.removeEdge(edge);
				this.canvasApi.invalidateEdgeIndex();

				if (this.settings.autoLayoutOnEdit) this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
				canvas.requestSave();
			},
		});

		// Command: Resize + re-layout selected subtree (Ctrl+Shift+L)
		this.addCommand({
			id: "mindmap-resize-subtree",
			name: tr("Resize & re-layout selected subtree", "按内容调整选中子树尺寸并重新排版"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node) return false;
				if (checking) return true;
				const wasEditing = node.isEditing;
				this.preserveViewport(canvas, () => {
					const subtree = this.collectSubtreeNodes(canvas, node);
					for (const item of subtree) setManualMinHeight(item, null);
					this.resizeNodes(canvas, subtree);
					this.layoutEngine.layout(canvas);
					this.updateGroupBounds(canvas);
				});
				if (wasEditing) node.startEditing();
			},
		});

		// Command: Resize all nodes to fit content (Ctrl+Shift+Alt+R)
		this.addCommand({
			id: "mindmap-resize-all",
			name: tr("Resize all nodes to fit content", "按内容调整全部节点尺寸"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapCanvas(canvas)) return false;
				if (canvas.nodes.size === 0) return false;
				if (checking) return true;
				this.preserveViewport(canvas, () => {
					for (const item of canvas.nodes.values()) setManualMinHeight(item, null);
					this.resizeNodes(canvas, Array.from(canvas.nodes.values()));
					this.layoutEngine.layout(canvas);
					this.updateGroupBounds(canvas);
				});
			},
		});

		// Command: Apply branch colors
		this.addCommand({
			id: "mindmap-apply-colors",
			name: tr("Apply branch colors", "应用分支配色"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapCanvas(canvas)) return false;
				if (checking) return true;
				this.branchColors.applyColors(canvas);
			},
		});

		// Command: Export the current map through the native PDF print dialog.
		this.addCommand({
			id: "mindmap-export-pdf",
			name: tr("Export mind map as high-quality PDF", "导出导图为高清 PDF"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || !this.isMindmapCanvas(canvas) || canvas.nodes.size === 0) return false;
				if (checking) return true;
				void this.exportMindmapPdf(canvas);
			},
		});

		// Command: Toggle mindmap mode for current canvas
		this.addCommand({
			id: "mindmap-toggle-mode",
			name: tr("Toggle mindmap mode for this canvas", "切换当前画布的导图模式"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (checking) return true;
				this.toggleMindmapMode(canvas);
			},
		});

		// Watch for canvas view activation to set up UI
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				this.onLeafChange(leaf);
			})
		);

		// Register outline sidebar view
		this.registerView(OUTLINE_VIEW_TYPE, (leaf) => new OutlineView(leaf));

		// Show outline if a mindmap canvas is already open on startup
		this.app.workspace.onLayoutReady(() => {
			const view = this.app.workspace.getActiveViewOfType(ItemView);
			if (view) this.onLeafChange(view.leaf);
		});

		// Import FreeMind: right-click context menu on folders
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				// Show on folders only
				if (!(file instanceof TFolder)) return;

				menu.addItem((item) => {
					item.setTitle(tr("Import mind map (.mm) to canvas", "导入思维导图（.mm）到画布"))
						.setIcon("file-input")
						.onClick(() => this.importFreeMindFile(file.path));
				});
			})
		);

		// Multi-selection context menu: turn consecutive siblings into a summary.
		this.registerEvent(
			this.app.workspace.on("canvas:selection-menu", (menu: Menu, canvas: Canvas) => {
				if (!this.isMindmapCanvas(canvas) || canvas !== this.interceptedCanvas) return;
				const selected = this.getSelectedNodeIds(canvas);
				if (selected.length < 2) return;
				menu.addItem((item) => item
					.setTitle(tr("Create summary", "创建概要"))
					.setIcon("brackets")
					.onClick(() => this.summaryHandle?.create(selected)));
			})
		);

		// Node referencing: "Copy node link" in canvas node context menu
		this.registerEvent(
			this.app.workspace.on("canvas:node-menu", (menu: Menu, node: CanvasNode) => {
				const canvas = node.canvas;

				menu.addItem((item) => {
					item.setTitle(tr("Copy node link", "复制节点链接"))
						.setIcon("link")
						.onClick(() => {
							const canvasPath = node.canvas.view.file.path;
							void copyText(
								node.nodeEl.win,
								`obsidian://cammvas-plus-navigate?canvas=${encodeURIComponent(canvasPath)}&id=${node.id}`,
								tr("Node link copied", "已复制节点链接")
							);
						});
				});
				if (Platform.isMobile && this.isMindmapCanvas(canvas)) {
					menu.addItem((item) => item
						.setTitle(tr("Add child node", "新建子节点"))
						.setIcon("corner-down-right")
						.onClick(() => this.keyboardHandler.addChildNode(canvas, node)));
					menu.addItem((item) => item
						.setTitle(tr("Add sibling node", "新建兄弟节点"))
						.setIcon("list-plus")
						.onClick(() => this.keyboardHandler.addSiblingNode(canvas, node)));
					menu.addItem((item) => item
						.setTitle(tr("Zoom to branch", "缩放到分支"))
						.setIcon("scan")
						.onClick(() => this.navigation.zoomToBranch(canvas, node)));
				}
				const summaryRecord = canvas === this.interceptedCanvas
					? this.summaryHandle?.findByContentNode(node.id) ?? null
					: null;
				if (summaryRecord) {
					menu.addItem((item) => item
						.setTitle(tr("Remove summary bracket (keep content)", "移除概要括号（保留内容）"))
						.setIcon("brackets")
						.onClick(() => this.summaryHandle?.removeBracket(summaryRecord.id)));
				}
				const groupIds = getGroupIds(canvas);
				if (this.isMindmapCanvas(canvas) && !groupIds.has(node.id)) {
					const branchColors = [
						["1", tr("Red", "红")],
						["2", tr("Orange", "橙")],
						["3", tr("Yellow", "黄")],
						["4", tr("Green", "绿")],
						["5", tr("Blue", "蓝")],
						["6", tr("Purple", "紫")],
					] as const;
					menu.addItem((item) => item
						.setTitle(tr("Branch color", "分支颜色"))
						.setIcon("palette")
						.onClick((event) => this.showBranchColorMenu(event, canvas, node.id, branchColors)));
				}

				if (groupIds.has(node.id)) {
					menu.addItem((item) => {
						item.setTitle(tr("Layout forest", "整理多棵树"))
							.setIcon("layout-grid")
							.onClick(() => {
								this.layoutEngine.layoutForest(canvas, node.id);
								this.updateGroupBounds(canvas);
							});
					});
				} else if (this.isMindmapCanvas(canvas)) {
					menu.addItem((item) => {
						item.setTitle(tr("Re-layout selected branch", "重新排版选中分支"))
							.setIcon("list-tree")
							.onClick(() => {
								this.relayoutSelectedBranch(canvas, node);
						});
					});
				}
				if (this.isMindmapCanvas(canvas)) {
					menu.addItem((item) => item
						.setTitle(tr("Export as high-quality PDF", "导出高清 PDF"))
						.setIcon("file-down")
						.onClick(() => {
							void this.exportMindmapPdf(canvas);
						}));
				}
			})
		);

		// Node referencing: handle obsidian://cammvas-plus-navigate protocol
		this.registerObsidianProtocolHandler("cammvas-plus-navigate", async (params) => {
			const nodeId = params.id;
			if (!nodeId) return;

			const canvasPath = params.canvas;
			let canvas: Canvas | null = null;
			if (canvasPath) {
				const file = this.app.vault.getAbstractFileByPath(canvasPath);
				if (file && file instanceof TFile) {
					const leaf = this.app.workspace.getLeaf();
					await leaf.openFile(file);
					canvas = await this.waitForCanvas(canvasPath, leaf.view.containerEl.win);
				}
				if (!canvas) {
					new Notice(tr("Canvas not found", "找不到画布"));
					return;
				}
			}

			canvas ??= this.canvasApi.getActiveCanvas() ?? this.canvasApi.getAnyCanvas();
			if (!canvas) {
				new Notice(tr("Canvas not found", "找不到画布"));
				return;
			}

			const node = canvas.nodes.get(nodeId);
			if (!node) {
				new Notice(tr("Target node not found", "找不到目标节点"));
				return;
			}

			this.canvasApi.selectAndZoom(canvas, node, this.settings.navigationZoomPadding);
		});

		// Navigation history: back/forward commands
		this.addCommand({
			id: "mindmap-nav-back",
			name: tr("Navigate back", "导航后退"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || this.navHistoryIndex <= 0) return false;
				if (checking) return true;
				this.navigateBack(canvas);
			},
		});
		this.addCommand({
			id: "mindmap-nav-forward",
			name: tr("Navigate forward", "导航前进"),
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || this.navHistoryIndex >= this.navHistory.length - 1) return false;
				if (checking) return true;
				this.navigateForward(canvas);
			},
		});

		// Import FreeMind: command palette
		this.addCommand({
			id: "mindmap-import-freemind",
			name: tr("Import mind map (.mm) file to canvas", "导入思维导图（.mm）到画布"),
			callback: () => this.importFreeMindFile(),
		});

		// Settings tab
		this.addSettingTab(new MindMapSettingTab(this.app, this));

	}

	private pushNavHistory(nodeId: string): void {
		if (this.navHistory[this.navHistoryIndex] === nodeId) return;
		this.navHistory.splice(this.navHistoryIndex + 1);
		this.navHistory.push(nodeId);
		if (this.navHistory.length > 50) this.navHistory.shift();
		this.navHistoryIndex = this.navHistory.length - 1;
	}

	private navigateBack(canvas: Canvas): void {
		const targetIndex = findNavigableHistoryIndex(
			this.navHistory,
			this.navHistoryIndex,
			-1,
			(nodeId) => canvas.nodes.has(nodeId)
		);
		if (targetIndex === null) return;
		const node = canvas.nodes.get(this.navHistory[targetIndex]);
		if (!node) return;
		const editingNode = this.canvasApi.getSelectedNode(canvas);
		if (editingNode?.isEditing) {
			this.keyboardHandler.finishEditing(canvas, editingNode, false);
		}
		this.navSkipTracking = true;
		this.navHistoryIndex = targetIndex;
		this.canvasApi.selectAndZoom(canvas, node, this.settings.navigationZoomPadding);
		this.navSkipTracking = false;
	}

	private navigateForward(canvas: Canvas): void {
		const targetIndex = findNavigableHistoryIndex(
			this.navHistory,
			this.navHistoryIndex,
			1,
			(nodeId) => canvas.nodes.has(nodeId)
		);
		if (targetIndex === null) return;
		const node = canvas.nodes.get(this.navHistory[targetIndex]);
		if (!node) return;
		const editingNode = this.canvasApi.getSelectedNode(canvas);
		if (editingNode?.isEditing) {
			this.keyboardHandler.finishEditing(canvas, editingNode, false);
		}
		this.navSkipTracking = true;
		this.navHistoryIndex = targetIndex;
		this.canvasApi.selectAndZoom(canvas, node, this.settings.navigationZoomPadding);
		this.navSkipTracking = false;
	}

	private async waitForCanvas(path: string, win: Window): Promise<Canvas | null> {
		for (let attempt = 0; attempt < 40; attempt++) {
			if (this.unloaded) return null;
			const canvas = this.canvasApi.getActiveCanvas();
			if (canvas?.view.file.path === path) return canvas;
			await new Promise<void>((resolve) => win.setTimeout(resolve, 50));
		}
		return null;
	}

	onunload(): void {
		this.unloaded = true;
		// Cancel all pending async operations first
		this.cancelPendingAsync();
		this.unwrapCanvasMethods();

		if (this.cleanupClickHandler) {
			this.cleanupClickHandler();
			this.cleanupClickHandler = null;
		}
		if (this.cleanupDragHandler) {
			this.cleanupDragHandler();
			this.cleanupDragHandler = null;
		}
		if (this.cleanupSubtreeDragHandler) {
			this.cleanupSubtreeDragHandler();
			this.cleanupSubtreeDragHandler = null;
		}
		if (this.cleanupAutoLayoutOnMoveHandler) {
			this.cleanupAutoLayoutOnMoveHandler();
			this.cleanupAutoLayoutOnMoveHandler = null;
		}
		if (this.cleanupNodeResizeHandler) {
			this.cleanupNodeResizeHandler();
			this.cleanupNodeResizeHandler = null;
		}
		if (this.cleanupDragReparentHandler) {
			this.cleanupDragReparentHandler();
			this.cleanupDragReparentHandler = null;
		}
		if (this.cleanupGroupDragHandler) {
			this.cleanupGroupDragHandler();
			this.cleanupGroupDragHandler = null;
		}
		if (this.cleanupGroupBoundsHandler) {
			this.cleanupGroupBoundsHandler();
			this.cleanupGroupBoundsHandler = null;
		}
		if (this.cleanupSelectionSyncHandler) {
			this.cleanupSelectionSyncHandler();
			this.cleanupSelectionSyncHandler = null;
		}
		if (this.cleanupInsertNodeHandler) {
			this.cleanupInsertNodeHandler();
			this.cleanupInsertNodeHandler = null;
		}
		if (this.cleanupNavHandler) {
			this.cleanupNavHandler();
			this.cleanupNavHandler = null;
		}
		if (this.autoResizeHandle) {
			this.autoResizeHandle.cleanup();
			this.autoResizeHandle = null;
		}
		if (this.mobileEditingBarHandle) {
			this.mobileEditingBarHandle.cleanup();
			this.mobileEditingBarHandle = null;
		}
		if (this.branchCollapseHandle) {
			this.branchCollapseHandle.cleanup();
			this.branchCollapseHandle = null;
		}
		if (this.summaryHandle) {
			this.summaryHandle.cleanup();
			this.summaryHandle = null;
		}
		this.keyboardHandler.unregisterArrowKeyNavigation();
		this.lastNavCanvas = null;
		if (this.toggleBtnEl) {
			this.toggleBtnEl.remove();
			this.toggleBtnEl = null;
		}
		if (this.dragReparentBtnEl) {
			this.dragReparentBtnEl.remove();
			this.dragReparentBtnEl = null;
		}
		if (this.autoLayoutOnEditBtnEl) {
			this.autoLayoutOnEditBtnEl.remove();
			this.autoLayoutOnEditBtnEl = null;
		}
		if (this.layoutBtnEl) {
			this.layoutBtnEl.remove();
			this.layoutBtnEl = null;
		}
		if (this.exportPdfBtnEl) {
			this.exportPdfBtnEl.remove();
			this.exportPdfBtnEl = null;
		}
		if (this.enterTabBtnEl) {
			this.enterTabBtnEl.remove();
			this.enterTabBtnEl = null;
		}
		if (this.mobileActionsBtnEl) {
			this.mobileActionsBtnEl.remove();
			this.mobileActionsBtnEl = null;
		}
	}

	/**
	 * Called when the active leaf changes — set up canvas-specific UI.
	 */
	private onLeafChange(leaf: WorkspaceLeaf | null): void {
		// Don't clean up when focus moves to sidebar panels
		if (leaf?.view?.getViewType() === OUTLINE_VIEW_TYPE) return;
		const root = leaf?.getRoot();
		if (root && root !== this.app.workspace.rootSplit) return;

		// Cancel pending async operations and unwrap previous canvas
		this.cancelPendingAsync();
		this.unwrapCanvasMethods();

		// Clean up previous canvas handlers
		if (this.cleanupClickHandler) {
			this.cleanupClickHandler();
			this.cleanupClickHandler = null;
		}
		if (this.cleanupDragHandler) {
			this.cleanupDragHandler();
			this.cleanupDragHandler = null;
		}
		if (this.cleanupSubtreeDragHandler) {
			this.cleanupSubtreeDragHandler();
			this.cleanupSubtreeDragHandler = null;
		}
		if (this.cleanupAutoLayoutOnMoveHandler) {
			this.cleanupAutoLayoutOnMoveHandler();
			this.cleanupAutoLayoutOnMoveHandler = null;
		}
		if (this.cleanupNodeResizeHandler) {
			this.cleanupNodeResizeHandler();
			this.cleanupNodeResizeHandler = null;
		}
		if (this.cleanupDragReparentHandler) {
			this.cleanupDragReparentHandler();
			this.cleanupDragReparentHandler = null;
		}
		if (this.cleanupGroupDragHandler) {
			this.cleanupGroupDragHandler();
			this.cleanupGroupDragHandler = null;
		}
		if (this.cleanupGroupBoundsHandler) {
			this.cleanupGroupBoundsHandler();
			this.cleanupGroupBoundsHandler = null;
		}
		if (this.cleanupSelectionSyncHandler) {
			this.cleanupSelectionSyncHandler();
			this.cleanupSelectionSyncHandler = null;
		}
		if (this.cleanupInsertNodeHandler) {
			this.cleanupInsertNodeHandler();
			this.cleanupInsertNodeHandler = null;
		}
		if (this.cleanupNavHandler) {
			this.cleanupNavHandler();
			this.cleanupNavHandler = null;
		}
		if (this.autoResizeHandle) {
			this.autoResizeHandle.cleanup();
			this.autoResizeHandle = null;
		}
		if (this.mobileEditingBarHandle) {
			this.mobileEditingBarHandle.cleanup();
			this.mobileEditingBarHandle = null;
		}
		if (this.branchCollapseHandle) {
			this.branchCollapseHandle.cleanup();
			this.branchCollapseHandle = null;
		}
		if (this.summaryHandle) {
			this.summaryHandle.cleanup();
			this.summaryHandle = null;
		}
		this.keyboardHandler.unregisterArrowKeyNavigation();

		const canvas = this.canvasApi.getActiveCanvas();

		// Only reset nav history when switching to a different canvas
		if (canvas && canvas !== this.lastNavCanvas) {
			this.navHistory = [];
			this.navHistoryIndex = -1;
		}
		if (canvas) {
			this.lastNavCanvas = canvas;
		}

		if (!canvas) {
			if (this.toggleBtnEl) {
				this.toggleBtnEl.remove();
				this.toggleBtnEl = null;
			}
			if (this.dragReparentBtnEl) {
				this.dragReparentBtnEl.remove();
				this.dragReparentBtnEl = null;
			}
			if (this.autoLayoutOnEditBtnEl) {
				this.autoLayoutOnEditBtnEl.remove();
				this.autoLayoutOnEditBtnEl = null;
			}
			if (this.layoutBtnEl) {
				this.layoutBtnEl.remove();
				this.layoutBtnEl = null;
			}
			if (this.exportPdfBtnEl) {
				this.exportPdfBtnEl.remove();
				this.exportPdfBtnEl = null;
			}
			if (this.enterTabBtnEl) {
				this.enterTabBtnEl.remove();
				this.enterTabBtnEl = null;
			}
			if (this.mobileActionsBtnEl) {
				this.mobileActionsBtnEl.remove();
				this.mobileActionsBtnEl = null;
			}
			this.hideOutline();
			return;
		}

		// Apply edge label font size CSS variable
		canvas.wrapperEl.style.setProperty("--cammvas-edge-label-font-size", `${this.settings.edgeLabelFontSize}px`);
		// Mind-map-only styling (content overflow, hierarchy, edges) keys off this class.
		canvas.wrapperEl.toggleClass("cammvas-mindmap", this.isMindmapCanvas(canvas));

		// Register after Canvas so Cammvas takes precedence over native node nudging.
		this.keyboardHandler.registerArrowKeyNavigation(canvas);

		// Inject mindmap toggle button into canvas toolbar
		this.injectToggleButton(canvas);
		this.updateLayoutButton(canvas);

		// Set up Ctrl+click zoom handler
		this.cleanupClickHandler = Platform.isMobile
			? null
			: this.navigation.registerClickHandler(canvas);

		// Set up drag-end edge update handler
		this.cleanupDragHandler =
			registerDragEndHandler(canvas);

		// Set up subtree drag handler (move descendants with parent)
		this.cleanupSubtreeDragHandler =
			registerSubtreeDragHandler(canvas, this.canvasApi);

		this.cleanupDragReparentHandler = registerDragReparent(
			canvas,
			this.canvasApi,
			() => this.settings.dragToReparent && this.isMindmapCanvas(canvas),
			(nodes, newParent) => {
				let changed = false;
				for (const node of nodes) {
					changed = this.nodeOps.reparent(canvas, node, newParent) || changed;
				}
				if (!changed) return;
				if (this.settings.autoLayoutOnReparent) this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
				this.branchCollapseHandle?.refresh();
			},
			12,
			(node) => getSummaryRecords(canvas).some((record) => record.summaryNodeId === node.id)
		);

		// Snap a manually dragged node (and its subtree) back into its
		// auto-layout slot once released, when enabled.
		this.cleanupAutoLayoutOnMoveHandler = registerAutoLayoutOnMove(
			canvas,
			this.canvasApi,
			() => this.settings.autoLayoutOnEdit && this.isMindmapCanvas(canvas),
			(parentIds) => {
				if (parentIds.size > 0) this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
				this.branchCollapseHandle?.refresh();
			}
		);

		// A manual resize can change wrapping and therefore every downstream
		// position. Synchronize widths at the same depth, then reflow the full map.
		this.cleanupNodeResizeHandler = registerNodeResizeHandler(
			canvas,
			() => this.settings.autoLayoutOnEdit
				&& this.isMindmapCanvas(canvas)
				&& this.canvasApi.getActiveCanvas() === canvas,
			({ nodes: resizedNodes, widthChangedNodeIds, heightChangedNodeIds }) => {
				// A height dragged by hand becomes the node's floor; content can still grow it.
				for (const node of resizedNodes) {
					if (heightChangedNodeIds.has(node.id)) setManualMinHeight(node, node.height);
				}
				const affectedNodes = new Map(resizedNodes.map((node) => [node.id, node]));
				if (this.settings.syncSameDepthWidth) {
					const widthChangedNodes = resizedNodes.filter((node) => widthChangedNodeIds.has(node.id));
					for (const node of syncWidthsAtSameDepth(canvas, widthChangedNodes)) {
						affectedNodes.set(node.id, node);
					}
				}
				const skipAnimationNodeIds = new Set(canvas.nodes.keys());
				const anchor = resizedNodes[0] ?? null;
				this.preserveViewport(canvas, () => {
					this.layoutEngine.layout(canvas, skipAnimationNodeIds);
				}, anchor);
				this.trackedRaf(canvas.wrapperEl.win, () => {
					if (this.canvasApi.getActiveCanvas() !== canvas) return;
					this.preserveViewport(canvas, () => {
						const heightChanged = this.resizeNodes(canvas, Array.from(affectedNodes.values()));
						if (heightChanged) this.layoutEngine.layout(canvas, skipAnimationNodeIds);
					}, anchor);
					this.updateGroupBounds(canvas);
					this.branchCollapseHandle?.refresh();
					canvas.requestSave();
				});
			}
		);

		// Set up group drag handler (Alt+drag leaves stranger nodes behind)
		this.cleanupGroupDragHandler = Platform.isMobile
			? null
			: registerGroupDragHandler(canvas, this.canvasApi);

		// Add persistent collapse controls to nodes that have descendants.
		this.branchCollapseHandle = registerBranchCollapse(canvas, this.canvasApi, () => {
			if (this.settings.autoLayout && this.isMindmapCanvas(canvas)) {
				// Glide siblings into place (like XMind) instead of teleporting;
				// the root and the viewport stay put.
				this.markLayoutAnimating(canvas);
				this.preserveViewport(canvas, () => this.layoutEngine.layout(canvas));
				this.updateGroupBounds(canvas);
			}
			this.summaryHandle?.syncNow();
		});

		// XMind-style summaries: brackets and content nodes anchored to sibling ranges.
		this.summaryHandle = registerSummaries(canvas, () => this.debouncedOutlineRefresh());

		// Update group bounds after any drag operation (deferred to let positions settle)
		const onDragEnd = () => this.trackedRaf(canvas.wrapperEl.win, () => this.updateGroupBounds(canvas));
		canvas.wrapperEl.addEventListener('pointerup', onDragEnd);
		this.cleanupGroupBoundsHandler = () =>
			canvas.wrapperEl.removeEventListener('pointerup', onDragEnd);

		// Sync outline highlight when canvas selection changes (click or Escape)
		const syncOutlineSelection = () => {
			this.trackedRaf(canvas.wrapperEl.win, () => {
				for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_VIEW_TYPE)) {
					if (leaf.view instanceof OutlineView) {
						leaf.view.syncHighlightFromCanvas(canvas);
					}
				}
			});
		};
		const onCanvasClick = () => syncOutlineSelection();
		const onCanvasKeydown = (e: KeyboardEvent) => {
			if (e.key === "Escape") syncOutlineSelection();
			if (e.key === "s" && (e.ctrlKey || e.metaKey) && !e.shiftKey) syncOutlineSelection();
		};
		canvas.wrapperEl.addEventListener("click", onCanvasClick);
		canvas.wrapperEl.addEventListener("keydown", onCanvasKeydown);
		this.cleanupSelectionSyncHandler = () => {
			canvas.wrapperEl.removeEventListener("click", onCanvasClick);
			canvas.wrapperEl.removeEventListener("keydown", onCanvasKeydown);
		};

		// Insert node between parent and child via Alt+click on connection point
		const onInsertNodeClick = (e: MouseEvent) => {
			if (!e.altKey) return;

			const target = e.target;
			if (!isHtmlElement(target)) return;
			const connectionPoint = target.closest(".canvas-node-connection-point");
			if (!connectionPoint) return;

			const side = connectionPoint.getAttribute("data-side");
			if (!side) return;

			// Connection point is an overlay, not inside .canvas-node — find node by position
			const canvasPos = canvas.posFromEvt(e);
			let clickedNode: CanvasNode | null = null;
			let closestDist = Infinity;
			for (const node of canvas.nodes.values()) {
				const cx = node.x + node.width / 2;
				const cy = node.y + node.height / 2;
				const dist = Math.hypot(canvasPos.x - cx, canvasPos.y - cy);
				if (dist < closestDist) {
					closestDist = dist;
					clickedNode = node;
				}
			}
			if (!clickedNode) return;

			// Collect ALL edges on this side of the clicked node
			const incomingEdges: CanvasEdge[] = [];
			const outgoingEdges: CanvasEdge[] = [];
			for (const edge of canvas.edges.values()) {
				if (edge.to.node.id === clickedNode.id && edge.to.side === side) {
					incomingEdges.push(edge);
				}
				if (edge.from.node.id === clickedNode.id && edge.from.side === side) {
					outgoingEdges.push(edge);
				}
			}

			const edges = outgoingEdges.length > 0 ? outgoingEdges : incomingEdges;
			if (edges.length === 0) return;

			e.preventDefault();
			e.stopPropagation();

			const isOutgoing = outgoingEdges.length > 0;
			const fromSide = edges[0].from.side;
			const toSide = edges[0].to.side;

			if (isOutgoing) {
				// Insert between clickedNode and all its children on this side
				const children = edges.map(edge => edge.to.node);
				const avgY = children.reduce((s, c) => s + c.y + c.height / 2, 0) / children.length;
				const midX = (clickedNode.x + clickedNode.width + children[0].x) / 2
					- this.settings.defaultNodeWidth / 2;
				const midY = avgY - this.settings.defaultNodeHeight / 2;

				const newNode = this.canvasApi.createTextNode(canvas, midX, midY);
				for (const edge of edges) canvas.removeEdge(edge);
				this.canvasApi.invalidateEdgeIndex();
				this.canvasApi.createEdge(canvas, clickedNode, newNode, fromSide, toSide);
				for (const child of children) {
					this.canvasApi.createEdge(canvas, newNode, child, fromSide, toSide);
				}

				this.finishInsertNode(canvas, newNode, clickedNode);
			} else {
				// Insert between parent and clickedNode (single incoming edge)
				const edge = edges[0];
				const parentNode = edge.from.node;
				const midX = (parentNode.x + parentNode.width / 2 + clickedNode.x + clickedNode.width / 2) / 2
					- this.settings.defaultNodeWidth / 2;
				const midY = (parentNode.y + parentNode.height / 2 + clickedNode.y + clickedNode.height / 2) / 2
					- this.settings.defaultNodeHeight / 2;

				const newNode = this.canvasApi.createTextNode(canvas, midX, midY);
				canvas.removeEdge(edge);
				this.canvasApi.invalidateEdgeIndex();
				this.canvasApi.createEdge(canvas, parentNode, newNode, fromSide, toSide);
				this.canvasApi.createEdge(canvas, newNode, clickedNode, fromSide, toSide);

				this.finishInsertNode(canvas, newNode, parentNode);
			}
		};
		if (!Platform.isMobile) {
			canvas.wrapperEl.addEventListener("click", onInsertNodeClick, true);
			this.cleanupInsertNodeHandler = () =>
				canvas.wrapperEl.removeEventListener("click", onInsertNodeClick, true);
		}

		// Set up auto-resize handler (grow/shrink nodes with content)
		this.autoResizeHandle = registerAutoResize(
			canvas,
			{
				minHeight: this.settings.defaultNodeHeight,
			},
			(canvas, editedNode) => {
				const generation = ++this.editExitGeneration;
				this.waitForPreview(editedNode, () => {
					if (generation !== this.editExitGeneration) return;
					// Guard: skip if canvas changed while waiting
					if (this.canvasApi.getActiveCanvas() !== canvas) return;
					const forest = buildForest(canvas);
					const treeNode = findTreeForNode(forest, editedNode.id);
					if (!treeNode) return;
					let root = treeNode;
					while (root.parent) root = root.parent;
					this.preserveViewport(canvas, () => {
						this.resizeNodes(canvas, this.collectSubtreeNodes(canvas, root.canvasNode));
						if (this.settings.autoLayoutOnEdit) this.layoutEngine.layout(canvas);
						this.updateGroupBounds(canvas);
					}, editedNode);
				});
			},
			(canvas, editedNode) => this.queueOrderedListRenumber(canvas, editedNode),
			(event, canvas) => this.keyboardHandler.handleEditingStateShortcut(canvas, event)
		);
		this.registerRenderedNodeAutoResize(canvas);
		this.keyboardHandler.onBeforeLeaveNode = () => {
			const generation = ++this.editExitGeneration;
			this.autoResizeHandle?.finalizeNode();
			const node = this.canvasApi.getSelectedNode(canvas);
			if (node?.isEditing) {
				this.renumberOrderedListNow(canvas, node);
				this.waitForPreview(node, () => {
					if (generation !== this.editExitGeneration) return;
					// Guard: skip if canvas changed while waiting
					if (this.canvasApi.getActiveCanvas() !== canvas) return;
					this.preserveViewport(canvas, () => {
						this.resizeNodes(canvas, [node]);
						this.finalizeEdit(canvas, node);
					});
				});
			}
		};
		if (Platform.isMobile) {
			this.mobileEditingBarHandle = registerMobileEditingBar(
				canvas,
				() => this.isMindmapCanvas(canvas),
				(node) => this.canvasApi.getParentNode(canvas, node) !== null,
				(node) => this.keyboardHandler.addChildNode(canvas, node, {
					immediateEdit: true,
					transferSelection: false,
				}),
				(node) => this.keyboardHandler.addSiblingNode(canvas, node, {
					immediateEdit: true,
					transferSelection: false,
				}),
				(node) => {
					this.keyboardHandler.finishEditing(canvas, node, false);
				}
			);
		}
		// Mouse back/forward buttons for navigation history (optional)
		if (this.settings.mouseNavigation && !Platform.isMobile) {
			const onPointerDown = (e: PointerEvent) => {
				if (e.button === 3) {
					e.preventDefault();
					e.stopImmediatePropagation();
					this.navigateBack(canvas);
				}
				if (e.button === 4) {
					e.preventDefault();
					e.stopImmediatePropagation();
					this.navigateForward(canvas);
				}
			};
			canvas.wrapperEl.addEventListener("pointerdown", onPointerDown, true);
			this.cleanupNavHandler = () => canvas.wrapperEl.removeEventListener("pointerdown", onPointerDown, true);
		}

		// Auto-color if enabled (mindmap only)
		if (this.settings.autoColor && this.isMindmapCanvas(canvas)) {
			this.branchColors.applyColors(canvas);
		}

		// Intercept canvas methods (store originals for cleanup)
		const origSave = canvas.requestSave.bind(canvas);
		const origCreateGroup = canvas.createGroupNode.bind(canvas);
		const origUndo = canvas.undo?.bind(canvas);
		const origRedo = canvas.redo?.bind(canvas);
		const origSelectOnly = canvas.selectOnly.bind(canvas);
		const origShowCreationMenu = canvas.showCreationMenu?.bind(canvas);
		this.origCanvasMethods = {
			requestSave: origSave,
			createGroupNode: origCreateGroup,
			undo: origUndo,
			redo: origRedo,
			selectOnly: origSelectOnly,
			showCreationMenu: origShowCreationMenu,
		};
		this.interceptedCanvas = canvas;
		this.knownNodeIds = new Set(canvas.nodes.keys());

		// Blank-canvas right-click menu: Obsidian has no event for it, so extend
		// the creation menu it builds.
		if (origShowCreationMenu) {
			canvas.showCreationMenu = (menu: Menu, pos: { x: number; y: number }) => {
				origShowCreationMenu(menu, pos);
				if (!this.isMindmapCanvas(canvas)) return;
				menu.addSeparator();
				menu.addItem((item) => item
					.setTitle(tr("Create root node", "新建根节点"))
					.setIcon("circle-plus")
					.onClick(() => this.createRootNode()));
				menu.addItem((item) => item
					.setTitle(tr("Re-layout mind map", "重新排版导图"))
					.setIcon("layout-template")
					.onClick(() => {
						this.layoutEngine.layout(canvas);
						this.updateGroupBounds(canvas);
					}));
				menu.addItem((item) => item
					.setTitle(tr("Export as high-quality PDF", "导出高清 PDF"))
					.setIcon("file-down")
					.setDisabled(canvas.nodes.size === 0)
					.onClick(() => {
						void this.exportMindmapPdf(canvas);
					}));
			};
		}

		// Track selection changes for navigation history
		canvas.selectOnly = (item: CanvasNode | CanvasEdge) => {
			origSelectOnly(item);
			if (!this.navSkipTracking && "nodeEl" in item) {
				this.pushNavHistory(item.id);
			}
		};

		canvas.requestSave = () => {
			if (this.isMindmapCanvas(canvas)) {
				this.branchColors.inheritConnectionColors(canvas);
			}
			origSave();
			this.branchCollapseHandle?.refresh();
			this.summaryHandle?.schedule();
			this.relayoutAfterNodeRemoval(canvas);
			this.debouncedOutlineRefresh();
		};
		canvas.createGroupNode = (options: CreateNodeOptions & { label?: string }) => {
			const group = origCreateGroup(options);
			this.updateGroupBounds(canvas);
			return group;
		};
		if (origUndo) {
			canvas.undo = () => {
				origUndo();
				this.canvasApi.invalidateEdgeIndex();
				this.branchCollapseHandle?.refresh();
				this.summaryHandle?.schedule();
				this.debouncedOutlineRefresh();
			};
		}
		if (origRedo) {
			canvas.redo = () => {
				origRedo();
				this.canvasApi.invalidateEdgeIndex();
				this.branchCollapseHandle?.refresh();
				this.summaryHandle?.schedule();
				this.debouncedOutlineRefresh();
			};
		}
		if (this.isMindmapCanvas(canvas)) {
			this.showOutline(canvas);
		} else {
			this.hideOutline();
		}
	}

	private debouncedOutlineRefresh = debounce(() => {
		if (this.unloaded) return;
		const canvas = this.canvasApi.getActiveCanvas()
			?? this.canvasApi.getAnyCanvas();
		if (canvas) {
			this.refreshOutline(canvas);
		}
	}, 300);

	private refreshOutline(canvas: Canvas): void {
		for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof OutlineView) {
				view.zoomPadding = this.settings.navigationZoomPadding;
				view.onForestLayout = (c, groupId) => {
					this.layoutEngine.layoutForest(c, groupId);
					this.updateGroupBounds(c);
				};
				view.refresh(canvas);
			}
		}
	}

	/**
	 * Obsidian's own Delete key bypasses the mind map commands. When a save
	 * shows that nodes disappeared, close the gap they left behind.
	 */
	private relayoutAfterNodeRemoval(canvas: Canvas): void {
		const ids = new Set(canvas.nodes.keys());
		const previous = this.knownNodeIds;
		this.knownNodeIds = ids;
		if (!previous || this.removalRelayoutPending) return;
		let removed = false;
		for (const id of previous) {
			if (!ids.has(id)) {
				removed = true;
				break;
			}
		}
		if (!removed || !this.settings.autoLayoutOnEdit || !this.isMindmapCanvas(canvas)) return;
		this.removalRelayoutPending = true;
		this.trackedRaf(canvas.wrapperEl.win, () => {
			this.removalRelayoutPending = false;
			if (this.canvasApi.getActiveCanvas() !== canvas) return;
			this.canvasApi.invalidateEdgeIndex();
			this.preserveViewport(canvas, () => this.layoutEngine.layout(canvas), "center");
			this.updateGroupBounds(canvas);
			this.branchCollapseHandle?.refresh();
		});
	}

	/** Flag an animated relayout so summaries can move along instead of snapping. */
	private markLayoutAnimating(canvas: Canvas): void {
		canvas.wrapperEl.addClass(LAYOUT_ANIMATING_CLASS);
		this.trackedTimeout(canvas.wrapperEl.win, () => {
			canvas.wrapperEl.removeClass(LAYOUT_ANIMATING_CLASS);
		}, 360);
	}

	/** IDs of selected content nodes (groups excluded). */
	private getSelectedNodeIds(canvas: Canvas): string[] {
		const groupIds = getGroupIds(canvas);
		return Array.from(canvas.selection)
			.filter((item): item is CanvasNode => "nodeEl" in item && !groupIds.has(item.id))
			.map((node) => node.id);
	}

	/**
	 * Collect a node and all its descendants via BFS.
	 */
	private collectSubtreeNodes(canvas: Canvas, root: import("./types/canvas-internal").CanvasNode): import("./types/canvas-internal").CanvasNode[] {
		const result = [root];
		const visited = new Set<string>([root.id]);
		const queue = [root.id];
		while (queue.length > 0) {
			const id = queue.shift()!;
			for (const edge of this.canvasApi.getOutgoingEdges(canvas, id)) {
				const childId = edge.to.node.id;
				if (!visited.has(childId)) {
					visited.add(childId);
					result.push(edge.to.node);
					queue.push(childId);
				}
			}
		}
		return result;
	}

	/**
	 * Recalculate bounds for all groups to tightly fit their contained subtrees.
	 * A root node belongs to a group if its center is inside the group's current bounds.
	 */
	updateGroupBounds(canvas: Canvas): void {
		const PADDING = 20;
		const groupIds = getGroupIds(canvas);
		if (groupIds.size === 0) return;
		const bracketIds = getSummaryBracketIds(canvas);

		let changed = false;

		for (const groupId of groupIds) {
			if (bracketIds.has(groupId)) continue;
			const group = canvas.nodes.get(groupId);
			if (!group) continue;

			const gx = group.x;
			const gy = group.y;
			const gw = group.width;
			const gh = group.height;

			// Collect subtrees of all non-group nodes whose center is inside this group
			const contained = new Set<import("./types/canvas-internal").CanvasNode>();
			for (const node of canvas.nodes.values()) {
				if (groupIds.has(node.id)) continue;
				const cx = node.x + node.width / 2;
				const cy = node.y + node.height / 2;
				if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
					for (const n of this.collectSubtreeNodes(canvas, node)) {
						contained.add(n);
					}
				}
			}

			// No nodes inside — leave group unchanged
			if (contained.size === 0) continue;

			// Compute bounding box
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (const node of contained) {
				minX = Math.min(minX, node.x);
				minY = Math.min(minY, node.y);
				maxX = Math.max(maxX, node.x + node.width);
				maxY = Math.max(maxY, node.y + node.height);
			}

			const newX = minX - PADDING;
			const newY = minY - PADDING;
			const newW = (maxX - minX) + PADDING * 2;
			const newH = (maxY - minY) + PADDING * 2;

			// Only resize if bounds actually changed
			if (newX !== gx || newY !== gy || newW !== gw || newH !== gh) {
				group.nodeEl?.addClass('mindmap-group-animating');
				group.moveAndResize({ x: newX, y: newY, width: newW, height: newH });
				changed = true;
			}
		}

		if (changed) {
			canvas.requestSave();
			// Remove animation class after transition completes
			this.trackedTimeout(canvas.wrapperEl.win, () => {
				for (const groupId of groupIds) {
					const group = canvas.nodes.get(groupId);
					group?.nodeEl?.removeClass('mindmap-group-animating');
				}
			}, 260);
		}
	}

	/**
	 * Re-measure text nodes whenever Obsidian mounts or re-renders their
	 * Markdown preview. Canvas virtualizes off-screen content, so a one-shot
	 * timer cannot reliably size every node.
	 */
	private registerRenderedNodeAutoResize(canvas: Canvas): void {
		const pendingIds = new Set<string>();
		const SETTLE_MS = 160;
		let settleTimer: { id: number; win: Window } | null = null;
		const queueNode = (node: CanvasNode | undefined): void => {
			if (!node || node.isEditing) return;
			pendingIds.add(node.id);
			// Restart the timer on every render so a scroll produces one relayout, not many.
			if (settleTimer) {
				settleTimer.win.clearTimeout(settleTimer.id);
				this.pendingTimers.delete(settleTimer);
			}
			settleTimer = this.trackedTimeout(canvas.wrapperEl.win, () => {
				settleTimer = null;
				if (this.canvasApi.getActiveCanvas() !== canvas) {
					pendingIds.clear();
					return;
				}
				const nodes = Array.from(pendingIds, (id) => canvas.nodes.get(id))
					.filter((node): node is CanvasNode => !!node);
				pendingIds.clear();
				let changed = false;
				this.preserveViewport(canvas, () => {
					changed = this.resizeNodes(canvas, nodes);
					if (changed && this.settings.autoLayout && this.isMindmapCanvas(canvas)) {
						this.layoutEngine.layout(canvas, new Set(canvas.nodes.keys()));
					}
				}, "center");
				if (!changed) return;
				this.updateGroupBounds(canvas);
				this.branchCollapseHandle?.refresh();
			}, SETTLE_MS);
		};
		const queueFromElement = (value: unknown, includeDescendants = false): void => {
			if (!isHtmlElement(value)) return;
			const contentEl = value.matches(".canvas-node-content")
				? value
				: value.closest<HTMLElement>(".canvas-node-content")
					?? (includeDescendants
						? value.querySelector<HTMLElement>(".canvas-node-content")
						: null);
			if (!contentEl?.querySelector(".markdown-preview-sizer")) return;
			const nodeEl = contentEl.closest<HTMLElement>(".canvas-node");
			if (!nodeEl) return;
			for (const node of canvas.nodes.values()) {
				if (node.nodeEl === nodeEl) {
					queueNode(node);
					return;
				}
			}
		};
		const Observer = Reflect.get(canvas.wrapperEl.win, "MutationObserver") as typeof MutationObserver;
		const observer = new Observer((mutations) => {
			for (const mutation of mutations) {
				queueFromElement(mutation.target);
				for (const added of Array.from(mutation.addedNodes)) {
					queueFromElement(added, true);
				}
			}
		});
		observer.observe(canvas.wrapperEl, { childList: true, subtree: true });
		this.pendingObservers.add(observer);
		for (const node of canvas.nodes.values()) queueNode(node);
	}

	/** Keep the Markdown source numbers equal to the ordered-list preview. */
	private queueOrderedListRenumber(canvas: Canvas, node: CanvasNode): void {
		if (!node.isEditing || this.pendingOrderedListRenumberNodes.has(node.id)) return;
		this.pendingOrderedListRenumberNodes.add(node.id);
		this.trackedRaf(canvas.wrapperEl.win, () => {
			this.pendingOrderedListRenumberNodes.delete(node.id);
			this.renumberOrderedListNow(canvas, node);
		});
	}

	private renumberOrderedListNow(canvas: Canvas, node: CanvasNode): boolean {
		if (this.canvasApi.getActiveCanvas() !== canvas || !node.isEditing) return false;
		const editor = node.child?.editor;
		if (editor?.getValue && editor.replaceRange && editor.offsetToPos) {
			const changes = computeOrderedListRenumberChanges(editor.getValue());
			if (changes.length === 0) return false;
			// Apply back to front so earlier offsets stay valid.
			for (const change of [...changes].sort((a, b) => b.from - a.from)) {
				editor.replaceRange(change.insert, editor.offsetToPos(change.from), editor.offsetToPos(change.to));
			}
			return true;
		}
		const view = this.keyboardHandler.getEditorView(node);
		if (!view) return false;
		const changes = computeOrderedListRenumberChanges(view.state.doc.toString());
		if (changes.length === 0) return false;
		view.dispatch({ changes });
		return true;
	}

	/**
	 * Wait for a node's preview sizer to appear in the DOM, then invoke callback.
	 * Uses MutationObserver instead of arbitrary setTimeout for precise timing.
	 */
	private waitForPreview(node: import("./types/canvas-internal").CanvasNode, callback: () => void): void {
		const sizer = node.contentEl?.querySelector(".markdown-preview-sizer");
		if (sizer && !node.isEditing) {
			callback();
			return;
		}
		const Observer = Reflect.get(node.contentEl.win, "MutationObserver") as typeof MutationObserver;
		const observer = new Observer(() => {
			const s = node.contentEl?.querySelector(".markdown-preview-sizer");
			if (s && !node.isEditing) {
				observer.disconnect();
				this.pendingObservers.delete(observer);
				this.trackedRaf(node.contentEl.win, () => callback());
			}
		});
		this.pendingObservers.add(observer);
		observer.observe(node.contentEl, { childList: true, subtree: true });
		this.trackedTimeout(node.contentEl.win, () => {
			observer.disconnect();
			this.pendingObservers.delete(observer);
		}, 500);
	}

	/**
	 * Keep the viewport stable while automatic resize/layout mutates nodes.
	 * With an anchor, the viewport follows that node so it stays at the same
	 * screen position even when the whole map is re-laid out around it;
	 * "center" anchors the node closest to the middle of the screen.
	 */
	private preserveViewport(
		canvas: Canvas,
		mutate: () => void,
		anchor: CanvasNode | "center" | null = null
	): void {
		const viewport = { x: canvas.x, y: canvas.y, tx: canvas.tx, ty: canvas.ty, zoom: canvas.zoom, tZoom: canvas.tZoom };
		const anchorNode = anchor === "center" ? this.findViewportAnchor(canvas) : anchor;
		const before = anchorNode ? { x: anchorNode.x, y: anchorNode.y } : null;
		mutate();
		let dx = 0;
		let dy = 0;
		if (anchorNode && before && canvas.nodes.get(anchorNode.id) === anchorNode) {
			dx = anchorNode.x - before.x;
			dy = anchorNode.y - before.y;
		}
		const restore = () => {
			canvas.x = viewport.x + dx;
			canvas.y = viewport.y + dy;
			canvas.tx = viewport.tx + dx;
			canvas.ty = viewport.ty + dy;
			canvas.zoom = viewport.zoom;
			canvas.tZoom = viewport.tZoom;
			canvas.requestFrame();
		};
		restore();
		this.trackedRaf(canvas.wrapperEl.win, restore);
	}

	/** The visible node whose center is closest to the middle of the viewport. */
	private findViewportAnchor(canvas: Canvas): CanvasNode | null {
		let best: CanvasNode | null = null;
		let bestDistance = Infinity;
		for (const node of canvas.nodes.values()) {
			if (node.nodeEl?.hasClass("cammvas-canvas-branch-hidden")) continue;
			const distance = Math.hypot(
				node.x + node.width / 2 - canvas.x,
				node.y + node.height / 2 - canvas.y
			);
			if (distance < bestDistance) {
				bestDistance = distance;
				best = node;
			}
		}
		return best;
	}

	/**
	 * Finalize an edit. By default, preserves manually arranged node positions.
	 * When autoLayoutOnEdit is enabled, re-arranges the edited node's tree.
	 */
	private finalizeEdit(canvas: Canvas, node: CanvasNode): void {
		if (this.settings.autoLayoutOnEdit) {
			const forest = buildForest(canvas);
			const treeNode = findTreeForNode(forest, node.id);
			if (treeNode) {
				let root = treeNode;
				while (root.parent) root = root.parent;
				this.layoutEngine.layout(canvas);
			}
		}
		this.updateGroupBounds(canvas);
	}

	/** Measure rendered Markdown blocks without including Obsidian's flex filler. */
	private measurePreviewContentHeight(node: CanvasNode, sizer: HTMLElement): number | null {
		const children = Array.from(sizer.children).filter(isHtmlElement);
		if (children.length === 0) return node.text ? null : 0;
		let minTop = Infinity;
		let maxBottom = -Infinity;
		for (const child of children) {
			const style = child.ownerDocument.defaultView?.getComputedStyle(child);
			const marginTop = Number.parseFloat(style?.marginTop ?? "0") || 0;
			const marginBottom = Number.parseFloat(style?.marginBottom ?? "0") || 0;
			minTop = Math.min(minTop, child.offsetTop - marginTop);
			maxBottom = Math.max(maxBottom, child.offsetTop + child.offsetHeight + marginBottom);
		}
		if (!Number.isFinite(minTop) || !Number.isFinite(maxBottom)) return null;
		const VERTICAL_PADDING = 24;
		const NODE_CHROME = 2;
		return Math.ceil(Math.max(0, maxBottom - minTop) + VERTICAL_PADDING + NODE_CHROME);
	}

	/** Resize rendered nodes to their content while preserving manual widths. */
	private resizeNodes(canvas: Canvas, nodes: CanvasNode[]): boolean {
		const minH = this.settings.defaultNodeHeight;
		let changed = false;
		for (const node of nodes) {
			// Collapsed (display:none) cards measure as empty; never shrink them.
			if (!node.isEditing && node.nodeEl && node.nodeEl.offsetParent === null) continue;
			let desiredH: number | null = null;
			if (node.isEditing) {
				const { cmContent, scroller } = getEditorElements(node);
				if (cmContent && scroller) {
					const contentH = Math.max(
						cmContent.scrollHeight,
						cmContent.offsetHeight,
						cmContent.getBoundingClientRect().height
					);
					const chrome = Math.max(0, node.height - scroller.clientHeight);
					desiredH = Math.ceil(contentH + chrome + 12);
				}
			}
			if (desiredH === null) {
				const sizer = node.contentEl?.querySelector<HTMLElement>(".markdown-preview-sizer");
				if (!sizer) continue;
				desiredH = this.measurePreviewContentHeight(node, sizer);
			}
			if (desiredH === null) continue;
			const targetH = Math.max(desiredH, minH, getManualMinHeight(node));
			if (targetH === node.height) continue;
			node.moveAndResize({ x: node.x, y: node.y, width: node.width, height: targetH });
			changed = true;
		}
		if (changed) canvas.requestSave();
		return changed;
	}

	private finishInsertNode(canvas: Canvas, newNode: CanvasNode, nearNode: CanvasNode): void {
		const forest = buildForest(canvas);
		const treeNode = findTreeForNode(forest, nearNode.id);
		if (treeNode) {
			let root = treeNode;
			while (root.parent) root = root.parent;
			if (this.settings.autoLayout) {
				this.layoutEngine.layout(canvas, new Set([newNode.id]));
			}
		}
		if (this.settings.autoColor && this.isMindmapCanvas(canvas)) {
			this.branchColors.applyColors(canvas);
		}
		this.updateGroupBounds(canvas);
		this.canvasApi.selectAndEdit(canvas, newNode, this.settings.navigationZoomPadding);
	}

	private showOutline(canvas: Canvas, reveal = !Platform.isMobile): void {
		const leaves = this.app.workspace.getLeavesOfType(OUTLINE_VIEW_TYPE);
		if (leaves.length > 0) {
			this.refreshOutline(canvas);
			if (reveal) void this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		void leaf.setViewState({ type: OUTLINE_VIEW_TYPE }).then(() => {
			if (reveal) void this.app.workspace.revealLeaf(leaf);
			if (!Platform.isMobile) this.reorderOutlineToTop(leaf);
			this.refreshOutline(canvas);
		});
	}

	private hideOutline(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_VIEW_TYPE)) {
			leaf.detach();
		}
	}

	private reorderOutlineToTop(leaf: WorkspaceLeaf): void {
		const parent = leaf.parent;
		if (!parent?.children) return;
		const children = parent.children;
		const idx = children.indexOf(leaf);
		if (idx > 0) {
			children.splice(idx, 1);
			children.unshift(leaf);
		}
		parent.selectTab?.(leaf);
	}

	/**
	 * Import a FreeMind .mm file and create a .canvas file.
	 * @param folderPath Optional target folder; defaults to vault root.
	 */
	private importFreeMindFile(folderPath?: string): void {
		// Open native file picker for .mm files
		const input = createEl("input");
		input.type = "file";
		input.accept = ".mm";
		const handler = () => {
			input.removeEventListener("change", handler);
			const file = input.files?.[0];
			if (!file) return;

			void (async () => {
				const xml = await file.text();
				const canvasData = freemindToCanvas(xml, {
					nodeWidth: this.settings.defaultNodeWidth,
					nodeHeight: this.settings.defaultNodeHeight,
					horizontalGap: this.settings.horizontalGap,
					verticalGap: this.settings.verticalGap,
				});

				if (!canvasData) {
					new Notice(
						tr("Failed to parse .mm file. Make sure it is a valid mind map file.", "无法解析 .mm 文件，请确认它是有效的思维导图文件。")
					);
					return;
				}

				const baseName = file.name.replace(/\.mm$/i, "");
				const folder = folderPath ? folderPath + "/" : "";
				let canvasPath = `${folder}${baseName}.canvas`;

				// Avoid overwriting existing files
				let counter = 1;
				while (this.app.vault.getAbstractFileByPath(canvasPath)) {
					canvasPath = `${folder}${baseName} ${counter}.canvas`;
					counter++;
				}

				await this.app.vault.create(
					canvasPath,
					JSON.stringify(canvasData, null, "\t")
				);

				// Open the new canvas
				const created = this.app.vault.getAbstractFileByPath(canvasPath);
				if (created instanceof TFile) {
					await this.app.workspace.getLeaf(false).openFile(created);
				}

				new Notice(
					tr(`Imported "${file.name}" as "${canvasPath}"`, `已将 "${file.name}" 导入为 "${canvasPath}"`)
				);
			})();
		};
		input.addEventListener("change", handler);
		input.click();
	}

	isMindmapCanvas(canvas: Canvas): boolean {
		const data = canvas.getData();
		if (typeof data.mindmap === 'boolean') return data.mindmap;
		return this.settings.defaultMindmapMode;
	}

	private toggleMindmapMode(canvas: Canvas): void {
		const newValue = !this.isMindmapCanvas(canvas);
		writeCanvasDataKey(canvas, "mindmap", newValue);
		canvas.wrapperEl.toggleClass("cammvas-mindmap", newValue);

		// Re-apply or remove auto-color
		if (newValue && this.settings.autoColor) {
			this.branchColors.applyColors(canvas);
		}

		if (newValue) {
			this.showOutline(canvas);
		} else {
			this.hideOutline();
		}

		this.updateToggleButton(canvas);
		this.updateDragReparentButton(canvas);
		this.updateAutoLayoutOnEditButton(canvas);
		this.updateLayoutButton(canvas);
		this.updateExportPdfButton(canvas);
		this.updateEnterTabButton(canvas);
		this.updateMobileActionsButton(canvas);
		this.mobileEditingBarHandle?.refresh();
	}

	private injectToggleButton(canvas: Canvas): void {
		// Remove previous button
		if (this.toggleBtnEl) {
			this.toggleBtnEl.remove();
			this.toggleBtnEl = null;
		}
		if (this.dragReparentBtnEl) {
			this.dragReparentBtnEl.remove();
			this.dragReparentBtnEl = null;
		}
		if (this.autoLayoutOnEditBtnEl) {
			this.autoLayoutOnEditBtnEl.remove();
			this.autoLayoutOnEditBtnEl = null;
		}
		if (this.layoutBtnEl) {
			this.layoutBtnEl.remove();
			this.layoutBtnEl = null;
		}
		if (this.exportPdfBtnEl) {
			this.exportPdfBtnEl.remove();
			this.exportPdfBtnEl = null;
		}
		if (this.enterTabBtnEl) {
			this.enterTabBtnEl.remove();
			this.enterTabBtnEl = null;
		}
		if (this.mobileActionsBtnEl) {
			this.mobileActionsBtnEl.remove();
			this.mobileActionsBtnEl = null;
		}
		const controls = canvas.view.containerEl.querySelector('.canvas-controls');
		if (!controls) return;

		const btn = controls.createEl('button', { attr: { type: 'button' } });
		btn.addClass('cammvas-toggle-btn', 'clickable-icon');
		this.registerDomEvent(btn, 'click', (e) => {
			e.stopPropagation();
			this.showMindmapMenu(btn, canvas);
		});

		controls.prepend(btn);
		this.toggleBtnEl = btn;
		const exportPdfBtn = btn;

		if (Platform.isMobile) {
			const actionsBtn = controls.createEl('button', { attr: { type: 'button' } });
			actionsBtn.addClass('cammvas-toggle-btn', 'cammvas-mobile-actions-btn', 'clickable-icon');
			actionsBtn.setAttribute('aria-label', 'Mind map actions');
			setIcon(actionsBtn, 'list-plus');
			this.registerDomEvent(actionsBtn, 'click', (event) => {
				event.stopPropagation();
				this.showMobileActionsMenu(canvas, actionsBtn);
			});
			exportPdfBtn.after(actionsBtn);
			this.mobileActionsBtnEl = actionsBtn;
		}

		this.updateToggleButton(canvas);
		this.updateDragReparentButton(canvas);
		this.updateAutoLayoutOnEditButton(canvas);
		this.updateExportPdfButton(canvas);
		this.updateEnterTabButton(canvas);
		this.updateMobileActionsButton(canvas);
	}

	/** Everything mind-map related behind one toolbar button. */
	private showMindmapMenu(anchor: HTMLElement, canvas: Canvas): void {
		const menu = new Menu();
		const isMindmap = this.isMindmapCanvas(canvas);
		menu.addItem((item) => item
			.setTitle(tr("Mindmap mode", "导图模式"))
			.setIcon("network")
			.setChecked(isMindmap)
			.onClick(() => this.toggleMindmapMode(canvas)));
		if (isMindmap) {
			const toggle = (
				title: string,
				icon: string,
				key: "dragToReparent" | "autoLayoutOnEdit" | "enterCreatesSibling",
				disabled = false
			): void => {
				menu.addItem((item) => item
					.setTitle(title)
					.setIcon(icon)
					.setChecked(this.settings[key])
					.setDisabled(disabled)
					.onClick(() => {
						this.settings[key] = !this.settings[key];
						void this.saveSettings();
					}));
			};
			menu.addSeparator();
			toggle(tr("Drag to reparent", "拖拽改父节点"), "git-branch", "dragToReparent", !canvas.handleSelectionDrag);
			toggle(tr("Auto-layout on manual edits", "手动编辑后自动排版"), "layout-grid", "autoLayoutOnEdit");
			if (!Platform.isMobile) {
				toggle(tr("Mind mapping Enter and Tab", "导图式 Enter 与 Tab"), "keyboard", "enterCreatesSibling");
			}
			menu.addSeparator();
			for (const [orientation, title, icon] of [
				["horizontal", tr("Horizontal layout", "横向布局"), "rows-3"],
				["vertical", tr("Vertical layout", "纵向布局"), "columns-3"],
			] as const) {
				menu.addItem((item) => item
					.setTitle(title)
					.setIcon(icon)
					.setDisabled(canvas.nodes.size === 0)
					.onClick(() => this.applyLayout(canvas, orientation)));
			}
			menu.addSeparator();
			menu.addItem((item) => item
				.setTitle(tr("Export as high-quality PDF", "导出高清 PDF"))
				.setIcon("file-down")
				.setDisabled(canvas.nodes.size === 0)
				.onClick(() => {
					void this.exportMindmapPdf(canvas);
				}));
			menu.addItem((item) => item
				.setTitle(tr("Open map outline", "打开导图大纲"))
				.setIcon("list-tree")
				.onClick(() => this.showOutline(canvas, true)));
		}
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private showMobileActionsMenu(canvas: Canvas, anchor: HTMLElement): void {
		const menu = new Menu();
		const selected = this.canvasApi.getSelectedNode(canvas);
		const isMindmap = this.isMindmapCanvas(canvas);
		menu.addItem((item) => item
			.setTitle(tr("Create root node", "新建根节点"))
			.setIcon("circle-plus")
			.setDisabled(!isMindmap)
			.onClick(() => this.createRootNode()));
		if (selected && isMindmap) {
			menu.addItem((item) => item
				.setTitle(tr("Add child node", "新建子节点"))
				.setIcon("corner-down-right")
				.onClick(() => this.keyboardHandler.addChildNode(canvas, selected)));
			menu.addItem((item) => item
				.setTitle(tr("Add sibling node", "新建兄弟节点"))
				.setIcon("list-plus")
				.onClick(() => this.keyboardHandler.addSiblingNode(canvas, selected)));
			menu.addItem((item) => item
				.setTitle(tr("Zoom to branch", "缩放到分支"))
				.setIcon("scan")
				.onClick(() => this.navigation.zoomToBranch(canvas, selected)));
			menu.addItem((item) => item
				.setTitle(tr("Re-layout selected branch", "重新排版选中分支"))
				.setIcon("list-tree")
				.onClick(() => this.relayoutSelectedBranch(canvas, selected)));
		}
		menu.addItem((item) => item
			.setTitle(tr("Re-layout mind map", "重新排版导图"))
			.setIcon("layout-template")
			.setDisabled(!isMindmap)
			.onClick(() => {
				this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
			}));
		menu.addItem((item) => item
			.setTitle(tr("Export as high-quality PDF", "导出高清 PDF"))
			.setIcon("file-down")
			.setDisabled(!isMindmap || canvas.nodes.size === 0)
			.onClick(() => {
				void this.exportMindmapPdf(canvas);
			}));
		menu.addItem((item) => item
			.setTitle(tr("Open map outline", "打开导图大纲"))
			.setIcon("list-tree")
			.onClick(() => this.showOutline(canvas, true)));
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	private showBranchColorMenu(
		event: MouseEvent | KeyboardEvent,
		canvas: Canvas,
		nodeId: string,
		colors: ReadonlyArray<readonly [string, string]>
	): void {
		const colorMenu = new Menu();
		for (const [color, label] of colors) {
			colorMenu.addItem((item) => item
				.setTitle(label)
				.setIcon(`cammvas-color-${color}`)
				.onClick(() => this.branchColors.setBranchColor(canvas, nodeId, color)));
		}
		colorMenu.showAtMouseEvent(event as MouseEvent);
	}

	private showLayoutMenu(event: MouseEvent, canvas: Canvas): void {
		if (!this.isMindmapCanvas(canvas)) return;
		const layoutMenu = new Menu();
		for (const [orientation, title, icon] of [
			["horizontal", tr("Horizontal layout", "横向布局"), "rows-3"],
			["vertical", tr("Vertical layout", "纵向布局"), "columns-3"],
		] as const) {
			layoutMenu.addItem((item) => item
				.setTitle(title)
				.setIcon(icon)
				.onClick(() => this.applyLayout(canvas, orientation)));
		}
		layoutMenu.showAtMouseEvent(event);
	}

	private applyLayout(canvas: Canvas, orientation: LayoutOrientation): void {
		this.layoutEngine.layout(canvas, new Set(), orientation);
		this.updateGroupBounds(canvas);
	}

	private exportMindmapPdf(canvas: Canvas): void {
		const fileName = canvas.view.file.path.split("/").pop()?.replace(/\.canvas$/i, "") || "mindmap";
		new PdfExportModal(this.app, fileName, (name, folder, pageSize) => {
			void this.saveMindmapPdf(canvas, name, folder, pageSize);
		}).open();
	}

	private async saveMindmapPdf(
		canvas: Canvas,
		fileName: string,
		outputFolder: string,
		pageSize: import("./export/pdf-export").PdfPageSize
	): Promise<void> {
		const safeName = fileName.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "-") || "mindmap";
		try {
			const pdf = await createMindmapPdf(canvas, safeName, async (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) return null;
				return new Uint8Array(await this.app.vault.readBinary(file));
			}, pageSize);
			if (!pdf) {
				new Notice(tr("Unable to prepare the PDF export.", "无法准备 PDF 导出。"));
				return;
			}
			const folder = await this.ensureExportFolder(outputFolder);
			let outputPath = `${folder ? `${folder}/` : ""}${safeName}.pdf`;
			let index = 2;
			while (this.app.vault.getAbstractFileByPath(outputPath)) {
				outputPath = `${folder ? `${folder}/` : ""}${safeName} ${index++}.pdf`;
			}
			await this.app.vault.createBinary(outputPath, pdf);
			new Notice(tr(`PDF exported (${pageSize.toUpperCase()}) to ${outputPath}`, `PDF（${pageSize.toUpperCase()}）已导出到 ${outputPath}`));
		} catch (error) {
			console.error("Cammvas PDF export failed", error);
			new Notice(tr("Unable to export the PDF. Check the developer console for details.", "PDF 导出失败，详情见开发者控制台。"));
		}
	}

	private async ensureExportFolder(value: string): Promise<string> {
		const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
		if (parts.some((part) => part === "." || part === "..")) {
			throw new Error("Invalid export folder path");
		}
		let path = "";
		for (const part of parts) {
			path = path ? `${path}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (!existing) {
				await this.app.vault.createFolder(path);
			} else if (!(existing instanceof TFolder)) {
				throw new Error(`Export folder path is a file: ${path}`);
			}
		}
		return path;
	}

	private updateToggleButton(canvas: Canvas): void {
		if (!this.toggleBtnEl) return;
		const isActive = this.isMindmapCanvas(canvas);
		this.toggleBtnEl.empty();
		setIcon(this.toggleBtnEl, isActive ? 'network' : 'layout-dashboard');
		this.toggleBtnEl.toggleClass('is-active', isActive);
		this.toggleBtnEl.setAttribute('aria-label',
			isActive ? tr("Mind map (on)", "导图（已开启）") : tr("Mind map (off)", "导图（未开启）"));
	}

	private updateDragReparentButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.dragReparentBtnEl) return;
		const mindmapEnabled = !!canvas && this.isMindmapCanvas(canvas);
		const controlEnabled = mindmapEnabled && !!canvas.handleSelectionDrag;
		const isActive = controlEnabled && this.settings.dragToReparent;
		this.dragReparentBtnEl.empty();
		setIcon(this.dragReparentBtnEl, 'git-branch');
		this.dragReparentBtnEl.toggleClass('is-active', isActive);
		this.dragReparentBtnEl.toggleAttribute('disabled', !controlEnabled);
		this.dragReparentBtnEl.setAttribute('aria-disabled', String(!controlEnabled));
		this.dragReparentBtnEl.setAttribute(
			'aria-label',
			!mindmapEnabled
				? 'Drag to reparent (requires mindmap mode)'
				: isActive ? 'Drag to reparent (active)' : 'Drag to reparent (inactive)'
		);
	}

	private updateAutoLayoutOnEditButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.autoLayoutOnEditBtnEl) return;
		const controlEnabled = !!canvas && this.isMindmapCanvas(canvas);
		const isActive = controlEnabled && this.settings.autoLayoutOnEdit;
		this.autoLayoutOnEditBtnEl.empty();
		setIcon(this.autoLayoutOnEditBtnEl, 'layout-grid');
		this.autoLayoutOnEditBtnEl.toggleClass('is-active', isActive);
		this.autoLayoutOnEditBtnEl.toggleAttribute('disabled', !controlEnabled);
		this.autoLayoutOnEditBtnEl.setAttribute('aria-disabled', String(!controlEnabled));
		this.autoLayoutOnEditBtnEl.setAttribute(
			'aria-label',
			!controlEnabled
				? 'Auto-layout on manual edits (requires mindmap mode)'
				: isActive ? 'Auto-layout on manual edits (active)' : 'Auto-layout on manual edits (inactive)'
		);
	}

	private updateLayoutButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.layoutBtnEl) return;
		const enabled = !!canvas && this.isMindmapCanvas(canvas) && canvas.nodes.size > 0;
		this.layoutBtnEl.empty();
		setIcon(this.layoutBtnEl, "layout-template");
		this.layoutBtnEl.toggleAttribute("disabled", !enabled);
		this.layoutBtnEl.setAttribute("aria-disabled", String(!enabled));
		this.layoutBtnEl.setAttribute(
			"aria-label",
			enabled ? "Choose mindmap layout" : "Choose layout (requires a non-empty mindmap)"
		);
	}

	private updateExportPdfButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.exportPdfBtnEl) return;
		const enabled = !!canvas && this.isMindmapCanvas(canvas) && canvas.nodes.size > 0;
		this.exportPdfBtnEl.empty();
		setIcon(this.exportPdfBtnEl, "file-down");
		this.exportPdfBtnEl.toggleAttribute("disabled", !enabled);
		this.exportPdfBtnEl.setAttribute("aria-disabled", String(!enabled));
		this.exportPdfBtnEl.setAttribute(
			"aria-label",
			enabled ? "Export as high-quality PDF" : "Export PDF (requires a non-empty mindmap)"
		);
	}

	private updateEnterTabButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.enterTabBtnEl) return;
		const controlEnabled = !!canvas && this.isMindmapCanvas(canvas);
		const isActive = controlEnabled && this.settings.enterCreatesSibling;
		this.enterTabBtnEl.empty();
		setIcon(this.enterTabBtnEl, 'keyboard');
		this.enterTabBtnEl.toggleClass('is-active', isActive);
		this.enterTabBtnEl.toggleAttribute('disabled', !controlEnabled);
		this.enterTabBtnEl.setAttribute('aria-disabled', String(!controlEnabled));
		this.enterTabBtnEl.setAttribute(
			'aria-label',
			!controlEnabled
				? 'Mind mapping Enter and Tab (requires mindmap mode)'
				: isActive ? 'Mind mapping Enter and Tab (active)' : 'Mind mapping Enter and Tab (inactive)'
		);
	}

	private updateMobileActionsButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.mobileActionsBtnEl) return;
		const controlEnabled = !!canvas && this.isMindmapCanvas(canvas);
		this.mobileActionsBtnEl.toggleAttribute('disabled', !controlEnabled);
		this.mobileActionsBtnEl.setAttribute('aria-disabled', String(!controlEnabled));
		this.mobileActionsBtnEl.setAttribute(
			'aria-label',
			controlEnabled ? 'Mind map actions' : 'Mind map actions (requires mindmap mode)'
		);
	}

	private relayoutSelectedBranch(canvas: Canvas, branchParent?: CanvasNode): void {
		if (!this.isMindmapCanvas(canvas)) {
			new Notice(tr("Enable mindmap mode before re-layout", "请先开启导图模式再排版"));
			return;
		}
		const node = branchParent ?? this.canvasApi.getSelectedNode(canvas);
		if (!node) {
			new Notice(tr("Select a branch parent before re-layout", "请先选中一个有子分支的节点"));
			return;
		}
		if (this.canvasApi.getChildNodes(canvas, node).length === 0) {
			new Notice(tr("The selected node has no child branch to re-layout", "选中的节点没有可排版的子分支"));
			return;
		}

		// Keep an active editor session intact. Auto-resize already maintains its
		// live node height, and finalizing here would detach its iframe listeners.
		this.layoutEngine.layoutChildren(canvas, node.id);
		this.updateGroupBounds(canvas);
		this.branchCollapseHandle?.refresh();
	}

	/** Schedule a setTimeout that is automatically cancelled on unload/canvas switch. */
	private trackedTimeout(win: Window, callback: () => void, ms: number): { id: number; win: Window } {
		const pending = { id: 0, win };
		pending.id = win.setTimeout(() => {
			this.pendingTimers.delete(pending);
			callback();
		}, ms);
		this.pendingTimers.add(pending);
		return pending;
	}

	/** Schedule a requestAnimationFrame that is automatically cancelled on cleanup. */
	private trackedRaf(win: Window, callback: () => void): void {
		const pending = { id: 0, win };
		pending.id = win.requestAnimationFrame(() => {
			this.pendingRafs.delete(pending);
			callback();
		});
		this.pendingRafs.add(pending);
	}

	/** Cancel all pending tracked timers, RAFs, and observers. */
	private cancelPendingAsync(): void {
		for (const pending of this.pendingTimers) pending.win.clearTimeout(pending.id);
		this.pendingTimers.clear();
		for (const pending of this.pendingRafs) pending.win.cancelAnimationFrame(pending.id);
		this.pendingRafs.clear();
		this.pendingOrderedListRenumberNodes.clear();
		for (const obs of this.pendingObservers) obs.disconnect();
		this.pendingObservers.clear();
	}

	/** Restore wrapped canvas methods to originals. */
	private unwrapCanvasMethods(): void {
		if (this.interceptedCanvas) {
			if (this.origCanvasMethods.requestSave) {
				this.interceptedCanvas.requestSave = this.origCanvasMethods.requestSave;
			}
			if (this.origCanvasMethods.createGroupNode) {
				this.interceptedCanvas.createGroupNode = this.origCanvasMethods.createGroupNode;
			}
			if (this.origCanvasMethods.undo) {
				this.interceptedCanvas.undo = this.origCanvasMethods.undo;
			}
			if (this.origCanvasMethods.redo) {
				this.interceptedCanvas.redo = this.origCanvasMethods.redo;
			}
			if (this.origCanvasMethods.selectOnly) {
				this.interceptedCanvas.selectOnly = this.origCanvasMethods.selectOnly;
			}
			if (this.origCanvasMethods.showCreationMenu) {
				this.interceptedCanvas.showCreationMenu = this.origCanvasMethods.showCreationMenu;
			}
			this.interceptedCanvas.wrapperEl.removeClass("cammvas-mindmap");
		}
		this.interceptedCanvas = null;
		this.origCanvasMethods = {};
	}

	async loadSettings(): Promise<void> {
		const data: unknown = await this.loadData();
		this.settings = normalizeSettings(data);
	}

	async saveSettings(refreshBranchColors = false): Promise<void> {
		await this.saveData(this.settings);

		// Update services with new settings
		this.layoutEngine = new LayoutEngine({
			horizontalGap: this.settings.horizontalGap,
			verticalGap: this.settings.verticalGap,
			nodeWidth: this.settings.defaultNodeWidth,
			nodeHeight: this.settings.defaultNodeHeight,
		});
		this.nodeOps = new NodeOperations(this.canvasApi, {
			nodeWidth: this.settings.defaultNodeWidth,
			nodeHeight: this.settings.defaultNodeHeight,
			horizontalGap: this.settings.horizontalGap,
			verticalGap: this.settings.verticalGap,
		});
		this.branchColors = new BranchColors(
			this.canvasApi,
			this.settings.branchPalette,
			this.settings.colorLeafNodes
		);

		// Update keyboard handler references so it uses the new instances
		if (this.keyboardHandler) {
			this.keyboardHandler.nodeOps = this.nodeOps;
			this.keyboardHandler.layoutEngine = this.layoutEngine;
			this.keyboardHandler.branchColors = this.branchColors;
			this.keyboardHandler.zoomPadding = this.settings.navigationZoomPadding;
		}
		this.updateDragReparentButton();
		this.updateAutoLayoutOnEditButton();
		this.updateExportPdfButton();
		this.updateEnterTabButton();

		// Update edge label font size CSS variable
		const canvas = this.canvasApi.getActiveCanvas();
		if (canvas) {
			canvas.wrapperEl.style.setProperty("--cammvas-edge-label-font-size", `${this.settings.edgeLabelFontSize}px`);
		}

		if (refreshBranchColors && canvas && this.settings.autoColor && this.isMindmapCanvas(canvas)) {
			this.branchColors.applyColors(canvas);
		}
	}

	private createRootNode(): void {
		const canvas = this.canvasApi?.getActiveCanvas();
		if (!canvas) {
			new Notice(tr("Open a canvas before creating a root node", "请先打开一个画布再新建根节点"));
			return;
		}
		if (!this.isMindmapCanvas(canvas)) {
			new Notice(tr("Enable mindmap mode before creating a root node", "请先开启导图模式再新建根节点"));
			return;
		}

		const incomingIds = new Set(
			Array.from(canvas.edges.values(), (edge) => edge.to.node.id)
		);
		const groupIds = getGroupIds(canvas);
		const roots = Array.from(canvas.nodes.values()).filter(
			(node) => !groupIds.has(node.id) && !incomingIds.has(node.id)
		);

		let x: number;
		let y: number;
		const previousRoot = roots[roots.length - 1];
		if (previousRoot) {
			const subtree = this.collectSubtreeNodes(canvas, previousRoot);
			const subtreeBottom = Math.max(...subtree.map((node) => node.y + node.height));
			x = previousRoot.x;
			y = subtreeBottom + Math.max(40, this.settings.verticalGap * 2);
		} else {
			const rect = canvas.wrapperEl.getBoundingClientRect();
			const center = canvas.posFromEvt(new MouseEvent("mousemove", {
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2,
			}));
			x = center.x - this.settings.defaultNodeWidth / 2;
			y = center.y - this.settings.defaultNodeHeight / 2;
		}
		const node = this.canvasApi.createTextNode(
			canvas,
			x,
			y,
			"",
			this.settings.defaultNodeWidth,
			this.settings.defaultNodeHeight
		);
		canvas.requestSave();
		this.canvasApi.selectAndEdit(canvas, node, this.settings.navigationZoomPadding);
	}

	private registerBranchColorIcons(): void {
		const colors = [
			["1", "#e75545"],
			["2", "#e9973f"],
			["3", "#e0de71"],
			["4", "#44cf6e"],
			["5", "#53aaf5"],
			["6", "#a882f7"],
		] as const;
		for (const [id, color] of colors) {
			addIcon(`cammvas-color-${id}`, `<svg viewBox="0 0 24 24" fill="${color}"><circle cx="12" cy="12" r="8"/></svg>`);
		}
	}
}
