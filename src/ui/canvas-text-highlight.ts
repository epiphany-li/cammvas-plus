import type { CanvasNode } from "../types/canvas-internal";

const HIGHLIGHT_NAME = "cammvas-search";
const SHOW_TEXT = 4;

interface HighlightLike {
	add(range: Range): void;
	clear(): void;
}

interface HighlightsWindow {
	CSS?: { highlights?: { set(name: string, highlight: HighlightLike): void; delete(name: string): void } };
	Highlight?: new () => HighlightLike;
}

/**
 * Mark every occurrence of `query` inside a card with the CSS Custom Highlight
 * API, so the hit is visible in the card after a search jump. The DOM is not
 * touched (the approach Enhanced Canvas uses for its find). Card text is
 * rendered lazily (after the zoom animation, and only above a zoom level), so
 * the marks are repainted whenever the card's DOM changes, until cleared.
 * Returns the function that removes the marks. Does nothing where the API is
 * missing.
 */
export function highlightTextInNode(
	node: CanvasNode,
	query: string,
	win: Window
): () => void {
	const api = win as unknown as HighlightsWindow;
	const registry = api.CSS?.highlights;
	const HighlightCtor = api.Highlight;
	if (query === "" || !registry || !HighlightCtor) return () => undefined;

	const highlight = new HighlightCtor();
	registry.set(HIGHLIGHT_NAME, highlight);
	let frame: number | null = null;

	const paint = (): void => {
		frame = null;
		highlight.clear();
		for (const range of collectRanges(node.contentEl ?? node.nodeEl, query)) highlight.add(range);
	};
	const schedule = (): void => {
		if (frame === null) frame = win.requestAnimationFrame(paint);
	};
	const Observer = Reflect.get(win, "MutationObserver") as typeof MutationObserver;
	const observer = new Observer(schedule);
	observer.observe(node.nodeEl, { childList: true, subtree: true, characterData: true });
	paint();

	return () => {
		observer.disconnect();
		if (frame !== null) win.cancelAnimationFrame(frame);
		frame = null;
		registry.delete(HIGHLIGHT_NAME);
	};
}

/** One Range per case-insensitive occurrence of `query` in the text under `root`. */
export function collectRanges(root: HTMLElement | undefined, query: string): Range[] {
	const ranges: Range[] = [];
	if (!root) return ranges;
	const doc = root.ownerDocument;
	const walker = doc.createTreeWalker(root, SHOW_TEXT);
	const q = query.toLowerCase();
	for (let text = walker.nextNode(); text; text = walker.nextNode()) {
		const value = (text.nodeValue ?? "").toLowerCase();
		for (let i = value.indexOf(q); i >= 0; i = value.indexOf(q, i + q.length)) {
			const range = doc.createRange();
			range.setStart(text, i);
			range.setEnd(text, i + q.length);
			ranges.push(range);
		}
	}
	return ranges;
}
