import type { Vault } from "obsidian";
import { type AchmageSettings, TYPOGRAPHIC_SCALES } from "../settings";
import { MarpEngine, type SlideRenderResult } from "./marpEngine";
import { FONT_FACE_CSS } from "../themes/fontFace";
import { injectFrontmatter } from "../preprocessor/frontmatterInjector";
import { convertObsidianSyntax } from "../preprocessor/obsidianCompat";
import {
  splitOverflowingSlides,
  computeFrameBudget,
  type SlideMapEntry,
} from "../preprocessor/overflowSplitter";
import { applyShapeTemplates } from "../preprocessor/shapeTemplates";
import {
  buildTypographyConfig,
  measureBlockHeight,
  type ContentBlock,
  type TypographyConfig,
} from "../preprocessor/pretextMeasurer";
import { getThemeProfile } from "../themes/themeRegistry";
import { TIER3_DEFAULT_BACKGROUNDS } from "../assets/tier3Backgrounds.generated";
import { buildVideoDeckArtifactDraft } from "../video/videoArtifact";
import type { VideoDeckArtifactDraftV1 } from "../video/videoTypes";
// PR1 (majestic-eagle, 2026-05-15) — Atlas/semantic detour architecture
// deprecated per dogma #18 (BLUEPRINT.md §1). Pipeline reverts to v3 old's
// 4-stage shape: convertObsidian → injectFrontmatter → injectTypography →
// splitOverflowingSlides → marpEngine.render → buildPresentationHTML. The
// V5 measurement layer (PretextMeasurementEngine, chromeMetrics, codeMetrics,
// typography) survives because it powers measurement only — no longer feeds
// catalog candidate ranking. The .asu-native-1920-v5 section class survives
// because v5 themes (themeRegistry) bind their CSS variables on it; markdown
// is now passed raw (no semantic HTML wrapping), so theme rules that target
// .asu-card / .asu-callout / .asu-table-card etc. naturally no-op.

// v7.0 (과제 A) — sparse 본문 확대 시 중앙 컬럼의 폭 비율(콘텐츠 영역 대비).
// measure(scaleBodyTypography)와 render(--body-colw)가 같은 값을 써야 측정-렌더가
// 일치한다. 0.80 = 한 줄 글자수를 적당히 줄여 "가운데에 놓인 본문 덩어리" 느낌.
const BODY_COLUMN_RATIO = 0.8;

export interface RenderedDeck {
  html: string;
  slideCount: number;
  /** Present only for an explicit video-export render. */
  videoArtifactDraft?: VideoDeckArtifactDraftV1;
}

export interface SlideRendererRenderOptions {
  /** Reserved for future strict-validation modes. Currently unused. */
  strictFinalHtmlValidation?: boolean;
  /**
   * PR3 hot-reload preservation — initial logical group to display when the
   * iframe loads. Used by SlidePreviewView to keep the user on the same slide
   * across settings changes (Type Quick Controls, theme swap, etc.). The IIFE
   * clamps to a valid range so out-of-bounds values fall back to 0 safely.
   */
  restoreGroup?: number;
  /** Initial frame index within the restored logical group (see restoreGroup). */
  restoreFrame?: number;
  /**
   * v5.5 Phase 4 — closed-loop overflow correction. Per-logical-slide px to
   * subtract from the frame budget, keyed by logical-slide order index (0-based,
   * matching the deck's `data-group`). The overflow auditor measures the real
   * rendered geometry and feeds shrinks back so a re-render packs the
   * offending slides more tightly until nothing overflows. Empty/undefined on
   * the first pass.
   */
  budgetShrink?: Record<number, number>;
  /**
   * v5.7 — 타이틀 슬라이드에 표시할 노트 basename(확장자 제외). 비거나 공백이면
   * 타이틀 슬라이드를 만들지 않는다(export/빈 타이틀 안전 no-op). 값이 있으면
   * prependTitleSlide가 frontmatter 직후에 결정론적 타이틀 섹션을 삽입하고,
   * 그 결과 injectTypographyStyle의 <style>이 타이틀 group에 흡수되어 기존의
   * "빈 첫 슬라이드" 버그까지 동시에 사라진다.
   */
  title?: string;
  /**
   * Capture the final decorated SVG frames and shared CSS for deterministic
   * video export. Normal Preview and HTML export leave this disabled so they
   * do not retain an additional multi-megabyte artifact graph.
   */
  captureVideoArtifact?: boolean;
}

export class SlideRenderer {
  private engine: MarpEngine;
  private settings: AchmageSettings;
  // v7.0 — themeId → 로컬 override 이미지를 미리 읽어 만든 data URI. main.ts가
  // 플러그인 폴더/vault/절대경로에서 비동기로 읽어 채운다(렌더는 sync). https/data
  // override는 여기 없고 렌더 시 그대로 통과한다.
  private tier3ResolvedOverrides: Record<string, string> = {};

  constructor(settings: AchmageSettings) {
    this.settings = settings;
    this.engine = new MarpEngine(settings);
  }

  /** main.ts가 로컬 override를 data URI로 해석해 주입한다(설정 로드/변경 시). */
  setTier3ResolvedOverrides(map: Record<string, string>): void {
    this.tier3ResolvedOverrides = map ?? {};
  }

  render(
    markdown: string,
    vault: Vault,
    opts: SlideRendererRenderOptions = {}
  ): RenderedDeck {
    let processed = convertObsidianSyntax(markdown, vault);
    processed = injectFrontmatter(processed, this.settings);
    // PR1 (majestic-eagle): applySemanticLayout + resolveRenderOptions removed
    // per dogma #18 (no detour architecture). Markdown passes through raw to
    // Marp; overflowSplitter's isSemanticLayoutMarkdown() early-exit returns
    // false on raw markdown, so the v3 old greedy-pack path runs.

    // Build dynamic typography from user settings
    const scaleInfo = TYPOGRAPHIC_SCALES[this.settings.typographicScale];
    const typo = buildTypographyConfig(
      this.settings.baseFontSize,
      scaleInfo.ratio
    );

    // v5.7 — 결정론적 파일명 타이틀 슬라이드. injectTypographyStyle보다 먼저
    // 실행해야 한다: <style>이 frontmatter 직후에 삽입되므로, 그보다 앞에 타이틀
    // 섹션을 두면 splitByHeadings에서 {style + 타이틀 div}가 한 logical slide로
    // 묶여(뒤따르는 ---가 경계) style-only 빈 슬라이드가 생기지 않는다. title이
    // 없으면 no-op이라 기존 거동을 유지한다.
    processed = this.prependTitleSlide(processed, opts.title);

    // native 1920 v5: Inject typography as <style> HTML block in the body (not YAML).
    // Uses exact px values from buildTypographyConfig so CSS rendering
    // matches pretext measurement — no em↔px rounding mismatch.
    processed = this.injectTypographyStyle(processed, typo);

    // v6.0 (Tier 2) — 구조 시그니처 기반 결정론적 레이아웃. settings.tier2Layouts가
    // off면 no-op(byte-identical). injectTypographyStyle 다음에 둬서 <style>/타이틀
    // 슬라이드는 이미 자리잡은 상태로 보고, 매치된 logical 슬라이드만 사전조립 HTML로
    // 바꾼다. 미매치는 raw-flow 그대로 → 이어지는 splitOverflowingSlides가 동일 단위로
    // 재분할/패킹한다(혼합 deck 안전).
    processed = applyShapeTemplates(processed, this.settings, typo);

    const { markdown: splitMd, slideMap } = splitOverflowingSlides(
      processed,
      this.settings,
      typo,
      undefined,
      opts.budgetShrink
    );

    const result = this.decorateNative1920V5Slides(this.engine.render(splitMd), slideMap, typo);
    const html = this.buildPresentationHTML(result, slideMap, opts);
    if (!opts.captureVideoArtifact) {
      return { html, slideCount: result.slides.length };
    }

    const effectiveSlideMap = this.normalizeSlideMap(slideMap, result.slides.length);
    return {
      html,
      slideCount: result.slides.length,
      videoArtifactDraft: buildVideoDeckArtifactDraft(
        result.slides,
        FONT_FACE_CSS + result.css,
        effectiveSlideMap
      ),
    };
  }

