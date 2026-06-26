# Achmage Slides Ultra 1920 v5

Turn your Markdown notes into layout-aware, presentation-grade **1920×1080 slides** — automatically. Powered by [Marp](https://marp.app/), with a structure-aware layout engine that picks grids, balances columns, and guarantees overflow-free slides.

Open any note in the slide preview and it renders live. No slide-specific syntax required: the plugin reads the shape of your Markdown (headings, lists, definition lists, nesting) and lays it out for you.

## Features

- **Live slide preview** — render the active Markdown note as 1920×1080 slides in a side pane.
- **Structure-aware auto-layout** — definition grids, bento card grids, and balanced multi-column layouts are chosen automatically from your content's shape, with graceful degradation when content is dense.
- **Overflow-free guarantee** — a closed-loop measurement pass automatically paginates or shrinks content so nothing is clipped, in both the live preview and exports.
- **Automatic typographic scale** — body, heading, and label sizes scale together; bind hotkeys to nudge the base font size.
- **Premium themes** — multiple built-in 1920 v5 themes (light and dark), with per-theme background treatments.
- **Self-contained HTML export** — export a deck to a single `.slides.html` that embeds fonts and background images as data URIs, so it renders offline with no external dependency.
- **Bundled fonts** — Pretendard and JetBrains Mono are bundled (subset) for consistent, network-free typography.

## Installation

### From Community Plugins (recommended)

1. Open **Settings → Community plugins**.
2. **Browse**, search for *Achmage Slides Ultra*, and install.
3. Enable the plugin.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](https://github.com/laguna821/achmage-slides-ultra/releases).
2. Copy them into `<your-vault>/.obsidian/plugins/achmage-slides-ultra/`.
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

## Usage

- **Open slide preview** (command palette) — render the current note as slides in a side pane. Or click the ribbon icon.
- **Export slides as HTML** (command palette) — write a self-contained `<note>.slides.html` next to the note.
- **Increase / decrease base font size** — optional commands; assign hotkeys under **Settings → Hotkeys**.

Adjust the default theme, typographic scale, and Tier 3 backgrounds in the plugin's settings tab.

## Network use

This plugin works fully offline by default. There is exactly one optional network feature, disclosed here per Obsidian's developer policy:

- **Tier 3 theme backgrounds.** The settings ship with default background image URLs hosted on the author's Cloudflare R2 bucket. When a theme has a Tier 3 background URL set, the live preview loads that image over HTTPS. High-resolution backgrounds are hosted remotely rather than bundled to keep `main.js` smaller.
- **You can disable it entirely.** Clear a theme's background field in settings and the plugin falls back to a small bundled default — no network request is made.
- **Exports never call home.** On **Export slides as HTML**, all remote images — Tier 3 backgrounds, inline `<img>` content, and emoji — are fetched once and inlined as base64 data URIs. The resulting deck is fully self-contained, so anyone you share it with renders it **offline, without contacting any external server**. (Hyperlinks in your text remain ordinary clickable links.)

No analytics, telemetry, or user data is collected or transmitted.

## Why desktop-only

`isDesktopOnly` is `true` because the plugin relies on desktop APIs:

- bundled fonts and large background assets,
- `requestUrl` to fetch and inline remote backgrounds on export,
- `FileSystemAdapter` to read local override images and resolve the plugin folder,
- `openWithDefaultApp` to open the plugin folder in the OS file manager.

## Building from source

```bash
npm install
npm run build      # production build → main.js
npm run typecheck  # tsc --noEmit
```

## License

[MIT](LICENSE) © achmage
