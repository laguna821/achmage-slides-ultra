import {
  PRETENDARD_WOFF2_DATAURL,
  JETBRAINS_MONO_WOFF2_DATAURL,
} from "../assets/fonts.generated";

// Single source of truth for the font-family stacks. Both the render side
// (themeRegistry -> --asu-font-body / --asu-font-code) and the measure side
// (pretextMeasurer DEFAULT_FONT_FAMILY) import these so the measured advance
// and the rendered advance key on byte-identical stacks (measurement parity).
export const FONT_BODY_STACK =
  "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Segoe UI', system-ui, sans-serif";
export const FONT_CODE_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Cascadia Code', monospace";

// @font-face declarations for the bundled subsets. `font-weight: 100 900`
// preserves the variable wght axis (Hallym uses 400-800). `font-display: block`
// avoids a fallback flash — the data URI loads synchronously from the bundle so
// the block period is effectively zero. Injected into BOTH the Marp iframe theme
// CSS (themeRegistry, baseTheme) AND the main Obsidian document head (main.ts);
// the latter is required so the canvas text-measurer sees Pretendard too,
// otherwise it falls back and measurement diverges from the render.
export const FONT_FACE_CSS = `
@font-face{font-family:'Pretendard Variable';font-style:normal;font-weight:100 900;font-display:block;src:url(${PRETENDARD_WOFF2_DATAURL}) format('woff2');}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:100 800;font-display:block;src:url(${JETBRAINS_MONO_WOFF2_DATAURL}) format('woff2');}`;