  /**
   * Build the "One HTML Trick" presentation:
   *
   * - Each LOGICAL slide = one visual group
   * - If a logical slide has multiple frames (overflow), they're stacked
   *   inside ONE container with viewport clipping
   * - ?묅넃 moves translateY within the container (the "trick")
   * - ?먥넂 moves between logical groups
   */
  private buildPresentationHTML(
    result: SlideRenderResult,
    slideMap: SlideMapEntry[],
    opts: SlideRendererRenderOptions = {}
  ): string {
    // PR3 — sanitize restore values to integers (template literal interpolated
    // directly into the IIFE; the IIFE clamps against bounds at runtime).
    const restoreGroup = Math.max(0, Math.floor(opts.restoreGroup ?? 0));
    const restoreFrame = Math.max(0, Math.floor(opts.restoreFrame ?? 0));
    // PR3 follow-up (2026-05-19) — when settings change triggers a re-render
    // we want the iframe to come up *already showing the user's last slide*,
    // not flash group 0 first. Compute the group index that will actually
    // display first so the inline `style="display:..."` matches restoreGroup.
    const initialGroupIndex = restoreGroup;
    const effectiveSlideMap = this.normalizeSlideMap(slideMap, result.slides.length);

    // Group physical slides by logical index
    const groups: { logical: number; title: string; physicalIndices: number[] }[] = [];
    let currentLogical = -1;

    for (let i = 0; i < effectiveSlideMap.length; i++) {
      const entry = effectiveSlideMap[i];
      if (entry.logical !== currentLogical) {
        groups.push({
          logical: entry.logical,
          title: entry.title,
          physicalIndices: [i],
        });
        currentLogical = entry.logical;
      } else {
        groups[groups.length - 1].physicalIndices.push(i);
      }
    }

    // Build HTML for each logical group
    const groupDivs = groups
      .map((group, gIdx) => {
        const frameCount = group.physicalIndices.length;

        // Stack all frames of this logical slide inside ONE container
        const frameDivs = group.physicalIndices
          .map((physIdx, frameIdx) => {
            const svg = result.slides[physIdx] || "";
            return `<div class="marpit achmage-frame" data-frame="${frameIdx}" aria-hidden="true" inert>${svg}</div>`;
          })
          .join("\n");

        // PR3 follow-up — match initial display to restoreGroup so the
        // iframe doesn't flash group 0 before INIT swaps to the right one.
        // Falls back to group 0 if restoreGroup is out of range.
        const restoreClamped = Math.min(initialGroupIndex, groups.length - 1);
        const initialDisplay = gIdx === restoreClamped ? "block" : "none";
        return `<div class="achmage-logical-group" data-group="${gIdx}" data-frames="${frameCount}" data-title="${this.escapeAttr(group.title)}" aria-hidden="${initialDisplay === "block" ? "false" : "true"}" style="display:${initialDisplay}">
  <div class="achmage-frame-viewport">
    <div class="achmage-frame-stack" style="transform:translateY(0)">
${frameDivs}
    </div>
  </div>
</div>`;
      })
      .join("\n");

    const slideMapJSON = JSON.stringify(
      groups.map((g) => ({
        logical: g.logical,
        title: g.title,
        frames: g.physicalIndices.length,
      }))
    );

    return `<!DOCTYPE html>
<html data-achmage-interactive-click-guard="true">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${opts.title && opts.title.trim() ? `<title>${this.escapeHtml(opts.title.trim())}</title>\n` : ""}<style>
/* Bundled subset fonts — injected ONCE per deck document (not per-theme) so the
   slide iframe and the exported .slides.html render Pretendard/JetBrains Mono
   offline and self-contained, without bloating every theme's result.css with
   the ~650KB base64 payload on every re-render. */
${FONT_FACE_CSS}
${result.css}

/* ===== Achmage native 1920 v5 ??"One HTML Trick" Shell ===== */

/* LAYOUT: slide area + controls bar = NO OVERLAP */
html, body {
  margin: 0; padding: 0;
  width: 100%; height: 100%;
  overflow: hidden;
  background: #1a1a1a;
  font-family: system-ui, -apple-system, sans-serif;
  --achmage-controls-height: 56px;
}

body {
  display: grid;
  grid-template-rows: minmax(0, 1fr) var(--achmage-controls-height);
}

/* Slide area occupies the first grid row; controls occupy the second. */
.achmage-stage {
  position: relative;
  min-height: 0;
  overflow: hidden;
  overflow: clip;
}
.achmage-stage:focus { outline: none; }

/* Each logical group fills the stage (not the full viewport) */
.achmage-logical-group {
  position: absolute;
  inset: 0;
}

.achmage-frame-viewport {
  width: 100%;
  height: 100%;
  overflow: hidden;
  overflow: clip;
  position: relative;
}

/*
 * THE TRICK: frames stacked vertically, translateY shifts viewport.
 * Each frame = the stage height (100% of .achmage-stage).
 */
.achmage-frame-stack {
  width: 100%;
  height: 100%;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.achmage-frame {
  width: 100%;
  height: 100%;
  min-height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
}

.achmage-frame > svg[data-marpit-svg] {
  width: 100%;
  height: 100%;  /* fills the frame completely ??no extra margin needed */
}

/* Horizontal transition when switching logical slides */
.achmage-logical-group.enter-right {
  animation: enterRight 0.3s ease-out forwards;
}
.achmage-logical-group.enter-left {
  animation: enterLeft 0.3s ease-out forwards;
}
@keyframes enterRight {
  from { opacity: 0; transform: translateX(40px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes enterLeft {
  from { opacity: 0; transform: translateX(-40px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* Vertical frame dots (inside stage, right edge) */
.v-dots {
  position: absolute; right: 6px; top: 50%;
  transform: translateY(-50%);
  z-index: 1001;
  display: flex; flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  max-height: calc(100% - 16px);
  padding: 4px 2px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  background: #111;
  border: 1px solid #fff;
  border-radius: 999px;
}
.v-dots:not(.has-frames) { display: none; }
.v-dot {
  width: 24px; height: 24px;
  min-width: 24px; min-height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}
.v-dot::before {
  content: '';
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #b8c2cc;
  box-shadow: 0 0 0 1px #000;
  transition: background 0.15s, transform 0.15s;
}
.v-dot.active::before {
  background: #fff;
  transform: scale(1.35);
}
.v-dot:focus-visible {
  outline: 2px solid #fff;
  outline-offset: -2px;
}

/* ===== Bottom controls ??FIXED at bottom, BELOW slide area ===== */
.achmage-controls {
  position: relative;
  height: var(--achmage-controls-height);
  background: #111;
  border-top: 1px solid #333;
  display: flex; align-items: center; justify-content: center;
  gap: 6px;
  padding: 0 6px;
  box-sizing: border-box;
  z-index: 1000;
}

.achmage-controls button {
  background: none;
  border: 1px solid rgba(255,255,255,0.2);
  color: #fff;
  min-width: 32px;
  min-height: 32px;
  padding: 4px 9px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  -webkit-text-stroke: .35px rgba(0,0,0,.82);
  paint-order: stroke fill;
  text-shadow: 0 2px 7px rgba(0,0,0,.58), 0 8px 20px rgba(0,0,0,.30);
}
.achmage-controls button:hover { background: rgba(255,255,255,0.1); color: #fff; }
.achmage-controls .achmage-key-action {
  background: #00B5AD;
  border-color: #00B5AD;
  color: #061A19;
  -webkit-text-stroke: 0;
  text-shadow: none;
}
.achmage-controls .achmage-key-action:hover:not(:disabled) { background: #16C7BE; color: #061A19; }
.achmage-controls .achmage-key-action:active:not(:disabled) { background: #009B94; color: #061A19; }
.achmage-controls button:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.achmage-controls button:disabled {
  color: rgba(255,255,255,0.42);
  border-color: rgba(255,255,255,0.12);
  cursor: default;
}
.achmage-controls .achmage-key-action:disabled {
  background: none;
  color: rgba(255,255,255,0.42);
  border-color: rgba(255,255,255,0.12);
}
.achmage-controls button:disabled:hover { background: none; }
.control-divider {
  width: 1px;
  height: 24px;
  background: rgba(255,255,255,0.2);
  flex: 0 0 auto;
}
.route-icon { display: inline-block; min-width: 1em; }

.ctrl-counter {
  color: #fff;
  font-size: 13px; min-width: 152px; text-align: center;
  -webkit-text-stroke: .35px rgba(0,0,0,.82);
  paint-order: stroke fill;
  text-shadow: 0 2px 7px rgba(0,0,0,.58), 0 8px 20px rgba(0,0,0,.30);
}
.counter-compact, .section-compact, .primary-compact, .utility-compact { display: none; }
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.achmage-help {
  color: #fff;
  background: #171717;
  border: 1px solid #888;
  border-radius: 8px;
  padding: 20px;
  max-width: min(34rem, calc(100vw - 32px));
}
.achmage-help::backdrop { background: rgba(0,0,0,0.72); }
.achmage-help h2 { margin-top: 0; }
.achmage-help ul { line-height: 1.55; padding-left: 1.25rem; }
.achmage-help button { min-height: 32px; }

@media (max-width: 780px) {
  .achmage-controls { gap: 1px; padding-inline: 1px; }
  .achmage-controls button { min-width: 28px; padding-inline: 2px; font-size: 12px; }
  .counter-wide, .section-wide, .primary-wide, .utility-wide, .control-divider { display: none; }
  .counter-compact, .section-compact, .primary-compact, .utility-compact { display: inline; }
  .ctrl-counter { min-width: 49px; font-size: 12px; }
}

@media (max-width: 430px) {
  .primary-compact, .section-compact { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .achmage-frame-stack { transition: none; }
  .achmage-logical-group.enter-right,
  .achmage-logical-group.enter-left { animation: none; }
  .v-dot::before { transition: none; }
}

html.fullscreen body { background: #000; }
html.fullscreen .achmage-controls { background: rgba(0,0,0,0.9); }
html.fullscreen .achmage-stage { min-height: 0; }
</style>
</head>
<body>

<!-- Stage: slide area (above controls, no overlap) -->
<div class="achmage-stage" id="achmage-stage" tabindex="-1">
${groupDivs}

  <div class="v-dots" id="v-dots" role="navigation" aria-label="Slides in current section"></div>
</div>

<!-- Controls: BELOW stage, never overlaps -->
<div class="achmage-controls" role="navigation" aria-label="Presentation navigation">
  <button id="btn-home" class="achmage-key-action" type="button" aria-label="First slide">Home</button>
  <button id="btn-prev" type="button"><span class="route-icon" id="prev-route-icon" aria-hidden="true">&#x2191;</span> <span class="primary-wide">Previous</span><span class="primary-compact">Prev</span></button>
  <span class="ctrl-counter" id="counter"><span class="counter-wide" id="counter-wide"></span><span class="counter-compact" id="counter-compact"></span></span>
  <button id="btn-next" type="button"><span class="primary-wide">Next</span><span class="primary-compact">Next</span> <span class="route-icon" id="next-route-icon" aria-hidden="true">&#x2193;</span></button>
  <span class="control-divider" aria-hidden="true"></span>
  <button id="btn-prev-section" type="button" aria-label="Previous section">&#x21E4; <span class="section-wide">Section</span><span class="section-compact">Sec</span></button>
  <button id="btn-next-section" type="button" aria-label="Next section"><span class="section-wide">Section</span><span class="section-compact">Sec</span> &#x21E5;</button>
  <span class="control-divider" aria-hidden="true"></span>
  <button id="btn-help" type="button" aria-haspopup="dialog" aria-controls="help-dialog" aria-label="Navigation help">?</button>
  <button id="btn-fs" class="achmage-key-action" type="button" aria-pressed="false" aria-label="Enter fullscreen">&#x26F6; <span class="utility-wide" id="fs-label-wide">Fullscreen on</span><span class="utility-compact" id="fs-label-compact">FS on</span></button>
</div>
<span class="sr-only" id="position-status" aria-live="polite" aria-atomic="true"></span>

<dialog class="achmage-help" id="help-dialog" aria-labelledby="help-title">
  <h2 id="help-title">Navigation help</h2>
  <ul>
    <li><strong>Next slide:</strong> Right, Down, Page Down, Space, or N.</li>
    <li><strong>Previous slide:</strong> Left, Up, Page Up, Shift+Space, or P.</li>
    <li><strong>First / last slide:</strong> use the Home button or the Home / End keys.</li>
    <li><strong>Section jump:</strong> use the labeled Section buttons in the bottom bar.</li>
    <li><strong>Fullscreen:</strong> use the Fullscreen on / off button or F. Close this help or leave fullscreen with Escape.</li>
  </ul>
  <button id="btn-help-close" type="button">Close</button>
</dialog>

<script>
(function() {
  // ===== DATA =====
  var groups = document.querySelectorAll('.achmage-logical-group');
  var groupData = ${slideMapJSON};
  var totalGroups = groups.length;
  var gIdx = 0;   // current logical group index
  var fIdx = 0;   // current frame index within group

  // UI
  var counterWide = document.getElementById('counter-wide');
  var counterCompact = document.getElementById('counter-compact');
  var positionStatus = document.getElementById('position-status');
  var prevRouteIcon = document.getElementById('prev-route-icon');
  var nextRouteIcon = document.getElementById('next-route-icon');
  var homeButton = document.getElementById('btn-home');
  var prevButton = document.getElementById('btn-prev');
  var nextButton = document.getElementById('btn-next');
  var prevSectionButton = document.getElementById('btn-prev-section');
  var nextSectionButton = document.getElementById('btn-next-section');
  var fullscreenButton = document.getElementById('btn-fs');
  var fullscreenLabelWide = document.getElementById('fs-label-wide');
  var fullscreenLabelCompact = document.getElementById('fs-label-compact');
  var helpButton = document.getElementById('btn-help');
  var helpDialog = document.getElementById('help-dialog');
  var helpCloseButton = document.getElementById('btn-help-close');
  var vDots = document.getElementById('v-dots');
  var stage = document.getElementById('achmage-stage');
  var pendingNavigationFocus = null;
  var focusStageOnFullscreenEntry = false;

  // ===== SHOW GROUP =====
  function showGroup(newG, anim, requestedFrame) {
    if (totalGroups <= 0) return;
    newG = clamp(newG, 0, totalGroups - 1);
    if (newG === gIdx) {
      var sameGroupFrame = typeof requestedFrame === 'number' ? requestedFrame : fIdx;
      showFrame(clamp(sameGroupFrame, 0, frameCountFor(gIdx) - 1));
      return;
    }
    var destinationFrame = clamp(typeof requestedFrame === 'number' ? requestedFrame : 0, 0, frameCountFor(newG) - 1);
    moveFocusFromOutgoingFrame(newG, destinationFrame);
    // Hide current
    if (groups[gIdx]) {
      groups[gIdx].style.display = 'none';
      groups[gIdx].className = 'achmage-logical-group';
    }
    // Reset frame position of old group
    var oldStack = groups[gIdx] && groups[gIdx].querySelector('.achmage-frame-stack');
    if (oldStack) oldStack.style.transform = 'translateY(0)';

    // Show new
    gIdx = newG;
    fIdx = destinationFrame;
    groups[gIdx].style.display = 'block';
    var newStack = groups[gIdx].querySelector('.achmage-frame-stack');
    if (newStack) newStack.style.transform = 'translateY(' + (-fIdx * stageHeight()) + 'px)';
    if (anim) {
      var animatedGroup = groups[gIdx];
      animatedGroup.classList.add(anim);
      setTimeout(function() { animatedGroup.classList.remove(anim); }, 350);
    }
    updateUI();
  }

  // ===== SHOW FRAME (vertical pagination ??THE TRICK) =====
  function showFrame(newF) {
    var frameCount = frameCountFor(gIdx);
    newF = clamp(newF, 0, frameCount - 1);
    moveFocusFromOutgoingFrame(gIdx, newF);
    fIdx = newF;

    // THE ONE HTML TRICK: just shift translateY, content stays as one block
    var stack = groups[gIdx].querySelector('.achmage-frame-stack');
    var stageH = stageHeight();
    stack.style.transform = 'translateY(' + (-fIdx * stageH) + 'px)';
    updateUI();
  }

  // ===== UI UPDATE =====
  function updateUI() {
    var frameCount = frameCountFor(gIdx);
    var logNum = gIdx + 1;
    var frameNum = fIdx + 1;
    var canPrevious = fIdx > 0 || gIdx > 0;
    var canNext = fIdx < frameCount - 1 || gIdx < totalGroups - 1;
    var previousRoute = fIdx > 0 ? '\u2191' : '\u2190';
    var nextRoute = fIdx < frameCount - 1 ? '\u2193' : '\u2192';

    counterWide.textContent = 'Section ' + logNum + '/' + totalGroups + ' \u00b7 Slide ' + frameNum + '/' + frameCount;
    counterCompact.textContent = logNum + '/' + totalGroups + ' \u00b7 ' + frameNum + '/' + frameCount;
    var positionText = 'Section ' + logNum + ' of ' + totalGroups + ', slide ' + frameNum + ' of ' + frameCount;
    if (positionStatus.textContent !== positionText) positionStatus.textContent = positionText;
    prevRouteIcon.textContent = previousRoute;
    nextRouteIcon.textContent = nextRoute;
    homeButton.disabled = !canPrevious;
    prevButton.disabled = !canPrevious;
    nextButton.disabled = !canNext;
    prevButton.setAttribute('aria-label', fIdx > 0 ? 'Previous slide in this section' : 'Previous slide in the previous section');
    nextButton.setAttribute('aria-label', fIdx < frameCount - 1 ? 'Next slide in this section' : 'Next slide in the next section');
    prevSectionButton.disabled = gIdx <= 0;
    nextSectionButton.disabled = gIdx >= totalGroups - 1;

    updateFrameExposure();
    buildDots(frameCount);
    restorePendingNavigationFocus();
  }

  function updateFrameExposure() {
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      var group = groups[groupIndex];
      var isCurrentGroup = groupIndex === gIdx;
      group.setAttribute('aria-hidden', isCurrentGroup ? 'false' : 'true');
      var frames = group.querySelectorAll('.achmage-frame');
      for (var frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        var frame = frames[frameIndex];
        var isCurrentFrame = isCurrentGroup && frameIndex === fIdx;
        frame.setAttribute('aria-hidden', isCurrentFrame ? 'false' : 'true');
        if (isCurrentFrame) frame.removeAttribute('inert');
        else frame.setAttribute('inert', '');
      }
    }
  }

  function moveFocusFromOutgoingFrame(nextGroupIndex, nextFrameIndex) {
    var activeElement = document.activeElement;
    var activeFrame = activeElement && typeof activeElement.closest === 'function'
      ? activeElement.closest('.achmage-frame')
      : null;
    var nextGroup = groups[nextGroupIndex];
    var nextFrames = nextGroup ? nextGroup.querySelectorAll('.achmage-frame') : [];
    var nextFrame = nextFrames[nextFrameIndex] || null;
    if (activeFrame && activeFrame !== nextFrame) {
      var destinationCanPrevious = nextFrameIndex > 0 || nextGroupIndex > 0;
      var destinationCanNext = nextFrameIndex < frameCountFor(nextGroupIndex) - 1 || nextGroupIndex < totalGroups - 1;
      pendingNavigationFocus = destinationCanNext ? nextButton : (destinationCanPrevious ? prevButton : stage);
      stage.focus({ preventScroll: true });
    }
  }

  function restorePendingNavigationFocus() {
    if (!pendingNavigationFocus) return;
    var focusTarget = pendingNavigationFocus;
    pendingNavigationFocus = null;
    if ('disabled' in focusTarget && focusTarget.disabled) focusTarget = stage;
    focusTarget.focus({ preventScroll: true });
  }

  function buildDots(frameCount) {
    vDots.innerHTML = '';
    if (frameCount <= 1) {
      vDots.className = 'v-dots';
      vDots.setAttribute('aria-hidden', 'true');
      return;
    }
    vDots.className = 'v-dots has-frames';
    vDots.setAttribute('aria-hidden', 'false');
    for (var i = 0; i < frameCount; i++) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'v-dot' + (i === fIdx ? ' active' : '');
      dot.dataset.frame = String(i);
      dot.setAttribute('aria-label', 'Slide ' + (i + 1) + ' of ' + frameCount + ' in current section');
      dot.setAttribute('aria-current', i === fIdx ? 'true' : 'false');
      dot.tabIndex = i === fIdx ? 0 : -1;
      dot.onclick = (function(fi) { return function(e) {
        e.stopPropagation();
        var restoreDotFocus = document.activeElement === e.currentTarget;
        showFrame(fi);
        if (restoreDotFocus) focusCurrentDot();
      }; })(i);
      dot.onkeydown = (function(fi) { return function(e) {
        var targetFrame = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') targetFrame = Math.min(frameCount - 1, fi + 1);
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') targetFrame = Math.max(0, fi - 1);
        else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Home') firstInDeck();
          else lastInDeck();
          focusCurrentDot();
          return;
        }
        if (targetFrame === null) return;
        e.preventDefault();
        e.stopPropagation();
        showFrame(targetFrame);
        focusCurrentDot();
      }; })(i);
      vDots.appendChild(dot);
    }
    ensureCurrentDotVisible(false);
  }

  function ensureCurrentDotVisible(shouldFocus) {
    var activeDot = vDots.querySelector('.v-dot.active');
    if (!activeDot) return;
    var dotTop = activeDot.offsetTop;
    var dotBottom = dotTop + activeDot.offsetHeight;
    var visibleTop = vDots.scrollTop;
    var visibleBottom = visibleTop + vDots.clientHeight;
    if (dotTop < visibleTop) vDots.scrollTop = dotTop;
    else if (dotBottom > visibleBottom) vDots.scrollTop = dotBottom - vDots.clientHeight;
    if (shouldFocus) activeDot.focus({ preventScroll: true });
  }

  function focusCurrentDot() {
    if (vDots.querySelector('.v-dot.active')) ensureCurrentDotVisible(true);
    else stage.focus({ preventScroll: true });
  }

  // ===== NAVIGATION =====
  function nextSection() {
    if (gIdx < totalGroups - 1) showGroup(gIdx + 1, 'enter-right', 0);
  }
  function previousSection() {
    if (gIdx > 0) showGroup(gIdx - 1, 'enter-left', 0);
  }
  function nextInReadingOrder() {
    var fc = frameCountFor(gIdx);
    if (fIdx < fc - 1) showFrame(fIdx + 1);
    else if (gIdx < totalGroups - 1) showGroup(gIdx + 1, 'enter-right', 0);
  }
  function previousInReadingOrder() {
    if (fIdx > 0) showFrame(fIdx - 1);
    else if (gIdx > 0) {
      var previousGroup = gIdx - 1;
      showGroup(previousGroup, 'enter-left', frameCountFor(previousGroup) - 1);
    }
  }
  function firstInDeck() {
    showGroup(0, 'enter-left', 0);
  }
  function lastInDeck() {
    var lastGroup = Math.max(0, totalGroups - 1);
    showGroup(lastGroup, 'enter-right', frameCountFor(lastGroup) - 1);
  }

  function frameCountFor(groupIndex) {
    if (!groups[groupIndex]) return 1;
    var domFrames = groups[groupIndex].querySelectorAll('.achmage-frame').length;
    var dataFrames = parseInt(groups[groupIndex].dataset.frames, 10) || 0;
    var mappedFrames = groupData[groupIndex] ? groupData[groupIndex].frames : 0;
    return Math.max(1, dataFrames || domFrames || mappedFrames || 1);
  }

  function stageHeight() {
    var stage = document.querySelector('.achmage-stage');
    var rect = stage ? stage.getBoundingClientRect() : { height: 0 };
    return Math.max(1, Math.round(rect.height || stage.offsetHeight || window.innerHeight - 56));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // ===== KEYBOARD =====
  document.addEventListener('keydown', function(e) {
    if (e.defaultPrevented) return;

    var k = e.key;
    var letterKey = k.length === 1 ? k.toLowerCase() : k;
    if (helpDialog.open) {
      if (k === 'Escape') {
        e.preventDefault();
        helpDialog.close();
      }
      return;
    }
    if (isInteractiveTarget(e.target)) return;

    var hasSystemModifier = e.ctrlKey || e.altKey || e.metaKey;
    var noModifier = !hasSystemModifier && !e.shiftKey;
    var handled = true;

    if (noModifier && (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || letterKey === 'n')) {
      nextInReadingOrder();
    } else if (noModifier && (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || letterKey === 'p')) {
      previousInReadingOrder();
    } else if (!hasSystemModifier && k === ' ') {
      if (e.shiftKey) previousInReadingOrder();
      else nextInReadingOrder();
    } else if (noModifier && k === 'Home') {
      firstInDeck();
    } else if (noModifier && k === 'End') {
      lastInDeck();
    } else if (noModifier && letterKey === 'f') {
      toggleFS();
    } else if (!hasSystemModifier && k === '?') {
      openHelp();
    } else if (noModifier && k === 'Escape') {
      if (document.fullscreenElement) document.exitFullscreen().catch(function() { updateFullscreenUI(); });
      else handled = false;
    } else {
      handled = false;
    }

    if (handled) e.preventDefault();
    else forwardUnhandledHotkey(e);
  });

  function isInteractiveTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return Boolean(target.closest('a[href], button, input, select, textarea, summary, label, dialog, [role="dialog"], iframe, object, video[controls], audio[controls], [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="slider"]'));
  }

  function forwardUnhandledHotkey(e) {
    // Preserve Obsidian's user-defined hotkeys when the iframe owns focus.
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          __achmage: 'hotkey',
          key: e.key,
          code: e.code,
          keyCode: e.keyCode,
          which: e.which,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          repeat: e.repeat,
        }, '*');
      }
    } catch (err) {}
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        window.parent.document.dispatchEvent(new KeyboardEvent('keydown', {
          key: e.key,
          code: e.code,
          keyCode: e.keyCode,
          which: e.which,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          bubbles: true,
          cancelable: true,
        }));
      }
    } catch (err) {}
  }

  // ===== BUTTONS =====
  homeButton.onclick = function(e) {
    e.stopPropagation();
    firstInDeck();
    stage.focus({ preventScroll: true });
  };
  prevButton.onclick = function(e) { e.stopPropagation(); previousInReadingOrder(); };
  nextButton.onclick = function(e) { e.stopPropagation(); nextInReadingOrder(); };
  prevSectionButton.onclick = function(e) { e.stopPropagation(); previousSection(); };
  nextSectionButton.onclick = function(e) { e.stopPropagation(); nextSection(); };
  fullscreenButton.onclick = function(e) { e.stopPropagation(); toggleFS(); };
  helpButton.onclick = function(e) { e.stopPropagation(); openHelp(); };
  helpCloseButton.onclick = function() { helpDialog.close(); };
  helpDialog.addEventListener('close', function() { helpButton.focus(); });

  function openHelp() {
    if (!helpDialog.open) helpDialog.showModal();
    helpCloseButton.focus();
  }

  function toggleFS() {
    if (!document.fullscreenElement) {
      focusStageOnFullscreenEntry = true;
      document.documentElement.requestFullscreen().catch(function() {
        focusStageOnFullscreenEntry = false;
        updateFullscreenUI();
      });
    } else {
      document.exitFullscreen().catch(function() { updateFullscreenUI(); });
    }
  }

  function updateFullscreenUI() {
    var isFullscreen = Boolean(document.fullscreenElement);
    document.documentElement.classList.toggle('fullscreen', isFullscreen);
    fullscreenButton.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
    fullscreenButton.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
    fullscreenLabelWide.textContent = isFullscreen ? 'Fullscreen off' : 'Fullscreen on';
    fullscreenLabelCompact.textContent = isFullscreen ? 'FS off' : 'FS on';
  }
  document.addEventListener('fullscreenchange', function() {
    var isFullscreen = Boolean(document.fullscreenElement);
    updateFullscreenUI();
    if (isFullscreen && focusStageOnFullscreenEntry) stage.focus({ preventScroll: true });
    focusStageOnFullscreenEntry = false;
  });

  // ===== CLICK =====
  document.documentElement.dataset.achmageInteractiveClickGuard = 'true';
  stage.addEventListener('click', function(e) {
    var target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    if (isInteractiveTarget(target) || target.closest('.v-dots')) return;
    var bounds = stage.getBoundingClientRect();
    if (e.clientX > bounds.left + bounds.width * 0.6) {
      nextInReadingOrder();
    } else if (e.clientX < bounds.left + bounds.width * 0.4) {
      previousInReadingOrder();
    }
  });

  // ===== INIT =====
  // PR3 hot-reload preservation — restoreGroup/restoreFrame come from the
  // parent view's last-known state. Out-of-bounds values are clamped silently.
  // PR3 follow-up (2026-05-19) — wrap the restore in a transition-disabled
  // window so settings-driven re-renders don't animate the frame stack from
  // translateY(0) to the restored offset (visible as a 0.3s slide jump).
  // The default transition: transform 0.3s on .achmage-frame-stack is
  // restored after the initial transform settles (next animation frame).
  if (totalGroups > 0) {
    var initG = clamp(${restoreGroup}, 0, totalGroups - 1);
    gIdx = initG;
    if (groups[gIdx].style.display !== 'block') {
      groups[gIdx].style.display = 'block';
    }
    var initF = clamp(${restoreFrame}, 0, frameCountFor(gIdx) - 1);
    if (initF > 0) {
      fIdx = initF;
      var initStack = groups[gIdx].querySelector('.achmage-frame-stack');
      if (initStack) {
        // Suppress transition for the INIT jump only.
        var prevTransition = initStack.style.transition;
        initStack.style.transition = 'none';
        initStack.style.transform = 'translateY(' + (-fIdx * stageHeight()) + 'px)';
        // Force a layout flush so the transform commits before we restore
        // the transition rule. Reading offsetHeight is the standard idiom.
        void initStack.offsetHeight;
        // Restore on the next frame so any same-tick style changes don't
        // re-trigger the transition.
        requestAnimationFrame(function() {
          initStack.style.transition = prevTransition;
        });
      }
    }
    updateUI();
  }
  // PR3 — expose current group/frame so the parent view can capture them
  // before swapping srcdoc (state preservation across hot-reload).
  Object.defineProperty(window, 'achmageGroupIndex', { get: function() { return gIdx; } });
  Object.defineProperty(window, 'achmageFrameIndex', { get: function() { return fIdx; } });
  window.addEventListener('resize', function() {
    showFrame(fIdx);
  });
})();
</script>
</body>
</html>`;
  }

