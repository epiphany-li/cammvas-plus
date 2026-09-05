export function findNavigableHistoryIndex(
	history: readonly string[],
	startIndex: number,
	direction: -1 | 1,
	nodeExists: (nodeId: string) => boolean
): number | null {
	for (
		let index = startIndex + direction;
		index >= 0 && index < history.length;
		index += direction
	) {
		if (nodeExists(history[index])) return index;
	}
	return null;
}
