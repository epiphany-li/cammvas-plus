# Cammvas Plus

## Local maintenance fork

This repository is a separately maintained fork for a personal Obsidian workflow.
The `cammvas` GitHub repository remains the upstream source; keep it configured as the
`upstream` remote and merge upstream updates deliberately.

The Plus branch includes interaction and maintenance improvements:

- Automatic Markdown resize/edit-exit and structural changes preserve the current Canvas
  viewport (`x/y/tx/ty/zoom/tZoom`) across the synchronous and next-frame layout pass.
- Automatic re-layout after resize, insert, delete, flip, detach, and drag uses the full
  relationship forest, so all transitively affected nodes are recalculated instead of only
  the selected node's siblings.
- Manual node resizing synchronizes widths at the same tree depth, remeasures wrapped
  content, and reflows every affected branch without moving the viewport.
- Deferred editor, outline, and drag callbacks are cancelled when their original interaction
  is no longer current.

Build and install the generated `main.js`, `manifest.json`, and `styles.css` into the vault's
`.obsidian/plugins/cammvas-plus/` directory. Do not edit the generated bundle by hand.

**A dedicated mind-mapping experience inside Obsidian Canvas.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![GitHub release](https://img.shields.io/github/v/release/epiphany-li/cammvas-plus)](https://github.com/epiphany-li/cammvas-plus/releases) [![Obsidian](https://img.shields.io/badge/Obsidian-1.13.4%2B-purple.svg)](https://obsidian.md)

Cammvas adds the interactions people expect from standalone mind-mapping software while keeping every map as a standard `.canvas` file in the vault. Build branches from the keyboard, drag nodes onto other nodes to restructure a map, collapse complete subtrees, and navigate the hierarchy without leaving Canvas.

## What Cammvas Adds

- **Mind-map keyboard workflow:** `Enter` creates a sibling, `Tab` creates a child, `Shift + Enter` inserts a line break, and arrow keys navigate the tree.
- **Drag to create branches:** drop one or multiple selected nodes onto another node to reparent their complete branches, with cycle prevention and a highlighted target.
- **Collapsible branches:** fold and restore complete descendant trees directly from their parent nodes.
- **Automatic tree layout:** compact contour-based placement with left, right, and balanced branches.
- **Branch-only re-layout:** manually organize only the descendants of the selected node without moving its ancestors.
- **Branch-aware dragging:** moving a node moves its descendants while preserving their relative positions.
- **Map outline:** search, navigate, group, rename, and reorganize roots from a synchronized sidebar.
- **Branch colors:** configurable palettes with automatic propagation through each branch.
- **Canvas-native storage:** no proprietary format, external service, network request, or telemetry.

## Quick Start

1. Open a Canvas and activate **Mindmap mode** from the Canvas controls.
2. Double-click empty Canvas space to create a root node.
3. Use `Enter` and `Tab` for the conventional mind-mapping workflow.
4. Restructure branches by dropping nodes onto other nodes.
5. Use the node chevrons to collapse or expand branches.

The Canvas controls also include toggles for **Drag to reparent** and **Mind mapping Enter and Tab**. Right-click a parent node to re-layout only that branch.

All behavior can be configured under **Settings > Cammvas Plus**.

## Keyboard Workflow

When **Mind mapping Enter and Tab** is enabled, plain `Enter` starts editing a selected node or creates a sibling while editing, plain `Tab` creates a child, `Shift + Enter` inserts a line break, and arrow keys navigate between nodes.

Cammvas does not assign default hotkeys to **Add child node**, **Add sibling node**, or **Create root node**. All commands remain available from the command palette and can be assigned custom hotkeys under **Settings > Hotkeys**.

## Installation

### Community Plugins

Once Cammvas Plus is accepted into the Obsidian community directory:

1. Open **Settings > Community plugins**.
2. Search for **Cammvas Plus**.
3. Select **Install**, then **Enable**.

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/epiphany-li/cammvas-plus/releases/latest).
2. Create `.obsidian/plugins/cammvas-plus/` inside the vault.
3. Place the three files in that folder.
4. Enable Cammvas Plus under **Settings > Community plugins**.

## Compatibility

Cammvas requires Obsidian 1.13.4 or newer. Desktop and mobile use the same Canvas files and core mind-mapping features. On mobile, long-press and drag a node to reparent it; mouse- and modifier-specific interactions remain desktop-only. Several advanced Canvas interactions depend on undocumented runtime APIs, so compatibility is tested against current Obsidian releases.

## Privacy And Permissions

Cammvas Plus runs locally, makes no network requests, and collects no telemetry. It writes Canvas changes through Obsidian's vault API. Clipboard access occurs only after an explicit **Copy node link** action and writes the generated `obsidian://cammvas-plus-navigate` link to the clipboard; Cammvas Plus never reads clipboard contents.

## Origin And Attribution

Cammvas Plus is maintained by [epiphany-li](https://github.com/epiphany-li) as a derivative of [Cammvas](https://github.com/cuatrecasespro/cammvas), developed by cuatrecasespro. Cammvas is based on the MIT-licensed [Mindvas](https://github.com/mobench/mindvas) project by mobench; all copyright and license notices are retained.

Cammvas extends that foundation with a workflow designed to reproduce dedicated mind-mapping software inside Canvas, including drag-to-reparent branch creation, persistent branch collapsing, conventional mind-map hotkeys, spatial navigation, configurable branch palettes, root creation, and an expanded synchronized outline.

Cammvas is not affiliated with or endorsed by the original Mindvas project.

## License

[MIT](LICENSE). See the license file for the original and current copyright notices.

## Contributing

Bug reports and feature requests are welcome in the [issue tracker](https://github.com/epiphany-li/cammvas-plus/issues).
