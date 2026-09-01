export interface OrderedListRenumberChange {
	from: number;
	to: number;
	insert: string;
}

interface ListFrame {
	indent: number;
	kind: "ordered" | "unordered";
	delimiter: string;
	next: number;
}

function countIndentColumns(indent: string): number {
	let columns = 0;
	for (const character of indent) {
		columns = character === "\t" ? columns + (4 - columns % 4) : columns + 1;
	}
	return columns;
}

/** Compute source edits that make ordered-list numbering match its preview. */
export function computeOrderedListRenumberChanges(text: string): OrderedListRenumberChange[] {
	const changes: OrderedListRenumberChange[] = [];
	const frames: ListFrame[] = [];
	const lines = text.split("\n");
	let offset = 0;
	let blankSinceContent = false;
	let fence: { character: string; length: number } | null = null;

	for (const line of lines) {
		const fenceMatch = line.match(/^([ \t]*)(`{3,}|~{3,})(.*)$/);
		if (fence) {
			if (
				fenceMatch
				&& fenceMatch[2][0] === fence.character
				&& fenceMatch[2].length >= fence.length
			) fence = null;
			offset += line.length + 1;
			continue;
		}
		if (fenceMatch) {
			const fenceIndent = countIndentColumns(fenceMatch[1]);
			if (blankSinceContent && frames.length > 0) {
				while (frames.length > 0 && frames[frames.length - 1].indent >= fenceIndent) frames.pop();
			}
			fence = { character: fenceMatch[2][0], length: fenceMatch[2].length };
			blankSinceContent = false;
			offset += line.length + 1;
			continue;
		}
		if (/^[ \t]*\r?$/.test(line)) {
			blankSinceContent = true;
			offset += line.length + 1;
			continue;
		}

		const ordered = line.match(/^([ \t]*)(\d{1,9})([.)])(?:[ \t]+|(?=\r?$))/);
		const unordered = ordered ? null : line.match(/^([ \t]*)([-+*])(?:[ \t]+|(?=\r?$))/);
		if (ordered || unordered) {
			const indentText = ordered ? ordered[1] : unordered![1];
			const indent = countIndentColumns(indentText);
			if (frames.length === 0 && indent >= 4) {
				blankSinceContent = false;
				offset += line.length + 1;
				continue;
			}
			while (frames.length > 0 && frames[frames.length - 1].indent > indent) frames.pop();
			const kind = ordered ? "ordered" : "unordered";
			const delimiter = ordered ? ordered[3] : unordered![2];
			let frame = frames[frames.length - 1];
			if (!frame || frame.indent !== indent || frame.kind !== kind || frame.delimiter !== delimiter) {
				if (frame && frame.indent === indent) frames.pop();
				frame = { indent, kind, delimiter, next: ordered ? Number(ordered[2]) + 1 : 0 };
				frames.push(frame);
			} else if (ordered) {
				const expected = frame.next;
				if (Number(ordered[2]) !== expected) {
					const from = offset + ordered[1].length;
					changes.push({ from, to: from + ordered[2].length, insert: String(expected) });
				}
				frame.next = expected + 1;
			}
			blankSinceContent = false;
			offset += line.length + 1;
			continue;
		}

		if (frames.length > 0) {
			const indentMatch = line.match(/^[ \t]*/);
			const indent = countIndentColumns(indentMatch ? indentMatch[0] : "");
			const startsBlock = /^([ \t]*)(#{1,6}[ \t]+|>|(?:-{3,}|\*{3,}|_{3,})[ \t]*\r?$|<\/?[A-Za-z])/u.test(line);
			if (blankSinceContent || startsBlock) {
				while (frames.length > 0 && frames[frames.length - 1].indent >= indent) frames.pop();
			}
		}
		blankSinceContent = false;
		offset += line.length + 1;
	}

	return changes;
}