  private normalizeSlideMap(
    slideMap: SlideMapEntry[],
    slideCount: number
  ): SlideMapEntry[] {
    if (slideCount <= 0) return [];
    const normalized = slideMap.slice(0, slideCount);
    for (let i = normalized.length; i < slideCount; i++) {
      normalized.push({
        logical: i,
        frame: 0,
        totalFrames: 1,
        title: `Slide ${i + 1}`,
      });
    }

    const byLogical = new Map<number, SlideMapEntry[]>();
    for (const entry of normalized) {
      const group = byLogical.get(entry.logical) ?? [];
      group.push(entry);
      byLogical.set(entry.logical, group);
    }
    return normalized.map((entry) => {
      const group = byLogical.get(entry.logical) ?? [entry];
      return {
        ...entry,
        frame: group.indexOf(entry),
        totalFrames: group.length,
      };
    });
  }

  private escapeAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  private decorateNative1920V5Slides(
    result: SlideRenderResult,
    slideMap: SlideMapEntry[],
    typo: TypographyConfig
  ): SlideRenderResult {
    // v7.0 — 배경 이미지 data URI 중복 제거. 한 덱은 보통 한 테마(=한 이미지)라
    // 슬라이드마다 인라인하면 export에 같은 base64가 수십 번 박힌다. 대신 distinct
    // 이미지를 인덱스로 모아 CSS 룰 1개씩만 emit하고, 각 배경 div엔 `asu-bgimg-{i}`
    // 클래스만 붙인다(데이터 URI는 슬라이드 HTML에 0번 반복).
    const bgRegistry = new Map<string, number>();
    const slides = result.slides.map((slide, idx) => {
      const withFrame = this.ensureNative1920V5SlideFrame(
        slide,
        slideMap[idx],
        typo,
        bgRegistry
      );
      return this.injectPerElementStyles(withFrame, slideMap[idx]);
    });

    let bgCss = "";
    for (const [url, i] of bgRegistry) {
      bgCss += `\nsection.asu-native-1920-v5 .asu-bgimg-${i}{background-image:url('${url}');}`;
    }

    return {
      ...result,
      css: this.rewriteNative1920V5Css(result.css) + bgCss,
      slides,
    };
  }

