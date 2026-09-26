import { describe, expect, it } from "vitest";
import type { Canvas, CanvasEdge, CanvasNode } from "../src/types/canvas-internal";
import { buildForest, findTreeForNode, getDescendants, getNodeTitle, stripInlineMarkdown } from "../src/mindmap/tree-model";

function node(id: string, x: number, y: number): CanvasNode {
	return { id, x, y, width: 100, height: 50 } as CanvasNode;
}

function canvas(nodes: CanvasNode[], pairs: Array<[CanvasNode, CanvasNode]>, groupIds: string[] = [], collapsed: string[] = []): Canvas {
	const edges = pairs.map(([from, to], index) => ({
		id: `edge-${index}`,
		from: { node: from, side: "right", end: "none" },
		to: { node: to, side: "left", end: "arrow" },
	})) as CanvasEdge[];

	return {
		nodes: new Map(nodes.map((item) => [item.id, item])),
		edges: new Map(edges.map((edge) => [edge.id, edge])),
		getData: () => ({
			nodes: nodes.map((item) => ({
				id: item.id,
				type: groupIds.includes(item.id) ? "group" : "text",
				x: item.x,
				y: item.y,
				width: item.width,
				height: item.height,
			})),
			edges: [],
			mindmapCollapsed: collapsed,
		}),
	} as unknown as Canvas;
}

describe("buildForest", () => {
	it("builds nested trees and assigns branch directions", () => {
		const root = node("root", 0, 0);
		const left = node("left", -200, 0);
		const right = node("right", 200, 100);
		const grandchild = node("grandchild", -400, 0);
		const forest = buildForest(canvas(
			[root, left, right, grandchild],
			[[root, left], [root, right], [left, grandchild]]
		));

		expect(forest).toHaveLength(1);
		expect(forest[0].children.map((child) => child.canvasNode.id)).toEqual(["left", "right"]);
		expect(findTreeForNode(forest, "left")?.direction).toBe("left");
		expect(findTreeForNode(forest, "right")?.direction).toBe("right");
		expect(findTreeForNode(forest, "grandchild")?.direction).toBe("left");
		expect(getDescendants(forest[0]).map((item) => item.canvasNode.id)).toEqual([
			"left",
			"grandchild",
			"right",
		]);
	});

	it("excludes Canvas groups and sorts larger trees first", () => {
		const largeRoot = node("large-root", 0, 0);
		const child = node("child", 200, 0);
		const smallRoot = node("small-root", 0, 200);
		const group = node("group", -50, -50);
		const forest = buildForest(canvas(
			[smallRoot, group, largeRoot, child],
			[[largeRoot, child]],
			["group"]
		));

		expect(forest.map((root) => root.canvasNode.id)).toEqual(["large-root", "small-root"]);
		expect(findTreeForNode(forest, "group")).toBeNull();
	});

	it("omits collapsed descendants only when requested by the layout", () => {
		const root = node("root", 0, 0);
		const branch = node("branch", 200, 0);
		const hidden = node("hidden", 400, 0);
		const visible = node("visible", 200, 200);
		const source = canvas([root, branch, hidden, visible], [[root, branch], [branch, hidden], [root, visible]], [], ["branch"]);

		expect(findTreeForNode(buildForest(source), "hidden")).not.toBeNull();
		expect(findTreeForNode(buildForest(source, true), "hidden")).toBeNull();
		const visibleBranch = findTreeForNode(buildForest(source, true), "branch");
		expect(visibleBranch?.children).toEqual([]);
	});
});

describe("getNodeTitle", () => {
	it("uses a linked Markdown filename when the runtime node has no text", () => {
		const fileNode = { id: "note", text: "" } as CanvasNode;

		expect(getNodeTitle(fileNode, {
			id: "note",
			type: "file",
			x: 0,
			y: 0,
			width: 100,
			height: 50,
			file: "Projects/Meeting notes.md",
		})).toBe("Meeting notes");
	});
});

describe("buildForest graph safety", () => {
	it("ignores an edge that points back to an ancestor", () => {
		const a = node("a", 0, 0);
		const b = node("b", 200, 0);
		const c = node("c", 400, 0);
		const forest = buildForest(canvas([a, b, c], [[a, b], [b, c], [c, b]]));
		expect(forest.map((root) => root.canvasNode.id)).toEqual(["a"]);
		expect(getDescendants(forest[0]).map((item) => item.canvasNode.id)).toEqual(["b", "c"]);
		expect(findTreeForNode(forest, "c")?.depth).toBe(2);
	});

	it("breaks a pure cycle at its top-most node", () => {
		const a = node("a", 0, 100);
		const b = node("b", 200, 0);
		const forest = buildForest(canvas([a, b], [[a, b], [b, a]]));
		expect(forest.map((root) => root.canvasNode.id)).toEqual(["b"]);
		expect(forest[0].children.map((child) => child.canvasNode.id)).toEqual(["a"]);
	});

	it("keeps a node with two parents under only one of them", () => {
		const root = node("root", 0, 0);
		const p1 = node("p1", 200, -100);
		const p2 = node("p2", 200, 100);
		const shared = node("shared", 400, 0);
		const forest = buildForest(canvas(
			[root, p1, p2, shared],
			[[root, p1], [root, p2], [p1, shared], [p2, shared]]
		));
		const all = getDescendants(forest[0]).map((item) => item.canvasNode.id);
		expect(all.filter((id) => id === "shared")).toHaveLength(1);
	});
});

describe("stripInlineMarkdown", () => {
	it.each([
		["## RAG 检索链路", "RAG 检索链路"],
		["向量召回 + **BM25** 混合", "向量召回 + BM25 混合"],
		["`trace_id` 贯穿全链路", "trace_id 贯穿全链路"],
		["- [ ] 待办事项", "待办事项"],
		["1. 第一步", "第一步"],
		["见 [[项目笔记|笔记]] 和 [官网](https://x.y)", "见 笔记 和 官网"],
		["~~废弃~~ ==重点== *强调*", "废弃 重点 强调"],
		["snake_case_name 保留下划线", "snake_case_name 保留下划线"],
	])("%s → %s", (input, expected) => {
		expect(stripInlineMarkdown(input)).toBe(expected);
	});
});
