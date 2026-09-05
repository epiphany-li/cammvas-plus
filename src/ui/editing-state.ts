import type { CanvasNode } from "../types/canvas-internal";

export function isNodeEditorFocused(node: CanvasNode): boolean {
	const editor = node.child?.editor;
	return typeof editor?.hasFocus === "function" && editor.hasFocus();
}

export function shouldUseNodeArrowNavigation(
	enabled: boolean,
	isMindmap: boolean,
	hasSelectedNode: boolean,
	isEditing: boolean,
	isEditorFocused: boolean
): boolean {
	return enabled
		&& isMindmap
		&& hasSelectedNode
		&& !isEditing
		&& !isEditorFocused;
}
