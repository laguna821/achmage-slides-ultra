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
- **One-click MP4 export** — turn the same audited physical slides into a local, silent 1920×1080 H.264 MP4 at 30fps, with deterministic Smart motion and no AI, cloud renderer, Remotion runtime, or separate FFmpeg installation.
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
- **Export current note as MP4** (command palette) — choose one hold time (0.5–60.0 seconds per slide, default 3.0) and write a verified `<note>.slides.mp4` beside the note. The same action is available as **Export MP4** in Open Slide Preview.
- **Increase / decrease base font size** — optional commands; assign hotkeys under **Settings → Hotkeys**.

Adjust the default theme, typographic scale, and Tier 3 backgrounds in the plugin's settings tab.

## Navigation

A **section** is one Markdown topic group (each `##` in the bundled demos). If that section is too long for one screen, the overflow engine creates two or more **slides** (also called frames) inside it. The persistent bottom bar reports both levels, for example `Section 2/7 · Slide 1/3`.

The primary **Previous** and **Next** controls always follow reading order. Their arrow changes to `↑`/`↓` while another slide exists inside the current section, and to `←`/`→` when the route crosses a section boundary. Keep selecting **Next** to finish every slide in a section and continue at the top of the next section. **Home**, immediately before Previous, returns to the first slide in the deck. The dots select a particular slide in the current section; the visible **⇤ Section** and **Section ⇥** controls skip directly to the first slide of the adjacent section. Select the **?** control for a short keyboard guide inside the deck.

The Live Preview and exported HTML viewed in a desktop browser use the same controls:

| Action | Keyboard or pointer |
|---|---|
| Next slide in reading order | `Right`, `Down`, `PageDown`, `Space`, or `N`; click the right side of the stage; or select **Next** |
| Previous slide in reading order | `Left`, `Up`, `PageUp`, `Shift+Space`, or `P`; click the left side of the stage; or select **Previous** |
| First / last slide in the entire deck | Select **Home** or press `Home`; press `End` for the final slide |
| Previous / next section | Use the labeled section buttons in the bottom bar |
| Fullscreen | `F` or the **Fullscreen on** / **Fullscreen off** control |
| Open the short keyboard guide | `?` or the **?** control |

Keyboard navigation does not take over modified shortcuts, dialogs, links, form fields, or other authored interactive controls.

## Capabilities, network use, and privacy

The rendering engine and bundled fonts work offline, and the plugin has no analytics or telemetry. Network access can still occur when a deck or setting refers to a remote image:

- **Live Preview browser loads.** If Tier 3 backgrounds are enabled, the preview iframe loads the selected preset URL from the author's Cloudflare R2 bucket or a user-supplied background URL. It also loads external images referenced by the Markdown. Tier 3 is off by default; clearing its background field uses the bundled fallback, but external images in the note still behave like ordinary browser images.
- **Desktop export fetch and base64.** When you invoke **Export slides as HTML**, Obsidian's `requestUrl` fetches remote Tier 3 backgrounds and remote rendered images (including inline images or generated emoji assets) so the plugin can replace them with base64 data URIs. Fetches go to the URLs present in the settings or rendered deck. A successful export is self-contained for those assets; if a fetch fails, the exporter keeps the original URL, so that particular image still needs network access when the deck is viewed. Ordinary hyperlinks are not fetched or rewritten.
- **MP4 asset capture and local encoding.** When you explicitly invoke **Export current note as MP4**, the exporter resolves the rendered deck's required images from the vault or their referenced remote URLs, embeds them into an immutable local snapshot, and encodes that snapshot with Obsidian's built-in WebCodecs implementation. A missing or undecodable required asset stops the job instead of creating a silently incomplete video. The plugin itself does not upload the Markdown, rendered frames, or generated MP4; network requests, when needed, go only to asset URLs already referenced by the deck. Cancelling or timing out stops ASU from using the result, but Obsidian's `requestUrl` API cannot abort an HTTP request that the host has already started, so that request may finish in the background. A vault sync provider can still upload the partial/final output and its deletion history under that provider's normal rules.
- **Local files.** On desktop, Obsidian's `FileSystemAdapter` reads a local Tier 3 override and resolves the vault/plugin folder used by the background settings. The plugin can also ask Obsidian to open that plugin folder. These actions stay local.
- **MP4 output files.** MP4 export uses the desktop filesystem to stream a same-directory partial file and atomically link it to the first available `<note>.slides.mp4`, `<note>.slides-2.mp4`, and so on. Extremely long note names are shortened only when a collision suffix would exceed the filesystem component limit; ASU then appends a stable 12-character hash of the full stem. It never replaces an existing final video. Before validation, after validation, and again after publication, ASU compares the retained file handle's full-file SHA-256 and size so a same-inode mutation cannot be reported as a verified result. Once ownership has been established, it cleans up its private partial after normal completion, cancellation, or an error. If the initial identity check fails, ASU leaves the unknown file untouched and reports its exact path; if the operating system later rejects cleanup, it likewise reports the exact private partial path. A filesystem or sync provider that cannot create a same-directory hard link fails closed; the plugin does not fall back to an overwrite-prone rename or copy. Because both names live beside the note, Dropbox, Obsidian Sync, or another watcher may observe or sync the temporary file, final file, and deletion even though ASU itself performs no upload. ASU retains the exclusive file handle and verifies file identity before path cleanup, but Node does not expose an atomic “unlink only this inode” operation: a local process or sync provider that replaces the private pathname in the tiny interval between the final identity check and unlink can still race that cleanup. The UUID name and checks make this unlikely; they do not claim to eliminate that OS-level race. Editing the published file after the final seal is an ordinary external file modification and is outside the completed export transaction.
- **Clipboard writes.** Explicit settings buttons can copy a background-generation prompt or, when opening the plugin folder is unavailable, its path. The plugin writes only after the button is selected and never reads the clipboard.

