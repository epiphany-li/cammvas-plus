import { App, Modal, Notice, Setting } from "obsidian";
import type { PdfPageSize } from "./pdf-export";
import { tr } from "../i18n";

export class PdfExportModal extends Modal {
	private fileName: string;
	private folder = "Cammvas Exports";
	private pageSize: PdfPageSize = "a4";

	constructor(
		app: App,
		initialFileName: string,
		private onExport: (fileName: string, folder: string, pageSize: PdfPageSize) => void
	) {
		super(app);
		this.fileName = initialFileName;
	}

	onOpen(): void {
		this.setTitle(tr("Save mind map PDF", "保存导图 PDF"));
		new Setting(this.contentEl)
			.setName(tr("File name", "文件名"))
			.setDesc(tr("The .pdf extension is added automatically.", "会自动添加 .pdf 扩展名。"))
			.addText((text) => {
				text.setValue(this.fileName);
				text.inputEl.select();
				text.onChange((value) => this.fileName = value);
			});

		new Setting(this.contentEl)
			.setName(tr("Save in", "保存位置"))
			.setDesc(tr("Folder path in the vault. It is created automatically when needed; leave empty for the vault root.", "保存到库中的文件夹，不存在时自动创建；留空表示库根目录。"))
			.addText((text) => {
				text.setValue(this.folder);
				text.onChange((value) => this.folder = value);
			});

		new Setting(this.contentEl)
			.setName(tr("Page size", "纸张大小"))
			.setDesc(tr("Fixed paper sizes fit the whole map on one page. Full size preserves the map's natural dimensions.", "固定纸张会把整张导图缩放到一页；原始尺寸保留导图的实际大小。"))
			.addDropdown((dropdown) => {
				dropdown.addOption("a4", tr("A4 (auto orientation)", "A4（自动方向）"));
				dropdown.addOption("a3", tr("A3 (auto orientation)", "A3（自动方向）"));
				dropdown.addOption("full", tr("Full size (one large page)", "原始尺寸（单张大页）"));
				dropdown.setValue(this.pageSize);
				dropdown.onChange((value) => this.pageSize = value as PdfPageSize);
			});

		const actions = this.contentEl.createDiv({ cls: "cammvas-pdf-export-actions" });
		actions.createEl("button", { text: tr("Cancel", "取消") }).addEventListener("click", () => this.close());
		actions.createEl("button", { text: tr("Export PDF", "导出 PDF"), cls: "mod-cta" }).addEventListener("click", () => {
			const fileName = this.fileName.trim();
			if (!fileName) {
				new Notice(tr("Enter a file name before exporting.", "请先填写文件名"));
				return;
			}
			this.close();
			this.onExport(fileName, this.folder.trim(), this.pageSize);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