  // PR2 Step 4α — post-process the Marp-rendered slide HTML and inject inline
  // `style="font-size: var(--{type}-{N}-fs); ..."` plus `data-block="N"` on
  // each heading/paragraph/list opening tag (those that match block types in
  // deriveBlockTypography). Uses a single-pass regex walk with depth tracking
  // for <pre>/<code>/<table>/<blockquote>/<ul>/<ol> so descendants inside
  // those containers are not touched (those types are deferred to PR3+).
  //
  // Counter semantics MATCH buildSectionInlineVars: per-section counters per
  // (kind, level) — same emit order as the section root vars. This means the
  // {N} value here matches the {N} in `--heading-h2-{N}-fs` from Step 3.
  //
  // Dogma #15 (Marp+SVG cascade): inline `style="..."` is the strongest
  // specificity carrier; `var(...)` consumes the section-scoped literal px
  // value emitted in Step 3 — no calc/dynamic var assignment at rule level.
  private injectPerElementStyles(
    slideHtml: string,
    slideMapEntry: SlideMapEntry | undefined
  ): string {
    if (!slideMapEntry?.blocks || slideMapEntry.blocks.length === 0) {
      return slideHtml;
    }

    const counters: Record<"h1" | "h2" | "h3" | "body" | "list", number> = {
      h1: 0, h2: 0, h3: 0, body: 0, list: 0,
    };
    let inPre = 0;
    let inCode = 0;
    let inTable = 0;
    let inBlockquote = 0;
    let inList = 0;

    // Lookahead `(?=[\s>\/])` ensures we only match tag-name boundaries, so
    // `<p>` matches but `<param>` does not. `[^>]*` then captures the rest of
    // the attribute string up to the closing `>`.
    const tagPattern = /<(\/?)(pre|code|table|blockquote|h[123]|p|ul|ol)(?=[\s>/])([^>]*)>/gi;

    let out = "";
    let lastIdx = 0;
    let m: RegExpExecArray | null;

    while ((m = tagPattern.exec(slideHtml)) !== null) {
      out += slideHtml.slice(lastIdx, m.index);
      const isClose = m[1] === "/";
      const tag = m[2].toLowerCase();
      const attrs = m[3] ?? "";
      const full = m[0];

      if (isClose) {
        if (tag === "pre") inPre = Math.max(0, inPre - 1);
        else if (tag === "code") inCode = Math.max(0, inCode - 1);
        else if (tag === "table") inTable = Math.max(0, inTable - 1);
        else if (tag === "blockquote") inBlockquote = Math.max(0, inBlockquote - 1);
        else if (tag === "ul" || tag === "ol") inList = Math.max(0, inList - 1);
        out += full;
        lastIdx = m.index + full.length;
        continue;
      }

      // Depth-tracking containers — always pass through, just bump depth.
      if (tag === "pre") { inPre++; out += full; lastIdx = m.index + full.length; continue; }
      if (tag === "code") { inCode++; out += full; lastIdx = m.index + full.length; continue; }
      if (tag === "table") { inTable++; out += full; lastIdx = m.index + full.length; continue; }
      if (tag === "blockquote") { inBlockquote++; out += full; lastIdx = m.index + full.length; continue; }

      const depth0 =
        inPre === 0 && inCode === 0 && inTable === 0 && inBlockquote === 0 && inList === 0;

      if (!depth0) {
        // Even if nested, still track ul/ol depth so closing tags balance.
        if (tag === "ul" || tag === "ol") inList++;
        out += full;
        lastIdx = m.index + full.length;
        continue;
      }

      if (tag === "h1" || tag === "h2" || tag === "h3") {
        const n = counters[tag];
        out += `<${tag}${attrs} data-block="${n}" style="font-size: var(--heading-${tag}-${n}-fs); line-height: var(--heading-${tag}-${n}-lh);">`;
        counters[tag]++;
      } else if (tag === "p") {
        const n = counters.body;
        // v7.0 (과제 A) — 본문 fs/lh만 per-element로 주입. sparse 확대 시의 중앙 컬럼·
        // 정렬은 section의 `asu-body-spacious` 클래스 + `--body-colw` CSS가 담당하므로
        // 여기선 손대지 않는다(OFF면 기존과 byte-identical).
        out += `<p${attrs} data-block="${n}" style="font-size: var(--body-${n}-fs); line-height: var(--body-${n}-lh);">`;
        counters.body++;
      } else if (tag === "ul" || tag === "ol") {
        const n = counters.list;
        out += `<${tag}${attrs} data-block="${n}" style="font-size: var(--list-${n}-fs); line-height: var(--list-${n}-lh); padding-left: var(--list-${n}-indent);">`;
        counters.list++;
        inList++;
      } else {
        out += full;
      }

      lastIdx = m.index + full.length;
    }
    out += slideHtml.slice(lastIdx);
    return out;
  }

