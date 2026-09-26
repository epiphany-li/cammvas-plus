import { setIcon } from "obsidian";
import type { Canvas, CanvasEdge, CanvasNode } from "../types/canvas-internal";
import { CanvasAPI, writeCanvasDataKey } from "./canvas-api";
import { collectCollapsedDescendantIds } from "./branch-collapse-state";

const BUTTON_CLASS = "cammvas-canvas-collapse-button";
export const COLLAPSED_HIDDEN_CLASS = "cammvas-canvas-branch-hidden";
/** Briefly on nodes/edges that were just revealed by expanding, to fade them in. */
const REVEALED_CLASS = "cammvas-branch-revealed";
const REVEAL_MS = 400;

export interface BranchCollapseHandle {
	refresh: () => void;
	/** Collapse or expand the branch below a node. */
	toggle: (nodeId: string) => void;
	/** Whether the node has children that can be collapsed. */
	canToggle: (nodeId: string) => boolean;
	cleanup: () => void;
}

/**
 * Tree depth of every node that belongs to a branch (root = 0), used for
 * hierarchy styling. Lone nodes without children or parent get no depth.
 */
function computeDepths(canvas: Canvas, childIds: (nodeId: string) => string[]): Map<string, number> {
	const hasParent = new Set<string>();
	for (const edge of canvas.edges.values()) hasParent.add(edge.to.node.id);
	const depths = new Map<string, number>();
	for (const node of canvas.nodes.values()) {
		if (hasParent.has(node.id) || childIds(node.id).length === 0) continue;
		depths.set(node.id, 0);
		const queue = [node.id];
		while (queue.length > 0) {
			const id = queue.shift()!;
			const depth = depths.get(id)!;
			for (const childId of childIds(id)) {
				if (depths.has(childId)) continue;
				depths.set(childId, depth + 1);
				queue.push(childId);
			}
		}
	}
	return depths;
}

