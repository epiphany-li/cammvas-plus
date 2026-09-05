export interface EditingEnterEvent {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	isComposing: boolean;
}

export function shouldCreateSiblingOnEnter(
	event: EditingEnterEvent,
	enabled: boolean,
	isEditing: boolean
): boolean {
	return enabled
		&& isEditing
		&& event.key === "Enter"
		&& !event.shiftKey
		&& !event.ctrlKey
		&& !event.altKey
		&& !event.metaKey
		&& !event.isComposing;
}

export function shouldStartEditingOnEnter(
	event: EditingEnterEvent,
	enabled: boolean,
	isEditing: boolean
): boolean {
	return enabled
		&& !isEditing
		&& event.key === "Enter"
		&& !event.shiftKey
		&& !event.ctrlKey
		&& !event.altKey
		&& !event.metaKey
		&& !event.isComposing;
}

export function shouldStartEditingOnSpace(
	event: EditingEnterEvent,
	isEditing: boolean
): boolean {
	return !isEditing
		&& (event.key === " " || event.key === "Spacebar")
		&& !event.shiftKey
		&& !event.ctrlKey
		&& !event.altKey
		&& !event.metaKey
		&& !event.isComposing;
}

export function shouldExitEditingOnEscape(
	event: EditingEnterEvent,
	isEditing: boolean
): boolean {
	return isEditing
		&& event.key === "Escape"
		&& !event.shiftKey
		&& !event.ctrlKey
		&& !event.altKey
		&& !event.metaKey
		&& !event.isComposing;
}

export function shouldCreateChildOnTab(
	event: EditingEnterEvent,
	enabled: boolean,
	hasSelectedNode: boolean
): boolean {
	return enabled
		&& hasSelectedNode
		&& event.key === "Tab"
		&& !event.shiftKey
		&& !event.ctrlKey
		&& !event.altKey
		&& !event.metaKey
		&& !event.isComposing;
}
