/**
 * Pure summary (XMind-style "概要") logic, independent of the Canvas runtime.
 *
 * A summary groups two or more consecutive siblings that share a parent. It is
 * stored as a record in the canvas file under `cammvasSummaries` and rendered
 * with two ordinary canvas nodes: a narrow group node drawn as a bracket, and a
 * text node holding the summary content.
 */

export const SUMMARY_DATA_KEY = "cammvasSummaries";
export const SUMMARY_DEFAULT_TEXT = "概要";
/** Default texts that count as "never edited" when deciding whether to keep a content node. */
const DEFAULT_SUMMARY_TEXTS = new Set(["", SUMMARY_DEFAULT_TEXT, "Summary"]);

export const BRACKET_WIDTH = 24;
export const BRACKET_GAP = 24;
export const SUMMARY_GAP = 56;

export type SummarySide = "left" | "right";

export interface SummaryRecord {
	id: string;
	version: 2;
	bracketNodeId: string;
	summaryNodeId: string;
	memberNodeIds: string[];
	parentNodeId: string;
	side: SummarySide;
	/** Offset of the content node from its computed slot, set by dragging it. */
	offsetX: number;
	offsetY: number;
}

export interface Rect {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface GraphEdge {
	from: string;
	to: string;
}

/** Minimal read-only view of a canvas used by the pure helpers. */
export interface SummaryGraph {
	nodes: Map<string, Rect & { text?: string }>;
	edges: GraphEdge[];
}

export interface SummaryGeometry {
	bracketX: number;
	bracketY: number;
	bracketHeight: number;
	summaryX: number;
	summaryY: number;
}

/** Read summary records from serialized canvas data, dropping malformed entries. */
export function readSummaryRecords(data: Record<string, unknown>): SummaryRecord[] {
	const raw = data[SUMMARY_DATA_KEY];
	if (!Array.isArray(raw)) return [];
	const records: SummaryRecord[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const r = item as Record<string, unknown>;
		if (typeof r.id !== "string" || typeof r.bracketNodeId !== "string"
			|| typeof r.summaryNodeId !== "string" || typeof r.parentNodeId !== "string"
			|| !Array.isArray(r.memberNodeIds)) continue;
		records.push({
			id: r.id,
			version: 2,
			bracketNodeId: r.bracketNodeId,
			summaryNodeId: r.summaryNodeId,
			memberNodeIds: r.memberNodeIds.filter((id): id is string => typeof id === "string"),
			parentNodeId: r.parentNodeId,
			side: r.side === "left" ? "left" : "right",
			offsetX: Number.isFinite(r.offsetX) ? (r.offsetX as number) : 0,
			offsetY: Number.isFinite(r.offsetY) ? (r.offsetY as number) : 0,
		});
	}
	return records;
}

export function getBracketIds(records: SummaryRecord[]): Set<string> {
	return new Set(records.map((record) => record.bracketNodeId));
}

export function getSummaryNodeIds(records: SummaryRecord[]): Set<string> {
	return new Set(records.map((record) => record.summaryNodeId));
}

function childrenIndex(edges: GraphEdge[]): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const edge of edges) {
		const list = index.get(edge.from) ?? [];
		list.push(edge.to);
		index.set(edge.from, list);
	}
	return index;
}

function parentsIndex(edges: GraphEdge[]): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const edge of edges) {
		const list = index.get(edge.to) ?? [];
		list.push(edge.from);
		index.set(edge.to, list);
	}
	return index;
}

const centerX = (rect: Rect): number => rect.x + rect.width / 2;

export type SelectionValidation =
	| { ok: true; memberIds: string[]; parentId: string; side: SummarySide }
	| { ok: false; error: string };

/**
 * Check that the selected nodes can form a summary: at least two consecutive
 * siblings of the same parent on the same side, none already summarized.
 */
