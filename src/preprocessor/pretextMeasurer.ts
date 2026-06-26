/**
 * Pretext-based content height measurer.
 *
 * Uses the local vendored Pretext runtime for accurate text measurement via canvas,
 * plus heuristics for non-text content (images, code, tables).
 *
 * Pretext works in browser/Electron contexts (needs canvas API).
 */

import {
  isPretextMeasurementUnavailable,
  semanticPretextEngine,
} from "../measurement/PretextMeasurementEngine";
import { deriveCodeMetrics } from "../measurement/codeMetrics";
import {
  CODE_SNIPPET_HEAD_LINES,
  CODE_SNIPPET_TAIL_LINES,
  decideCodeMode,
} from "../semantic/codeBlockPolicy";
import { NATIVE_1920_V5_CONTENT_FRAME } from "../layout/native1920V5Canvas";
import { FONT_BODY_STACK } from "../themes/fontFace";

/** Typography configuration matching marp's default theme */
export interface TypographyConfig {
  /** Body font (e.g. "'Segoe UI', sans-serif") */
  bodyFont: string;
  /** Body font size in px */
  bodyFontSize: number;
  /** Body line height in px */
  bodyLineHeight: number;
  /** Heading font */
  headingFont: string;
  /** H1 font size in px */
  h1FontSize: number;
  /** H2 font size in px */
  h2FontSize: number;
  /** H3 font size in px */
  h3FontSize: number;
  /** Code font size in px */
  codeFontSize: number;
  /** Code line height in px */
  codeLineHeight: number;
  /** Available width for content in px (slide width - padding) */
  contentWidth: number;
  /**
   * Typographic scale ratio (h3=base*r, h2=base*r^2, h1=base*r^3). Tier 2 폰트
   * 캐스케이드가 `buildTypographyConfig(base-Δ, scaleRatio)`로 정확히 재호출하기 위한
   * 단일소스(ratio 역산은 h3 clamp(max 34)로 부정확 → 금지).
   */
  scaleRatio: number;
}

/**
 * Default font family stack used across all native 1920 v5 themes.
 * Imported from the shared single source (themes/fontFace) so the measured
 * advance keys on the same byte-identical stack the render uses — pinned now
 * that Pretendard ships bundled (themes/fontFace FONT_FACE_CSS).
 */
const DEFAULT_FONT_FAMILY = FONT_BODY_STACK;

export const DEFAULT_TYPOGRAPHY: TypographyConfig = {
  bodyFont: `28px ${DEFAULT_FONT_FAMILY}`,
  bodyFontSize: 28,
  bodyLineHeight: 46, // 28 * 1.65 (matches theme line-height: 1.65)
  headingFont: `700 28px ${DEFAULT_FONT_FAMILY}`,
  h1FontSize: 48, // 28 * 1.2^3
  h2FontSize: 40, // 28 * 1.2^2
  h3FontSize: 34, // 28 * 1.2^1
  codeFontSize: 24, // 28 * 0.85
  codeLineHeight: 38, // 24 * 1.6 (matches theme pre code line-height: 1.6)
  contentWidth: NATIVE_1920_V5_CONTENT_FRAME.width,
  scaleRatio: 1.2, // 28 * 1.2^n 기본값 (minorThird)
};

/**
 * Build a TypographyConfig dynamically from base font size and scale ratio.
 * Heading sizes follow a geometric progression: h3 = base*r, h2 = base*r^2, h1 = base*r^3
 */