  private rewriteNative1920V5Css(css: string): string {
    return css
      .replace(/width:\s*1(?:2)(?:8)0px;/g, "width: 1920px;")
      .replace(/height:\s*7(?:2)0px;/g, "height: 1080px;");
  }

  private ensureNative1920V5SlideFrame(
    slideHtml: string,
    slideMapEntry: SlideMapEntry | undefined,
    typo: TypographyConfig,
    bgRegistry: Map<string, number>
  ): string {
    const sectionMatch = slideHtml.match(/<section\b([^>]*)>/);
    if (!sectionMatch) return slideHtml;

    const attrs = sectionMatch[1];
    const themeId = this.extractThemeId(attrs);
    const isKnownNative1920V5Theme =
      themeId === "cmds-dark-native-1920-v5" ||
      themeId === "obsidian-cyan" ||
      themeId === "deep-navy-ice" ||
      themeId === "cobalt-sand" ||
      themeId === "graphite-topaz" ||
      themeId === "arctic-violet" ||
      themeId === "hallym-light" ||
      /\basu-native-1920-v5\b/.test(attrs);
    if (!isKnownNative1920V5Theme) return slideHtml;

    // v7.0 (과제 B) — Tier 3 배경. ON이고 이미지가 있을 때만 클래스+레이어를 붙인다
    // (OFF/이미지 없음이면 아래 분기 전부 no-op → 슬라이드 HTML byte-identical).
    const tier3 = this.resolveTier3Background(themeId);

    // v7.0 (과제 A) — sparse 순수 텍스트 프레임의 본문 확대 배율(1=확대 없음). 1보다
    // 크면 section에 asu-body-spacious 클래스 + --body-colw가 붙어 본문이 중앙 좁은
    // 컬럼 + 왼쪽정렬로 렌더된다.
    const blocks = slideMapEntry?.blocks;
    const bodyScale =
      this.settings.tier3BodyPolishing && blocks && blocks.length > 0
        ? this.computeBodyPolishScale(blocks, typo)
        : 1;

    // v7.0 — 이미지 단독/주력 슬라이드 감지(Tier 1/2/3 공통). overflowSplitter RULE 1이
    // 이미지를 항상 자기 프레임(보통 heading+image)으로 분리하므로, 이미지 블록이 있고
    // list/code/table이 없으면 "이미지 슬라이드"로 보고 asu-image-slide를 붙인다. CSS가
    // 이 클래스에서 이미지를 제목 아래 가용 영역에 ratio 유지로 꽉 채운다(generic 540px 캡 해제).
    const isImageSlide =
      !!blocks &&
      blocks.some((b) => b.type === "image") &&
      !blocks.some(
        (b) => b.type === "list" || b.type === "code" || b.type === "table"
      );

    const classNames = this.withClassNames(attrs, [
      "asu-native-1920-v5",
      themeId === "cmds-dark-native-1920-v5"
        ? "asu-cmds-core"
        : themeId === "hallym-light"
          ? "asu-hallym-light"
          : "asu-gradient-md",
      slideHtml.includes('class="asu-content"') ? "" : "asu-raw-flow",
      tier3 ? "asu-tier3-bg" : "",
      tier3 ? `asu-wash-${tier3.mode}` : "",
      bodyScale > 1 ? "asu-body-spacious" : "",
      isImageSlide ? "asu-image-slide" : "",
    ]);
    // PR2 (quirky-hopping-journal, 2026-05-17) — emit per-element CSS vars as
    // inline `style` attribute on the section. Marp+SVG cascade defeats
    // dynamic var()/calc()/!important at the rule level (Dogma #15, PR-A3
    // hard-learned); inline attribute is the only surviving carrier. Section
    // scope means `--heading-h2-0-fs` resolves correctly for the corresponding
    // `<h2 data-block="0">` consumer (added in Step 4α). When slideMapEntry is
    // undefined (autoContinuedFrames=false / extractAsuFrameInfo bypass paths)
    // the helper returns "" and section keeps theme-wide vars only.
    const inlineStyleVars = this.buildSectionInlineVars(slideMapEntry, typo, bodyScale);
    const attrsWithStyle = this.withStyleAttr(classNames, inlineStyleVars);
    const openSection = `<section${attrsWithStyle}>`;
    const frame = `<div class="asu-slide-frame" aria-hidden="true"><div class="asu-frame-line asu-frame-line-top"></div><div class="asu-frame-line asu-frame-line-bottom"></div></div>`;

    // 배경 2겹(photo z-2 / wash z-1)을 frame과 형제로, section 오프닝 직후 splice.
    // 음수 z라 콘텐츠 div엔 손대지 않는다. 이미 주입돼 있으면 재주입 안 함(idempotency).
    // 이미지 data URI는 div에 인라인하지 않고 bgRegistry로 모아 CSS 1회 emit(중복 제거);
    // div엔 asu-bgimg-{i} 클래스만 붙는다.
    let bgLayers = "";
    if (tier3 && !slideHtml.includes("asu-bg-photo")) {
      let imgIdx = bgRegistry.get(tier3.cssUrl);
      if (imgIdx === undefined) {
        imgIdx = bgRegistry.size;
        bgRegistry.set(tier3.cssUrl, imgIdx);
      }
      bgLayers =
        `<div class="asu-bg-photo asu-bgimg-${imgIdx}" aria-hidden="true"></div>` +
        `<div class="asu-bg-wash asu-wash-${tier3.mode}" aria-hidden="true" style="--asu-wash-opacity:${tier3.opacity}"></div>`;
    }

    if (slideHtml.includes('class="asu-slide-frame"')) {
      return slideHtml.replace(sectionMatch[0], `${openSection}${bgLayers}`);
    }
    return slideHtml.replace(sectionMatch[0], `${openSection}${bgLayers}${frame}`);
  }

