# Achmage Slides Ultra 1920 v5

Turn your Markdown notes into layout-aware, presentation-grade **1920×1080 slides** — automatically. Powered by [Marp](https://marp.app/), with a structure-aware layout engine that picks grids, balances columns, and guarantees overflow-free slides.

Open any note in the slide preview and it renders live. No slide-specific syntax required: the plugin reads the shape of your Markdown (headings, lists, definition lists, nesting) and lays it out for you.

## Features

- **Live slide preview** — render the active Markdown note as 1920×1080 slides in a side pane.
- **Structure-aware auto-layout** — definition grids, bento card grids, and balanced multi-column layouts are chosen automatically from your content's shape, with graceful degradation when content is dense.
- **Overflow-free guarantee** — a closed-loop measurement pass automatically paginates or shrinks content so nothing is clipped, in both the live preview and exports.
- **Automatic typographic scale** — body, heading, and label sizes scale together; bind hotkeys to nudge the base font size.
- **Premium themes** — multiple built-in 1920 v5 themes (light and dark), with per-theme background treatments.
- **Self-contained HTML export** — export a deck to a single `.slides.html` that embeds fonts and fetchable remote images as data URIs. If a remote image cannot be fetched, its original URL is retained instead of dropping the image.
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

## Navigation

A **section** is one Markdown topic group (each `##` in the bundled demos). If that section is too long for one screen, the overflow engine creates two or more **slides** (also called frames) inside it. The persistent bottom bar reports both levels, for example `Section 2/7 · Slide 1/3`.

The primary **Previous** and **Next** controls always follow reading order. Their arrow changes to `↑`/`↓` while another slide exists inside the current section, and to `←`/`→` when the route crosses a section boundary. Keep selecting **Next** to finish every slide in a section and continue at the top of the next section. The dots select a particular slide in the current section; the visible **⇤ Section** and **Section ⇥** controls skip directly to the first slide of the adjacent section. Select the **?** control for a short keyboard guide inside the deck.

The Live Preview and exported HTML viewed in a desktop browser use the same controls:

| Action | Keyboard or pointer |
|---|---|
| Next slide in reading order | `Right`, `Down`, `PageDown`, `Space`, or `N`; click the right side of the stage; or select **Next** |
| Previous slide in reading order | `Left`, `Up`, `PageUp`, `Shift+Space`, or `P`; click the left side of the stage; or select **Previous** |
| First / last slide in the entire deck | `Home` / `End` |
| Previous / next section | Use the labeled section buttons in the bottom bar |
| Fullscreen | `F` or **Full** |
| Open the short keyboard guide | `?` or the **?** control |

Keyboard navigation does not take over modified shortcuts, dialogs, links, form fields, or other authored interactive controls.

## Capabilities, network use, and privacy

The rendering engine and bundled fonts work offline, and the plugin has no analytics or telemetry. Network access can still occur when a deck or setting refers to a remote image:

- **Live Preview browser loads.** If Tier 3 backgrounds are enabled, the preview iframe loads the selected preset URL from the author's Cloudflare R2 bucket or a user-supplied background URL. It also loads external images referenced by the Markdown. Tier 3 is off by default; clearing its background field uses the bundled fallback, but external images in the note still behave like ordinary browser images.
- **Desktop export fetch and base64.** When you invoke **Export slides as HTML**, Obsidian's `requestUrl` fetches remote Tier 3 backgrounds and remote rendered images (including inline images or generated emoji assets) so the plugin can replace them with base64 data URIs. Fetches go to the URLs present in the settings or rendered deck. A successful export is self-contained for those assets; if a fetch fails, the exporter keeps the original URL, so that particular image still needs network access when the deck is viewed. Ordinary hyperlinks are not fetched or rewritten.
- **Local files.** On desktop, Obsidian's `FileSystemAdapter` reads a local Tier 3 override and resolves the vault/plugin folder used by the background settings. The plugin can also ask Obsidian to open that plugin folder. These actions stay local.
- **Clipboard writes.** Explicit settings buttons can copy a background-generation prompt or, when opening the plugin folder is unavailable, its path. The plugin writes only after the button is selected and never reads the clipboard.

No presentation content, usage data, analytics, or telemetry is sent to the plugin author. Any network requests described above go only to the asset URLs selected by the built-in preset, the user, or the Markdown content.

## Why desktop-only

`isDesktopOnly` is `true`, and the plugin, its HTML export command, and the exported viewer are officially supported on desktop only. Mobile browsers, touch-only navigation, and swipe gestures are outside the supported contract. The implementation relies on desktop capabilities including:

- bundled fonts and large background assets,
- `requestUrl` to fetch and inline remote backgrounds and rendered images on export,
- `FileSystemAdapter` to read local override images and resolve the vault/plugin folder,
- `openWithDefaultApp` to open the plugin folder in the OS file manager.

## Building from source

```bash
npm ci
npm run build      # production build → main.js
npm run typecheck  # tsc --noEmit
```

### Maintainer workflow

Repository updates follow a research-led workflow. Start with the [Research Register](docs/research/REGISTER.md), then use the [research operating guide](docs/research/README.md) and [contributing guide](CONTRIBUTING.md) to create evidence-backed plans, execution records, and verified changes.

## License

[MIT](LICENSE) © achmage