export function validateSummarySelection(
	graph: SummaryGraph,
	selectedIds: string[],
	records: SummaryRecord[]
): SelectionValidation {
	const excluded = new Set([...getBracketIds(records), ...getSummaryNodeIds(records)]);
	const selected = [...new Set(selectedIds)]
		.filter((id) => graph.nodes.has(id) && !excluded.has(id));
	if (selected.length < 2) return { ok: false, error: "请至少选择两个相邻的兄弟节点" };

	const parents = parentsIndex(graph.edges);
	const parentIds = selected.map((id) => parents.get(id) ?? []);
	if (parentIds.some((list) => list.length !== 1)) {
		return { ok: false, error: "每个选中节点都必须恰好有一个父节点" };
	}
	const parentId = parentIds[0][0];
	if (!parentIds.every((list) => list[0] === parentId)) {
		return { ok: false, error: "选中节点必须属于同一个父节点" };
	}
	const parent = graph.nodes.get(parentId);
	if (!parent) return { ok: false, error: "找不到共同的父节点" };

	const sideOf = (id: string): SummarySide =>
		centerX(graph.nodes.get(id)!) >= centerX(parent) ? "right" : "left";
	const side = sideOf(selected[0]);
	if (!selected.every((id) => sideOf(id) === side)) {
		return { ok: false, error: "选中节点必须位于父节点的同一侧" };
	}

	const siblings = (childrenIndex(graph.edges).get(parentId) ?? [])
		.filter((id) => graph.nodes.has(id) && sideOf(id) === side)
		.sort((a, b) => graph.nodes.get(a)!.y - graph.nodes.get(b)!.y);
	const selectedSet = new Set(selected);
	const indices = siblings
		.map((id, index) => (selectedSet.has(id) ? index : -1))
		.filter((index) => index >= 0);
	if (indices.length !== selected.length
		|| Math.max(...indices) - Math.min(...indices) + 1 !== indices.length) {
		return { ok: false, error: "请选择连续相邻的兄弟节点" };
	}

	const used = new Set(records.flatMap((record) => record.memberNodeIds));
	if (selected.some((id) => used.has(id))) {
		return { ok: false, error: "有节点已经属于另一个概要" };
	}

	return {
		ok: true,
		memberIds: siblings.filter((id) => selectedSet.has(id)),
		parentId,
		side,
	};
}

/** Collect the members and all their descendants (breadth-first, cycle-safe). */
export function collectCoveredIds(
	edges: GraphEdge[],
	rootIds: string[],
	excludedIds: Set<string> = new Set()
): string[] {
	const children = childrenIndex(edges);
	const result: string[] = [];
	const visited = new Set<string>();
	const queue = [...rootIds];
	while (queue.length > 0) {
		const id = queue.shift()!;
		if (visited.has(id) || excludedIds.has(id)) continue;
		visited.add(id);
		result.push(id);
		queue.push(...(children.get(id) ?? []));
	}
	return result;
}

/** Place the bracket beside the covered nodes and the content node beside the bracket. */
export function computeSummaryGeometry(
	covered: Rect[],
	side: SummarySide,
	summaryWidth: number,
	summaryHeight: number
): SummaryGeometry {
	const minX = Math.min(...covered.map((rect) => rect.x));
	const maxX = Math.max(...covered.map((rect) => rect.x + rect.width));
	const minY = Math.min(...covered.map((rect) => rect.y));
	const maxY = Math.max(...covered.map((rect) => rect.y + rect.height));
	const bracketHeight = Math.max(40, maxY - minY);
	const bracketX = side === "right"
		? maxX + BRACKET_GAP
		: minX - BRACKET_GAP - BRACKET_WIDTH;
	const summaryX = side === "right"
		? bracketX + BRACKET_WIDTH + SUMMARY_GAP
		: bracketX - SUMMARY_GAP - summaryWidth;
	return {
		bracketX,
		bracketY: minY,
		bracketHeight,
		summaryX,
		summaryY: minY + bracketHeight / 2 - summaryHeight / 2,
	};
}

export interface SummaryRemoval {
	record: SummaryRecord;
	/** Bracket node to delete, if it still exists. */
	removeBracket: boolean;
	/** Delete the content node too (only when it was never edited and has no children). */
	removeSummaryNode: boolean;
}

export interface ReconcileResult {
	records: SummaryRecord[];
	removals: SummaryRemoval[];
	changed: boolean;
}

/**
 * Bring records in line with the current graph: drop members that were deleted
 * or moved to another parent, and dissolve summaries that lost their content
 * node, their bracket, or all but one member.
 */
export function reconcileSummaryRecords(
	graph: SummaryGraph,
	records: SummaryRecord[]
): ReconcileResult {
	const parents = parentsIndex(graph.edges);
	const children = childrenIndex(graph.edges);
	const kept: SummaryRecord[] = [];
	const removals: SummaryRemoval[] = [];
	let changed = false;

	for (const record of records) {
		const members = record.memberNodeIds.filter((id) =>
			graph.nodes.has(id) && (parents.get(id) ?? []).includes(record.parentNodeId)
		);
		const summaryNode = graph.nodes.get(record.summaryNodeId);
		const bracketExists = graph.nodes.has(record.bracketNodeId);
		if (!summaryNode || !bracketExists || members.length < 2) {
			const untouched = summaryNode
				&& DEFAULT_SUMMARY_TEXTS.has((summaryNode.text ?? "").trim())
				&& (children.get(record.summaryNodeId) ?? []).length === 0;
			removals.push({
				record,
				removeBracket: bracketExists,
				removeSummaryNode: Boolean(untouched),
			});
			changed = true;
			continue;
		}
		if (members.length !== record.memberNodeIds.length) {
			kept.push({ ...record, memberNodeIds: members });
			changed = true;
		} else {
			kept.push(record);
		}
	}
	return { records: kept, removals, changed };
}
