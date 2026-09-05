import { describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "../src/types/canvas-internal";
import { isNodeEditorFocused, shouldUseNodeArrowNavigation } from "../src/ui/editing-state";

describe("isNodeEditorFocused", () => {
	it("uses the live embedded editor focus state", () => {
		const hasFocus = vi.fn(() => true);
		const node = { child: { editor: { hasFocus } } } as unknown as CanvasNode;

		expect(isNodeEditorFocused(node)).toBe(true);
		expect(hasFocus).toHaveBeenCalled();
	});

	it("ignores stale node.isEditing after Escape destroys the editor", () => {
		const node = { isEditing: true, child: {} } as unknown as CanvasNode;

		expect(isNodeEditorFocused(node)).toBe(false);
	});
});

describe("shouldUseNodeArrowNavigation", () => {
	it("navigates only from a selected node outside editing", () => {
		expect(shouldUseNodeArrowNavigation(true, true, true, false, false)).toBe(true);
	});

	it("does not switch nodes while edit mode is active, even during a focus transition", () => {
		expect(shouldUseNodeArrowNavigation(true, true, true, true, false)).toBe(false);
		expect(shouldUseNodeArrowNavigation(true, true, true, false, true)).toBe(false);
	});

	it("respects disabled navigation, non-mindmap canvases, and missing selection", () => {
		expect(shouldUseNodeArrowNavigation(false, true, true, false, false)).toBe(false);
		expect(shouldUseNodeArrowNavigation(true, false, true, false, false)).toBe(false);
		expect(shouldUseNodeArrowNavigation(true, true, false, false, false)).toBe(false);
	});
});
