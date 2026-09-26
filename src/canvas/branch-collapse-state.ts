export function collectCollapsedDescendantIds(
	collapsedIds: Iterable<string>,
	getChildren: (nodeId: string) => string[]
): Set<string> {
	const hidden = new Set<string>();
	for (const collapsedId of collapsedIds) {
		const visited = new Set<string>([collapsedId]);
		const queue = [...getChildren(collapsedId)];
		while (queue.length > 0) {
			const id = queue.shift()!;
			if (visited.has(id)) continue;
			visited.add(id);
			hidden.add(id);
			queue.push(...getChildren(id));
		}
	}
	return hidden;
}

/**
 * Nodes hidden by collapsed branches: descendants of a collapsed node that can
 * no longer be reached from a root without passing through a collapsed node.
 * A node that also hangs under an expanded parent therefore stays visible,
 * matching how buildForest assigns it to a single tree.
 */
export function collectHiddenIds(
	collapsedIds: Iterable<string>,
	allIds: Iterable<string>,
	getChildren: (nodeId: string) => string[]
): Set<string> {
	const collapsed = new Set(collapsedIds);
	const candidates = collectCollapsedDescendantIds(collapsed, getChildren);
	if (candidates.size === 0) return candidates;

	const ids = Array.from(allIds);
	const hasParent = new Set<string>();
	for (const id of ids) {
		for (const child of getChildren(id)) hasParent.add(child);
	}
	const queue = ids.filter((id) => !hasParent.has(id));
	const reachable = new Set(queue);
	while (queue.length > 0) {
		const id = queue.shift()!;
		if (collapsed.has(id)) continue;
		for (const child of getChildren(id)) {
			if (reachable.has(child)) continue;
			reachable.add(child);
			queue.push(child);
		}
	}
	return new Set([...candidates].filter((id) => !reachable.has(id)));
}
