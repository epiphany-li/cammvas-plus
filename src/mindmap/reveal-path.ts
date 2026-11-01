import type { TreeNode } from "./tree-model";

/**
 * Collapsed branches that hide `node` on the canvas: its ancestors that are in
 * the collapsed set, nearest first. Locating a node (outline click, search
 * hit, node link) expands exactly these, like XMind unfolding the path to a
 * topic. The node's own collapse state is left alone: a collapsed node is
 * still visible, only its children are not.
 */
export function collectCollapsedAncestorIds(node: TreeNode, collapsedIds: Iterable<string>): string[] {
	const collapsed = new Set(collapsedIds);
	const result: string[] = [];
	const seen = new Set<string>([node.canvasNode.id]);
	let current = node.parent;
	while (current && !seen.has(current.canvasNode.id)) {
		seen.add(current.canvasNode.id);
		if (collapsed.has(current.canvasNode.id)) result.push(current.canvasNode.id);
		current = current.parent;
	}
	return result;
}
