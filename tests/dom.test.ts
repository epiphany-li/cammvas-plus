import { describe, expect, it } from "vitest";
import { isInteractiveControlTarget } from "../src/ui/dom";

function target(closestResult: unknown): HTMLElement {
	return {
		offsetHeight: 10,
		closest: () => closestResult,
	} as unknown as HTMLElement;
}

describe("isInteractiveControlTarget", () => {
	it("recognizes a focused Canvas control", () => {
		expect(isInteractiveControlTarget(target({}))).toBe(true);
	});

	it("allows keyboard handling on the non-interactive Canvas surface", () => {
		expect(isInteractiveControlTarget(target(null))).toBe(false);
		expect(isInteractiveControlTarget(null)).toBe(false);
	});
});