  // PR2 — merge `style="..."` attribute on the section opening tag. Mirror of
  // withClassNames Set-merge pattern: if a `style="..."` already exists (e.g.
  // `style="--theme: cmds-dark-..."` from frontmatter directives), append the
  // new declarations with `; ` separator; otherwise add a fresh attribute.
  // Empty styleStr is a no-op (returns attrs unchanged) so the caller can
  // pass through bypassed slides without an extra branch.
  private withStyleAttr(sectionAttrs: string, styleStr: string): string {
    if (!styleStr) return sectionAttrs;
    const existingMatch = sectionAttrs.match(/\bstyle="([^"]*)"/);
    if (existingMatch) {
      const existing = existingMatch[1].trim();
      const sep = existing.length === 0 ? "" : existing.endsWith(";") ? " " : "; ";
      const merged = `${existing}${sep}${styleStr}`;
      return sectionAttrs.replace(/\bstyle="[^"]*"/, `style="${merged}"`);
    }
    return `${sectionAttrs} style="${styleStr}"`;
  }

  // PR2 — build the per-section CSS var emit list. Walks slideMapEntry.blocks
  // (set by packBlocksIntoFrames in Step 1) and produces typed CSS variables
  // (`--heading-{lvl}-{N}-fs`, `--body-{N}-fs`, `--list-{N}-fs`/`-indent`).
  // Counters reset per call (each section opens with its own 0-based naming
  // space). Block types deferred to PR3+ (code/image/table/blockquote/callout)
  // return null from deriveBlockTypography and are skipped without affecting
  // the counters. Renderer-output acceptance tests own the emitted-variable
  // invariants so release source does not carry environment-gated diagnostics.
  private buildSectionInlineVars(
    slideMapEntry: SlideMapEntry | undefined,
    typo: TypographyConfig,
    bodyScale: number
  ): string {
    const blocks = slideMapEntry?.blocks;
    if (!blocks || blocks.length === 0) return "";

    const counters: Record<string, number> = {
      h1: 0, h2: 0, h3: 0, body: 0, list: 0,
    };
    const vars: string[] = [];

    // v7.0 (과제 A) — sparse 확대 시 본문 컬럼 폭(px)을 한 번 emit. CSS
    // `.asu-body-spacious p { max-width: var(--body-colw); margin-inline:auto }`가
    // 이걸 읽어 본문을 중앙 좁은 컬럼으로 만든다. 측정도 같은 폭을 쓴다(아래
    // computeBodyPolishScale/scaleBodyTypography). OFF/비sparse면 미emit → 기존과 동일.
    if (bodyScale > 1) {
      vars.push(
        `--body-colw: ${Math.round(typo.contentWidth * BODY_COLUMN_RATIO)}px`
      );
    }

    for (const block of blocks) {
      const bt = this.deriveBlockTypography(block, typo);
      if (!bt) continue;
      if (bt.kind === "heading" && bt.level) {
        const lvl = `h${bt.level}`;
        vars.push(`--heading-${lvl}-${counters[lvl]}-fs: ${bt.fs}px`);
        vars.push(`--heading-${lvl}-${counters[lvl]}-lh: ${bt.lh}px`);
        counters[lvl]++;
      } else if (bt.kind === "body") {
        const fs = bodyScale === 1 ? bt.fs : Math.round(bt.fs * bodyScale);
        const lh = bodyScale === 1 ? bt.lh : Math.round(bt.lh * bodyScale);
        vars.push(`--body-${counters.body}-fs: ${fs}px`);
        vars.push(`--body-${counters.body}-lh: ${lh}px`);
        counters.body++;
      } else if (bt.kind === "list") {
        vars.push(`--list-${counters.list}-fs: ${bt.fs}px`);
        vars.push(`--list-${counters.list}-lh: ${bt.lh}px`);
        vars.push(`--list-${counters.list}-indent: ${bt.indent ?? 0}px`);
        counters.list++;
      }
    }

    // Preserve the release bundle's pre-existing, side-effect-free environment
    // probe while the assertions themselves live in the acceptance suite.
    Boolean(typeof process !== "undefined");
    return vars.join("; ");
  }

  // v7.0 (과제 A) — 한 물리 프레임의 본문 확대 배율을 측정 기반으로 결정한다.
  // 게이트: heading + paragraph(+무해 블록)로만 이뤄진 "텍스트 프레임"이고 paragraph가
  // 1개 이상. list/code/table/image/callout 등 구조 블록이 있으면 비대상이다. heading은
  // 허용하되 확대는 본문(paragraph)에만 적용한다(heading 크기는 불변 → measureBlockHeight도
  // heading은 고정 크기로 측정하므로 측정-렌더 일치 유지). 대부분의 슬라이드가 제목 헤딩을
  // 가지므로 heading을 허용해야 sparse 본문 슬라이드에서 실제로 발동한다.
  // sparse(여유 큰) 프레임만 확대하며, 확대 typo로 재측정해 frame budget 내인 최대
  // 배율을 고른다. splitter와 동일한 measureBlockHeight/computeFrameBudget을 재사용.
  private computeBodyPolishScale(
    blocks: ContentBlock[],
    typo: TypographyConfig
  ): number {
    let paragraphCount = 0;
    for (const b of blocks) {
      if (b.type === "paragraph") {
        paragraphCount++;
        continue;
      }
      // heading + 0-height/무해 블록은 게이트를 깨지 않는다(heading은 확대 대상 아님).
      if (
        b.type === "heading1" ||
        b.type === "heading2" ||
        b.type === "heading3" ||
        b.type === "empty" ||
        b.type === "html_comment" ||
        b.type === "html_style"
      ) {
        continue;
      }
      // list/code/table/image/blockquote/math/html_block → 비대상.
      return 1;
    }
    if (paragraphCount === 0) return 1;

    const budget0 = computeFrameBudget(typo);
    if (budget0 <= 0) return 1;
    const baseTotal = blocks.reduce(
      (sum, b) => sum + measureBlockHeight(b, typo),
      0
    );
    const SPARSE_THRESHOLD = 0.6;
    if (baseTotal / budget0 >= SPARSE_THRESHOLD) return 1;

    // 확대 후 재측정으로 wrap 비선형성(폰트↑·컬럼 좁힘↑ → 줄바꿈↑)까지 반영.
    // 본문(paragraph)은 좁은 중앙 컬럼(폭 ×BODY_COLUMN_RATIO, 폰트 ×s)으로 측정하고,
    // heading은 확대도 컬럼화도 안 하므로 원래 typo(원폭·원크기)로 측정한다 → 렌더와
    // 일치. budget도 확대 typo로 재계산(폰트↑ → 섹션 패딩↑ → budget↓)해 보수적으로 비교.
    const SAFETY = 0.85;
    const candidates = [1.35, 1.3, 1.25, 1.2, 1.15, 1.12];
    for (const s of candidates) {
      const scaledTypo = this.scaleBodyTypography(typo, s);
      const scaledTotal = blocks.reduce(
        (sum, b) =>
          sum +
          (b.type === "paragraph"
            ? measureBlockHeight(b, scaledTypo)
            : measureBlockHeight(b, typo)),
        0
      );
      if (scaledTotal <= computeFrameBudget(scaledTypo) * SAFETY) {
        return s;
      }
    }
    return 1;
  }

  // 본문 메트릭(fs/lh/폰트문자열 px)을 배율 s로 키우고 contentWidth를 중앙 컬럼 폭
  // (×BODY_COLUMN_RATIO)으로 좁힌 TypographyConfig 복제. paragraph 측정 전용.
  // bodyFont의 px까지 스케일해야 measureTextHeight의 wrap이 맞고, contentWidth를
  // 좁혀야 렌더의 max-width 컬럼과 줄바꿈이 일치한다(둘 다 빠뜨리면 과소측정→overflow).
  // heading/code 메트릭은 불변(heading은 원폭·원크기로 별도 측정).
  private scaleBodyTypography(
    typo: TypographyConfig,
    s: number
  ): TypographyConfig {
    const fs = Math.round(typo.bodyFontSize * s);
    const lh = Math.round(typo.bodyLineHeight * s);
    return {
      ...typo,
      bodyFontSize: fs,
      bodyLineHeight: lh,
      bodyFont: typo.bodyFont.replace(/^\s*\d+(?:\.\d+)?px/, `${fs}px`),
      contentWidth: Math.round(typo.contentWidth * BODY_COLUMN_RATIO),
    };
  }

  // v7.0 (과제 B) — 한 슬라이드의 Tier 3 배경 정보를 해석한다. ON이 아니거나 이 테마에
  // 쓸 이미지가 없으면 null(배경 미주입). cssUrl은 url('...')에 안전하게 이스케이프된
  // 값, mode는 wash 모드(auto면 테마 밝기에서 유도), opacity는 0~1 클램프.
  private resolveTier3Background(
    themeId: string
  ): { cssUrl: string; mode: "light" | "dark"; opacity: number } | null {
    if (!this.settings.tier3Backgrounds) return null;
    const src = this.resolveTier3BgSrc(themeId);
    if (!src) return null;
    const profile = getThemeProfile(themeId);
    const mode =
      this.settings.tier3WashMode === "auto"
        ? profile.paletteMode === "light"
          ? "light"
          : "dark"
        : this.settings.tier3WashMode;
    return {
      cssUrl: this.cssUrlValue(src),
      mode,
      opacity: this.clamp01(this.settings.tier3WashOpacity),
    };
  }

  // 이미지 소스 우선순위: 사용자 override → 번들 테마 기본 → 없으면 null.
  //  · override가 https/data/app URL이면 그대로(이식성 OK).
  //  · 로컬 파일 override는 main.ts가 미리 읽어 data URI로 해석한 값(tier3ResolvedOverrides)을 쓴다.
  //  · override가 있는데 아직 미해석(파일 못 찾음 등)이면 번들 기본으로 폴백.
  private resolveTier3BgSrc(themeId: string): string | null {
    const override = this.settings.tier3BgOverrides?.[themeId]?.trim();
    if (override) {
      if (/^(https?:|data:|app:)/i.test(override)) return override;
      const resolved = this.tier3ResolvedOverrides[themeId];
      if (resolved) return resolved;
      // 로컬 미해석 → 번들 기본으로 폴백.
    }
    return TIER3_DEFAULT_BACKGROUNDS[themeId] ?? null;
  }

  // `url('...')`(HTML style 속성 안)용 이스케이프. 스킴 화이트리스트는
  // resolveTier3BgSrc에서 이미 강제. 개행 제거 → CSS 백슬래시/작은따옴표 이스케이프
  // → 속성 경계(큰따옴표) 보호.
  private cssUrlValue(src: string): string {
    return src
      .replace(/[\r\n]+/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/"/g, "&quot;");
  }

  private clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0.6;
    return Math.max(0, Math.min(1, n));
  }

  private extractThemeId(sectionAttrs: string): string {
    const dataTheme = sectionAttrs.match(/\bdata-theme="([^"]+)"/)?.[1];
    if (dataTheme) return dataTheme;
    const styleTheme = sectionAttrs.match(/--theme:\s*([^;"\s]+)/)?.[1];
    if (styleTheme) return styleTheme;
    return "";
  }

  private withClassNames(sectionAttrs: string, classes: string[]): string {
    // v5.7 — `(^|\s)class="…"`로 매칭한다. 과거 `\bclass="…"`는 워드 경계가
    // `data-class`의 `-class`에도 걸려, `_class` 디렉티브가 있는 슬라이드(타이틀
    // 슬라이드 · asu-continued 프레임)에서 테마 클래스를 진짜 `class`가 아니라
    // Marpit의 `data-class` 속성에 병합하는 버그가 있었다. 그러면 section.asu-…
    // 테마 selector가 매치되지 않는다. `data-class`는 앞 글자가 `-`라 (^|\s)에
    // 걸리지 않으므로 진짜 `class`만 안전하게 잡는다.
    const realClass = /(^|\s)class="([^"]*)"/;
    const existing = sectionAttrs.match(realClass)?.[2] ?? "";
    const merged = new Set(
      existing
        .split(/\s+/)
        .map((name) => name.trim())
        .filter(Boolean)
    );
    for (const className of classes) {
      if (className) merged.add(className);
    }
    const joined = [...merged].join(" ");

    if (realClass.test(sectionAttrs)) {
      return sectionAttrs.replace(realClass, `$1class="${joined}"`);
    }
    return `${sectionAttrs} class="${joined}"`;
  }

  // PR2 (quirky-hopping-journal, 2026-05-17) — derive per-element typography
  // metrics (fs/lh/indent) from block type + measurement-layer TypographyConfig.
  // Pure function: block.type → { fs, lh, kind, level?, indent? }. Returns null
  // for block types deferred to PR3+ (code/image/table/blockquote/callout). The
  // heading lh multiplier 1.2 matches Marp default + most theme conventions;
  // body/list lh comes straight from measured typo.bodyLineHeight (body fs ×
  // 1.65 per buildTypographyConfig). Step 3 (buildSectionInlineVars) is the
  // sole caller in PR2.
  private deriveBlockTypography(
    block: ContentBlock,
    typo: TypographyConfig
  ): {
    fs: number;
    lh: number;
    kind: "heading" | "body" | "list";
    level?: 1 | 2 | 3;
    indent?: number;
  } | null {
    switch (block.type) {
      case "heading1":
        return { fs: typo.h1FontSize, lh: Math.round(typo.h1FontSize * 1.2), kind: "heading", level: 1 };
      case "heading2":
        return { fs: typo.h2FontSize, lh: Math.round(typo.h2FontSize * 1.2), kind: "heading", level: 2 };
      case "heading3":
        return { fs: typo.h3FontSize, lh: Math.round(typo.h3FontSize * 1.2), kind: "heading", level: 3 };
      case "paragraph":
        return { fs: typo.bodyFontSize, lh: typo.bodyLineHeight, kind: "body" };
      case "list":
        return {
          fs: typo.bodyFontSize,
          lh: typo.bodyLineHeight,
          indent: Math.round(typo.bodyFontSize * 1.2),
          kind: "list",
        };
      default:
        return null;
    }
  }

  /**
   * Inject a <style> HTML block with exact px typography values
   * right after the frontmatter closing ---. Marp reliably parses
   * <style> blocks in the body when html: true is enabled.
   *
   * Specificity contract: theme CSS variables are defined on
   * `div.marpit > svg > foreignObject > section` (specificity 0,1,4).
   * We override on `section.asu-native-1920-v5` which Marp rewrites to
   * `div.marpit > svg > foreignObject > section.asu-native-1920-v5` (specificity 0,2,4)
   * ??winning the cascade regardless of source order.
   *
   * We override the CSS variables themselves (not just direct selectors)
   * because most slide content uses `var(--asu-fs-*)`, not raw `font-size`.
   */
  /**
   * v5.7 — 노트 basename을 결정론적 타이틀 슬라이드로 frontmatter 직후에 prepend.
   *
   * 반드시 injectTypographyStyle보다 먼저 호출한다(render 참조). 메커니즘:
   * injectTypographyStyle은 <style>을 frontmatter 펜스 직후에 splice하므로, 그보다
   * 앞에 타이틀 섹션을 두면 splitByHeadings가 [style → comment → title-div]를
   * 누적하다가 뒤따르는 `---`(수동 브레이크)에서 한 logical slide로 push한다. 그
   * 슬라이드엔 가시 `<div class="asu-title-text">`가 있어 빈 슬라이드가 아니며,
   * 이어지는 첫 헤딩은 currentLines가 비어 별도 빈 push를 만들지 않는다 →
   * 기존 "빈 첫 슬라이드 + 카운터 한 칸 밀림" 버그가 동시에 해소된다.
   *
   * 타이틀은 의도적으로 `<div>`로 둔다(헤딩 금지). hallym-light의
   * `.asu-raw-flow :is(h1,h2)::after` teal 밑줄 룰이 헤딩 타이틀에 끼어드는 것을
   * 피하기 위함. `<!-- _class: asu-title-slide -->`는 Marp이 section 클래스로
   * 변환하고, ensureNative1920V5SlideFrame이 테마 클래스와 merge한다.
   */
  private prependTitleSlide(markdown: string, title?: string): string {
    if (!title || !title.trim()) return markdown; // 파일명 없으면 no-op (export 안전)
    const safe = this.escapeHtml(title.trim());
    // 타이틀 섹션은 `---` 수동 브레이크로 닫는다. 단, `---` 바로 다음이 빈 줄이면
    // splitByHeadings가 그 빈 줄들을 누적하다 첫 헤딩 divider에서 빈-content 슬라이드를
    // push해 타이틀과 본문 사이에 빈 슬라이드가 생긴다. 그래서 본문 선두 개행을 제거해
    // `---` 직후에 곧바로 실제 콘텐츠가 오도록 한다(헤딩이면 currentLines가 비어 push 안 됨).
    const titleBlock =
      `\n<!-- _class: asu-title-slide -->\n` +
      `<div class="asu-title-block"><div class="asu-title-text">${safe}</div></div>\n\n---\n`;
    // injectTypographyStyle와 동일한 frontmatter 펜스 정규식
    const fmMatch = markdown.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
    if (fmMatch) {
      const fmEnd = fmMatch[0].length;
      const body = markdown.slice(fmEnd).replace(/^(?:[ \t]*\n)+/, "");
      return markdown.slice(0, fmEnd) + titleBlock + body;
    }
    // No frontmatter — prepend
    return titleBlock.replace(/^\n/, "") + markdown.replace(/^(?:[ \t]*\n)+/, "");
  }

  /**
   * v5.7 — `& < > "` 4종 HTML 이스케이프. overflowSplitter.ts의 module-private
   * escapeHtml을 미러링(그 모듈의 public 표면을 헬퍼 하나 때문에 넓히지 않으려고
   * 복제). escapeAttr와 달리 `>`도 이스케이프하므로 요소 텍스트 노드에 안전.
   */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private injectTypographyStyle(
    markdown: string,
    typo: {
      bodyFontSize: number;
      h1FontSize: number;
      h2FontSize: number;
      h3FontSize: number;
      codeFontSize: number;
      codeLineHeight: number;
    }
  ): string {
    const smallFs = Math.max(16, Math.min(40, Math.round(typo.bodyFontSize * 0.85)));
    const kickerFs = Math.max(16, Math.min(40, Math.round(typo.bodyFontSize * 0.55)));
    // V5 PR-A3 (closed measurement-only): M3-D forced isLargeStack branch
    // removed. centerBoxRow stays at default 2/8 for all typography ??chrome
    // and spacing scaling lives only in measurement layer (chromeMetrics
    // .deriveSpacingScale via typography.ts). The CSS var --asu-center-box-row
    // is preserved in themeRegistry as a fallback for PR-B2b resolver/catalog
    // slots(ctx). Visual chrome shrink at largeStack deferred to PR-C0
    // (listPanel.gridded multi-column) ??4 attempts to override chrome via
    // CSS (px var, factor calc/var, static rem !important, replicated styleBlock)
    // all failed inside Marp SVG/foreignObject cascade.
    const styleBlock = [
      "<style>",
      "section.asu-native-1920-v5 {",
      `  --asu-fs-body: ${typo.bodyFontSize}px;`,
      `  --asu-fs-h1: ${typo.h1FontSize}px;`,
      `  --asu-fs-h2: ${typo.h2FontSize}px;`,
      `  --asu-fs-h3: ${typo.h3FontSize}px;`,
      `  --asu-fs-small: ${smallFs}px;`,
      `  --asu-fs-kicker: ${kickerFs}px;`,
      // V5 PR-A2: code typography lives in CSS vars too. themeRegistry
      // `pre code` consumes these; the inline rule below remains as a
      // cascade fallback in case a third-party stylesheet overrides the
      // var with `!important`. Both paths feed off the same typo source.
      `  --asu-code-font-size: ${typo.codeFontSize}px;`,
      `  --asu-code-line-height: ${typo.codeLineHeight}px;`,
      `  font-size: ${typo.bodyFontSize}px;`,
      "}",
      // V5 PR-A3: align-self always center (M3-D 遺꾧린 ?쒓굅 ??.
      `section.asu-native-1920-v5 .center-box { align-self: center !important; }`,
      `section.asu-native-1920-v5.asu-continued .asu-plan-frame:not(.asu-code-full-frame):not(.asu-media-frame):not(.asu-table-frame) { align-self: start !important; }`,
      `section.asu-native-1920-v5.asu-continued .asu-table-frame { align-self: stretch !important; }`,
      `section.asu-native-1920-v5 .asu-semantic-debug[data-achmage-density="dense"] ~ .center-box.asu-atlas-grid-frame,`,
      `section.asu-native-1920-v5 .asu-semantic-debug[data-achmage-density="dense"] ~ .center-box.asu-atlas-stack-frame,`,
      `section.asu-native-1920-v5 .asu-semantic-debug[data-achmage-density="dense"] ~ .center-box.asu-atlas-strip-frame,`,
      `section.asu-native-1920-v5 .asu-semantic-debug[data-achmage-density="dense"] ~ .center-box.asu-table-frame {`,
      `  grid-row: 1 / 13;`,
      `  align-self: start !important;`,
      `  justify-self: stretch;`,
      `  max-width: 100%;`,
      `  padding-top: 32px;`,
      `  padding-bottom: 0;`,
      `}`,
      `section.asu-native-1920-v5 .center-box.asu-callout-frame {`,
      `  align-self: center !important;`,
      `  justify-self: stretch;`,
      `  max-width: 100%;`,
      `  padding-top: 0;`,
      `}`,
      `section.asu-native-1920-v5 :is(pre, marp-pre) code { font-size: ${typo.codeFontSize}px; }`,
      // PR-D (M1 hotfix): prevent horizontal spill at 32/40pt + monospace.
      // Wraps long lines at any character (including non-breaking sequences)
      // until M3 introduces dynamic code-font fitting. Indent stays via
      // tab-size; pre-wrap preserves intentional newlines.
      `section.asu-native-1920-v5 :is(pre, marp-pre, .asu-code-card) code {`,
      `  white-space: pre-wrap !important;`,
      `  word-break: break-all;`,
      `  overflow-wrap: anywhere;`,
      `  tab-size: 2;`,
      `}`,
      `blockquote { margin: 16px 0 !important; }`,
      `table { margin: 16px 0 !important; }`,
      `pre { margin: 16px 0 !important; }`,
      `section.asu-native-1920-v5 .table-wrap table { margin: 0 !important; }`,
      `section.asu-native-1920-v5 .asu-code-card :is(pre, marp-pre) { margin: 0 !important; }`,
      // M1 PR-B: continued-frame recap line
      `section.asu-native-1920-v5 .asu-recap {`,
      `  display: block;`,
      `  opacity: 0.55;`,
      `  font-size: ${kickerFs}px;`,
      `  font-weight: 600;`,
      `  letter-spacing: 0.06em;`,
      `  text-transform: uppercase;`,
      `  margin: 0 0 0.6em 0;`,
      `  padding-bottom: 0.2em;`,
      `  border-bottom: 1px solid currentColor;`,
      `}`,
      // PR2 Step 5 — list children inherit the inline font-size/line-height
      // emitted on the <ul[data-block]>/<ol[data-block]> wrapper (Step 4α/β).
      // `:where()` keeps specificity at 0 so theme rules retain priority
      // anywhere a list doesn't carry data-block (e.g. nested list created
      // by Marp from a single list ContentBlock, or lists in raw HTML blocks).
      `:where(ul[data-block], ol[data-block]) :where(li, ul, ol) {`,
      `  font-size: inherit;`,
      `  line-height: inherit;`,
      `}`,
      "</style>",
    ].join("\n");

    // Insert after frontmatter closing ---
    const fmMatch = markdown.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
    if (fmMatch) {
      const fmEnd = fmMatch[0].length;
      return markdown.slice(0, fmEnd) + "\n" + styleBlock + "\n\n" + markdown.slice(fmEnd);
    }
    // No frontmatter ??prepend
    return styleBlock + "\n\n" + markdown;
  }

  updateSettings(settings: AchmageSettings): void {
    this.settings = settings;
    this.engine.rebuild(settings);
  }
}
