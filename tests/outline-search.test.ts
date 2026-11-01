import { describe, expect, it } from "vitest";
import { findMatchSnippet, nodeSearchText, normalizeQuery } from "../src/ui/outline-search";

describe("nodeSearchText", () => {
	it("joins the card text, file path, url and label", () => {
		expect(nodeSearchText({ text: "## 控速\n- rwnd", file: "a/b.md" }, "fallback")).toBe("## 控速\n- rwnd\na/b.md");
	});

	it("falls back to the title when the card carries no searchable data", () => {
		expect(nodeSearchText(undefined, "Untitled")).toBe("Untitled");
		expect(nodeSearchText({ text: "   " }, "Untitled")).toBe("Untitled");
	});
});

describe("findMatchSnippet", () => {
	const card = "## 控速：流量控制、拥塞控制\n- 零窗口：发送方停发\n\t- 解法：坚持计时器 + 窗口探测报文\n- 慢启动：每个 ACK +1";

	it("returns the line holding the first hit, markers stripped, with the hit offset", () => {
		const hit = findMatchSnippet(card, "坚持计时器");
		expect(hit).toEqual({ line: "解法：坚持计时器 + 窗口探测报文", start: 3, length: 5 });
	});

	it("matches case-insensitively and strips heading hashes", () => {
		const hit = findMatchSnippet(card, "ack");
		expect(hit?.line).toBe("慢启动：每个 ACK +1");
		expect(hit && hit.line.slice(hit.start, hit.start + hit.length)).toBe("ACK");
		expect(findMatchSnippet(card, "控速")?.line).toBe("控速：流量控制、拥塞控制");
	});

	it("keeps the hit visible when windowing a long line", () => {
		const long = "x".repeat(200) + " needle " + "y".repeat(200);
		const hit = findMatchSnippet(long, "needle", 60);
		expect(hit).not.toBeNull();
		expect(hit!.line.length).toBeLessThanOrEqual(62);
		expect(hit!.line.startsWith("…")).toBe(true);
		expect(hit!.line.endsWith("…")).toBe(true);
		expect(hit!.line.slice(hit!.start, hit!.start + hit!.length)).toBe("needle");
	});

	it("returns null for an empty query or no hit", () => {
		expect(findMatchSnippet(card, "  ")).toBeNull();
		expect(findMatchSnippet(card, "不存在")).toBeNull();
	});

	it("normalizes queries by trimming and lowercasing", () => {
		expect(normalizeQuery("  RWND ")).toBe("rwnd");
	});
});
