import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Vault } from "obsidian";
import { SlideRenderer } from "../engine/slideRenderer";
import { DEFAULT_SETTINGS } from "../settingsDefaults";
import {
  clearMeasurementCaches,
  getFontMeasurementState,
  getMeasureContext,
  getSegmentMetricCache,
  getSegmentMetrics,
} from "../vendor/pretext/measurement";

const fakeVault = {
  getFiles: () => [],
  getResourcePath: (file: { path: string }) => file.path,
  getAbstractFileByPath: () => null,
} as unknown as Vault;

class AcceptanceCanvasContext {
  font = "16px Acceptance Sans";
  measureCalls = 0;

  measureText(text: string): TextMetrics {
    this.measureCalls++;
    const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 16);
    const width = text === "😀" ? size + 12 : text.length * size * 0.5;
    return { width } as TextMetrics;
  }
}

class AcceptanceOffscreenCanvas {
  private readonly context = new AcceptanceCanvasContext();
  constructor(_width: number, _height: number) {}
  getContext(type: string): AcceptanceCanvasContext | null {
    return type === "2d" ? this.context : null;
  }
}

function testSlideRendererInlineVars(): void {
  const globals = globalThis as unknown as { OffscreenCanvas?: unknown };
  const original = globals.OffscreenCanvas;
  globals.OffscreenCanvas = AcceptanceOffscreenCanvas;
  clearMeasurementCaches();
  try {
    const baseFontSize = 31;
    const renderer = new SlideRenderer({
      ...DEFAULT_SETTINGS,
      baseFontSize,
      defaultTheme: "hallym-light",
      tier3BodyPolishing: false,
    });
    const { html } = renderer.render(
      "---\nmarp: true\ntheme: hallym-light\n---\n\n## Inline variables\n\nA body-scale-one paragraph.\n",
      fakeVault
    );

    const emittedStyles = (html.match(/<section\b[^>]*>/g) ?? [])
      .map((tag) => tag.match(/\bstyle="([^"]*)"/)?.[1] ?? "")
      .filter((style) => /--(?:heading-h[1-3]|body|list)-\d+-(?:fs|lh|indent)\s*:/.test(style));

    assert.ok(emittedStyles.length > 0, "real SlideRenderer emitted no section inline variable block");
    for (const style of emittedStyles) {
      const names = style
        .split(";")
        .map((part) => part.match(/^\s*(--[^:]+)\s*:/)?.[1])
        .filter((name): name is string => name !== undefined);
      assert.ok(names.some((name) => name.endsWith("-fs")), `inline variable block lacks an -fs variable: ${style}`);
    }
    assert.ok(
      emittedStyles.some((style) => new RegExp(`--body-\\d+-fs\\s*:\\s*${baseFontSize}px(?:;|$)`).test(style)),
      `bodyScale=1 paragraph did not emit configured ${baseFontSize}px body font`
    );
  } finally {
    clearMeasurementCaches();
    if (original === undefined) delete globals.OffscreenCanvas;
    else globals.OffscreenCanvas = original;
  }
}

function testPretextDocumentOwnership(): void {
  const globals = globalThis as unknown as {
    OffscreenCanvas?: unknown;
    activeDocument?: Document;
  };
  const originalOffscreen = globals.OffscreenCanvas;
  const originalDocument = globals.activeDocument;
  delete globals.OffscreenCanvas;

  const stats = { createEl: 0, createSpan: 0, legacy: 0, append: 0, remove: 0 };
  const context = new AcceptanceCanvasContext();
  let win: Window & {
    createEl(tag: "canvas"): HTMLCanvasElement;
    createSpan(): HTMLSpanElement;
  };

  const makeCanvas = (owner: unknown) => ({
    ownerWindow: owner,
    getContext: (type: string) => (type === "2d" ? context : null),
  }) as unknown as HTMLCanvasElement;
  const makeSpan = (owner: unknown) => ({
    ownerWindow: owner,
    textContent: "",
    setCssStyles: (_styles: Partial<CSSStyleDeclaration>) => undefined,
    getBoundingClientRect: () => ({ width: 16 }) as DOMRect,
  }) as unknown as HTMLSpanElement;

  win = {
    createEl(tag: "canvas") {
      assert.equal(this, win, "canvas helper lost captured window receiver");
      assert.equal(tag, "canvas");
      stats.createEl++;
      return makeCanvas(win);
    },
    createSpan() {
      assert.equal(this, win, "span helper lost captured window receiver");
      stats.createSpan++;
      return makeSpan(win);
    },
  } as unknown as typeof win;

  const body = {
    appendChild(node: Node) {
      stats.append++;
      return node;
    },
    removeChild(node: Node) {
      stats.remove++;
      return node;
    },
  } as unknown as HTMLElement;
  const doc = {
    win,
    body,
    createElement(tag: string) {
      stats.legacy++;
      return tag === "canvas" ? makeCanvas(null) : makeSpan(null);
    },
  } as unknown as Document;
  globals.activeDocument = doc;
  clearMeasurementCaches();

  try {
    const firstContext = getMeasureContext();
    assert.equal(getMeasureContext(), firstContext, "canvas fallback context was not cached");
    const cache = getSegmentMetricCache("16px Acceptance Sans");
    assert.equal(getSegmentMetricCache("16px Acceptance Sans"), cache, "segment cache was not reused");
    assert.equal(getSegmentMetrics("abc", cache), getSegmentMetrics("abc", cache), "segment metric was not cached");

    const first = getFontMeasurementState("16px Acceptance Sans", true);
    const second = getFontMeasurementState("16px Acceptance Sans", true);
    assert.ok(first.emojiCorrection > 0, "emoji DOM correction path did not execute");
    assert.equal(second.emojiCorrection, first.emojiCorrection, "emoji correction cache changed its result");
    assert.equal(stats.createEl, 1, "canvas must be created once through captured doc.win");
    assert.equal(stats.createSpan, 1, "emoji span must be created once through captured doc.win");
    assert.equal(stats.legacy, 0, "measurement must not call Document.createElement");
    assert.equal(stats.append, 1, "emoji span was not appended exactly once");
    assert.equal(stats.remove, 1, "emoji span was not removed exactly once");
  } finally {
    clearMeasurementCaches();
    if (originalOffscreen === undefined) delete globals.OffscreenCanvas;
    else globals.OffscreenCanvas = originalOffscreen;
    if (originalDocument === undefined) delete globals.activeDocument;
    else globals.activeDocument = originalDocument;
  }
}

function testBundleEncoding(): void {
  const path = resolve(process.cwd(), "main.js");
  assert.ok(existsSync(path), "main.js is missing; run the production build first");
  const bytes = readFileSync(path);
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "main.js must not have a UTF-8 BOM");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.ok(!source.includes("\ufffd"), "main.js contains a replacement character");

  if (process.env.EXPECT_UTF8_BUNDLE === "1") {
    assert.ok(bytes.byteLength < 5_150_000, `main.js ${bytes.byteLength} bytes exceeds 5,150,000`);
    assert.ok(bytes.byteLength < 5 * 1024 * 1024, `main.js ${bytes.byteLength} bytes exceeds 5 MiB`);
    console.log(`UTF-8 bundle PASS: ${bytes.byteLength} bytes`);
  } else {
    console.log(`Bundle baseline: ${bytes.byteLength} bytes (size gate skipped; set EXPECT_UTF8_BUNDLE=1)`);
  }
}

testSlideRendererInlineVars();
testPretextDocumentOwnership();
testBundleEncoding();
console.log("Scorecard refactor acceptance PASS");
