import { Notice } from "obsidian";
import type { Canvas, CanvasEdge, CanvasNode } from "../types/canvas-internal";
import { writeCanvasDataKey } from "../canvas/canvas-api";
import { collectCollapsedDescendantIds } from "../canvas/branch-collapse-state";
import { isHtmlElement } from "../ui/dom";
import {
	BRACKET_WIDTH,
	SUMMARY_DATA_KEY,
	SUMMARY_DEFAULT_TEXT,
	SummaryGraph,
	SummaryRecord,
	SummarySide,
	collectCoveredIds,
	computeSummaryGeometry,
	readSummaryRecords,
	reconcileSummaryRecords,
	validateSummarySelection,
} from "./summary-model";

export const SUMMARY_BRACKET_CLASS = "cammvas-summary-bracket";
export const SUMMARY_CONTENT_CLASS = "cammvas-summary-content";
export const SUMMARY_HIDDEN_CLASS = "cammvas-summary-hidden";

export interface SummaryHandle {
	/** Queue a sync on the next animation frame (deduplicated). */
	schedule: () => void;
	/** Reconcile records and reposition every bracket and summary subtree now. */
	syncNow: () => void;
	create: (selectedIds: string[]) => boolean;
	/** Remove the bracket and record; the content node stays as a free node. */
	removeBracket: (recordId: string) => void;
	findByContentNode: (nodeId: string) => SummaryRecord | null;
	isSummaryNode: (nodeId: string) => boolean;
	cleanup: () => void;
}

/** Read the summary records currently stored in a canvas. */
export function getSummaryRecords(canvas: Canvas): SummaryRecord[] {
	return readSummaryRecords(canvas.data ?? {});
}

/** IDs of group nodes used as summary brackets (never treat these as user groups). */
export function getSummaryBracketIds(canvas: Canvas): Set<string> {
	return new Set(getSummaryRecords(canvas).map((record) => record.bracketNodeId));
}

