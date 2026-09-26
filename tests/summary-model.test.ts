import { describe, expect, it } from "vitest";
import {
	BRACKET_GAP,
	BRACKET_WIDTH,
	SUMMARY_GAP,
	SummaryGraph,
	SummaryRecord,
	collectCoveredIds,
	computeSummaryGeometry,
	readSummaryRecords,
	reconcileSummaryRecords,
	validateSummarySelection,
} from "../src/summary/summary-model";

const rect = (id: string, x: number, y: number, text = id) =>
	({ id, x, y, width: 200, height: 60, text });

/** root with four right children a..d, and a left child l; a has child a1. */
function makeGraph(): SummaryGraph {
	const nodes = [
		rect("root", 0, 0),
		rect("a", 400, -300),
		rect("b", 400, -100),
		rect("c", 400, 100),
		rect("d", 400, 300),
		rect("l", -400, 0),
		rect("a1", 800, -300),
	];
	return {
		nodes: new Map(nodes.map((node) => [node.id, node])),
		edges: [
			{ from: "root", to: "a" },
			{ from: "root", to: "b" },
			{ from: "root", to: "c" },
			{ from: "root", to: "d" },
			{ from: "root", to: "l" },
			{ from: "a", to: "a1" },
		],
	};
}

const record = (overrides: Partial<SummaryRecord> = {}): SummaryRecord => ({
	id: "s1",
	version: 2,
	bracketNodeId: "bracket",
	summaryNodeId: "summary",
	memberNodeIds: ["b", "c"],
	parentNodeId: "root",
	side: "right",
	offsetX: 0,
	offsetY: 0,
	...overrides,
});

describe("validateSummarySelection", () => {
	it("accepts consecutive siblings and orders them top to bottom", () => {
		expect(validateSummarySelection(makeGraph(), ["c", "b"], [])).toEqual({
			ok: true,
			memberIds: ["b", "c"],
			parentId: "root",
			side: "right",
		});
	});

	it("rejects fewer than two nodes", () => {
		expect(validateSummarySelection(makeGraph(), ["b"], []).ok).toBe(false);
	});

	it("rejects gaps between selected siblings", () => {
		const result = validateSummarySelection(makeGraph(), ["a", "c"], []);
		expect(result).toEqual({ ok: false, error: "请选择连续相邻的兄弟节点" });
	});

	it("rejects nodes with different parents", () => {
		expect(validateSummarySelection(makeGraph(), ["a1", "b"], []).ok).toBe(false);
	});

	it("rejects siblings on opposite sides of the parent", () => {
		const graph = makeGraph();
		graph.nodes.set("l2", rect("l2", -400, 200));
		graph.edges.push({ from: "root", to: "l2" });
		const result = validateSummarySelection(graph, ["l", "a"], []);
		expect(result).toEqual({ ok: false, error: "选中节点必须位于父节点的同一侧" });
	});

	it("rejects nodes already covered by another summary", () => {
		const result = validateSummarySelection(makeGraph(), ["c", "d"], [record()]);
		expect(result).toEqual({ ok: false, error: "有节点已经属于另一个概要" });
	});
});

describe("collectCoveredIds", () => {
	it("includes members and their descendants", () => {
		expect(collectCoveredIds(makeGraph().edges, ["a", "b"])).toEqual(["a", "b", "a1"]);
	});

	it("terminates on cycles", () => {
		const edges = [{ from: "x", to: "y" }, { from: "y", to: "x" }];
		expect(collectCoveredIds(edges, ["x"])).toEqual(["x", "y"]);
	});
});

describe("computeSummaryGeometry", () => {
	it("places the bracket right of the covered nodes and centers the content", () => {
		const geometry = computeSummaryGeometry(
			[rect("b", 400, -100), rect("c", 400, 100)],
			"right",
			260,
			60
		);
		const bracketX = 600 + BRACKET_GAP;
		expect(geometry).toEqual({
			bracketX,
			bracketY: -100,
			bracketHeight: 260,
			summaryX: bracketX + BRACKET_WIDTH + SUMMARY_GAP,
			summaryY: 0,
		});
	});

	it("mirrors to the left side", () => {
		const geometry = computeSummaryGeometry([rect("l", -400, 0), rect("m", -400, 100)], "left", 260, 60);
		expect(geometry.bracketX).toBe(-400 - BRACKET_GAP - BRACKET_WIDTH);
		expect(geometry.summaryX).toBe(geometry.bracketX - SUMMARY_GAP - 260);
	});
});

describe("readSummaryRecords", () => {
	it("drops malformed entries and fills missing offsets", () => {
		const records = readSummaryRecords({
			cammvasSummaries: [
				{ id: "ok", bracketNodeId: "b", summaryNodeId: "s", parentNodeId: "p", memberNodeIds: ["x", 3, "y"] },
				{ id: "broken" },
				null,
			],
		});
		expect(records).toEqual([{
			id: "ok",
			version: 2,
			bracketNodeId: "b",
			summaryNodeId: "s",
			memberNodeIds: ["x", "y"],
			parentNodeId: "p",
			side: "right",
			offsetX: 0,
			offsetY: 0,
		}]);
	});

	it("returns nothing when the key is missing", () => {
		expect(readSummaryRecords({})).toEqual([]);
	});
});

describe("reconcileSummaryRecords", () => {
	const withSummary = (text = "概要"): SummaryGraph => {
		const graph = makeGraph();
		graph.nodes.set("bracket", rect("bracket", 620, -100));
		graph.nodes.set("summary", rect("summary", 700, 0, text));
		return graph;
	};

	it("keeps valid records unchanged", () => {
		const result = reconcileSummaryRecords(withSummary(), [record()]);
		expect(result).toEqual({ records: [record()], removals: [], changed: false });
	});

	it("shrinks the member list when one of three members is deleted", () => {
		const graph = withSummary();
		graph.nodes.delete("d");
		const result = reconcileSummaryRecords(graph, [record({ memberNodeIds: ["b", "c", "d"] })]);
		expect(result.records[0].memberNodeIds).toEqual(["b", "c"]);
		expect(result.changed).toBe(true);
	});

	it("dissolves the summary and removes an untouched content node when members drop below two", () => {
		const graph = withSummary();
		graph.nodes.delete("c");
		const result = reconcileSummaryRecords(graph, [record()]);
		expect(result.records).toEqual([]);
		expect(result.removals).toEqual([{ record: record(), removeBracket: true, removeSummaryNode: true }]);
	});

	it("keeps an edited content node when dissolving", () => {
		const graph = withSummary("我写的总结");
		graph.nodes.delete("c");
		expect(reconcileSummaryRecords(graph, [record()]).removals[0].removeSummaryNode).toBe(false);
	});

	it("removes the bracket when the content node was deleted", () => {
		const graph = withSummary();
		graph.nodes.delete("summary");
		expect(reconcileSummaryRecords(graph, [record()]).removals).toEqual([
			{ record: record(), removeBracket: true, removeSummaryNode: false },
		]);
	});

	it("drops members re-parented elsewhere", () => {
		const graph = withSummary();
		graph.edges = graph.edges.filter((edge) => edge.to !== "c");
		graph.edges.push({ from: "a", to: "c" });
		const result = reconcileSummaryRecords(graph, [record()]);
		expect(result.records).toEqual([]);
		expect(result.removals).toHaveLength(1);
	});
});