No presentation content, usage data, analytics, or telemetry is sent to the plugin author. Any network requests described above go only to the asset URLs selected by the built-in preset, the user, or the Markdown content.

## Why desktop-only

`isDesktopOnly` is `true`, and the plugin, its HTML export command, and the exported viewer are officially supported on desktop only. Mobile browsers, touch-only navigation, and swipe gestures are outside the supported contract. The implementation relies on desktop capabilities including:

- bundled fonts and large background assets,
- `requestUrl` to fetch and inline remote backgrounds and rendered images on export,
- `FileSystemAdapter` to read local override images and resolve the vault/plugin folder,
- WebCodecs and a filesystem-backed MP4 target for local H.264 export,
- `openWithDefaultApp` to open the plugin folder in the OS file manager.

MP4 export requires Obsidian 1.13.4 or later and a desktop runtime that exposes a compatible H.264 encoder and OffscreenCanvas. Obsidian can update its app payload without replacing the Electron runtime bundled by the installer. If the capability check fails even though Obsidian reports that it is current, fully close Obsidian, download the current desktop installer from [obsidian.md/download](https://obsidian.md/download), and install it over the existing application; no uninstall or vault migration is required. It is intentionally silent and fixed at 1920×1080/30fps in version 1.2.0. Static PNG, JPEG, GIF, WebP, BMP, AVIF, SVG, and their common MIME aliases are dimension-checked before decode. ICO is rejected because its directory dimensions cannot conservatively bound every embedded PNG/DIB payload; convert ICO assets to static PNG before exporting. APNG, multi-frame GIF, animated WebP, and AVIF image sequences fail explicitly because wall-clock image animation would make captured frames nondeterministic. To keep the renderer bounded, one compressed asset may be at most 24 MiB, all compressed assets at most 64 MiB, one image at most 8192px on either axis and 40 million pixels, the unique decoded-image inventory at most 134,217,728 pixels, and serialized capture markup at most 48 Mi characters. Resize an asset if the exporter reports one of these limits. Image formats without a conservative header inspector fail closed. Nested SVG namespace aliases, nested data fonts or external resources, fragment-only image/background reloads, authored CSS transitions or animations, and `@starting-style` are also rejected because they can bypass static resource accounting or make capture depend on wall-clock state. Audio, TTS, captions, embedded video/iframe/object capture, nested external assets inside an SVG image, element-level motion, timeline editing, WebM/MOV/GIF, 4K, and custom codec or bitrate controls are not part of this release and cause an actionable failure when present in the rendered deck.

## Building from source

```bash
npm ci
npm run build      # production build → main.js
npm run typecheck  # tsc --noEmit
```

### Maintainer workflow

Repository updates follow a research-led workflow. Start with the [Research Register](docs/research/REGISTER.md), then use the [research operating guide](docs/research/README.md) and [contributing guide](CONTRIBUTING.md) to create evidence-backed plans, execution records, and verified changes.

## License

[MIT](LICENSE) © achmage. The MP4 container path includes tree-shaken [Mediabunny 1.52.3](https://github.com/Vanilagy/mediabunny/tree/v1.52.3) under MPL-2.0; see the repository's [third-party notices](https://github.com/laguna821/achmage-slides-ultra/blob/main/THIRD_PARTY_NOTICES.md).
