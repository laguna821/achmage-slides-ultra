import type { AchmageSettings } from "../settings";
import {
  parseContentBlocks,
  measureBlockHeight,
  measureTableCardRows,
  type ContentBlock,
  type TypographyConfig,
} from "./pretextMeasurer";
import { NATIVE_1920_V5_STAGE } from "../layout/native1920V5Canvas";
import { SPLIT_POLICY } from "../semantic/splitPolicy";
import {
  CODE_SNIPPET_FULL_LINES,
  CODE_SNIPPET_HEAD_LINES,
  CODE_SNIPPET_TAIL_LINES,
} from "../semantic/codeBlockPolicy";
import type { BlockType, InternalLayoutKind, RenderOptions } from "../semantic/types";

export interface SlideMapEntry {
  logical: number;
  frame: number;
  totalFrames: number;
  title: string;
  // PR2 (quirky-hopping-journal, 2026-05-17) — per-physical-frame blocks for
  // CSS var emit. Undefined for slides routed via autoContinuedFrames=false
  // or extractAsuFrameInfo bypass paths; those slides keep theme-wide vars
  // only (PR2 limitation, PR3+ backfills).
  blocks?: ContentBlock[];
  // PR2 — 0-based block index within this physical frame. Resets at frame
  // boundary so section-scoped CSS vars (e.g. --heading-h2-0-fs) are stable.
  // Parallel to blocks[]; same length.
  frameBlockIndex?: number[];
}

export interface OverflowResult {
  markdown: string;
  slideMap: SlideMapEntry[];
}

const STAGE_HEIGHT = NATIVE_1920_V5_STAGE.height;
/** Padding inside marp section (top + bottom) at the 28pt reference */
const SECTION_PADDING_V_BASE = 94; // sample grid top/bottom: line-y + 32px
/** Reference body font size that the static budgets were calibrated against. */
const REFERENCE_BODY_FONT = 28;
/** Bottom area: generous reserve to prevent content touching labels/dots.
 *  Prefer more vertical frames over cramming content into one frame. */
const UI_RESERVED_BOTTOM = 110;
/** Heading area reserved on continued frames */
const CONTINUED_HEADING_HEIGHT = 70;
/**
 * PR2 Amendment (quirky-hopping-journal, 2026-05-17) — line-density cap on
 * availableHeight. Before PR2 the raw `<p>` rendered at Marp default lh (~1.2 ×
 * fs) while measurement assumed `bodyLineHeight` (1.65 × fs). The mismatch
 * left a visual cushion: render underfilled the measurement budget. PR2
 * forced inline `line-height: var(--body-N-lh)` on every paragraph, closing
 * the gap and revealing how many paragraphs the measurement actually packed.
 * At small body sizes (where `fontScale = Math.max(1, ...)` clamps to 1 and
 * the padding-driven height stays large) this surfaces as 14+ paragraphs per
 * frame — visually cramped despite being measurement-honest (dogma #17).
 *
 * The cap forces a per-frame ceiling derived from the measured paragraph
 * budget, calibrated so the engaged regime (≤ ~36pt body) matches the
 * paragraph density the user already found comfortable at 40pt (~10/frame).
 * Above ~36pt the padding-driven height is already smaller, so the cap is a
 * no-op — 40pt+ visual LOCK is preserved.
 */
const MAX_BODY_LINES_PER_FRAME = 11;

/**
 * Main entry: parse by headings ??measure with Pretext ??pack into frames
 */
/**
 * 한 프레임의 가용 콘텐츠 높이(px). 본문 폰트에 따라 스케일된다.
 *
 * PR-D (M1 hotfix): 사용자가 고른 base 폰트에 맞춰 섹션 패딩을 키워, 큰 텍스트가
 * 헤딩·패딩에 그만큼 공간을 예약하게 한다(28pt 기준 미만은 원래 패딩 유지).
 * PR2 Amendment — `+ round(bodyFontSize*0.5)`는 pretextMeasurer의 문단 chrome과 동형.
 * lineDensityCap은 작은 본문 폰트에서 14+ 문단이 욱여넣어지는 것을 막는다(≥~36pt에선
 * paddingDrivenHeight가 더 작아 cap은 no-op, 40pt+ LOCK 유지).
 *
 * v6.0 — Tier 2가 콜아웃/박스의 fit 판정에 재사용하도록 export.
 */
export function computeFrameBudget(typo: TypographyConfig): number {
  const fontScale = Math.max(1, typo.bodyFontSize / REFERENCE_BODY_FONT);
  const sectionPaddingV = SECTION_PADDING_V_BASE * fontScale;
  const paddingDrivenHeight = STAGE_HEIGHT - sectionPaddingV - UI_RESERVED_BOTTOM;
  const perParagraphBudget =
    typo.bodyLineHeight + Math.round(typo.bodyFontSize * 0.5);
  const lineDensityCap = perParagraphBudget * MAX_BODY_LINES_PER_FRAME;
  return Math.max(240, Math.min(paddingDrivenHeight, lineDensityCap));
}

