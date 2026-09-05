import { describe, expect, it } from "vitest";
import { findNavigableHistoryIndex } from "../src/ui/navigation-history";

describe("findNavigableHistoryIndex", () => {
	it("skips deleted nodes in both directions", () => {
		const history = ["a", "deleted-back", "c", "deleted-forward", "e"];
		const existing = new Set(["a", "c", "e"]);
		expect(findNavigableHistoryIndex(history, 2, -1, (id) => existing.has(id))).toBe(0);
		expect(findNavigableHistoryIndex(history, 2, 1, (id) => existing.has(id))).toBe(4);
	});

	it("returns null without changing state when no valid target remains", () => {
		expect(findNavigableHistoryIndex(["a"], 0, -1, () => true)).toBeNull();
		expect(findNavigableHistoryIndex(["a"], 0, 1, () => true)).toBeNull();
	});
});
