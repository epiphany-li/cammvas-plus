import { describe, expect, it } from "vitest";
import { computeOrderedListRenumberChanges } from "../src/ui/ordered-list-renumber";

describe("computeOrderedListRenumberChanges", () => {
	it("renumbers consecutive ordered-list items", () => {
		expect(computeOrderedListRenumberChanges("1. first\n9. second\n4. third"))
			.toEqual([
				{ from: 9, to: 10, insert: "2" },
				{ from: 19, to: 20, insert: "3" },
			]);
	});

	it("tracks nested list counters independently", () => {
		const text = "1. root\n    1. child\n    7. child\n8. root";
		expect(computeOrderedListRenumberChanges(text)).toEqual([
			{ from: 25, to: 26, insert: "2" },
			{ from: 34, to: 35, insert: "2" },
		]);
	});

	it("does not rewrite examples inside fenced code blocks", () => {
		const text = "1. before\n```md\n1. example\n9. example\n```\n2. after";
		expect(computeOrderedListRenumberChanges(text)).toEqual([]);
	});
});
