import { describe, expect, it, vi } from "vitest";
import { focusCanvasKeyboardTarget } from "../src/ui/canvas-keyboard-focus";

function focusable(initialTabIndex: string | null) {
	let tabIndex = initialTabIndex;
	const focus = vi.fn();
	const target = {
		getAttribute: (name: string) => name === "tabindex" ? tabIndex : null,
		setAttribute: (name: string, value: string) => {
			if (name === "tabindex") tabIndex = value;
		},
		removeAttribute: (name: string) => {
			if (name === "tabindex") tabIndex = null;
		},
		focus,
	} as unknown as HTMLElement;
	return { target, focus, getTabIndex: () => tabIndex };
}

describe("focusCanvasKeyboardTarget", () => {
	it("focuses a non-focusable Canvas wrapper without adding it to the tab order", () => {
		const { target, focus, getTabIndex } = focusable(null);
		focusCanvasKeyboardTarget(target);
		expect(focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(getTabIndex()).toBeNull();
	});

	it("preserves an existing tabindex", () => {
		const { target, getTabIndex } = focusable("0");
		focusCanvasKeyboardTarget(target);
		expect(getTabIndex()).toBe("0");
	});
});
