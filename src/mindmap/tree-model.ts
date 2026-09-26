import type { Canvas, CanvasNode, CanvasNodeFileData } from "../types/canvas-internal";
import { collectCollapsedDescendantIds } from "../canvas/branch-collapse-state";

export type BranchDirection = "left" | "right";

/**
 * Represents a node in the mind map tree structure.
 */
export interface TreeNode {
	canvasNode: CanvasNode;
	parent: TreeNode | null;
	children: TreeNode[];
	depth: number;
	/** Index among siblings (0-based) */
	siblingIndex: number;
	/** Branch direction: null for root, inherited for deeper nodes */
	direction: BranchDirection | null;
}

/**
 * Builds a forest of tree structures from the flat canvas nodes and edges.
 * Each node with no incoming edges becomes a root of its own tree.
 * Returns all roots sorted by descending subtree size (largest first).
 */
export function buildForest(canvas: Canvas, respectCollapsed = false): TreeNode[] {
	const nodeMap = new Map<string, TreeNode>();
	const childIds = new Set<string>();

	// Identify all nodes that are targets of edges (they have parents)
	for (const edge of canvas.edges.values()) {
		childIds.add(edge.to.node.id);
	}

	const groupIds = getGroupIds(canvas);
	const visibleNodeIds = new Set<string>();
	for (const node of canvas.nodes.values()) {
		if (!groupIds.has(node.id)) visibleNodeIds.add(node.id);
	}
	if (respectCollapsed) {
		const childrenById = new Map<string, string[]>();
		for (const edge of canvas.edges.values()) {
			const children = childrenById.get(edge.from.node.id) ?? [];
			children.push(edge.to.node.id);
			childrenById.set(edge.from.node.id, children);
		}
		const hidden = collectCollapsedDescendantIds(
			canvas.getData().mindmapCollapsed ?? [],
			(id) => childrenById.get(id) ?? []
		);
		for (const id of hidden) visibleNodeIds.delete(id);
	}
	childIds.clear();
	for (const edge of canvas.edges.values()) {
		if (visibleNodeIds.has(edge.from.node.id) && visibleNodeIds.has(edge.to.node.id)) {
			childIds.add(edge.to.node.id);
		}
	}

	// Create TreeNode wrappers (skip group nodes)
	for (const node of canvas.nodes.values()) {
		if (groupIds.has(node.id) || !visibleNodeIds.has(node.id)) continue;
		nodeMap.set(node.id, {
			canvasNode: node,
			parent: null,
			children: [],
			depth: 0,
			siblingIndex: 0,
			direction: null,
		});
	}

	// Candidate children per parent, sorted by y-position for consistent ordering
	const childLists = new Map<string, TreeNode[]>();
	for (const edge of canvas.edges.values()) {
		const parentTree = nodeMap.get(edge.from.node.id);
		const childTree = nodeMap.get(edge.to.node.id);
		if (!parentTree || !childTree) continue;
		const list = childLists.get(parentTree.canvasNode.id) ?? [];
		list.push(childTree);
		childLists.set(parentTree.canvasNode.id, list);
	}
	for (const list of childLists.values()) {
		list.sort((a, b) => a.canvasNode.y - b.canvasNode.y);
	}

	// Attach children breadth-first. A node reached a second time (a cycle or a
	// second parent) is skipped, so every node belongs to exactly one tree.
	const attached = new Set<string>();
	const attachTree = (root: TreeNode): void => {
		attached.add(root.canvasNode.id);
		root.depth = 0;
		const queue = [root];
		while (queue.length > 0) {
			const parent = queue.shift()!;
			for (const child of childLists.get(parent.canvasNode.id) ?? []) {
				if (attached.has(child.canvasNode.id)) continue;
				attached.add(child.canvasNode.id);
				child.parent = parent;
				child.depth = parent.depth + 1;
				child.siblingIndex = parent.children.length;
				parent.children.push(child);
				queue.push(child);
			}
		}
		assignDirections(root);
	};

	// Collect all roots: nodes with no incoming edges
	const roots: TreeNode[] = [];
	for (const node of canvas.nodes.values()) {
		if (childIds.has(node.id)) continue;
		const treeNode = nodeMap.get(node.id);
		if (!treeNode) continue;
		attachTree(treeNode);
		roots.push(treeNode);
	}
	// Nodes left over form pure cycles; break each at its top-most node.
	const leftovers = [...nodeMap.values()]
		.filter((treeNode) => !attached.has(treeNode.canvasNode.id))
		.sort((a, b) => a.canvasNode.y - b.canvasNode.y);
	for (const treeNode of leftovers) {
		if (attached.has(treeNode.canvasNode.id)) continue;
		attachTree(treeNode);
		roots.push(treeNode);
	}

	// Sort by descending subtree size (largest first)
	roots.sort((a, b) => countReachable(b) - countReachable(a));

	return roots;
}