export function splitOverflowingSlides(
  markdown: string,
  settings: AchmageSettings,
  typo: TypographyConfig,
  renderOptions?: RenderOptions,
  // v5.5 Phase 4 — closed-loop feedback. Per-logical-slide px to subtract from
  // the frame budget. The auditor measures the real rendered overflow and feeds
  // a shrink back here so the next pass packs that slide more aggressively
  // (split functions produce smaller chunks). Keyed by logical-slide ORDER index
  // (0-based), matching the deck's `data-group`.
  budgetShrink?: Record<number, number>
): OverflowResult {
  const { frontmatter, body } = extractFrontmatter(markdown);
  if (isSemanticLayoutMarkdown(body)) {
    return buildSemanticOverflowResult(frontmatter, body);
  }
  const logicalSlides = splitByHeadings(body, settings.headingDivider);

  const availableHeight = computeFrameBudget(typo);

  const slideMap: SlideMapEntry[] = [];
  const physicalSlides: string[] = [];

  for (let logIdx = 0; logIdx < logicalSlides.length; logIdx++) {
    const logical = logicalSlides[logIdx];
    const logicalId = extractAsuLogical(logical.content) ?? logIdx;

    if (!settings.autoContinuedFrames) {
      // No splitting ??one frame per logical slide
      slideMap.push({
        logical: logicalId,
        frame: 0,
        totalFrames: 1,
        title: logical.title,
      });
      physicalSlides.push(logical.content);
      continue;
    }

    // V5 PR-B2b ??semantic frame marker bypass (Q-S conservative, invariant 13 lock).
    // If splitLayoutPlan already split this slide into frames, the logical content
    // carries `<!-- asu-frame: N/M -->`. Honor the SoT (frame split = splitLayoutPlan
    // single owner) by skipping measure-and-pack here. Beyond defense-in-depth this
    // also prevents frame ID drift when the semantic pipeline produces a single-frame
    // slide and packBlocksIntoFrames over-packs the inserted recap.
    const frameInfo = extractAsuFrameInfo(logical.content);
    if (frameInfo) {
      slideMap.push({
        logical: logicalId,
        frame: Math.max(0, frameInfo.frame - 1), // marker is 1-indexed; slideMap is 0-indexed
        totalFrames: frameInfo.total,
        title: logical.title,
      });
      physicalSlides.push(logical.content);
      continue;
    }

    // Parse content into typed blocks
    const blocks = parseContentBlocks(logical.content);

    const layoutKind = inferLayoutKind(logical.content);

    // Measure each block's height with Pretext
    const blockHeights = blocks.map((b) =>
      measureBlockHeight(b, typo, {
        layoutProfile: renderOptions?.layoutProfile,
        layoutKind,
        cardPolicy: renderOptions?.cardPolicy,
      })
    );

    // PR-B: derive a semantic weight per block so packing favours heavier
    // semantic units (tables/code) when the layout policy demands it. Empty
    // table ??weight 1 (no behaviour change).
    const blockWeights = blocks.map((b) =>
      semanticWeightFor(toBlockType(b.type), layoutKind)
    );

    // v5.5 Phase 4 — apply the closed-loop budget shrink for THIS logical slide
    // (keyed by order index, matching the deck's data-group). Floor keeps the
    // budget sane even after several shrink passes.
    const effAvailableHeight = Math.max(
      180,
      availableHeight - (budgetShrink?.[logIdx] ?? 0)
    );

    // Pack blocks into frames based on measured heights
    const frames = packBlocksIntoFrames(
      blocks,
      blockHeights,
      blockWeights,
      effAvailableHeight,
      logical.title,
      typo
    );

    for (let fIdx = 0; fIdx < frames.length; fIdx++) {
      slideMap.push({
        logical: logicalId,
        frame: fIdx,
        totalFrames: frames.length,
        title: logical.title,
        blocks: frames[fIdx].blocks,
        frameBlockIndex: frames[fIdx].frameBlockIndex,
      });
      physicalSlides.push(frames[fIdx].md);
    }
  }

  return {
    markdown: frontmatter + physicalSlides.join("\n\n---\n\n"),
    slideMap,
  };
}

/**
 * Pack content blocks into frames using measured heights.
 *
 * KEY RULES:
 * 1. Images/screenshots ALWAYS get their own dedicated frame
 * 2. Text blocks are packed greedily until available height is exceeded
 * 3. Continued frames get a repeated heading
 * 4. Code blocks that overflow a single frame are truncated to head + omitted
 *    notation + tail rather than split across multiple frames. PPT-style
 *    presentations almost never walk through every line of long code — the
 *    snippet form keeps the structural cue (first lines, last lines) while
 *    making the omitted middle explicit. (PR3 follow-up, 2026-05-19)
 *
 * PR2 (quirky-hopping-journal, 2026-05-17) — returns per-frame metadata alongside
 * markdown so slideRenderer can emit per-element CSS vars. blocks[] and
 * frameBlockIndex[] are parallel; frameBlockIndex resets at every frame boundary
 * (section-scope guarantee for `--heading-h2-0-fs` etc.).
 */
interface PackedFrame {
  md: string;
  blocks: ContentBlock[];
  frameBlockIndex: number[];
}

/**
 * PR3 follow-up (2026-05-19) — when a code block is taller than the frame
 * budget, replace its middle with an "<--- N lines omitted --->" comment
 * instead of letting it spill or splitting it across frames. The comment
 * marker uses the language's likely prefix (//, #, --, ;) detected from the
 * existing code; falls back to // which renders as text in any language
 * (highlight.js won't crash on an unknown comment for the wrong language).
 *
 * The math estimates how many lines fit in `availableHeight` after subtracting
 * chrome (padding 40px + border 2px + the omitted-line itself + margin), then
 * splits the kept lines roughly evenly between head and tail.
 *
 * The returned block carries the same `type` ("code") and `blockIndex` as
 * the original so per-element transfer in slideRenderer stays correctly
 * indexed.
 */
