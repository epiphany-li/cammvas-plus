import { describe, expect, it } from "vitest";
import { collectCollapsedAncestorIds } from "../src/mindmap/reveal-path";
import type { TreeNode } from "../src/mindmap/tree-model";

function tree(id: string, parent: TreeNode | null = null): TreeNode {
	const node = {
		canvasNode: { id },
		parent,
		children: [],
		depth: parent ? parent.depth + 1 : 0,
		siblingIndex: parent ? parent.children.length : 0,
		direction: null,
	} as unknown as TreeNode;
	parent?.children.push(node);
	return node;
}

describe("collectCollapsedAncestorIds", () => {
	it("lists the collapsed ancestors nearest first and skips expanded ones", () => {
		const root = tree("root");
		const a = tree("a", root);
		const b = tree("b", a);
		const leaf = tree("leaf", b);
		expect(collectCollapsedAncestorIds(leaf, ["root", "b", "unrelated"])).toEqual(["b", "root"]);
	});

	it("leaves the node's own collapse state alone", () => {
		const root = tree("root");
		const leaf = tree("leaf", root);
		expect(collectCollapsedAncestorIds(leaf, ["leaf"])).toEqual([]);
	});

	it("returns nothing for a root or an open path", () => {
		const root = tree("root");
		const leaf = tree("leaf", root);
		expect(collectCollapsedAncestorIds(root, ["root"])).toEqual([]);
		expect(collectCollapsedAncestorIds(leaf, [])).toEqual([]);
	});

	it("stops on a parent cycle", () => {
		const root = tree("root");
		const a = tree("a", root);
		root.parent = a;
		expect(collectCollapsedAncestorIds(a, ["root", "a"])).toEqual(["root"]);
	});
});
