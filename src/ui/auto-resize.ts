import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { isDomNode, isHtmlElement } from "./dom";

interface AutoResizeConfig {
	minHeight: number;
}

/**
 * Get CodeMirror editor elements from a canvas node's iframe.
 * Used to measure content height via .cm-content.offsetHeight.
 */
export function getEditorElements(node: CanvasNode): {
	iframe: HTMLIFrameElement | null;
	scroller: HTMLElement | null;
	cmContent: HTMLElement | null;
} {
	const iframe = node.contentEl?.querySelector<HTMLIFrameElement>("iframe");
	const container = iframe?.contentDocument ?? node.contentEl;
	if (!container) return { iframe: null, scroller: null, cmContent: null };

	const scroller = container.querySelector<HTMLElement>(".cm-scroller");
	const cmContent = container.querySelector<HTMLElement>(".cm-content");
	return { iframe, scroller, cmContent };
}

export interface AutoResizeHandle {
	/** Remove all listeners and observers. */
	cleanup: () => void;
	/** Finalize the currently editing node before leaving it.
	 *  Call synchronously before any action that exits the current node
	 *  (navigate, create child/sibling, delete).
	 *  Cleans up observers but does NOT trigger relayout — the command
	 *  handler is responsible for its own layout. */
	finalizeNode: () => void;
}

/**
 * Registers auto-resize behavior for canvas nodes:
 * - While editing: node grows to fit complete content and never shrinks.
 * - On natural exit (focusout): calls onEditExit callback after a delay
 *   to let the preview sizer render, enabling resize + relayout.
 * - On command exit (finalizeNode): cleanup only, no relayout.
 * Returns a handle with cleanup() and finalizeNode().
 */