function truncateCodeForFrame(
  block: ContentBlock,
  availableHeight: number,
  typo: TypographyConfig
): ContentBlock {
  const lines = block.rawLines;
  const fenceStart = lines.findIndex((l) => /^\s*```/.test(l));
  let fenceEnd = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*```/.test(lines[i])) {
      fenceEnd = i;
      break;
    }
  }
  if (fenceStart < 0 || fenceEnd <= fenceStart) {
    // Not a fenced code structure we recognize — leave alone.
    return block;
  }

  const codeLines = lines.slice(fenceStart + 1, fenceEnd);
  if (codeLines.length === 0) return block;

  const lineHeight = typo.codeLineHeight;
  // Chrome budget: container padding ~40px + border 2px + margin ~16px +
  // the omitted-line marker itself (1 line). Reserve generously so the
  // truncated render stays under the frame ceiling even with mono-font
  // wrap factor variance.
  const chromeBudget = 80 + lineHeight;
  const usableHeight = Math.max(lineHeight * 4, availableHeight - chromeBudget);
  const geomMaxLines = Math.max(4, Math.floor(usableHeight / lineHeight));

  // v5.5 Phase 5 — snippet policy (invariant 11): a block with more than
  // CODE_SNIPPET_FULL_LINES (12) source lines collapses to 7 head + 4 tail.
  // This MUST be honored independently of the geometric fit because
  // measureBlockHeight already measured the *snippet* form (decideCodeMode),
  // not the full source. If we emitted the full source the packer's budget
  // would be wrong and the code would spill (the 28pt+ overflow this fixes).
  // We keep the TIGHTER of the snippet cap and the geometric fit so very
  // small frames (16pt + line-density cap) still fit.
  const isSnippet = codeLines.length > CODE_SNIPPET_FULL_LINES;
  const snippetKeep = CODE_SNIPPET_HEAD_LINES + CODE_SNIPPET_TAIL_LINES; // 11
  const maxVisibleLines = isSnippet
    ? Math.min(geomMaxLines, snippetKeep)
    : geomMaxLines;

  if (codeLines.length <= maxVisibleLines) {
    // Already fits — caller's overflow check was overly conservative or
    // the block is borderline. No truncation needed.
    return block;
  }

  // When the snippet cap governs, use the locked 7/4 head/tail shape so the
  // emitted form matches what measureBlockHeight assumed. Otherwise split the
  // geometric budget roughly evenly (head gets the ceiling — readers anchor
  // on opening lines).
  let headCount: number;
  let tailCount: number;
  if (isSnippet && maxVisibleLines === snippetKeep) {
    headCount = CODE_SNIPPET_HEAD_LINES;
    tailCount = CODE_SNIPPET_TAIL_LINES;
  } else {
    headCount = Math.ceil(maxVisibleLines / 2);
    tailCount = maxVisibleLines - headCount;
  }
  const omittedCount = codeLines.length - headCount - tailCount;

  const commentPrefix = detectCommentPrefix(codeLines);
  const omittedNotation = `${commentPrefix} ... <--- ${omittedCount} lines omitted ---> ...`;

  const newRawLines = [
    ...lines.slice(0, fenceStart + 1),
    ...codeLines.slice(0, headCount),
    omittedNotation,
    ...codeLines.slice(codeLines.length - tailCount),
    ...lines.slice(fenceEnd),
  ];

  return {
    ...block,
    rawLines: newRawLines,
  };
}

/**
 * Sniff a likely comment prefix from a few representative lines. Order
 * matters — checks for the most distinctive prefixes first. Returns "//"
 * as a sane default (works for JS/TS/Java/C/C++/Go/Rust/Swift/Kotlin).
 */