function makeId(): string {
	return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

export function registerSummaries(
	canvas: Canvas,
	onLayoutNeeded: () => void
): SummaryHandle {
	const win = canvas.wrapperEl.win;
	let disposed = false;
	let scheduled: number | null = null;
	let syncing = false;
	let drag: { recordId: string; nodeId: string; pointerId: number; x: number; y: number } | null = null;

	const graph = (): SummaryGraph => ({
		nodes: new Map(Array.from(canvas.nodes.values(), (node) => [node.id, node])),
		edges: Array.from(canvas.edges.values(), (edge) => ({
			from: edge.from.node.id,
			to: edge.to.node.id,
		})),
	});

	const writeRecords = (records: SummaryRecord[]): void => {
		writeCanvasDataKey(canvas, SUMMARY_DATA_KEY, records);
	};

	const hiddenByCollapse = (edges: SummaryGraph["edges"]): Set<string> => {
		const children = new Map<string, string[]>();
		for (const edge of edges) {
			const list = children.get(edge.from) ?? [];
			list.push(edge.to);
			children.set(edge.from, list);
		}
		const collapsed = canvas.getData().mindmapCollapsed ?? [];
		return collectCollapsedDescendantIds(collapsed, (id) => children.get(id) ?? []);
	};

	const setEdgeHidden = (edge: CanvasEdge, hidden: boolean): void => {
		for (const el of [
			edge.lineGroupEl, edge.lineEl, edge.lineEndGroupEl, edge.startGroupEl, edge.endGroupEl,
			edge.fromLineEnd?.el, edge.toLineEnd?.el, edge.labelElement?.wrapperEl,
			edge.path?.display, edge.path?.interaction,
		]) {
			el?.classList.toggle(SUMMARY_HIDDEN_CLASS, hidden);
		}
	};

	const updateConnector = (bracket: CanvasNode, summaryNode: CanvasNode, side: SummarySide): void => {
		const startX = side === "left" ? bracket.x : bracket.x + bracket.width;
		const startY = bracket.y + bracket.height / 2;
		const endX = side === "left" ? summaryNode.x + summaryNode.width : summaryNode.x;
		const endY = summaryNode.y + summaryNode.height / 2;
		const dx = endX - startX;
		const dy = endY - startY;
		bracket.nodeEl.style.setProperty("--cammvas-summary-line-length", `${Math.hypot(dx, dy)}px`);
		bracket.nodeEl.style.setProperty("--cammvas-summary-line-angle", `${Math.atan2(dy, dx)}rad`);
	};

	const syncNow = (): void => {
		if (disposed || syncing) return;
		syncing = true;
		try {
			sync();
		} finally {
			syncing = false;
		}
	};

	const sync = (): void => {
		let records = getSummaryRecords(canvas);
		if (records.length === 0) return;
		let g = graph();

		// Dissolve summaries whose content node, bracket or members disappeared.
		const reconciled = reconcileSummaryRecords(g, records);
		if (reconciled.changed) {
			for (const removal of reconciled.removals) {
				const bracket = removal.removeBracket ? canvas.nodes.get(removal.record.bracketNodeId) : null;
				if (bracket) canvas.removeNode(bracket);
				const content = removal.removeSummaryNode ? canvas.nodes.get(removal.record.summaryNodeId) : null;
				if (content) canvas.removeNode(content);
				else canvas.nodes.get(removal.record.summaryNodeId)?.nodeEl.removeClass(SUMMARY_CONTENT_CLASS);
			}
			if (reconciled.removals.length > 0) {
				new Notice(reconciled.removals.length === 1
					? "概要的成员不足两个，已解除该概要"
					: `已解除 ${reconciled.removals.length} 个失效的概要`);
			}
			records = reconciled.records;
			writeRecords(records);
			g = graph();
		}

		const hidden = hiddenByCollapse(g.edges);
		const contexts = records.map((record) => {
			const covered = collectCoveredIds(
				g.edges,
				record.memberNodeIds,
				new Set([record.bracketNodeId, record.summaryNodeId])
			);
			return { record, covered, coveredSet: new Set(covered) };
		});
		// A summary nested inside another's covered range is placed first so the
		// outer bracket can include the inner bracket and content.
		const contains = (outer: typeof contexts[number], inner: typeof contexts[number]): boolean =>
			outer !== inner && outer.coveredSet.has(inner.record.parentNodeId);
		contexts.sort((a, b) => (contains(a, b) ? 1 : contains(b, a) ? -1 : 0));

		let moved = false;
		for (const context of contexts) {
			const { record } = context;
			const bracket = canvas.nodes.get(record.bracketNodeId);
			const summaryNode = canvas.nodes.get(record.summaryNodeId);
			const parent = canvas.nodes.get(record.parentNodeId);
			const members = record.memberNodeIds
				.map((id) => canvas.nodes.get(id))
				.filter((node): node is CanvasNode => !!node);
			if (!bracket || !summaryNode || members.length < 2) continue;

			let side = record.side;
			if (parent) {
				const parentCx = parent.x + parent.width / 2;
				const memberCx = members.reduce((sum, node) => sum + node.x + node.width / 2, 0) / members.length;
				side = memberCx >= parentCx ? "right" : "left";
			}

			const summaryTree = collectCoveredIds(
				g.edges,
				[summaryNode.id],
				new Set([record.bracketNodeId, ...context.covered])
			);
			const allHidden = members.every((node) => hidden.has(node.id));
			const treeSet = new Set(summaryTree);
			bracket.nodeEl.toggleClass(SUMMARY_HIDDEN_CLASS, allHidden);
			for (const id of summaryTree) {
				canvas.nodes.get(id)?.nodeEl.toggleClass(SUMMARY_HIDDEN_CLASS, allHidden);
			}
			for (const edge of canvas.edges.values()) {
				if (treeSet.has(edge.from.node.id)) setEdgeHidden(edge, allHidden);
			}
			// A fully collapsed range keeps its last geometry until it is expanded again.
			if (allHidden) continue;

			const coveredIds = context.covered.filter((id) => !hidden.has(id));
			for (const nested of contexts) {
				if (!contains(context, nested)) continue;
				coveredIds.push(nested.record.bracketNodeId);
				coveredIds.push(...collectCoveredIds(
					g.edges,
					[nested.record.summaryNodeId],
					new Set([nested.record.bracketNodeId])
				).filter((id) => !hidden.has(id)));
			}
			const coveredRects = coveredIds
				.map((id) => canvas.nodes.get(id))
				.filter((node): node is CanvasNode => !!node);
			if (coveredRects.length === 0) continue;

			const geometry = computeSummaryGeometry(coveredRects, side, summaryNode.width, summaryNode.height);
			if (Math.abs(bracket.x - geometry.bracketX) > 0.5
				|| Math.abs(bracket.y - geometry.bracketY) > 0.5
				|| bracket.width !== BRACKET_WIDTH
				|| Math.abs(bracket.height - geometry.bracketHeight) > 0.5) {
				bracket.moveAndResize({
					x: geometry.bracketX,
					y: geometry.bracketY,
					width: BRACKET_WIDTH,
					height: geometry.bracketHeight,
				});
				moved = true;
			}

			// Leave the content node alone while the user is dragging it.
			if (drag?.nodeId !== summaryNode.id) {
				const dx = geometry.summaryX + record.offsetX - summaryNode.x;
				const dy = geometry.summaryY + record.offsetY - summaryNode.y;
				if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
					for (const id of summaryTree) {
						const node = canvas.nodes.get(id);
						node?.moveTo({ x: node.x + dx, y: node.y + dy });
					}
					moved = true;
				}
			}

			bracket.nodeEl.addClass(SUMMARY_BRACKET_CLASS);
			bracket.nodeEl.toggleClass("is-right", side === "right");
			bracket.nodeEl.toggleClass("is-left", side === "left");
			summaryNode.nodeEl.addClass(SUMMARY_CONTENT_CLASS);
			updateConnector(bracket, summaryNode, side);

			if (side !== record.side) {
				record.side = side;
				writeRecords(records);
			}
		}
		if (moved) {
			canvas.requestFrame();
			canvas.requestSave();
		}
	};

	const schedule = (): void => {
		if (disposed || scheduled !== null) return;
		scheduled = win.requestAnimationFrame(() => {
			scheduled = null;
			syncNow();
		});
	};

	const findByContentNode = (nodeId: string): SummaryRecord | null =>
		getSummaryRecords(canvas).find((record) => record.summaryNodeId === nodeId) ?? null;

	const create = (selectedIds: string[]): boolean => {
		const records = getSummaryRecords(canvas);
		const g = graph();
		const validation = validateSummarySelection(g, selectedIds, records);
		if (!validation.ok) {
			new Notice(validation.error);
			return false;
		}
		const covered = collectCoveredIds(g.edges, validation.memberIds)
			.map((id) => canvas.nodes.get(id))
			.filter((node): node is CanvasNode => !!node);
		const geometry = computeSummaryGeometry(covered, validation.side, 260, 60);
		const bracketId = makeId();
		const summaryNodeId = makeId();
		canvas.importData({
			nodes: [
				{
					id: bracketId,
					type: "group",
					x: geometry.bracketX,
					y: geometry.bracketY,
					width: BRACKET_WIDTH,
					height: geometry.bracketHeight,
					label: "",
				},
				{
					id: summaryNodeId,
					type: "text",
					text: SUMMARY_DEFAULT_TEXT,
					x: geometry.summaryX,
					y: geometry.summaryY,
					width: 260,
					height: 60,
				},
			],
			edges: [],
		}, false);
		writeRecords([
			...records,
			{
				id: makeId(),
				version: 2,
				bracketNodeId: bracketId,
				summaryNodeId,
				memberNodeIds: validation.memberIds,
				parentNodeId: validation.parentId,
				side: validation.side,
				offsetX: 0,
				offsetY: 0,
			},
		]);
		syncNow();
		canvas.requestSave();
		onLayoutNeeded();
		win.setTimeout(() => {
			const node = canvas.nodes.get(summaryNodeId);
			if (!node || disposed) return;
			canvas.selectOnly(node);
			node.startEditing();
		}, 80);
		return true;
	};

	const removeBracket = (recordId: string): void => {
		const records = getSummaryRecords(canvas);
		const record = records.find((item) => item.id === recordId);
		if (!record) return;
		const bracket = canvas.nodes.get(record.bracketNodeId);
		if (bracket) canvas.removeNode(bracket);
		canvas.nodes.get(record.summaryNodeId)?.nodeEl.removeClass(SUMMARY_CONTENT_CLASS);
		writeRecords(records.filter((item) => item.id !== recordId));
		canvas.requestSave();
		new Notice("已移除概要括号，概要内容节点保留");
	};

	// Remember where the user drops a summary content node as a persistent offset.
	const onPointerDown = (event: PointerEvent): void => {
		const target = event.target;
		if (!isHtmlElement(target) || target.closest(".canvas-node-resizer")) return;
		const nodeEl = target.closest(`.canvas-node.${SUMMARY_CONTENT_CLASS}`);
		if (!nodeEl) return;
		for (const node of canvas.nodes.values()) {
			if (node.nodeEl !== nodeEl) continue;
			const record = findByContentNode(node.id);
			if (record) {
				drag = { recordId: record.id, nodeId: node.id, pointerId: event.pointerId, x: node.x, y: node.y };
			}
			return;
		}
	};
	const onPointerUp = (event: PointerEvent): void => {
		const current = drag;
		if (!current || event.pointerId !== current.pointerId) return;
		win.requestAnimationFrame(() => {
			drag = null;
			const node = canvas.nodes.get(current.nodeId);
			if (!node || disposed) return;
			const dx = node.x - current.x;
			const dy = node.y - current.y;
			if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
				const records = getSummaryRecords(canvas);
				const record = records.find((item) => item.id === current.recordId);
				if (record) {
					record.offsetX += dx;
					record.offsetY += dy;
					writeRecords(records);
				}
			}
			syncNow();
		});
	};
	const onPointerCancel = (event: PointerEvent): void => {
		if (drag && event.pointerId === drag.pointerId) {
			drag = null;
			schedule();
		}
	};
	canvas.wrapperEl.addEventListener("pointerdown", onPointerDown, true);
	win.addEventListener("pointerup", onPointerUp, true);
	win.addEventListener("pointercancel", onPointerCancel, true);

	syncNow();

	return {
		schedule,
		syncNow,
		create,
		removeBracket,
		findByContentNode,
		isSummaryNode: (nodeId) => getSummaryRecords(canvas).some((record) => record.summaryNodeId === nodeId),
		cleanup: () => {
			disposed = true;
			if (scheduled !== null) win.cancelAnimationFrame(scheduled);
			canvas.wrapperEl.removeEventListener("pointerdown", onPointerDown, true);
			win.removeEventListener("pointerup", onPointerUp, true);
			win.removeEventListener("pointercancel", onPointerCancel, true);
			for (const node of canvas.nodes.values()) node.nodeEl.removeClass(SUMMARY_HIDDEN_CLASS);
			for (const edge of canvas.edges.values()) setEdgeHidden(edge, false);
		},
	};
}