export function buildTypographyConfig(
  baseFontSize: number,
  scaleRatio: number,
  _padding: number = NATIVE_1920_V5_CONTENT_FRAME.x
): TypographyConfig {
  const h3Size = clamp(Math.round(baseFontSize * scaleRatio), 16, 34);
  const h2Size = clamp(Math.round(baseFontSize * Math.pow(scaleRatio, 2)), 16, 40);
  const h1Size = clamp(Math.round(baseFontSize * Math.pow(scaleRatio, 3)), 16, 40);
  // V5 PR-A2: codeFontSize/codeLineHeight come from the single-source
  // deriveCodeMetrics. The PR-D2 cap (28pt ??24px) lives there now and is
  // shared with typography.ts so measurement and render agree (locked
  // decision #2, invariant 14). The PR-D2 rationale for the cap (40pt body
  // forces mid-identifier wrap that deriveCodeSnippetPlan can't see)
  // remains the locked behavior; only its location moved.
  const codeMetrics = deriveCodeMetrics(baseFontSize, scaleRatio);
  const lineHeight = Math.round(baseFontSize * 1.65);
  const contentWidth = NATIVE_1920_V5_CONTENT_FRAME.width;

  return {
    bodyFont: `${baseFontSize}px ${DEFAULT_FONT_FAMILY}`,
    bodyFontSize: baseFontSize,
    bodyLineHeight: lineHeight,
    headingFont: `700 ${baseFontSize}px ${DEFAULT_FONT_FAMILY}`,
    h1FontSize: h1Size,
    h2FontSize: h2Size,
    h3FontSize: h3Size,
    codeFontSize: codeMetrics.codeFontSize,
    codeLineHeight: codeMetrics.codeLineHeight,
    contentWidth: contentWidth,
    scaleRatio: scaleRatio,
  };
}

/**
 * A parsed markdown block with its type and raw text.
 */
export interface ContentBlock {
  type:
    | "heading1"
    | "heading2"
    | "heading3"
    | "paragraph"
    | "list"
    | "code"
    | "image"
    | "table"
    | "blockquote"
    | "empty"
    | "html_comment"
    | "html_style"
    | "html_block"
    | "math";
  rawLines: string[];
  // PR2 (quirky-hopping-journal, 2026-05-17) — parse-time 0-based index within
  // parseContentBlocks output. Carries identity from measurement to per-element
  // CSS var emit. packBlocksIntoFrames emits a parallel `frameBlockIndex` array
  // that resets per physical frame for section-scoped var naming.
  blockIndex: number;
}

/**
 * Parse markdown into typed content blocks for measurement.
 */
export function parseContentBlocks(markdown: string): ContentBlock[] {
  const lines = markdown.split("\n");
  const blocks: ContentBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line
    if (trimmed === "") {
      i++;
      continue;
    }

    // HTML style block (injected typography ??zero height in measurement)
    if (trimmed.startsWith("<style")) {
      const styleLines = [line];
      if (!trimmed.includes("</style>")) {
        i++;
        while (i < lines.length && !lines[i].includes("</style>")) {
          styleLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          styleLines.push(lines[i]);
        }
      }
      i++;
      blocks.push({ type: "html_style", rawLines: styleLines, blockIndex: blocks.length });
      continue;
    }

    // HTML comment
    if (trimmed.startsWith("<!--")) {
      const commentLines = [line];
      while (i < lines.length && !lines[i].includes("-->")) {
        i++;
        if (i < lines.length) commentLines.push(lines[i]);
      }
      i++;
      blocks.push({ type: "html_comment", rawLines: commentLines, blockIndex: blocks.length });
      continue;
    }

    // native 1920 v5 semantic wrapper block. Keep complete HTML fragments together so
    // overflow splitting does not tear a card/table/code panel in half.
    if (startsHtmlBlock(trimmed)) {
      const htmlLines = [line];
      let depth = htmlDepthDelta(line);
      i++;
      while (i < lines.length && depth > 0) {
        htmlLines.push(lines[i]);
        depth += htmlDepthDelta(lines[i]);
        i++;
      }
      blocks.push({ type: "html_block", rawLines: htmlLines, blockIndex: blocks.length });
      continue;
    }

    // Headings
    if (/^#\s+/.test(trimmed)) {
      blocks.push({ type: "heading1", rawLines: [line], blockIndex: blocks.length });
      i++;
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      blocks.push({ type: "heading2", rawLines: [line], blockIndex: blocks.length });
      i++;
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      blocks.push({ type: "heading3", rawLines: [line], blockIndex: blocks.length });
      i++;
      continue;
    }

    // Code block
    if (trimmed.startsWith("```")) {
      const codeLines = [line];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", rawLines: codeLines, blockIndex: blocks.length });
      continue;
    }

    // Math block
    if (trimmed.startsWith("$$")) {
      const mathLines = [line];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("$$")) {
        mathLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        mathLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "math", rawLines: mathLines, blockIndex: blocks.length });
      continue;
    }

    // Image
    if (trimmed.startsWith("![")) {
      blocks.push({ type: "image", rawLines: [line], blockIndex: blocks.length });
      i++;
      continue;
    }

    // Table (starts with |)
    if (trimmed.startsWith("|")) {
      const tableLines = [line];
      i++;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "table", rawLines: tableLines, blockIndex: blocks.length });
      continue;
    }

    // Blockquote (only lines starting with ">")
    if (trimmed.startsWith(">")) {
      const quoteLines = [line];
      i++;
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "blockquote", rawLines: quoteLines, blockIndex: blocks.length });
      continue;
    }

    // List (- or * or 1.)
    if (/^[-*]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) {
      const listLines = [line];
      i++;
      while (i < lines.length) {
        const lt = lines[i].trim();
        if (lt === "") break;
        // Continuation: indented, or new list item
        if (
          /^[-*]\s/.test(lt) ||
          /^\d+[.)]\s/.test(lt) ||
          lines[i].startsWith("  ") ||
          lines[i].startsWith("\t")
        ) {
          listLines.push(lines[i]);
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "list", rawLines: listLines, blockIndex: blocks.length });
      continue;
    }

    // Paragraph (default)
    const paraLines = [line];
    i++;
    while (i < lines.length) {
      const pt = lines[i].trim();
      if (
        pt === "" ||
        pt.startsWith("#") ||
        pt.startsWith("```") ||
        pt.startsWith("$$") ||
        pt.startsWith("![") ||
        pt.startsWith("|") ||
        pt.startsWith(">") ||
        /^[-*]\s/.test(pt) ||
        /^\d+[.)]\s/.test(pt) ||
        pt.startsWith("<!--")
        || startsHtmlBlock(pt)
      ) {
        break;
      }
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", rawLines: paraLines, blockIndex: blocks.length });
  }

  return blocks;
}

