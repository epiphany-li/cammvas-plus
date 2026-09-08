export function isHtmlElement(value: unknown): value is HTMLElement {
	return typeof value === "object"
		&& value !== null
		&& typeof Reflect.get(value, "closest") === "function"
		&& typeof Reflect.get(value, "offsetHeight") === "number";
}

export function isDomNode(value: unknown): value is Node {
	return typeof value === "object"
		&& value !== null
		&& typeof Reflect.get(value, "nodeType") === "number";
}

const INTERACTIVE_CONTROL_SELECTOR = [
	"button",
	"input",
	"textarea",
	"select",
	"a[href]",
	"[role='button']",
	"[contenteditable='true']",
	".clickable-icon",
].join(", ");

/** Keep Canvas navigation/edit shortcuts away from focused UI controls. */
export function isInteractiveControlTarget(value: unknown): boolean {
	return isHtmlElement(value) && Boolean(value.closest(INTERACTIVE_CONTROL_SELECTOR));
}
