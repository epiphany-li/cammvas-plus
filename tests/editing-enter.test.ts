import { describe, expect, it } from "vitest";
import {
	shouldCreateChildOnTab,
	shouldCreateSiblingOnEnter,
	shouldExitEditingOnEscape,
	shouldStartEditingOnEnter,
	shouldStartEditingOnSpace,
} from "../src/ui/editing-enter";

function enterEvent(overrides: Partial<Parameters<typeof shouldCreateSiblingOnEnter>[0]> = {}) {
	return {
		key: "Enter",
		shiftKey: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		isComposing: false,
		...overrides,
	};
}

describe("shouldCreateSiblingOnEnter", () => {
	it("handles plain Enter while editing when enabled", () => {
		expect(shouldCreateSiblingOnEnter(enterEvent(), true, true)).toBe(true);
	});

	it("leaves Shift+Enter available for new lines", () => {
		expect(shouldCreateSiblingOnEnter(enterEvent({ shiftKey: true }), true, true)).toBe(false);
	});

	it("does not interfere when disabled, outside editing, or during composition", () => {
		expect(shouldCreateSiblingOnEnter(enterEvent(), false, true)).toBe(false);
		expect(shouldCreateSiblingOnEnter(enterEvent(), true, false)).toBe(false);
		expect(shouldCreateSiblingOnEnter(enterEvent({ isComposing: true }), true, true)).toBe(false);
	});
});

describe("shouldStartEditingOnEnter", () => {
	it("handles plain Enter on a selected node when enabled", () => {
		expect(shouldStartEditingOnEnter(enterEvent(), true, false)).toBe(true);
	});

	it("does not interfere while editing, when disabled, or with modifiers", () => {
		expect(shouldStartEditingOnEnter(enterEvent(), true, true)).toBe(false);
		expect(shouldStartEditingOnEnter(enterEvent(), false, false)).toBe(false);
		expect(shouldStartEditingOnEnter(enterEvent({ shiftKey: true }), true, false)).toBe(false);
	});
});

describe("shouldStartEditingOnSpace", () => {
	it("starts editing from a selected, non-editing node on plain Space", () => {
		expect(shouldStartEditingOnSpace(enterEvent({ key: " " }), false)).toBe(true);
		expect(shouldStartEditingOnSpace(enterEvent({ key: "Spacebar" }), false)).toBe(true);
	});

	it("leaves Space untouched while editing or when modified", () => {
		expect(shouldStartEditingOnSpace(enterEvent({ key: " " }), true)).toBe(false);
		expect(shouldStartEditingOnSpace(enterEvent({ key: " ", ctrlKey: true }), false)).toBe(false);
		expect(shouldStartEditingOnSpace(enterEvent({ key: " ", isComposing: true }), false)).toBe(false);
	});
});

describe("shouldExitEditingOnEscape", () => {
	it("exits editing on plain Escape only while editing", () => {
		expect(shouldExitEditingOnEscape(enterEvent({ key: "Escape" }), true)).toBe(true);
		expect(shouldExitEditingOnEscape(enterEvent({ key: "Escape" }), false)).toBe(false);
		expect(shouldExitEditingOnEscape(enterEvent({ key: "Escape", shiftKey: true }), true)).toBe(false);
	});
});

describe("shouldCreateChildOnTab", () => {
	it("handles plain Tab when the mode is enabled and a node is selected", () => {
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab" }), true, true)).toBe(true);
	});

	it("leaves modified Tab and disabled mode unchanged", () => {
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab", shiftKey: true }), true, true)).toBe(false);
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab" }), false, true)).toBe(false);
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab" }), true, false)).toBe(false);
	});
});
