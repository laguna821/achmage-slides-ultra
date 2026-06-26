// V5 PR-A2 — single source of code typography metrics.
//
// Before PR-A2 the codeFontSize was computed in two independent places —
// typography.ts (bodySize × 0.66 = 15px @28pt) and pretextMeasurer.ts
// (min(24, round(base × 0.85)) = 24px @28pt). The 60% gap between
// measurement and render was BLUEPRINT §10 결함 1 — measurement layer
// thought 50-line code fit but the render at 24px spilled.
//
// Locked decision #2 + invariant 14 (렌더 truth 정직): the measurement
// layer aligns to render truth (24px LOCK at 28pt baseline). Below 28pt
// codeFontSize shrinks proportionally (16pt → 14px) since that's user
// intent, not a spill-avoidance shrink. Above 28pt is capped at 24 because
// large code text does not improve presentation density.

export interface CodeMetrics {
  /** Code font size in px. default 28pt → 24px LOCK. */
  codeFontSize: number;
  /** Code line height in px. round(codeFontSize * CODE_LINE_HEIGHT_RATIO). */
  codeLineHeight: number;
  /** Average monospace char advance in px. codeFontSize * MONO_CHAR_ADVANCE_RATIO.
   *  Float — used in charCapacity arithmetic without rounding. */
  monoCharAdvance: number;
}

/** baseFontSize at which codeFontSize hits the 24px LOCK. */
export const REFERENCE_BASE_FONT_SIZE = 28;
/** codeFontSize ceiling. round(28 * 0.85). */
export const REFERENCE_CODE_FONT_SIZE = 24;
/** Theme `pre code` line-height ratio (themeRegistry.ts:688 1.56 ↔ measurement 1.6 — 24×1.6=38). */
export const CODE_LINE_HEIGHT_RATIO = 1.6;
/** JetBrains Mono / SFMono / Consolas average advance fraction of font size. */
export const MONO_CHAR_ADVANCE_RATIO = 0.6;

/**
 * Derive code typography metrics from base font size + scale ratio.
 *
 * scaleRatio is accepted for forward-compatibility with PR-A2b/A3 chrome
 * scaling but currently has no effect — locked decision #2 specifies only
 * baseFontSize × 0.85 with the 24px cap.
 */
export function deriveCodeMetrics(
  baseFontSize: number,
  _scaleRatio: number
): CodeMetrics {
  const codeFontSize = Math.min(
    REFERENCE_CODE_FONT_SIZE,
    Math.round(baseFontSize * 0.85)
  );
  const codeLineHeight = Math.round(codeFontSize * CODE_LINE_HEIGHT_RATIO);
  const monoCharAdvance = codeFontSize * MONO_CHAR_ADVANCE_RATIO;
  return { codeFontSize, codeLineHeight, monoCharAdvance };
}