function detectCommentPrefix(codeLines: string[]): string {
  const sample = codeLines.slice(0, 50).join("\n");
  if (/^\s*(\/\/|\/\*)/m.test(sample)) return "//";
  if (/^\s*--/m.test(sample)) return "--"; // SQL / Haskell / Lua
  if (/^\s*#/m.test(sample)) return "#"; // Python / Bash / Ruby / YAML
  if (/^\s*;/m.test(sample)) return ";"; // Lisp / INI / Assembly
  if (/^\s*<!--/m.test(sample)) return "<!--";
  return "//";
}

/**
 * v5.5 Phase 5 — when a table is taller than a single frame, truncate its data
 * rows to a header + first N rows + a "… M more rows …" marker row + the last
 * row, rather than letting a 50-row table spill thousands of px off-canvas (the
 * pre-v5.5 behavior had no table truncation at all). Row height mirrors the
 * estimate in measureBlockHeight (table case) so the kept rows fit the budget.
 *
 * Preserves the block's `type` ("table") and `blockIndex` so per-element
 * transfer in slideRenderer stays correctly indexed.
 */
function truncateTableForFrame(
  block: ContentBlock,
  availableHeight: number,
  typo: TypographyConfig
): ContentBlock {
  // v6.0 Tier 2 — 표 카드는 html_block가 `<div class="asu-table-card">` + 빈 줄로 raw 마크다운
  // 표를 감싼 형태다. div/빈 줄까지 끼워 자르면 CommonMark type-6 구조가 깨져 Marp이 표를 raw
  // 텍스트로 렌더한다. 카드면 표 행(`|…`)만 추출해 자른 뒤 **같은 단일 카드로 다시 감싼다**(모든
  // 폰트/길이에서 동일한 카드 모양 유지). 남길 행 수는 셀 줄바꿈을 실측(measureTableCardRows)해
  // 정한다 — measureHtmlBlockHeight의 카드 높이와 동일 모델이라 측정-자름이 일관.
  const isTableCard = /class="[^"]*\basu-table-card\b/.test(block.rawLines.join(" "));
  const lines = isTableCard
    ? block.rawLines.filter((l) => /^\s*\|/.test(l))
    : block.rawLines.filter((l) => l.trim().length > 0);
  const sepIndex = lines.findIndex((l) => /^\|[\s\-:|]+\|$/.test(l.trim()));
  // Header = the row(s) up to and including the |---| separator. If there's no
  // separator we can't safely identify the header — leave the table alone.
  if (sepIndex < 1) return block;
  const headerLines = lines.slice(0, sepIndex + 1);
  const dataRows = lines.slice(sepIndex + 1);
  if (dataRows.length === 0) return block;

  if (isTableCard) {
    const cardFontSize = Math.round(typo.bodyFontSize * 0.72);
    const cardCols = Math.max(1, (lines[0].match(/\|/g) || []).length - 1);
    // 헤더 높이(구분선 제외) + data 행별 높이를 실측(measureHtmlBlockHeight와 같은 cardPadding 52).
    const headerH = measureTableCardRows(
      headerLines.filter((l) => !/^\|[\s\-:|]+\|$/.test(l.trim())),
      cardCols,
      cardFontSize,
      typo,
      52
    ).reduce((a, b) => a + b, 0);
    const dataH = measureTableCardRows(dataRows, cardCols, cardFontSize, typo, 52);
    const markerH = Math.round(cardFontSize * 1.55) + 14;
    const cardChrome = 52 + 14 + 6; // cardPadding + profilePadding + border (측정과 정렬)
    const budget = availableHeight - cardChrome - headerH;
    const lastH = dataH[dataH.length - 1];
    // 마커 + 마지막 행은 항상 유지, 첫 행들을 budget 안에서 최대한.
    let used = markerH + lastH;
    let keepFirst = 0;
    for (let k = 0; k < dataRows.length - 1; k++) {
      if (used + dataH[k] > budget) break;
      used += dataH[k];
      keepFirst++;
    }
    if (keepFirst >= dataRows.length - 1) return block; // 다 들어감 → 원본 카드 유지
    keepFirst = Math.max(1, keepFirst);
    const omittedCardRows = dataRows.length - keepFirst - 1;
    const cardMarkerCells = [
      `… ${omittedCardRows} more rows …`,
      ...new Array(Math.max(0, cardCols - 1)).fill(""),
    ];
    const cardTable = [
      ...headerLines,
      ...dataRows.slice(0, keepFirst),
      `| ${cardMarkerCells.join(" | ")} |`,
      dataRows[dataRows.length - 1],
    ];
    return {
      ...block,
      rawLines: [`<div class="asu-table-card">`, ``, ...cardTable, ``, `</div>`],
    };
  }

  // Mirror measureBlockHeight's table row-height estimate.
  const tableFontSize = Math.round(typo.bodyFontSize * 0.78);
  const firstRow = lines[0] || "";
  const colCount = Math.max(1, (firstRow.match(/\|/g) || []).length - 1);
  const baseRowHeight = Math.round(tableFontSize * 1.65) + 18;
  // v5.5 Phase 5 — the rendered cell padding + line-height grows faster than
  // the tableFontSize estimate at large base fonts, so inflate the row-height
  // budget by the font scale (no-op at/below the 28pt reference). Keeps the
  // truncated table inside the frame at 40pt (where the flat estimate left a
  // ~290px spill).
  const fontScale = Math.max(1, typo.bodyFontSize / REFERENCE_BODY_FONT);
  const rowHeight = Math.round(
    (colCount > 3 ? baseRowHeight + 8 : baseRowHeight) * fontScale
  );

  // chrome 30 (header extra) + 32 (margin) mirrors measureBlockHeight, plus one
  // extra row of slack so sub-pixel row-height drift at large fonts can't tip a
  // kept row over the frame edge (cleared the residual ~13px spill at 40pt).
  const chrome = 30 + 32 + rowHeight;
  const maxTotalRows = Math.max(
    3,
    Math.floor((availableHeight - chrome) / rowHeight)
  );
  const maxDataRows = Math.max(2, maxTotalRows - 1); // reserve one for header

  if (dataRows.length <= maxDataRows) return block;

  // Keep first (maxDataRows - 2) rows, then a marker, then the final row.
  const keepFirst = Math.max(1, maxDataRows - 2);
  const omitted = dataRows.length - keepFirst - 1; // minus the kept last row
  const markerCells = [
    `… ${omitted} more rows …`,
    ...new Array(Math.max(0, colCount - 1)).fill(""),
  ];
  const markerRow = `| ${markerCells.join(" | ")} |`;

  // bare 표(비-카드): 단일 행 모델로 자른다(카드는 위에서 셀 실측으로 처리하고 early-return).
  const truncatedTable = [
    ...headerLines,
    ...dataRows.slice(0, keepFirst),
    markerRow,
    dataRows[dataRows.length - 1],
  ];
  return { ...block, rawLines: truncatedTable };
}

const LIST_MARKER_RE = /^(\s*)([-*]|\d+[.)])\s/;

/** Group a run of list lines into items at the SHALLOWEST marker indent present. */
function groupListItems(lines: string[]): string[][] {
  const indents = lines
    .map((l) => l.match(LIST_MARKER_RE))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].length);
  if (indents.length === 0) return [lines];
  const minIndent = Math.min(...indents);
  const items: string[][] = [];
  for (const line of lines) {
    const m = line.match(LIST_MARKER_RE);
    const isTopMarker = m !== null && m[1].length === minIndent;
    if (isTopMarker || items.length === 0) items.push([line]);
    else items[items.length - 1].push(line);
  }
  return items;
}

function measureListLines(
  lines: string[],
  typo: TypographyConfig,
  blockIndex: number
): number {
  return measureBlockHeight({ type: "list", rawLines: lines, blockIndex }, typo, {});
}

/**
 * v5.5 Phase 4 — recursively pack list lines into groups each ≤ budget. Splits
 * at the shallowest item level first; if a SINGLE item (with its nested subtree)
 * still exceeds the budget, recurse INTO it — the parent marker rides with the
 * first sub-group and the deeper children flow into following groups. This is
 * what lets a 3-level-nested list at 40pt stop overflowing: top-level splitting
 * alone left one indivisible item taller than the frame.
 */
