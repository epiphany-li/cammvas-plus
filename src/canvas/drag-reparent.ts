import { Platform } from "obsidian";
import type { Canvas, CanvasDragHandler, CanvasNode } from "../types/canvas-internal";
import { CanvasAPI } from "./canvas-api";
import {
	collectDescendantIdsForRoots,
	findDropTarget,
	getTopLevelSelectedIds,
	shouldReparentOnDragEnd,
} from "./drag-reparent-state";
import { getGroupIds } from "../mindmap/tree-model";

const DROP_TARGET_CLASS = "cammvas-reparent-drop-target";
/** On the dragged nodes while they hover a drop target, so the target shows through. */
const DRAGGED_CLASS = "cammvas-reparent-dragged";
/** On the canvas wrapper while a reparent drop is pending (hides snap guides). */
const REPARENTING_CLASS = "cammvas-reparenting";

export function registerDragReparent(
	canvas: Canvas,
	canvasApi: CanvasAPI,
	isEnabled: () => boolean,
	onReparent: (nodes: CanvasNode[], newParent: CanvasNode) => void,
	touchHitPadding = 12,
	/** Nodes that must never be re-parented by dragging (e.g. summary content). */
	isPinned: (node: CanvasNode) => boolean = () => false
): () => void {
	const original = canvas.handleSelectionDrag;
	if (!original) return () => {};

	let highlighted: CanvasNode | null = null;
	let touchSession = 0;

	const clearHighlight = (): void => {
		highlighted?.nodeEl.removeClass(DROP_TARGET_CLASS);
		highlighted = null;
	};

	const pointerDownHandler = (event: PointerEvent): void => {
		if (event.pointerType !== "touch" || event.isPrimary) return;
		touchSession++;
		clearHighlight();
	};

	const cancelHandler = (event: PointerEvent): void => {
		if (event.pointerType === "touch") touchSession++;
		clearHighlight();
	};

	const replacement = function (
		this: Canvas,
		event: PointerEvent,
		dragEl: HTMLElement,
		directNode?: CanvasNode
	): CanvasDragHandler | void {
		const isTouchDrag = event.pointerType === "touch";
		const touchSessionId = isTouchDrag ? ++touchSession : 0;
		if (isTouchDrag) clearHighlight();

		const groupIds = getGroupIds(canvas);
		const selectedNodes = Array.from(canvas.selection)
			.map((item) => canvas.nodes.get(item.id))
			.filter((node): node is CanvasNode => !!node && !groupIds.has(node.id));
		const candidateNodes = directNode && !canvas.selection.has(directNode)
			? [directNode]
			: selectedNodes.length > 0
				? selectedNodes
				: directNode
					? [directNode]
					: [];
		const candidateIds = new Set(candidateNodes.map((node) => node.id));
		const topLevelIds = getTopLevelSelectedIds(
			candidateIds,
			(nodeId) => {
				const node = canvas.nodes.get(nodeId);
				return node ? canvasApi.getParentNode(canvas, node)?.id ?? null : null;
			}
		);
		const draggedNodes = candidateNodes.filter((node) => topLevelIds.has(node.id) && !isPinned(node));
		let eligible = isEnabled()
			&& draggedNodes.length > 0
			&& (!directNode || !groupIds.has(directNode.id))
			&& (!isTouchDrag || event.isPrimary);

		const handler = original.call(this, event, dragEl, directNode);
		if (!handler || !eligible) return handler;

		const descendantIds = collectDescendantIdsForRoots(
			draggedNodes.map((node) => node.id),
			(nodeId) => canvasApi.getOutgoingEdges(canvas, nodeId).map((edge) => edge.to.node.id)
		);
		const excludedIds = new Set(descendantIds);
		for (const node of draggedNodes) excludedIds.add(node.id);
		for (const groupId of groupIds) excludedIds.add(groupId);

		const hasEligiblePointer = (pointerEvent: PointerEvent): boolean => {
			if (!isTouchDrag) return true;
			const valid = touchSessionId === touchSession
				&& pointerEvent.pointerType === "touch"
				&& pointerEvent.pointerId === event.pointerId
				&& pointerEvent.isPrimary;
			if (!valid) {
				eligible = false;
				clearHighlight();
			}
			return valid;
		};

		const targetAt = (pointerEvent: PointerEvent): CanvasNode | null =>
			findDropTarget(
				canvas.nodes.values(),
				canvas.posFromEvt(pointerEvent),
				excludedIds,
				isTouchDrag ? touchHitPadding : 0
			);

		const updateHighlight = (pointerEvent: PointerEvent): CanvasNode | null => {
			const target = eligible && hasEligiblePointer(pointerEvent) && isEnabled()
				? targetAt(pointerEvent)
				: null;
			if (target === highlighted) return target;
			clearHighlight();
			target?.nodeEl.addClass(DROP_TARGET_CLASS);
			highlighted = target;
			setDraggingFeedback(!!target);
			return target;
		};
		const setDraggingFeedback = (active: boolean): void => {
			canvas.wrapperEl?.toggleClass(REPARENTING_CLASS, active);
			for (const node of draggedNodes) node.nodeEl?.toggleClass(DRAGGED_CLASS, active);
		};
		const clearDragState = (): void => {
			clearHighlight();
			setDraggingFeedback(false);
		};

		const originalMove = handler.move;
		const originalEnd = handler.end;
		const originalCancel = handler.cancel;
		const originalCleanup = handler.cleanup;

		handler.move = (moveEvent: PointerEvent) => {
			originalMove?.call(handler, moveEvent);
			updateHighlight(moveEvent);
		};
		handler.end = (endEvent: PointerEvent) => {
			const shouldCommit = shouldReparentOnDragEnd(endEvent.type)
				&& eligible
				&& hasEligiblePointer(endEvent);
			const target = shouldCommit ? updateHighlight(endEvent) : null;
			clearDragState();
			const duplicating = Platform.isMacOS ? endEvent.altKey : endEvent.ctrlKey;
			try {
				if (target && isEnabled() && !duplicating) onReparent(draggedNodes, target);
			} finally {
				originalEnd?.call(handler, endEvent);
			}
		};
		handler.cancel = () => {
			clearDragState();
			originalCancel?.call(handler);
		};
		handler.cleanup = () => {
			clearDragState();
			originalCleanup?.call(handler);
		};

		return handler;
	};

	canvas.handleSelectionDrag = replacement;
	canvas.wrapperEl?.addEventListener("pointerdown", pointerDownHandler, true);
	canvas.wrapperEl?.addEventListener("pointercancel", cancelHandler, true);
	canvas.wrapperEl?.addEventListener("lostpointercapture", cancelHandler, true);

	return () => {
		touchSession++;
		clearHighlight();
		canvas.wrapperEl?.removeEventListener("pointerdown", pointerDownHandler, true);
		canvas.wrapperEl?.removeEventListener("pointercancel", cancelHandler, true);
		canvas.wrapperEl?.removeEventListener("lostpointercapture", cancelHandler, true);
		if (canvas.handleSelectionDrag === replacement) {
			canvas.handleSelectionDrag = original;
		}
	};
}
