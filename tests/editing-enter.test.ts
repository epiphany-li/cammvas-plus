import { describe, expect, it } from "vitest";
import {
	isCanvasKeyboardContext,
	shouldCreateChildOnTab,
	shouldCreateSiblingOnEnter,
	shouldExitEditingOnEscape,
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
	it("creates a sibling on plain Enter from selected-node mode", () => {
		expect(shouldCreateSiblingOnEnter(enterEvent(), true, false)).toBe(true);
	});

	it("leaves both Enter and Shift+Enter available to the text editor", () => {
		expect(shouldCreateSiblingOnEnter(enterEvent(), true, true)).toBe(false);
		expect(shouldCreateSiblingOnEnter(enterEvent({ shiftKey: true }), true, true)).toBe(false);
	});

	it("does not interfere when disabled, modified, or during composition", () => {
		expect(shouldCreateSiblingOnEnter(enterEvent(), false, false)).toBe(false);
		expect(shouldCreateSiblingOnEnter(enterEvent({ shiftKey: true }), true, false)).toBe(false);
		expect(shouldCreateSiblingOnEnter(enterEvent({ isComposing: true }), true, false)).toBe(false);
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

describe("isCanvasKeyboardContext", () => {
	const win = {};
	const doc = {};
	const body = {};
	const documentElement = {};

	const context = (target: unknown, isInsideCanvas = false) => ({
		target,
		windowTarget: win,
		documentTarget: doc,
		bodyTarget: body,
		documentElementTarget: documentElement,
		isInsideCanvas,
	});

	it("accepts body-level events left behind after arrow-key node navigation", () => {
		expect(isCanvasKeyboardContext(context(body))).toBe(true);
		expect(isCanvasKeyboardContext(context(documentElement))).toBe(true);
	});

	it("accepts Canvas descendants and rejects unrelated controls", () => {
		expect(isCanvasKeyboardContext(context({}, true))).toBe(true);
		expect(isCanvasKeyboardContext(context({}))).toBe(false);
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
	it("handles plain Tab outside editing when the mode is enabled and a node is selected", () => {
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab" }), true, true, false)).toBe(true);
	});

	it("leaves Tab available to the text editor while editing", () => {
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab" }), true, true, true)).toBe(false);
	});

	it("leaves modified Tab and disabled mode unchanged", () => {
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab", shiftKey: true }), true, true, false)).toBe(false);
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab" }), false, true, false)).toBe(false);
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab" }), true, false, false)).toBe(false);
	});
});