function packListLines(
  lines: string[],
  budget: number,
  typo: TypographyConfig,
  blockIndex: number
): string[][] {
  const items = groupListItems(lines);
  if (items.length <= 1) {
    const only = items[0] ?? lines;
    if (only.length > 1 && measureListLines(only, typo, blockIndex) > budget) {
      const [parent, ...rest] = only;
      const sub = packListLines(rest, budget, typo, blockIndex);
      if (sub.length > 1) {
        return sub.map((g, i) => (i === 0 ? [parent, ...g] : g));
      }
    }
    return [lines];
  }

  const out: string[][] = [];
  let cur: string[] = [];
  let curHeight = 0;
  for (const item of items) {
    const itemHeight = measureListLines(item, typo, blockIndex);
    if (itemHeight > budget && item.length > 1) {
      // A single item is taller than a whole frame — recurse into its subtree.
      if (cur.length > 0) {
        out.push(cur);
        cur = [];
        curHeight = 0;
      }
      const [parent, ...rest] = item;
      const sub = packListLines(rest, budget, typo, blockIndex);
      sub.forEach((g, i) => out.push(i === 0 ? [parent, ...g] : g));
      continue;
    }
    if (cur.length > 0 && curHeight + itemHeight > budget) {
      out.push(cur);
      cur = [];
      curHeight = 0;
    }
    cur.push(...item);
    curHeight += itemHeight;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/**
 * Split a list block taller than a frame into multiple list blocks (recursive,
 * nesting-aware). Each chunk fits a continued-frame budget; no content dropped.
 */
function splitListIntoChunks(
  block: ContentBlock,
  maxHeight: number,
  typo: TypographyConfig
): ContentBlock[] {
  const budget = Math.max(120, maxHeight - CONTINUED_HEADING_HEIGHT);
  const groups = packListLines(
    block.rawLines,
    budget,
    typo,
    block.blockIndex
  );
  if (groups.length <= 1) return [block];
  return groups.map((lines) => ({
    type: "list" as const,
    rawLines: lines,
    blockIndex: block.blockIndex,
  }));
}

/**
 * v5.5 Phase 4 — split a single paragraph taller than a frame at sentence
 * boundaries (latin .!? and CJK 。！？ / "…다."). Rare; mainly large-font dense
 * CJK clauses. No text dropped.
 */
function splitParagraphIntoChunks(
  block: ContentBlock,
  maxHeight: number,
  typo: TypographyConfig
): ContentBlock[] {
  const text = block.rawLines.join(" ").trim();
  const sentences = text
    .split(/(?<=[.!?。！？])\s+|(?<=다\.)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return [block];
  const budget = Math.max(120, maxHeight - CONTINUED_HEADING_HEIGHT);

  const chunks: ContentBlock[] = [];
  let curText = "";
  for (const sentence of sentences) {
    const tryText = curText ? `${curText} ${sentence}` : sentence;
    const h = measureBlockHeight(
      { type: "paragraph", rawLines: [tryText], blockIndex: block.blockIndex },
      typo,
      {}
    );
    if (curText && h > budget) {
      chunks.push({
        type: "paragraph",
        rawLines: [curText],
        blockIndex: block.blockIndex,
      });
      curText = sentence;
    } else {
      curText = tryText;
    }
  }
  if (curText) {
    chunks.push({
      type: "paragraph",
      rawLines: [curText],
      blockIndex: block.blockIndex,
    });
  }
  return chunks.length > 0 ? chunks : [block];
}

function packBlocksIntoFrames(
  blocks: ContentBlock[],
  heights: number[],
  weights: number[],
  availableHeight: number,
  title: string,
  typo: TypographyConfig
): PackedFrame[] {
  if (blocks.length === 0) return [{ md: "", blocks: [], frameBlockIndex: [] }];

  // v5.5 Phase 4/5 — pre-expand atomic blocks that can't fit one frame so the
  // greedy packer (and the fast path) can distribute them:
  //   • code      → snippet form (7 head + omit + 4 tail) the measurer assumed.
  //                 Without this the fast path emits the FULL source and spills
  //                 (the 28pt+ code overflow).
  //   • list      → split into per-(top-level-item) chunks each ≤ budget so a
  //                 long list flows across frames instead of overflowing as one
  //                 atomic block.
  //   • paragraph → split at sentence boundaries when a single paragraph alone
  //                 exceeds a frame (rare; large-font CJK clauses).
  // heights[]/weights[] are rebuilt in lock-step so indices stay aligned.
  {
    const exBlocks: ContentBlock[] = [];
    const exHeights: number[] = [];
    const exWeights: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const w = weights[i] ?? 1;
      if (b.type === "code") {
        const sourceLineCount = b.rawLines.filter(
          (l) => !/^\s*```/.test(l)
        ).length;
        exBlocks.push(
          sourceLineCount > CODE_SNIPPET_FULL_LINES
            ? truncateCodeForFrame(b, availableHeight, typo)
            : b
        );
        exHeights.push(heights[i]);
        exWeights.push(w);
        continue;
      }
      if (
        (b.type === "list" || b.type === "paragraph") &&
        heights[i] > availableHeight
      ) {
        const chunks =
          b.type === "list"
            ? splitListIntoChunks(b, availableHeight, typo)
            : splitParagraphIntoChunks(b, availableHeight, typo);
        if (chunks.length <= 1) {
          exBlocks.push(b);
          exHeights.push(heights[i]);
          exWeights.push(w);
          continue;
        }
        for (const c of chunks) {
          exBlocks.push(c);
          exHeights.push(measureBlockHeight(c, typo, {}));
          exWeights.push(w);
        }
        continue;
      }
      exBlocks.push(b);
      exHeights.push(heights[i]);
      exWeights.push(w);
    }
    blocks = exBlocks;
    heights = exHeights;
    weights = exWeights;
  }

  // Check if any images exist — if not and total fits, single frame
  const hasImages = blocks.some((b) => b.type === "image");
  const totalHeight = heights.reduce((sum, h, idx) => sum + h * (weights[idx] ?? 1), 0);

  if (totalHeight <= availableHeight && !hasImages) {
    const md = blocks.map((b) => b.rawLines.join("\n")).join("\n\n");
    return [
      {
        md,
        blocks: [...blocks],
        frameBlockIndex: blocks.map((_, i) => i),
      },
    ];
  }

  interface FrameBuilder {
    lines: string[];
    blocks: ContentBlock[];
    frameBlockIndex: number[];
  }
  const frames: FrameBuilder[] = [{ lines: [], blocks: [], frameBlockIndex: [] }];
  let currentHeight = 0;
  let frameIndex = 0;
  let frameAvailable = availableHeight;
  let counterInFrame = 0;

  const headingLevel =
    blocks[0]?.rawLines[0]?.match(/^(#{1,6})\s/)?.[1] || "##";
  const asuClasses = extractAsuClasses(blocks);
  const isNative1920V5Slide = asuClasses.length > 0;

  function startNewFrame(): void {
    frameIndex++;
    frames.push({ lines: [], blocks: [], frameBlockIndex: [] });
    currentHeight = 0;
    frameAvailable = availableHeight - CONTINUED_HEADING_HEIGHT;
    counterInFrame = 0;

    if (title) {
      if (isNative1920V5Slide) {
        frames[frameIndex].lines.push(`<!-- asu-title: ${escapeComment(title)} -->`);
        frames[frameIndex].lines.push(`<!-- _class: ${asuClasses.join(" ")} asu-continued -->`);
        frames[frameIndex].lines.push(`<div class="asu-kicker">${escapeHtml(title.toUpperCase())} CONT.</div>`);
      } else {
        frames[frameIndex].lines.push(`${headingLevel} ${title} *(cont.)*`);
      }
    }
  }

  function pushBlock(block: ContentBlock): void {
    frames[frameIndex].lines.push(...block.rawLines);
    frames[frameIndex].lines.push("");
    frames[frameIndex].blocks.push(block);
    frames[frameIndex].frameBlockIndex.push(counterInFrame++);
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockHeight = heights[i];
    const weight = weights[i] ?? 1;
    const effectiveBlockHeight = blockHeight * weight;

    // Skip zero-height blocks (still need blank line separator). Still push
    // into frame.blocks for Step 4 state-machine consumers; deriveBlockTypography
    // returns null for these types so emit will skip them.
    if (blockHeight === 0) {
      pushBlock(block);
      continue;
    }

    // PR3 follow-up (2026-05-19) — RULE 1.5: code blocks that overflow a
    // single frame get snippet-truncated rather than spilling or splitting
    // across frames. Apply before the image/table rule (RULE 1) so code
    // never falls through to the multi-frame greedy path. Use a full
    // `availableHeight` budget (fresh frame chrome) when measuring fit
    // because we'll start a new frame for the truncated block anyway.
    // v5.5 Phase 5 — trigger on snippet mode (line count > 12) too, not only
    // on measured overflow. measureBlockHeight already measured the snippet
    // form, so a >12-line block MUST be emitted as a snippet or the render
    // spills (the 28pt+ code overflow this fixes). truncateCodeForFrame is a
    // no-op when the block already fits.
    const codeLineCount =
      block.type === "code"
        ? block.rawLines.filter((l) => !/^\s*```/.test(l)).length
        : 0;
    const codeNeedsTruncation =
      block.type === "code" &&
      (codeLineCount > CODE_SNIPPET_FULL_LINES ||
        effectiveBlockHeight > availableHeight);
    if (codeNeedsTruncation) {
      if (frames[frameIndex].lines.length > 0 && currentHeight > 0) {
        startNewFrame();
      }
      const truncated = truncateCodeForFrame(block, availableHeight, typo);
      pushBlock(truncated);
      // Mark the frame as effectively full so subsequent blocks go to the
      // next frame. The exact post-truncation height isn't critical here —
      // we just don't want anything else packed alongside.
      currentHeight = availableHeight;
      if (i < blocks.length - 1) {
        startNewFrame();
      }
      continue;
    }

    // RULE 1: Images ALWAYS get their own frame.
    // Large tables (>50% of frame) also get their own frame.
    const isLargeTable =
      (block.type === "table" || hasClass(block, "asu-table-card")) &&
      blockHeight > availableHeight * 0.5;
    const isImage = block.type === "image" || hasClass(block, "asu-image-card");
    if (isImage || isLargeTable) {
      // 현재 프레임에 heading 외 "본문" 콘텐츠가 있을 때만 닫고 이미지/큰표 전용 프레임을
      // 연다. heading만 있거나(또는 비어 있으면) 이미지를 그 프레임에 함께 둔다 →
      // heading-only 빈 슬라이드 방지(heading + 이미지 = 한 슬라이드). 과거엔 heading이
      // currentHeight>0을 만들어 무조건 새 프레임을 열어 빈 제목 슬라이드가 남았다.
      const frameHasBodyContent = frames[frameIndex].blocks.some(
        (b) =>
          b.type !== "heading1" &&
          b.type !== "heading2" &&
          b.type !== "heading3" &&
          b.type !== "empty"
      );
      if (frameHasBodyContent) {
        startNewFrame();
      }

      // v5.5 Phase 5 — a table taller than a whole frame is row-truncated so
      // it can't spill thousands of px (pre-v5.5 gave it an own frame but never
      // shrank it). Images keep their own-frame behavior (CSS max-height clamps
      // them). The truncated/own block takes the entire frame to itself.
      let ownBlock = block;
      if (
        (block.type === "table" || hasClass(block, "asu-table-card")) &&
        blockHeight > availableHeight
      ) {
        ownBlock = truncateTableForFrame(block, availableHeight, typo);
      }
      pushBlock(ownBlock);

      // If there are more blocks after this image, start a new frame for them
      if (i < blocks.length - 1) {
        startNewFrame();
      }
      continue;
    }

    // RULE 2: Would this block overflow the current frame? Use the
    // semantic-weight-adjusted height so heavy blocks (per splitPolicy) get
    // a bias toward their own frame.
    if (
      currentHeight + effectiveBlockHeight > frameAvailable &&
      frames[frameIndex].lines.length > 0 &&
      currentHeight > 0
    ) {
      startNewFrame();
    }

    pushBlock(block);
    currentHeight += effectiveBlockHeight;
  }

  return frames
    .map((f) => ({
      md: f.lines.join("\n").trim(),
      blocks: f.blocks,
      frameBlockIndex: f.frameBlockIndex,
    }))
    .filter((f) => f.md.length > 0);
}

// ---------------------------------------------------------------------------
// Helpers (unchanged from before)
// ---------------------------------------------------------------------------

export interface LogicalSlide {
  title: string;
  content: string;
}

// v6.0 (Tier 2) — exported so shapeTemplates can split into the SAME logical
// units the overflow splitter uses, keeping signature computation and the
// downstream greedy packer in lockstep.
export function extractFrontmatter(markdown: string): {
  frontmatter: string;
  body: string;
} {
  const match = markdown.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
  if (match) {
    return { frontmatter: match[0], body: markdown.slice(match[0].length) };
  }
  return { frontmatter: "", body: markdown };
}

export function splitByHeadings(
  body: string,
  headingDivider: number[]
): LogicalSlide[] {
  if (headingDivider.length === 0) {
    return splitByManualBreaks(body);
  }

  const lines = body.split("\n");
  const slides: LogicalSlide[] = [];
  let currentLines: string[] = [];
  let currentTitle = "";
  let inCodeBlock = false;
  let protectedDepth = 0;

  const headingPattern = new RegExp(
    `^(${headingDivider.map((l) => "#".repeat(l)).join("|")})\\s+(.+)$`
  );

  for (const line of lines) {
    const trimmed = line.trim();
    if (isFenceToggleLine(line)) {
      inCodeBlock = !inCodeBlock;
      currentLines.push(line);
      continue;
    }
    if (inCodeBlock) {
      currentLines.push(line);
      continue;
    }
    const nextProtectedDepth = updateProtectedHtmlDepth(protectedDepth, line);
    if (protectedDepth > 0 || nextProtectedDepth > 0) {
      currentLines.push(line);
      protectedDepth = nextProtectedDepth;
      continue;
    }
    protectedDepth = nextProtectedDepth;
    if (/^---\s*$/.test(trimmed)) {
      if (currentLines.length > 0 || currentTitle) {
        const content = currentLines.join("\n").trim();
        slides.push({ title: currentTitle || extractAsuTitle(content), content });
      }
      currentLines = [];
      currentTitle = "";
      continue;
    }
    const m = trimmed.match(headingPattern);
    if (m) {
      if (currentLines.length > 0 || currentTitle) {
        const content = currentLines.join("\n").trim();
        slides.push({ title: currentTitle || extractAsuTitle(content), content });
      }
      currentTitle = m[2].trim();
      currentLines = [line];
      continue;
    }
    currentLines.push(line);
  }
  if (currentLines.length > 0 || currentTitle) {
    const content = currentLines.join("\n").trim();
    slides.push({ title: currentTitle || extractAsuTitle(content), content });
  }
  return slides;
}

function splitByManualBreaks(body: string): LogicalSlide[] {
  const slides: LogicalSlide[] = [];
  let current = "";
  let inCodeBlock = false;
  let protectedDepth = 0;

  for (const line of body.split("\n")) {
    if (isFenceToggleLine(line)) {
      inCodeBlock = !inCodeBlock;
      current += line + "\n";
      continue;
    }
    if (inCodeBlock) {
      current += line + "\n";
      continue;
    }
    const nextProtectedDepth = updateProtectedHtmlDepth(protectedDepth, line);
    const isProtectedHtml = protectedDepth > 0 || nextProtectedDepth > 0;
    if (!isProtectedHtml && /^---\s*$/.test(line.trim())) {
      if (current.trim()) {
        const title =
          extractAsuTitle(current) ||
          current.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() ||
          "";
        slides.push({ title, content: current.trim() });
      }
      current = "";
    } else {
      current += line + "\n";
    }
    protectedDepth = nextProtectedDepth;
  }
  if (current.trim()) {
    const title =
      extractAsuTitle(current) ||
      current.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() ||
      "";
    slides.push({ title, content: current.trim() });
  }
  return slides;
}

function isSemanticLayoutMarkdown(body: string): boolean {
  return (
    /<div\b[^>]*\basu-content\b/i.test(body) ||
    /<!--\s*asu-frame:/i.test(body) ||
    /\bdata-achmage-layout-object-id=/i.test(body) ||
    /\bdata-achmage-source-node-id=/i.test(body)
  );
}

function buildSemanticOverflowResult(frontmatter: string, body: string): OverflowResult {
  const physicalSlides = splitSemanticHtmlSlides(body);
  const tempMap: SlideMapEntry[] = physicalSlides.map((content, index) => {
    const frameInfo = extractAsuFrameInfo(content);
    return {
      logical: extractAsuLogical(content) ?? index,
      frame: frameInfo ? Math.max(0, frameInfo.frame - 1) : 0,
      totalFrames: frameInfo?.total ?? 1,
      title:
        extractAsuTitle(content) ||
        content.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() ||
        "",
    };
  });

  const nextFrameByLogical = new Map<number, number>();
  const countByLogical = new Map<number, number>();
  for (const entry of tempMap) {
    countByLogical.set(entry.logical, (countByLogical.get(entry.logical) ?? 0) + 1);
    if (entry.frame > 0) {
      nextFrameByLogical.set(entry.logical, Math.max(nextFrameByLogical.get(entry.logical) ?? 0, entry.frame + 1));
      continue;
    }
    const next = nextFrameByLogical.get(entry.logical) ?? 0;
    entry.frame = next;
    nextFrameByLogical.set(entry.logical, next + 1);
  }

  const declaredTotalByLogical = new Map<number, number>();
  for (const entry of tempMap) {
    declaredTotalByLogical.set(
      entry.logical,
      Math.max(declaredTotalByLogical.get(entry.logical) ?? 0, entry.totalFrames)
    );
  }

  const slideMap = tempMap.map((entry) => ({
    ...entry,
    totalFrames: Math.max(
      countByLogical.get(entry.logical) ?? 1,
      declaredTotalByLogical.get(entry.logical) ?? 1
    ),
  }));

  return {
    markdown: frontmatter + physicalSlides.join("\n\n---\n\n"),
    slideMap,
  };
}

function splitSemanticHtmlSlides(body: string): string[] {
  const slides: string[] = [];
  let current: string[] = [];
  let protectedDepth = 0;

  for (const line of body.split("\n")) {
    const nextProtectedDepth = updateProtectedHtmlDepth(protectedDepth, line);
    if (protectedDepth === 0 && nextProtectedDepth === 0 && /^---\s*$/.test(line.trim())) {
      const content = current.join("\n").trim();
      if (content) slides.push(content);
      current = [];
      protectedDepth = 0;
      continue;
    }
    current.push(line);
    protectedDepth = nextProtectedDepth;
  }

  const content = current.join("\n").trim();
  if (content) slides.push(content);
  return slides;
}

function isFenceToggleLine(line: string): boolean {
  const normalized = line.trim().replace(/^(?:>\s*)+/, "");
  return /^(```|~~~)/.test(normalized);
}

const PROTECTED_HTML_TAGS = ["pre", "code", "script", "style", "table", "figure", "aside"] as const;

function updateProtectedHtmlDepth(depth: number, line: string): number {
  let next = depth;
  for (const tag of PROTECTED_HTML_TAGS) {
    const open = new RegExp(`<${tag}\\b(?![^>]*\\/)`, "gi");
    const close = new RegExp(`</${tag}>`, "gi");
    next += countMatches(line, open);
    next -= countMatches(line, close);
  }
  return Math.max(0, next);
}

function inferLayoutKind(content: string): string | undefined {
  return content.match(/asu-layout-([A-Za-z0-9-]+)/)?.[1];
}

function semanticWeightFor(
  blockType: BlockType | undefined,
  layoutKindKebab: string | undefined
): number {
  if (!blockType) return 1;
  const camel = layoutKindKebab
    ? (layoutKindKebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as InternalLayoutKind)
    : undefined;
  const policy = camel ? SPLIT_POLICY[camel] : undefined;
  return policy?.semanticWeight[blockType] ?? 1;
}

function toBlockType(t: ContentBlock["type"]): BlockType | undefined {
  switch (t) {
    case "heading1":
    case "heading2":
    case "heading3":
      return "heading";
    case "paragraph":
    case "list":
    case "code":
    case "image":
    case "table":
    case "blockquote":
    case "math":
      return t;
    default:
      return undefined;
  }
}

function extractAsuTitle(content: string): string {
  return content.match(/<!--\s*asu-title:\s*([\s\S]*?)\s*-->/)?.[1]?.trim() ?? "";
}

function extractAsuLogical(content: string): number | undefined {
  const value = content.match(/<!--\s*asu-logical:\s*(\d+)\s*-->/)?.[1];
  return value === undefined ? undefined : Number(value);
}

// V5 PR-B2b ??extract `<!-- asu-frame: N/M -->` marker emitted by renderingFrames.
// Strict regex: integer/integer only; rejects floats, negatives, missing parts.
// Used by splitOverflowingSlides to honor invariant 13 (frame split SoT = splitLayoutPlan).
function extractAsuFrameInfo(content: string): { frame: number; total: number } | null {
  const m = content.match(/<!--\s*asu-frame:\s*(\d+)\/(\d+)\s*-->/);
  if (!m) return null;
  const frame = parseInt(m[1], 10);
  const total = parseInt(m[2], 10);
  if (!Number.isFinite(frame) || !Number.isFinite(total) || total < 1 || frame < 1) return null;
  return { frame, total };
}

function extractAsuClasses(blocks: ContentBlock[]): string[] {
  const text = blocks.flatMap((block) => block.rawLines).join("\n");
  const classes = text.match(/<!--\s*_class:\s*([\s\S]*?)\s*-->/)?.[1]?.trim();
  return classes ? classes.split(/\s+/).filter(Boolean) : [];
}

function hasClass(block: ContentBlock, className: string): boolean {
  return block.rawLines.join("\n").includes(className);
}

function escapeComment(value: string): string {
  return value.replace(/-->/g, "--&gt;");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}
