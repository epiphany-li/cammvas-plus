/** Where a search hit sits in one line of a card, for the outline's context line. */
export interface MatchSnippet {
	/** The line (markers stripped, long lines windowed around the hit). */
	line: string;
	/** Offset of the hit inside `line`. */
	start: number;
	length: number;
}

export function normalizeQuery(raw: string): string {
	return raw.trim().toLowerCase();
}

/**
 * Everything of a card the outline search looks through: the whole text of a
 * text card, the file path of a file card, the URL of a link card, a group's
 * label. The outline itself only shows first lines, so without this a search
 * for something in a card's body finds nothing.
 */
export function nodeSearchText(
	data: { text?: string; file?: string; url?: string; label?: string } | undefined,
	fallback: string
): string {
	const parts = [data?.text, data?.file, data?.url, data?.label].filter(
		(part): part is string => typeof part === "string" && part.trim() !== ""
	);
	return parts.length > 0 ? parts.join("\n") : fallback;
}

/** List bullets, checkboxes, heading hashes, quote marks and table pipes at the start of a line. */
const LINE_PREFIX = /^(?:\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|\s*#{1,6}\s+|\s*>\s*|\s*\|\s*)+/;

/**
 * The first line of `text` containing `query` (case-insensitive), with the
 * hit's position in it. Returns null when there is no hit.
 */
export function findMatchSnippet(text: string, query: string, maxLength = 80): MatchSnippet | null {
	const q = normalizeQuery(query);
	if (q === "") return null;
	const lower = text.toLowerCase();
	const hit = lower.indexOf(q);
	if (hit < 0) return null;

	const lineStart = lower.lastIndexOf("\n", hit) + 1;
	const lineEndRaw = lower.indexOf("\n", hit);
	const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
	let line = text.slice(lineStart, lineEnd).replace(/\s+$/, "");
	let start = hit - lineStart;

	// Read like the card, not like its Markdown source.
	const prefix = LINE_PREFIX.exec(line)?.[0] ?? "";
	if (prefix.length <= start) {
		line = line.slice(prefix.length);
		start -= prefix.length;
	}

	if (line.length > maxLength) {
		const lead = Math.max(0, Math.min(start - Math.floor(maxLength / 4), line.length - maxLength));
		const cut = line.slice(lead, lead + maxLength);
		const before = lead > 0 ? "…" : "";
		const after = lead + maxLength < line.length ? "…" : "";
		line = before + cut + after;
		start = start - lead + before.length;
	}
	return { line, start, length: q.length };
}
