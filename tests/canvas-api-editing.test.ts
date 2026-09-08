import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	ItemView: class {},
}));

import { ItemView } from "obsidian";
import type { App } from "obsidian";
import { CanvasAPI } from "../src/canvas/canvas-api";
import type { Canvas, CanvasNode } from "../src/types/canvas-internal";

function editingFixture() {
	const node = {
		id: "node",
		x: 0,
		y: 0,
		width: 100,
		height: 60,
		nodeEl: {
			isConnected: true,
			getBoundingClientRect: () => ({ top: 20, right: 120, bottom: 80, left: 20 }),
		},
		startEditing: vi.fn(),
	} as unknown as CanvasNode;
	const canvas = {
		nodes: new Map([[node.id, node]]),
		selection: new Set<CanvasNode>(),
		wrapperEl: {
			win: { setTimeout },
			getBoundingClientRect: () => ({ top: 0, right: 800, bottom: 600, left: 0 }),
		},
		selectOnly: vi.fn((selected: CanvasNode) => {
			canvas.selection.clear();
			canvas.selection.add(selected);
		}),
		zoomToSelection: vi.fn(),
	} as unknown as Canvas;
	const view = {
		canvas,
		getViewType: () => "canvas",
	} as unknown as ItemView & { canvas: Canvas };
	Object.setPrototypeOf(view, ItemView.prototype);
	let activeView: ItemView | null = view;
	const app = {
		workspace: {
			getActiveViewOfType: () => activeView,
		},
	};
	return {
		api: new CanvasAPI(app as unknown as App),
		canvas,
		node,
		setActiveView: (next: ItemView | null) => { activeView = next; },
	};
}

describe("CanvasAPI.selectAndEdit", () => {
	afterEach(() => vi.useRealTimers());

	it("starts editing when the delayed target is still selected on the active Canvas", () => {
		vi.useFakeTimers();
		const { api, canvas, node } = editingFixture();
		api.selectAndEdit(canvas, node);
		vi.advanceTimersByTime(50);
		expect(node.startEditing).toHaveBeenCalledOnce();
		expect(canvas.zoomToSelection).not.toHaveBeenCalled();
	});

	it("does not reopen a node after the user switches away", () => {
		vi.useFakeTimers();
		const { api, canvas, node, setActiveView } = editingFixture();
		api.selectAndEdit(canvas, node);
		setActiveView(null);
		vi.advanceTimersByTime(50);
		expect(node.startEditing).not.toHaveBeenCalled();
	});
});
