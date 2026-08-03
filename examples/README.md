# Examples

Real, working examples for **Achmage Slides Ultra**. Open the demo notes in Obsidian with the plugin enabled to see how each Markdown pattern renders into slides.

## Demo notes — open these in Obsidian

Each note is a living manual: every `##` section shows one layout pattern **and** explains, in its own content, how it renders. Flip through them in the slide preview to learn by example.

In these demos, each `##` begins a **section**. A long section can be split into multiple **slides/frames** by the overflow engine. The persistent bottom bar shows both positions and lets you either follow every frame in reading order or jump directly between sections; the opening pages of each demo explain the controls.

- **`demo-en.md`** — 38 sections covering body text, inline formatting, the full callout family, and every list-card combination (2/3/4-up, even vs. asymmetric, short chips vs. long definitions, single cards, plain bullets, layout markers, pagination, mixed blocks, images).
- **`demo-ko.md`** — the same demo in Korean.

Open and export these examples with Obsidian Desktop. The generated `.slides.html` uses the same navigation grammar as Live Preview and is officially supported in desktop browsers. Mobile browsers, touch-only navigation, and swipe gestures are outside the supported contract. External images that were fetched successfully are embedded; an image whose fetch failed keeps its original URL and will still need network access.

## Master prompts — reformat any messy note with AI

Paste one of these into an LLM chat (e.g. Obsidian Smart Composer, Copilot) **together with the note you want to reformat**. The prompt teaches the model to restructure messy Markdown — even raw `<table>`/`<br>` soup imported from `.hwp`/`.docx`/PDF — into Slides Ultra's syntax, **while preserving every piece of information**.

They are **standalone**: the design-pattern catalog is embedded in the prompt, so you don't need to attach a demo note.

- **`master-prompt-en.md`** — English.
- **`master-prompt-ko.md`** — Korean.

**The core idea the prompt is built around:** the layout engine is deterministic and structural — it never reads meaning, only *what kind of blocks sit under a heading, and how many / how long*. So:

- `##` begins a left/right **section** boundary. `###`/`####` and everything under that `##` flow inside the section, which can become one or more vertical slides/frames when content overflows.
- One heading + a bold-label list (and nothing else) → a **card grid**. Paragraphs only → a **text slide**. A callout → a **box**. A table → a **table card**. An image alone → **full-screen**. Mixed blocks → a **vertical flow**.

Know the shape, and you know the render.