export function registerAutoResize(
	canvas: Canvas,
	config: AutoResizeConfig,
	onEditExit?: (canvas: Canvas, node: CanvasNode) => void,
	onTextChange?: (canvas: Canvas, node: CanvasNode) => void,
	onEditorKeydown?: (event: KeyboardEvent, canvas: Canvas, node: CanvasNode) => boolean
): AutoResizeHandle {
	let activeNode: CanvasNode | null = null;
	let observer: MutationObserver | null = null;
	let inputHandler: (() => void) | null = null;
	let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	/** Cached DOM refs to avoid querySelector on every keystroke */
	let cachedCmContent: HTMLElement | null = null;
	let cachedScroller: HTMLElement | null = null;
	let cachedInputTarget: Document | HTMLElement | null = null;
	// Invalidates delayed focus/pointer callbacks when editing switches nodes.
	let watchGeneration = 0;
	const win = canvas.wrapperEl.win;

	function onContentChange(): void {
		if (!activeNode || !cachedScroller || !cachedCmContent) return;

		const contentH = Math.max(
			cachedCmContent.scrollHeight,
			cachedCmContent.offsetHeight,
			cachedCmContent.getBoundingClientRect().height
		);
		const chrome = activeNode.height - cachedScroller.clientHeight;
		const targetH = Math.max(Math.ceil(contentH + chrome + 12), config.minHeight);

		// Only grow, never shrink during editing
		if (targetH > activeNode.height) {
			activeNode.moveAndResize({
				x: activeNode.x,
				y: activeNode.y,
				width: activeNode.width,
				height: targetH,
			});
			canvas.requestSave();
		}
	}

	function startWatching(node: CanvasNode): void {
		watchGeneration++;
		const { iframe, scroller, cmContent } = getEditorElements(node);

		activeNode = node;
		cachedCmContent = cmContent;
		cachedScroller = scroller;
		scroller?.classList.add("cammvas-editor-scroller");

		// Observe inside the iframe where actual editing happens
		const handleMutation = () => {
			onContentChange();
			onTextChange?.(canvas, node);
		};
		const observeTarget = cmContent ?? iframe?.contentDocument?.body;
		if (observeTarget) {
			const Observer = Reflect.get(observeTarget.win, "MutationObserver") as typeof MutationObserver;
			const nextObserver = new Observer(handleMutation);
			nextObserver.observe(observeTarget, {
				childList: true,
				subtree: true,
				characterData: true,
			});
			observer = nextObserver;
		} else {
			const Observer = Reflect.get(node.contentEl.win, "MutationObserver") as typeof MutationObserver;
			const nextObserver = new Observer(handleMutation);
			nextObserver.observe(node.contentEl, {
				childList: true,
				subtree: true,
				characterData: true,
			});
			observer = nextObserver;
		}

		cachedInputTarget = iframe?.contentDocument ?? node.contentEl;
		const handler = () => {
			onContentChange();
			onTextChange?.(canvas, node);
		};
		inputHandler = handler;
		cachedInputTarget.addEventListener("input", handler);
		keydownHandler = (event: KeyboardEvent) => {
			if (onEditorKeydown?.(event, canvas, node)) return;
			if (event.key === "Enter") onTextChange?.(canvas, node);
		};
		cachedInputTarget.addEventListener("keydown", keydownHandler, true);

		// Measure immediately in case existing content already overflows
		onContentChange();
		onTextChange?.(canvas, node);
	}

	function stopWatching(triggerRelayout: boolean = true): void {
		if (!activeNode) return;
		watchGeneration++;
		const node = activeNode;

		// Disconnect observers
		observer?.disconnect();
		if (inputHandler && cachedInputTarget) {
			cachedInputTarget.removeEventListener("input", inputHandler);
		}
		if (keydownHandler && cachedInputTarget) {
			cachedInputTarget.removeEventListener("keydown", keydownHandler, true);
		}
		cachedScroller?.classList.remove("cammvas-editor-scroller");

		// Reset state
		activeNode = null;
		observer = null;
		inputHandler = null;
		keydownHandler = null;
		cachedCmContent = null;
		cachedScroller = null;
		cachedInputTarget = null;

		// On natural exit: delay to let Obsidian complete edit-to-preview transition,
		// then resize+relayout via callback
		if (triggerRelayout && onEditExit) {
			onEditExit(canvas, node);
		}
	}

	const focusInHandler = (e: FocusEvent): void => {
		const target = e.target;
		if (!isHtmlElement(target)) return;
		const nodeEl = target.closest<HTMLElement>(".canvas-node");
		if (!nodeEl) return;

		for (const node of canvas.nodes.values()) {
			if (node.nodeEl === nodeEl && node.isEditing && node !== activeNode) {
				if (activeNode) stopWatching();
				startWatching(node);
				return;
			}
		}
	};

	const focusOutHandler = (): void => {
		if (!activeNode) return;
		const node = activeNode;
		const generation = watchGeneration;
		win.setTimeout(() => {
			if (generation === watchGeneration && activeNode === node && !node.isEditing) {
				stopWatching();
			}
		}, 50);
	};

	// Clicking canvas background exits edit mode but doesn't trigger focusout
	const pointerHandler = (e: PointerEvent): void => {
		if (!activeNode) return;
		// Ignore clicks inside the editing node
		if (isDomNode(e.target) && activeNode.nodeEl?.contains(e.target)) return;
		const node = activeNode;
		const generation = watchGeneration;
		win.setTimeout(() => {
			if (generation === watchGeneration && activeNode === node && !node.isEditing) {
				stopWatching();
			}
		}, 50);
	};

	canvas.wrapperEl?.addEventListener("focusin", focusInHandler);
	canvas.wrapperEl?.addEventListener("focusout", focusOutHandler);
	canvas.wrapperEl?.addEventListener("pointerdown", pointerHandler);

	return {
		cleanup: () => {
			if (activeNode) stopWatching(false);
			canvas.wrapperEl?.removeEventListener("focusin", focusInHandler);
			canvas.wrapperEl?.removeEventListener("focusout", focusOutHandler);
			canvas.wrapperEl?.removeEventListener("pointerdown", pointerHandler);
		},
		finalizeNode: () => {
			if (activeNode) stopWatching(false);
		},
	};
}
