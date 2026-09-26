import * as obsidian from "obsidian";

let cachedIsChinese: boolean | null = null;

/** Whether Obsidian's interface language is Chinese (any variant). */
export function isChineseUI(): boolean {
	if (cachedIsChinese !== null) return cachedIsChinese;
	const getLanguage = (obsidian as { getLanguage?: () => string }).getLanguage;
	const language = typeof getLanguage === "function"
		? getLanguage()
		: (globalThis.localStorage?.getItem("language") ?? "en");
	cachedIsChinese = /^zh/i.test(language);
	return cachedIsChinese;
}

/** Pick the Chinese or English string according to Obsidian's language. */
export function tr(en: string, zh: string): string {
	return isChineseUI() ? zh : en;
}