/**
 * Collect the set of group node IDs from the serialized canvas data.
 * Runtime CanvasNode objects lack `.type` despite the type declaration —
 * must read from getData() which returns the serialized JSON.
 */
export function getGroupIds(canvas: Canvas): Set<string> {
	const ids = new Set<string>();
	for (const nd of canvas.getData().nodes) {
		if (nd.type === "group") ids.add(nd.id);
	}
	return ids;
}

/** Return the Canvas text title, or the linked Markdown filename for file nodes. */
export function getNodeTitle(node: CanvasNode, data?: CanvasNodeFileData): string {
	const firstLine = (node.text || "").split("\n")[0].trim();
	if (firstLine) return stripInlineMarkdown(firstLine) || "Untitled";

	const fileName = data?.file?.split("/").pop();
	return fileName?.replace(/\.md$/i, "") || "Untitled";
}

/** Plain text of one Markdown line, as shown in the outline. */
export function stripInlineMarkdown(line: string): string {
	return line
		.replace(/^#+\s*/, "")
		.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
		.replace(/^>\s*/, "")
		.replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
		.replace(/!?\[\[([^\]]*)\]\]/g, "$1")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		.replace(/(~~|==)(.+?)\1/g, "$2")
		.replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
		.replace(/`([^`]*)`/g, "$1")
		.trim();
}

/**
 * Find a TreeNode by ID across all trees in a forest.
 */
export function findTreeForNode(
	forest: TreeNode[],
	nodeId: string
): TreeNode | null {
	for (const root of forest) {
		const found = findTreeNode(root, nodeId);
		if (found) return found;
	}
	return null;
}

function countReachable(node: TreeNode): number {
	let count = 1;
	for (const child of node.children) {
		count += countReachable(child);
	}
	return count;
}

/**
 * Find the TreeNode corresponding to a canvas node ID within a single tree.
 */
function findTreeNode(
	root: TreeNode,
	nodeId: string
): TreeNode | null {
	if (root.canvasNode.id === nodeId) return root;
	for (const child of root.children) {
		const found = findTreeNode(child, nodeId);
		if (found) return found;
	}
	return null;
}

/**
 * Get all descendants of a tree node (for collapse/expand).
 */
export function getDescendants(node: TreeNode): TreeNode[] {
	const result: TreeNode[] = [];
	for (const child of node.children) {
		result.push(child);
		result.push(...getDescendants(child));
	}
	return result;
}

/**
 * Get the next sibling, or null if last.
 */
export function getNextSibling(node: TreeNode): TreeNode | null {
	if (!node.parent) return null;
	const siblings = node.parent.children;
	const idx = siblings.indexOf(node);
	return idx < siblings.length - 1 ? siblings[idx + 1] : null;
}

/**
 * Get the previous sibling, or null if first.
 */
export function getPrevSibling(node: TreeNode): TreeNode | null {
	if (!node.parent) return null;
	const siblings = node.parent.children;
	const idx = siblings.indexOf(node);
	return idx > 0 ? siblings[idx - 1] : null;
}

/**
 * Assign branch directions to all nodes in the tree.
 * Depth-1 children: direction based on X-center relative to root X-center.
 * Deeper children: inherit direction from their depth-1 ancestor.
 */
function assignDirections(root: TreeNode): void {
	const rootCx = root.canvasNode.x + root.canvasNode.width / 2;

	for (const child of root.children) {
		const childCx = child.canvasNode.x + child.canvasNode.width / 2;
		child.direction = childCx >= rootCx ? "right" : "left";
		propagateDirection(child, child.direction);
	}
}

function propagateDirection(node: TreeNode, dir: BranchDirection): void {
	for (const child of node.children) {
		child.direction = dir;
		propagateDirection(child, dir);
	}
}

/**
 * Count how many direct children of root are on each side.
 */
export function countChildrenPerSide(
	root: TreeNode
): { left: number; right: number } {
	let left = 0;
	let right = 0;
	for (const child of root.children) {
		if (child.direction === "left") left++;
		else right++;
	}
	return { left, right };
}
