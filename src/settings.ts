import { App, Platform, PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type CanvasMindMapPlugin from "./main";
import { DEFAULT_BRANCH_PALETTE, parsePalette } from "./mindmap/color-palette";
import { tr } from "./i18n";

export interface MindMapSettings {
	autoLayout: boolean;
	autoColor: boolean;
	branchPalette: string[];
	colorLeafNodes: boolean;
	arrowKeyNavigation: boolean;
	centerNodeOnArrowNavigation: boolean;
	dragToReparent: boolean;
	autoLayoutOnReparent: boolean;
	autoLayoutOnEdit: boolean;
	enterCreatesSibling: boolean;
	edgeLabelFontSize: number;
	horizontalGap: number;
	verticalGap: number;
	defaultNodeWidth: number;
	defaultNodeHeight: number;
	defaultMindmapMode: boolean;
	navigationZoomPadding: number;
	mouseNavigation: boolean;
	/** Resizing one node's width also resizes every node at the same tree depth. */
	syncSameDepthWidth: boolean;
}

export const DEFAULT_SETTINGS: MindMapSettings = {
	autoLayout: true,
	autoColor: true,
	branchPalette: [...DEFAULT_BRANCH_PALETTE],
	colorLeafNodes: true,
	arrowKeyNavigation: true,
	centerNodeOnArrowNavigation: false,
	dragToReparent: true,
	autoLayoutOnReparent: true,
	autoLayoutOnEdit: false,
	enterCreatesSibling: true,
	edgeLabelFontSize: 14,
	horizontalGap: 80,
	// Keep sibling branches comfortably separated to reduce accidental clicks/drags.
	verticalGap: 40,
	defaultNodeWidth: 300,
	defaultNodeHeight: 60,
	defaultMindmapMode: true,
	navigationZoomPadding: 200,
	mouseNavigation: false,
	syncSameDepthWidth: false,
};

const BOOLEAN_SETTING_KEYS = [
	"autoLayout",
	"autoColor",
	"colorLeafNodes",
	"arrowKeyNavigation",
	"centerNodeOnArrowNavigation",
	"dragToReparent",
	"autoLayoutOnReparent",
	"autoLayoutOnEdit",
	"enterCreatesSibling",
	"defaultMindmapMode",
	"mouseNavigation",
	"syncSameDepthWidth",
] as const;

const POSITIVE_NUMBER_SETTING_KEYS = [
	"horizontalGap",
	"verticalGap",
	"defaultNodeWidth",
	"defaultNodeHeight",
	"edgeLabelFontSize",
] as const;

function isSettingsData(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSettingKey(key: string): key is keyof MindMapSettings {
	return key in DEFAULT_SETTINGS;
}

export function normalizeSettings(data: unknown): MindMapSettings {
	const settings: MindMapSettings = {
		...DEFAULT_SETTINGS,
		branchPalette: [...DEFAULT_SETTINGS.branchPalette],
	};
	if (!isSettingsData(data)) return settings;

	for (const key of BOOLEAN_SETTING_KEYS) {
		const value = data[key];
		if (typeof value === "boolean") settings[key] = value;
	}
	for (const key of POSITIVE_NUMBER_SETTING_KEYS) {
		const value = data[key];
		if (typeof value === "number" && Number.isFinite(value) && value > 0) {
			settings[key] = value;
		}
	}
	const zoomPadding = data.navigationZoomPadding;
	if (typeof zoomPadding === "number" && Number.isFinite(zoomPadding) && zoomPadding >= 0) {
		settings.navigationZoomPadding = zoomPadding;
	}
	const palette: unknown = data.branchPalette;
	if (Array.isArray(palette) && palette.every((color: unknown) => typeof color === "string")) {
		settings.branchPalette = parsePalette(palette.join(","));
	}
	return settings;
}

export class MindMapSettingTab extends PluginSettingTab {
	plugin: CanvasMindMapPlugin;

	constructor(app: App, plugin: CanvasMindMapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const positiveNumber = (key: string) => ({
			type: "number" as const,
			key,
			min: 1,
			step: 1,
			validate: (value: number) => value > 0 ? undefined : tr("Enter a positive number.", "请输入正数"),
		});

		return [
			{ name: tr("Default mindmap mode", "默认启用导图模式"), desc: tr("Whether canvases default to mindmap mode (can be toggled per canvas)", "新画布默认是否为导图模式（可按画布单独切换）"), control: { type: "toggle", key: "defaultMindmapMode" } },
			{ name: tr("Auto-layout", "自动排版"), desc: tr("Automatically arrange nodes when Cammvas creates them", "新建节点时自动排版"), control: { type: "toggle", key: "autoLayout" } },
			{ name: tr("Auto-color branches", "分支自动配色"), desc: tr("Assign distinct colors to top-level branches", "为一级分支分配不同颜色"), control: { type: "toggle", key: "autoColor" } },
			{ name: tr("Branch color palette", "分支调色板"), desc: tr("Comma-separated Canvas colors (1-6) or hex colors, assigned to top-level branches", "逗号分隔的画布颜色（1-6）或十六进制颜色，依次分配给一级分支"), control: { type: "text", key: "branchPalette", placeholder: "1, 2, 3, 4, 5, 6" } },
			{ name: tr("Color leaf nodes", "叶子节点着色"), desc: tr("Turn off to leave terminal nodes neutral while keeping their incoming edge colored", "关闭后末端节点保持中性色，只给连线着色"), control: { type: "toggle", key: "colorLeafNodes" } },
			{ name: tr("Edge label font size", "连线标签字号"), desc: tr("Font size of the text label on connection arrows (px)", "连线上文字标签的字号（px）"), control: positiveNumber("edgeLabelFontSize") },
			{ name: tr("Arrow key navigation", "方向键导航"), desc: tr("Navigate between selected mind map nodes with the arrow keys; disable to move Canvas cards natively", "用方向键在导图节点间移动选择；关闭后方向键恢复为移动卡片"), control: { type: "toggle", key: "arrowKeyNavigation" } },
			{ name: tr("Center node during arrow navigation", "方向键导航时居中"), desc: tr("Always center the selected node when navigating with the arrow keys instead of moving the viewport only when needed", "方向键导航时总是把选中节点居中，而不是仅在必要时移动视野"), control: { type: "toggle", key: "centerNodeOnArrowNavigation" } },
			{ name: tr("Drag to reparent", "拖拽改父节点"), desc: Platform.isMobile ? tr("Long-press and drag a node onto another node to make it a child while preserving its branch", "长按拖动节点到另一个节点上，使其连同分支成为子节点") : tr("Drop a node onto another node to make it a child while preserving its branch", "把节点拖到另一个节点上，使其连同分支成为子节点"), control: { type: "toggle", key: "dragToReparent" } },
			{ name: tr("Auto-layout after reparent", "改父节点后自动排版"), desc: tr("Automatically arrange the subtree after dragging a node onto a new parent", "拖到新父节点后自动排版"), control: { type: "toggle", key: "autoLayoutOnReparent" } },
			{ name: tr("Auto-layout on manual edits", "手动编辑后自动排版"), desc: tr("Also re-arrange the subtree after editing text, deleting, detaching, or manually moving a node — not just when Cammvas creates nodes", "编辑文字、删除、拆分或手动移动节点后也自动排版，而不只是新建节点时"), control: { type: "toggle", key: "autoLayoutOnEdit" } },
			{ name: tr("Sync width at the same depth", "同层节点同步宽度"), desc: tr("Resizing a node's width also applies that width to every node at the same depth of its tree", "拖动改变一个节点的宽度时，同一棵树同一层的节点也改为相同宽度"), control: { type: "toggle", key: "syncSameDepthWidth" } },
			{ name: tr("Mind mapping Enter and Tab", "导图式 Enter 与 Tab"), desc: Platform.isMobile ? tr("Use Enter and Tab from a hardware keyboard to create sibling and child nodes outside editing", "使用外接键盘时，非编辑状态下 Enter 新建兄弟节点、Tab 新建子节点") : tr("Outside editing, Enter creates a sibling and Tab creates a child; inside editing, both keys remain with the text editor", "非编辑状态下 Enter 新建兄弟节点、Tab 新建子节点；编辑时两个键仍用于输入文字"), control: { type: "toggle", key: "enterCreatesSibling" } },
			{ name: tr("Horizontal gap", "水平间距"), desc: tr("Space between parent and child nodes (px)", "父子节点之间的距离（px）"), control: positiveNumber("horizontalGap") },
			{ name: tr("Vertical gap", "垂直间距"), desc: tr("Space between sibling nodes (px)", "兄弟节点之间的距离（px）"), control: positiveNumber("verticalGap") },
			{ name: tr("Default node width", "默认节点宽度"), desc: tr("Width of newly created nodes (px)", "新建节点的宽度（px）"), control: positiveNumber("defaultNodeWidth") },
			{ name: tr("Default node height", "默认节点高度"), desc: tr("Height of newly created nodes (px)", "新建节点的高度（px）"), control: positiveNumber("defaultNodeHeight") },
			{ name: tr("Mouse back/forward navigation", "鼠标前进/后退导航"), desc: tr("Use mouse back/forward buttons for in-canvas navigation instead of Obsidian's default note navigation", "用鼠标侧键在画布内前进/后退，而不是 Obsidian 默认的笔记导航"), visible: () => !Platform.isMobile, control: { type: "toggle", key: "mouseNavigation" } },
			{ name: tr("Navigation zoom padding", "导航缩放留白"), desc: tr("Extra space around the target node when zooming after navigation (px). 0 = tight zoom.", "导航后缩放时目标节点四周的留白（px），0 表示紧贴"), control: { type: "number", key: "navigationZoomPadding", min: 0, step: 1, validate: (value) => value >= 0 ? undefined : tr("Enter zero or a positive number.", "请输入 0 或正数") } },
		];
	}

	getControlValue(key: string): unknown {
		if (key === "branchPalette") return this.plugin.settings.branchPalette.join(", ");
		return isSettingKey(key) ? this.plugin.settings[key] : undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "branchPalette" && typeof value === "string") {
			this.plugin.settings.branchPalette = parsePalette(value);
		} else if (BOOLEAN_SETTING_KEYS.some((settingKey) => settingKey === key)) {
			if (typeof value !== "boolean") return;
			Object.assign(this.plugin.settings, { [key]: value });
		} else if (POSITIVE_NUMBER_SETTING_KEYS.some((settingKey) => settingKey === key)) {
			if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
			Object.assign(this.plugin.settings, { [key]: value });
		} else if (key === "navigationZoomPadding") {
			if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return;
			this.plugin.settings.navigationZoomPadding = value;
		} else {
			return;
		}
		await this.plugin.saveSettings(
			key === "autoColor" || key === "branchPalette" || key === "colorLeafNodes"
		);
	}
}
