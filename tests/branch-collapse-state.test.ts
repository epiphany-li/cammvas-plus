import { describe, expect, it } from "vitest";
import { collectCollapsedDescendantIds, collectHiddenIds } from "../src/canvas/branch-collapse-state";

const children = new Map<string, string[]>([
	["root", ["a", "b"]],
	["a", ["a1", "a2"]],
	["a1", ["a1x"]],
	["b", ["b1"]],
]);

const getChildren = (id: string): string[] => children.get(id) ?? [];

describe("collectCollapsedDescendantIds", () => {
	it("hides every descendant but keeps the collapsed node visible", () => {
		expect(collectCollapsedDescendantIds(["a"], getChildren)).toEqual(
			new Set(["a1", "a2", "a1x"])
		);
	});

	it("combines overlapping collapsed branches without duplicates", () => {
		expect(collectCollapsedDescendantIds(["root", "a"], getChildren)).toEqual(
			new Set(["a", "b", "a1", "a2", "b1", "a1x"])
		);
	});

	it("returns an empty set for unknown or leaf nodes", () => {
		expect(collectCollapsedDescendantIds(["missing", "a2"], getChildren)).toEqual(new Set());
	});

	it("never hides the collapsed node when the graph contains a cycle", () => {
		const cyclicChildren = (id: string): string[] =>
			id === "a" ? ["b"] : id === "b" ? ["a"] : [];
		expect(collectCollapsedDescendantIds(["a"], cyclicChildren)).toEqual(new Set(["b"]));
	});
});

describe("collectHiddenIds", () => {
	const graph = new Map<string, string[]>([
		["root", ["p1", "p2"]],
		["p1", ["shared", "only1"]],
		["p2", ["shared"]],
		["shared", ["deep"]],
	]);
	const all = ["root", "p1", "p2", "shared", "only1", "deep"];
	const children = (id: string): string[] => graph.get(id) ?? [];

	it("keeps a node visible while another, expanded parent still shows it", () => {
		expect(collectHiddenIds(["p1"], all, children)).toEqual(new Set(["only1"]));
	});

	it("hides it once every parent is collapsed", () => {
		expect(collectHiddenIds(["p1", "p2"], all, children)).toEqual(new Set(["only1", "shared", "deep"]));
	});

	it("behaves like collectCollapsedDescendantIds on plain trees", () => {
		expect(collectHiddenIds(["a"], ["root", "a", "b", "a1", "a2", "a1x", "b1"], getChildren)).toEqual(
			collectCollapsedDescendantIds(["a"], getChildren)
		);
	});
});