export function registerBranchCollapse(
	canvas: Canvas,
	canvasApi: CanvasAPI,
	/** Called after the collapsed set changed, e.g. to re-layout the map. */
	onToggled?: (nodeId: string) => void
): BranchCollapseHandle {
	let disposed = false;
	let previousHidden = new Set<string>();
	let refreshRaf: number | null = null;
	let observer: MutationObserver;
	const win = canvas.wrapperEl.win;

	const scheduleRefresh = (): void => {
		if (disposed || refreshRaf !== null) return;
		refreshRaf = win.requestAnimationFrame(() => {
			refreshRaf = null;
			refresh();
		});
	};

	const toggle = (nodeId: string): void => {
		const collapsed = new Set(canvas.getData().mindmapCollapsed ?? []);
		if (collapsed.has(nodeId)) collapsed.delete(nodeId);
		else collapsed.add(nodeId);
		writeCanvasDataKey(canvas, "mindmapCollapsed", [...collapsed]);
		refresh();
		onToggled?.(nodeId);
	};

	const syncButton = (
		node: CanvasNode,
		collapsed: boolean,
		descendantCount: number,
		side: "left" | "right"
	): void => {
		let button = node.nodeEl.querySelector<HTMLElement>(`:scope > .${BUTTON_CLASS}`);
		if (!button) {
			button = node.nodeEl.createEl("button");
			button.className = `${BUTTON_CLASS} clickable-icon`;
			button.setAttribute("type", "button");
			button.addEventListener("pointerdown", (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				toggle(node.id);
			});
			node.nodeEl.appendChild(button);
		}

		const state = collapsed ? "collapsed" : "expanded";
		if (button.dataset.state !== state) {
			button.empty();
			setIcon(button, collapsed ? "chevron-right" : "chevron-down");
			button.dataset.state = state;
		}
		button.setAttribute(
			"aria-label",
			`${collapsed ? "Expand" : "Collapse"} branch (${descendantCount} descendant${descendantCount === 1 ? "" : "s"})`
		);
		button.dataset.descendantCount = String(descendantCount);
		// Sit on the side the branch grows toward, where the connecting line leaves.
		button.dataset.side = side;
	};

	const setEdgeHidden = (edge: CanvasEdge, hidden: boolean): void => {
		edge.lineGroupEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.lineEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.lineEndGroupEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.startGroupEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.endGroupEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.fromLineEnd?.el?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.toLineEnd?.el?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.labelElement?.wrapperEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.path?.display?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.path?.interaction?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
	};

	const refresh = (): void => {
		if (disposed) return;
		observer.disconnect();
		canvasApi.invalidateEdgeIndex();

		const collapsedIds = new Set(canvas.getData().mindmapCollapsed ?? []);
		const childIds = (nodeId: string): string[] =>
			canvasApi.getOutgoingEdges(canvas, nodeId).map((edge) => edge.to.node.id);
		const hiddenIds = collectCollapsedDescendantIds(collapsedIds, childIds);
		const revealed = new Set([...previousHidden].filter((id) => !hiddenIds.has(id) && canvas.nodes.has(id)));
		previousHidden = hiddenIds;
		const revealedEls: Element[] = [];
		const hiddenSelection = Array.from(canvas.selection).some((item) => {
			if ("nodeEl" in item) return hiddenIds.has(item.id);
			return hiddenIds.has(item.from.node.id) || hiddenIds.has(item.to.node.id);
		});
		if (hiddenSelection) canvas.deselectAll();

		const depths = computeDepths(canvas, childIds);
		for (const node of canvas.nodes.values()) {
			node.nodeEl.toggleClass(COLLAPSED_HIDDEN_CLASS, hiddenIds.has(node.id));
			if (revealed.has(node.id)) revealedEls.push(node.nodeEl);
			const depth = depths.get(node.id);
			if (depth === undefined) delete node.nodeEl.dataset.cammvasDepth;
			else node.nodeEl.dataset.cammvasDepth = String(Math.min(depth, 2));
			const children = childIds(node.id);
			const existing = node.nodeEl.querySelector<HTMLElement>(`:scope > .${BUTTON_CLASS}`);
			if (children.length === 0) {
				existing?.remove();
				continue;
			}
			const descendants = collectCollapsedDescendantIds([node.id], childIds);
			const nodeCx = node.x + node.width / 2;
			const childCx = children.reduce((sum, id) => {
				const child = canvas.nodes.get(id);
				return sum + (child ? child.x + child.width / 2 : nodeCx);
			}, 0) / children.length;
			syncButton(node, collapsedIds.has(node.id), descendants.size, childCx < nodeCx ? "left" : "right");
		}

		for (const edge of canvas.edges.values()) {
			setEdgeHidden(
				edge,
				hiddenIds.has(edge.from.node.id) || hiddenIds.has(edge.to.node.id)
			);
			if (revealed.has(edge.to.node.id) && edge.lineGroupEl) revealedEls.push(edge.lineGroupEl);
			const depth = depths.get(edge.to.node.id);
			if (depth === undefined) edge.lineGroupEl?.removeAttribute("data-cammvas-depth");
			else edge.lineGroupEl?.setAttribute("data-cammvas-depth", String(Math.min(depth, 2)));
		}

		if (revealedEls.length > 0) {
			for (const el of revealedEls) el.classList.add(REVEALED_CLASS);
			win.setTimeout(() => {
				for (const el of revealedEls) el.classList.remove(REVEALED_CLASS);
			}, REVEAL_MS);
		}

		observer.observe(canvas.wrapperEl, { childList: true, subtree: true });
	};

	const Observer = Reflect.get(win, "MutationObserver") as typeof MutationObserver;
	observer = new Observer(scheduleRefresh);
	observer.observe(canvas.wrapperEl, { childList: true, subtree: true });
	refresh();

	return {
		refresh: scheduleRefresh,
		toggle,
		canToggle: (nodeId) => canvasApi.getOutgoingEdges(canvas, nodeId).length > 0,
		cleanup: () => {
			disposed = true;
			observer.disconnect();
			if (refreshRaf !== null) win.cancelAnimationFrame(refreshRaf);
			for (const node of canvas.nodes.values()) {
				node.nodeEl.removeClass(COLLAPSED_HIDDEN_CLASS);
				node.nodeEl.querySelector<HTMLElement>(`:scope > .${BUTTON_CLASS}`)?.remove();
			}
			for (const edge of canvas.edges.values()) setEdgeHidden(edge, false);
		},
	};
}
