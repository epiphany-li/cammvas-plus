export function focusCanvasKeyboardTarget(target: HTMLElement): void {
	const previousTabIndex = target.getAttribute("tabindex");
	if (previousTabIndex === null) target.setAttribute("tabindex", "-1");
	target.focus({ preventScroll: true });
	if (previousTabIndex === null) {
		target.removeAttribute("tabindex");
	} else {
		target.setAttribute("tabindex", previousTabIndex);
	}
}