/**
 * Measure the height of a content block using Pretext (for text)
 * or heuristics (for images, code, tables).
 */
export function measureBlockHeight(
  block: ContentBlock,
  typo: TypographyConfig,
  context: { layoutProfile?: string; layoutKind?: string; cardPolicy?: string } = {}
): number {
  switch (block.type) {
    case "html_comment":
    case "html_style":
    case "empty":
      return 0;

    case "html_block":
      return measureHtmlBlockHeight(block.rawLines.join("\n"), typo, context);

    case "heading1": {
      const text = block.rawLines[0].replace(/^#\s+/, "").trim();
      return measureTextHeight(text, `700 ${typo.h1FontSize}px ${extractFontFamily(typo.bodyFont)}`, typo.contentWidth, typo.h1FontSize * 1.3) + Math.round(typo.h1FontSize * 0.3);
    }

    case "heading2": {
      const text = block.rawLines[0].replace(/^##\s+/, "").trim();
      return measureTextHeight(text, `700 ${typo.h2FontSize}px ${extractFontFamily(typo.bodyFont)}`, typo.contentWidth, typo.h2FontSize * 1.3) + Math.round(typo.h2FontSize * 0.25);
    }

    case "heading3": {
      const text = block.rawLines[0].replace(/^###\s+/, "").trim();
      return measureTextHeight(text, `700 ${typo.h3FontSize}px ${extractFontFamily(typo.bodyFont)}`, typo.contentWidth, typo.h3FontSize * 1.3) + Math.round(typo.h3FontSize * 0.2);
    }

    case "paragraph": {
      const text = block.rawLines.join(" ").trim();
      return measureTextHeight(text, typo.bodyFont, typo.contentWidth, typo.bodyLineHeight) + Math.round(typo.bodyFontSize * 0.5);
    }

    case "list": {
      let totalHeight = 0;
      for (const line of block.rawLines) {
        const text = line.replace(/^\s*[-*]\s+/, "").replace(/^\s*\d+[.)]\s+/, "").trim();
        // List items have indent, reduce available width
        const itemHeight = measureTextHeight(
          text,
          typo.bodyFont,
          typo.contentWidth - 40, // indent
          typo.bodyLineHeight
        );
        totalHeight += itemHeight + Math.round(typo.bodyFontSize * 0.35); // li margin-bottom: 0.35em
      }
      return totalHeight + 8;
    }

    case "code": {
      // Code blocks: count lines (exclude ``` markers)
      const codeLines = block.rawLines.filter(
        (l) => !l.trim().startsWith("```")
      );
      // M3-A: at large body fonts the narrow codeSplit right slot wraps each
      // source line into multiple visual lines, but the raw line count missed
      // it ??overflowSplitter underestimated height ??frames did not split ??      // vertical spill (BLUEPRINT §10 carry-over B). Gate on bodyFontSize > 28
      // so 28pt default fixtures stay byte-equal; large fonts get the inflated
      // (correct) height.
      const wrapFactor = estimateCodeWrapFactor(codeLines, typo, context);
      // V5 PR-A2b D1: respect codeBlockPolicy. If snippet mode, measure the
      // visible window (head + omission line + tail) instead of full source
      // ??aligns legacy/raw measurement fallback with the native 1920 v5 semantic path's
      // snippet truncation (invariant 14 ??render-truth honesty).
      const mode = decideCodeMode({ lineCount: codeLines.length });
      const visibleLines =
        mode === "snippet"
          ? Math.min(
              codeLines.length,
              CODE_SNIPPET_HEAD_LINES + CODE_SNIPPET_TAIL_LINES + 1
            )
          : codeLines.length;
      const codeHeight = visibleLines * wrapFactor * typo.codeLineHeight;
      return codeHeight + 42 + 16; // pre code padding 20px*2 + border 2px + margin
    }

    case "image": {
      // Images: significant vertical space
      // Marp scales images to fit, but they typically take 40-60% of viewport.
      return estimateImageHeight(typo.contentWidth, estimateImageAspect(block.rawLines.join(" ")));
    }

    case "table": {
      // Count actual data rows (exclude separator row like |---|---|)
      const dataRows = block.rawLines.filter(
        (l) => !l.trim().match(/^\|[\s-:|]+\|$/)
      );
      // Also estimate column count for width pressure
      const firstRow = block.rawLines[0] || "";
      const colCount = (firstRow.match(/\|/g) || []).length - 1;
      // More columns or more rows = taller because cells wrap text
      const tableFontSize = Math.round(typo.bodyFontSize * 0.78); // table { font-size: 0.78em }
      const baseRowHeight = Math.round(tableFontSize * 1.65) + 18; // line-height + cell padding
      const rowHeight = colCount > 3 ? baseRowHeight + 8 : baseRowHeight;
      return dataRows.length * rowHeight + 30 + 32; // header extra + margin 16px*2
    }

    case "blockquote": {
      // PR1 (majestic-eagle, 2026-05-15): per-line measurement. The previous
      // single-line `.join(" ")` under-measured callouts converted from
      // Obsidian's `> [!NOTE]` syntax, which contain headings, code blocks,
      // and lists that render across many visual lines. obsidianCompat strips
      // the `[!NOTE]` syntax to `> **Note: Title**` but keeps the inner block
      // structure (which `parseContentBlocks` collapses into one blockquote).
      // The single-line join then under-budgeted the frame and pack overflowed.
      // We now measure each non-empty raw line independently and floor on
      // line-count * lineHeight so multi-block callouts always get enough room.
      const lines = block.rawLines.map((l) => l.replace(/^>\s*/, ""));
      const innerWidth = Math.max(80, typo.contentWidth - 80);
      let textHeight = 0;
      let renderableLineCount = 0;
      for (const raw of lines) {
        const trimmed = raw.trim();
        if (trimmed.length === 0) continue;
        renderableLineCount++;
        const isCodeFence = trimmed.startsWith("```");
        if (isCodeFence) {
          // Fence markers themselves render as a thin band; the code inside is
          // already counted as plain text below since the fences are kept in
          // the raw lines slice. We still add one line of height for symmetry.
          textHeight += typo.codeLineHeight;
          continue;
        }
        textHeight += measureTextHeight(
          trimmed,
          typo.bodyFont,
          innerWidth,
          typo.bodyLineHeight
        );
      }
      const floor = renderableLineCount * typo.bodyLineHeight;
      // Chrome: 1.35rem top + 1.35rem bottom (=~ 43px each at 28pt body) +
      // margin 0.85rem*2 (~ 28px). Total ~ 114px. Matches themeRegistry's
      // strengthened blockquote padding/margin from the same PR.
      const chrome = 114;
      return Math.max(textHeight, floor) + chrome;
    }

    case "math": {
      const mathLines = block.rawLines.filter(
        (l) => !l.trim().startsWith("$$")
      );
      return Math.max(60, mathLines.length * 40) + 24;
    }

    default:
      return typo.bodyLineHeight;
  }
}

/**
 * tier2 표 카드의 각 data 행 렌더 높이(셀 줄바꿈 반영)를 추정해 배열로 반환한다. 카드 안 표는
 * table-layout:auto로 100% 폭을 채우므로 칼럼폭 ≈ (콘텐츠폭 − 카드 패딩)/칼럼수로 잡고, 셀
 * 텍스트를 measureTextHeight로 실측해 행마다 가장 높은 셀 높이를 쓴다(한글 keep-all 줄바꿈
 * 포함). measureHtmlBlockHeight(카드 높이)와 truncateTableForFrame(자를 행 수)가 공유 →
 * 측정과 자름이 일관. `**bold**`/`code` 마커는 렌더 시 사라지므로 글자수에서 제외(과대추정 방지).
 */
export function measureTableCardRows(
  rawRows: string[],
  colCount: number,
  tableFontSize: number,
  typo: TypographyConfig,
  cardPadding: number
): number[] {
  const tableFont = `${tableFontSize}px ${extractFontFamily(typo.bodyFont)}`;
  const lineH = Math.round(tableFontSize * 1.55);
  const cellPadV = 14; // th/td 상하 패딩 합 근사
  const colW = Math.max(
    80,
    Math.round((typo.contentWidth - 2 * cardPadding) / Math.max(1, colCount)) - 16
  );
  return rawRows.map((r) => {
    const cells = r
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim().replace(/\*\*?|`/g, ""));
    let rowH = lineH;
    for (const c of cells) {
      rowH = Math.max(rowH, measureTextHeight(c, tableFont, colW, lineH));
    }
    return rowH + cellPadV;
  });
}

function measureHtmlBlockHeight(
  html: string,
  typo: TypographyConfig,
  context: { layoutProfile?: string; layoutKind?: string; cardPolicy?: string }
): number {
  const text = stripHtml(html).trim();
  const cardPadding = context.cardPolicy === "none" ? 0 : 52;
  const profilePadding = context.layoutProfile === "cmds-core" ? 6 : 14;

  if (/class="[^"]*\basu-meta\b/.test(html)) return 0;
  if (/class="[^"]*\basu-kicker\b/.test(html)) return 30;
  if (/class="[^"]*\basu-ambient-title\b/.test(html)) return 0;

  if (/class="[^"]*\basu-code-card\b/.test(html) || /<pre\b/.test(html)) {
    const code = (html.match(/<code[^>]*>([\s\S]*?)<\/code>/)?.[1] ?? "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    const codeLines = code.split("\n");
    const lineCount = Math.max(1, codeLines.length);
    // M3-A: same wrap-aware inflation as the markdown code path (gated on
    // bodyFontSize > 28 to keep 28pt default fixtures byte-equal).
    const wrapFactor = estimateCodeWrapFactor(codeLines, typo, context);
    // V5 PR-A2b D1: same snippet-aware visible-line window as the markdown
    // path. native 1920 v5 semantic path has already truncated by the time HTML reaches
    // here so lineCount ??12 ??mode "full" ??no change. The branch matters
    // only for legacy/raw HTML containing untruncated long code.
    const mode = decideCodeMode({ lineCount });
    const visibleLines =
      mode === "snippet"
        ? Math.min(lineCount, CODE_SNIPPET_HEAD_LINES + CODE_SNIPPET_TAIL_LINES + 1)
        : lineCount;
    return visibleLines * wrapFactor * typo.codeLineHeight + cardPadding + 42 + profilePadding;
  }

  if (/class="[^"]*\basu-table-card\b/.test(html) || /<table\b/.test(html)) {
    const trCount = (html.match(/<tr\b/g) ?? []).length;
    const tableFontSize = Math.round(typo.bodyFontSize * 0.72);
    if (trCount > 0) {
      // 렌더된 HTML 표(semantic path): 행 수 기반 기존 모델 유지(byte-identical).
      const colCount = Math.max(1, (html.match(/<th\b/g) ?? []).length);
      const rowHeight = Math.round(tableFontSize * 1.55) + (colCount > 3 ? 22 : 16);
      return Math.max(2, trCount) * rowHeight + cardPadding + profilePadding;
    }
    // v6.0 Tier 2 — table-card는 RAW GFM 표(| a | b |)를 감싸 Marp이 렌더하므로 측정 시점엔
    // <tr>이 없다. 행 수만 세면 한글 셀이 2~3줄로 줄바꿈되는 걸 과소예측해 atomic 카드가
    // truncate 없이 넘친다(40pt 회귀). 셀 텍스트를 실측해(measureTableCardRows) 줄바꿈까지
    // 반영 → 넘치면 packer가 정확히 truncate(dogma #17: over-predict).
    const rawRows = html
      .split("\n")
      .filter((l) => /^\s*\|.*\|\s*$/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l));
    if (rawRows.length === 0) {
      return 2 * (Math.round(tableFontSize * 1.55) + 16) + cardPadding + profilePadding;
    }
    const colCount = Math.max(1, (rawRows[0].match(/\|/g)?.length ?? 2) - 1);
    const rowHeights = measureTableCardRows(rawRows, colCount, tableFontSize, typo, cardPadding);
    const sum = rowHeights.reduce((a, b) => a + b, 0);
    return sum + cardPadding + profilePadding;
  }

  if (/class="[^"]*\basu-image-card\b/.test(html) || /<img\b/.test(html)) {
    return estimateImageHeight(
      typo.contentWidth,
      estimateImageAspect(html)
    ) + cardPadding + profilePadding;
  }

  if (/class="[^"]*\basu-kpi-grid\b/.test(html)) {
    return 190 + cardPadding + profilePadding;
  }

  if (/<li\b/.test(html)) {
    const itemTexts = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(
      (match) => stripHtml(match[1])
    );
    const listWidth = context.layoutKind?.includes("split")
      ? Math.round(typo.contentWidth * 0.5)
      : typo.contentWidth - 120;
    const itemHeight = itemTexts.reduce(
      (sum, item) =>
        sum +
        measureTextHeight(item, typo.bodyFont, listWidth, typo.bodyLineHeight) +
        Math.round(typo.bodyFontSize * 0.28),
      0
    );
    return itemHeight + cardPadding + profilePadding;
  }

  if (/class="[^"]*\basu-quote-card\b/.test(html) || /<blockquote\b/.test(html)) {
    return (
      measureTextHeight(text, typo.bodyFont, typo.contentWidth - 140, typo.bodyLineHeight) +
      cardPadding +
      42 +
      profilePadding
    );
  }

  if (/class="[^"]*\basu-cover-title\b/.test(html)) {
    return Math.max(
      260,
      measureTextHeight(text, typo.headingFont, typo.contentWidth, typo.h1FontSize * 1.05)
    );
  }

  return (
    measureTextHeight(text, typo.bodyFont, typo.contentWidth - 120, typo.bodyLineHeight) +
    cardPadding +
    profilePadding
  );
}

// M3-A: wrap factor estimator for code blocks. Returns 1 (the legacy value)
// for default 28pt typography ??keeps the 304 acceptance fixtures byte-equal.
// Beyond that, infers slot width from layoutKind ("code-split" ??narrow right
// slot, otherwise full content width minus margin) and divides the average
// source-line char count by the slot's monospace char capacity.
function estimateCodeWrapFactor(
  codeLines: string[],
  typo: TypographyConfig,
  context: { layoutProfile?: string; layoutKind?: string; cardPolicy?: string }
): number {
  if (typo.bodyFontSize <= 28) return 1;
  if (codeLines.length === 0) return 1;
  const slotWidth = context.layoutKind?.includes("split")
    ? Math.round(typo.contentWidth * 0.34)
    : typo.contentWidth - 120;
  const monoCharAdvance = typo.codeFontSize * 0.6;
  if (monoCharAdvance <= 0) return 1;
  const usableWidth = Math.max(monoCharAdvance, slotWidth - 24);
  const charCapacity = Math.max(1, Math.floor(usableWidth / monoCharAdvance));
  const totalChars = codeLines.reduce((sum, line) => sum + line.length, 0);
  const avgLineChars = totalChars / codeLines.length;
  if (avgLineChars <= 0) return 1;
  return Math.max(1, Math.ceil(avgLineChars / charCapacity));
}

function startsHtmlBlock(trimmed: string): boolean {
  return /^<(div|figure|blockquote|pre|table|ul|ol|p|h[1-6])\b/i.test(trimmed);
}

function htmlDepthDelta(line: string): number {
  const opens = (line.match(/<(div|figure|blockquote|pre|table|ul|ol|p|h[1-6])\b(?![^>]*\/>)/gi) ?? []).length;
  const closes = (line.match(/<\/(div|figure|blockquote|pre|table|ul|ol|p|h[1-6])>/gi) ?? []).length;
  return opens - closes;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function estimateImageAspect(text: string): number | undefined {
  const normalized = text.toLowerCase();
  const dimension = normalized.match(/(?:^|[^\d])(\d{2,5})\s*[x×]\s*(\d{2,5})(?:[^\d]|$)/);
  if (dimension) {
    const width = Number(dimension[1]);
    const height = Number(dimension[2]);
    if (width > 0 && height > 0) return width / height;
  }
  const widthParam = normalized.match(/[?&#](?:w|width)=(\d{2,5})/);
  const heightParam = normalized.match(/[?&#](?:h|height)=(\d{2,5})/);
  if (widthParam && heightParam) {
    const width = Number(widthParam[1]);
    const height = Number(heightParam[1]);
    if (width > 0 && height > 0) return width / height;
  }
  if (/(portrait|profile|headshot|세로|인물)/i.test(normalized)) return 0.66;
  if (/(document|browser|screenshot|스크린샷|화면|문서|hwp|hwpx|기사)/i.test(normalized)) return 16 / 9;
  if (/(square|정사각)/i.test(normalized)) return 1;
  return undefined;
}

function estimateImageHeight(slotWidth: number, imageAspect?: number): number {
  // PR1 (majestic-eagle): when aspect is unknown the previous 520px estimate
  // under-budgeted user screenshots that rendered closer to the CSS cap of
  // 820px, causing packBlocksIntoFrames to pack the wrong neighbours into
  // the same frame. Raise the unknown default to 700 so the budget stays
  // closer to the visual render. The clamp upper bound (820) matches
  // themeRegistry's `section.asu-native-1920-v5 img { max-height: 820px }`.
  if (!imageAspect) return 700;
  return clamp(slotWidth / imageAspect, 280, 820);
}

/**
 * Measure text height using local vendored Pretext.
 * This module is only used by raw/classic overflow fallback paths, so it keeps
 * a conservative estimate when canvas is unavailable. The native 1920 v5 semantic path is
 * strict and does not use this estimate.
 *
 * v6.0 (Tier 2): exported so shapeTemplates can measure card/column text at an
 * arbitrary narrow width (cell-inner) at the current font scale. Same engine the
 * raw-flow measurement uses, so card fit prediction keys off the same advances.
 */
export function measureTextHeight(
  text: string,
  font: string,
  maxWidth: number,
  lineHeight: number
): number {
  if (!text || text.trim() === "") return 0;

  try {
    return semanticPretextEngine.measureText({
      text,
      font,
      maxWidth,
      lineHeight,
      language: /[\uac00-\ud7af\u3040-\u30ff\u3400-\u9fff]/.test(text)
        ? "mixed"
        : "en",
    }).height;
  } catch (error) {
    if (!isPretextMeasurementUnavailable(error)) throw error;
    const avgCharWidth = extractFontSize(font) * 0.5;
    const charsPerLine = Math.floor(maxWidth / avgCharWidth);
    const lineCount = Math.ceil(text.length / Math.max(charsPerLine, 1));
    return lineCount * lineHeight;
  }
}

function extractFontFamily(font: string): string {
  // "28px 'Segoe UI', sans-serif" ??"'Segoe UI', sans-serif"
  return font.replace(/^\d+px\s*/, "");
}

function extractFontSize(font: string): number {
  const match = font.match(/(\d+)px/);
  return match ? parseInt(match[1], 10) : 28;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
