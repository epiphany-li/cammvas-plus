import { Notice } from "obsidian";
import { tr } from "../i18n";

export async function copyText(win: Window, text: string, successMessage: string): Promise<void> {
	try {
		await win.navigator.clipboard.writeText(text);
		new Notice(successMessage);
	} catch {
		new Notice(tr("Unable to copy to the clipboard", "无法复制到剪贴板"));
	}
}
