import type { LayoutProfile, ThemeProfile } from "../semantic/types";
import { FONT_BODY_STACK, FONT_CODE_STACK } from "./fontFace";

const FONT_BODY = FONT_BODY_STACK;
const FONT_CODE = FONT_CODE_STACK;

export const THEME_PROFILES: Record<string, ThemeProfile> = {
  "cmds-dark-native-1920-v5": {
    id: "cmds-dark-native-1920-v5",
    displayName: "CMDS-Dark 1920 v5",
    layoutProfile: "cmds-core",
    typographyProfile: "cmds-compact",
    paletteMode: "mono-gradient",
    colorTokens: {
      base0: "#020303",
      base1: "#050606",
      base2: "#0b0d0c",
      base3: "#141716",
      text: "#ffffff",
      textSoft: "#ffffff",
      textFaint: "#ffffff",
      accent: "#c7ff64",
      accentSoft: "#a7d952",
      accentDim: "#6d8d33",
    },
    elementPolicy: {
      strongStyle: "lime",
      titleDefault: "kicker",
      cardStyle: "terminal",
      metadataStyle: "command",
    },
  },
  "obsidian-cyan": {
    id: "obsidian-cyan",
    displayName: "Obsidian Cyan",
    layoutProfile: "gradient-md",
    typographyProfile: "gradient-minor-second",
    paletteMode: "two-tone-gradient",
    colorTokens: {
      base0: "#06080f",
      base1: "#0a1222",
      base2: "#081827",
      text: "#ffffff",
      textSoft: "#ffffff",
      textFaint: "#ffffff",
      accent: "#73f1ff",
      accentSoft: "#c8f9ff",
      accentDim: "#1081ff",
      toneA: "16,129,255",
      toneB: "115,241,255",
      toneC: "196,230,255",
    },
    elementPolicy: {
      strongStyle: "gradient",
      titleDefault: "ambient",
      cardStyle: "glass",
      metadataStyle: "quiet",
    },
  },
  "deep-navy-ice": {
    id: "deep-navy-ice",
    displayName: "Deep Navy Ice",
    layoutProfile: "gradient-md",
    typographyProfile: "gradient-minor-second",
    paletteMode: "two-tone-gradient",
    colorTokens: {
      base0: "#050812",
      base1: "#0a1838",
      base2: "#102652",
      text: "#ffffff",
      textSoft: "#ffffff",
      textFaint: "#ffffff",
      accent: "#c2f4ff",
      accentSoft: "#a0ceff",
      accentDim: "#487eff",
      toneA: "72,126,255",
      toneB: "194,244,255",
      toneC: "160,206,255",
    },
    elementPolicy: {
      strongStyle: "gradient",
      titleDefault: "ambient",
      cardStyle: "glass",
      metadataStyle: "quiet",
    },
  },
  "cobalt-sand": {
    id: "cobalt-sand",
    displayName: "Cobalt Sand",
    layoutProfile: "gradient-md",
    typographyProfile: "gradient-minor-second",
    paletteMode: "two-tone-gradient",
    colorTokens: {
      base0: "#080d17",
      base1: "#0d1f43",
      base2: "#2c2617",
      text: "#ffffff",
      textSoft: "#ffffff",
      textFaint: "#ffffff",
      accent: "#ffd484",
      accentSoft: "#a2e6ff",
      accentDim: "#3d7cff",
      toneA: "61,124,255",
      toneB: "255,212,132",
      toneC: "162,230,255",
    },
    elementPolicy: {
      strongStyle: "gradient",
      titleDefault: "ambient",
      cardStyle: "glass",
      metadataStyle: "quiet",
    },
  },
  "graphite-topaz": {
    id: "graphite-topaz",
    displayName: "Graphite Topaz",
    layoutProfile: "gradient-md",
    typographyProfile: "gradient-minor-second",
    paletteMode: "two-tone-gradient",
    colorTokens: {
      base0: "#070a10",
      base1: "#111a2a",
      base2: "#2f2618",
      text: "#ffffff",
      textSoft: "#ffffff",
      textFaint: "#ffffff",
      accent: "#ffba5c",
      accentSoft: "#cfecff",
      accentDim: "#609eff",
      toneA: "96,158,255",
      toneB: "255,186,92",
      toneC: "207,236,255",
    },
    elementPolicy: {
      strongStyle: "gradient",
      titleDefault: "ambient",
      cardStyle: "glass",
      metadataStyle: "quiet",
    },
  },
  "arctic-violet": {
    id: "arctic-violet",
    displayName: "Arctic Violet",
    layoutProfile: "gradient-md",
    typographyProfile: "gradient-minor-second",
    paletteMode: "two-tone-gradient",
    colorTokens: {
      base0: "#060911",
      base1: "#111d3a",
      base2: "#172551",
      text: "#ffffff",
      textSoft: "#ffffff",
      textFaint: "#ffffff",
      accent: "#caddff",
      accentSoft: "#a995ff",
      accentDim: "#79bdff",
      toneA: "121,189,255",
      toneB: "202,219,255",
      toneC: "169,149,255",
    },
    elementPolicy: {
      strongStyle: "gradient",
      titleDefault: "ambient",
      cardStyle: "glass",
      metadataStyle: "quiet",
    },
  },
  "hallym-light": {
    id: "hallym-light",
    displayName: "Hallym Light",
    // Reuse "cmds-core" (a branch-safe LayoutProfile value): adding a new
    // LayoutProfile literal would make every `=== "cmds-core"` check fall
    // through to the gradient(dark) path. All light visuals branch on
    // paletteMode === "light" instead.
    layoutProfile: "cmds-core",
    typographyProfile: "hallym",
    paletteMode: "light",
    colorTokens: {
      base0: "#FFFFFF", // surface
      base1: "#FAFBFC", // surface-alt (soft section)
      base2: "#F4F6F8", // gray-100 card/code background
      base3: "#ECEFF3", // gray-150 border/stripe
      text: "#0F1620", // on-surface (body)
      textSoft: "#4A5563", // gray-700 (secondary)
      textFaint: "#8A929B", // gray-500 (caption/meta)
      accent: "#00B5AD", // teal — accent / rule / marker
      accentSoft: "#0066B3", // blue — link / secondary
      accentDim: "#002E6E", // navy — heading / strong / table header
    },
    elementPolicy: {
      strongStyle: "navy",
      titleDefault: "rule",
      cardStyle: "light",
      metadataStyle: "mono",
    },
  },
};

export function getThemeProfile(themeId: string): ThemeProfile {
  return THEME_PROFILES[themeId] ?? THEME_PROFILES["cmds-dark-native-1920-v5"];
}

export function getThemeDisplayName(themeId: string): string {
  return getThemeProfile(themeId).displayName;
}

function vars(profile: ThemeProfile): string {
  const t = profile.colorTokens;
  const toneA = t.toneA ?? "255,255,255";
  const toneB = t.toneB ?? "255,255,255";
  const toneC = t.toneC ?? "199,255,100";
  const isCmds = profile.layoutProfile === "cmds-core";
  const isLight = profile.paletteMode === "light";
  return `
  --asu-text: ${t.text};
  --asu-text-soft: ${t.textSoft};
  --asu-text-faint: ${t.textFaint};
  --asu-accent: ${t.accent};
  --asu-accent-soft: ${t.accentSoft};
  --asu-accent-dim: ${t.accentDim};
  --asu-accent-text: ${t.accent};
  --asu-base-0: ${t.base0};
  --asu-base-1: ${t.base1};
  --asu-base-2: ${t.base2};
  --asu-base-3: ${t.base3 ?? t.base2};
  --asu-tone-a: ${toneA};
  --asu-tone-b: ${toneB};
  --asu-tone-c: ${toneC};
  --asu-font-body: ${FONT_BODY};
  --asu-font-code: ${FONT_CODE};
  --asu-stroke: ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.92)" : "rgba(2,4,10,.90)"};
  --asu-shadow-a: ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.56)" : "rgba(0,0,0,.48)"};
  --asu-shadow-b: ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.34)" : "rgba(0,0,0,.30)"};
  --asu-text-stroke: .68px var(--asu-stroke);
  --asu-text-stroke-faint: .68px ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.90)" : "rgba(2,4,10,.88)"};
  --asu-text-shadow-a: 0 2px 8px var(--asu-shadow-a);
  --asu-text-shadow-b: 0 12px 34px var(--asu-shadow-b);
  --asu-accent-shadow: ${isLight ? "none" : isCmds ? "0 2px 8px rgba(0,0,0,.48), 0 0 18px rgba(199,255,100,.22)" : "0 2px 8px rgba(0,0,0,.40), 0 0 18px rgba(var(--asu-tone-b), .20)"};
  --asu-surface: ${isLight ? "#FFFFFF" : isCmds ? "rgba(255,255,255,.045)" : "rgba(255,255,255,.055)"};
  --asu-surface-strong: ${isLight ? "#FAFBFC" : isCmds ? "rgba(255,255,255,.072)" : "rgba(255,255,255,.095)"};
  --asu-surface-dark: ${isLight ? "#F4F6F8" : isCmds ? "rgba(0,0,0,.34)" : "rgba(4,10,24,.42)"};
  --asu-border: ${isLight ? "#E1E5EA" : isCmds ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.14)"};
  --asu-highlight: ${isLight ? "transparent" : isCmds ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.28)"};
  --asu-card-highlight: ${isLight ? "transparent" : isCmds ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.28)"};
  --asu-card-shadow: ${isLight ? "0 4px 12px rgba(15,22,32,.06), 0 10px 28px rgba(15,22,32,.06)" : isCmds ? "0 12px 40px rgba(0,0,0,.26)" : "0 12px 40px rgba(0,0,0,.18)"};
  /* v6.0 콜아웃 색 — 사용자 결정(2026-06-25): 의미색(note=파랑 등) 없이 **전부 테마 강조색**으로
     통일해 헤딩·표처럼 테마를 따라간다. 헤딩과 동일 매핑: 기본 var(--asu-accent-text)(다크=라임/
     골드), hallym-light는 var(--asu-accent-dim)(navy). 모든 타입(note/warning/danger/quote)이 같은
     강조색. 박스 배경(--asu-callout-bg)만 테마별 톤 유지. */
  --asu-callout-bg: ${isLight ? "rgba(15,22,32,.028)" : "rgba(255,255,255,.02)"};
  --asu-cl-info: ${isLight ? "var(--asu-accent-dim)" : "var(--asu-accent-text)"};
  --asu-cl-warn: ${isLight ? "var(--asu-accent-dim)" : "var(--asu-accent-text)"};
  --asu-cl-ok: ${isLight ? "var(--asu-accent-dim)" : "var(--asu-accent-text)"};
  --asu-cl-q: ${isLight ? "var(--asu-accent-dim)" : "var(--asu-accent-text)"};
  --asu-cl-danger: ${isLight ? "var(--asu-accent-dim)" : "var(--asu-accent-text)"};
  --asu-cl-quote: ${isLight ? "var(--asu-accent-dim)" : "var(--asu-accent-text)"};
  --asu-stage-w: 1920px;
  --asu-stage-h: 1080px;
  --asu-frame-x: 60px;
  --asu-frame-y: 72px;
  --asu-frame-w: 1800px;
  --asu-frame-h: 936px;
  --asu-rule-y: 36px;
  --asu-rule-bottom-y: 1044px;
  --asu-line-weight: 4px;
  --asu-col-w: 128px;
  --asu-row-h: 56px;
  --asu-gutter-x: 24px;
  --asu-gutter-y: 24px;
  --asu-fs-kicker: 16px;
  --asu-fs-small: 16px;
  --asu-fs-footer: 13px;
  --asu-footer-accent: var(--asu-accent-text);
  --asu-footer-muted: ${isLight ? "#8A929B" : isCmds ? "rgba(236,255,215,.70)" : "color-mix(in srgb, var(--asu-text) 62%, transparent)"};
  --asu-fs-body: 24px;
  --asu-fs-h3: 28px;
  --asu-fs-h2: 34px;
  --asu-fs-h1: 40px;`;
}

function background(profile: ThemeProfile): string {
  if (profile.layoutProfile === "cmds-core") {
    return `
    radial-gradient(ellipse 95% 82% at 18% 18%, rgba(255,255,255,.050) 0%, rgba(255,255,255,.018) 34%, transparent 72%),
    radial-gradient(ellipse 88% 76% at 84% 82%, rgba(255,255,255,.042) 0%, rgba(255,255,255,.014) 36%, transparent 70%),
    radial-gradient(ellipse 46% 38% at 54% 46%, rgba(255,255,255,.028) 0%, rgba(255,255,255,.010) 38%, transparent 72%),
    linear-gradient(155deg, var(--asu-base-0) 0%, var(--asu-base-1) 34%, var(--asu-base-2) 68%, var(--asu-base-3) 100%)`;
  }

  return `
    radial-gradient(ellipse 90% 78% at 18% 84%, rgba(var(--asu-tone-a), .84) 0%, rgba(var(--asu-tone-a), .30) 35%, rgba(var(--asu-tone-a), .08) 54%, transparent 72%),
    radial-gradient(ellipse 94% 82% at 86% 18%, rgba(var(--asu-tone-b), .76) 0%, rgba(var(--asu-tone-b), .26) 37%, rgba(var(--asu-tone-b), .06) 56%, transparent 72%),
    radial-gradient(ellipse 44% 34% at 54% 46%, rgba(var(--asu-tone-c), .14) 0%, rgba(var(--asu-tone-c), .05) 40%, transparent 74%),
    linear-gradient(160deg, var(--asu-base-0) 0%, var(--asu-base-1) 52%, var(--asu-base-2) 100%)`;
}

function baseTheme(profile: ThemeProfile): string {
  const isCmds = profile.layoutProfile === "cmds-core";
  const isLight = profile.paletteMode === "light";
  const strongRule = `color: var(--asu-accent-text); -webkit-text-stroke: 0; paint-order: normal; text-shadow: var(--asu-accent-shadow);`;
  // v7.0 — 리스트 카드의 테마별 진한 키컬러 배경. cmds-dark(올리브-라임)·obsidian-cyan
  // (블루)·hallym-light(네이비)는 기존 느낌 유지(accent-dim). 나머지는 accent-dim이
  // 전부 비슷한 블루라 테마 정체성과 어긋나므로(샌드/네이비/토파즈/바이올렛) 개별 지정.
  // 픽셀 튜닝 대상.
  const cardKey =
    profile.id === "cobalt-sand"
      ? "#4a3a14" // 따뜻한 샌드/브론즈(gold accent)
      : profile.id === "deep-navy-ice"
        ? "#0f2c63" // 딥 네이비
        : profile.id === "graphite-topaz"
          ? "#42300f" // 딥 토파즈/앰버
          : profile.id === "arctic-violet"
            ? "#2d2670" // 딥 바이올렛
            : "var(--asu-accent-dim)"; // cmds-dark / obsidian-cyan / hallym-light

  return `
/* @theme ${profile.id} */

@import "default";

section {
  ${vars(profile)}
  position: relative;
  overflow: hidden;
  width: 1920px;
  height: 1080px;
  background: ${background(profile)};
  color: var(--asu-text);
  font-family: var(--asu-font-body);
  font-size: 28px;
  line-height: 1.58;
  letter-spacing: 0;
  container-type: size;
  padding: var(--asu-frame-y) var(--asu-frame-x);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

section::after {
  display: none !important;
  content: none !important;
}

section.asu-native-1920-v5 {
  padding: 0;
  display: block;
  width: var(--asu-stage-w);
  height: var(--asu-stage-h);
  container-type: size;
  background: ${background(profile)};
  isolation: isolate;
}

section.asu-native-1920-v5.asu-raw-flow {
  padding: var(--asu-frame-y) var(--asu-frame-x);
}

section.asu-native-1920-v5,
section.asu-native-1920-v5 * {
  box-sizing: border-box;
}

section.asu-native-1920-v5::before {
  content: "";
  position: absolute;
  left: var(--asu-frame-x);
  right: var(--asu-frame-x);
  top: var(--asu-rule-y);
  bottom: var(--asu-rule-y);
  z-index: 8;
  pointer-events: none;
  border-top: var(--asu-line-weight) solid transparent;
  border-bottom: var(--asu-line-weight) solid transparent;
  border-image: linear-gradient(90deg, rgba(255,255,255,.14) 0%, var(--asu-accent) 52%, rgba(255,255,255,.14) 100%) 1;
  opacity: .96;
}

section.asu-native-1920-v5.asu-cmds-core::before {
  border-image: linear-gradient(90deg, rgba(255,255,255,.10) 0%, rgba(199,255,100,.78) 50%, rgba(255,255,255,.10) 100%) 1;
  opacity: .94;
}

section .asu-slide-frame {
  position: absolute;
  left: var(--asu-frame-x);
  right: var(--asu-frame-x);
  top: var(--asu-rule-y);
  bottom: var(--asu-rule-y);
  z-index: 8;
  pointer-events: none;
}

section .asu-frame-line {
  position: absolute;
  left: 0;
  right: 0;
  height: max(3px, var(--asu-line-weight));
  background: linear-gradient(90deg, rgba(255,255,255,.20) 0%, var(--asu-accent) 52%, rgba(255,255,255,.20) 100%);
  opacity: .96;
}

section.asu-cmds-core .asu-frame-line,
section[data-theme="cmds-dark-native-1920-v5"] .asu-frame-line {
  height: max(4px, var(--asu-line-weight));
  background: linear-gradient(90deg, rgba(184,255,0,.24) 0%, rgba(184,255,0,.96) 16%, #b8ff00 50%, rgba(184,255,0,.96) 84%, rgba(184,255,0,.24) 100%);
  box-shadow: 0 0 8px rgba(184,255,0,.42), 0 0 22px rgba(184,255,0,.24);
  opacity: 1;
}

section .asu-frame-line-top {
  top: 0;
}

section .asu-frame-line-bottom {
  bottom: 0;
}

/* ── v7.0 Tier 3: 배경 사진 + wash 막 ──────────────────────────────────────
   Tier 3 OFF면 .asu-tier3-bg/.asu-bg-* 클래스가 주입되지 않아 이 룰들은 전부
   매칭 0(슬라이드 HTML 불변 = 회귀 0). 적층(isolation:isolate 스택 컨텍스트):
   section 자체 background → .asu-bg-photo(z-2) → .asu-bg-wash(z-1) →
   non-positioned 콘텐츠(raw-flow) / .asu-content(z2) → frame(z8). 음수 z 자식은
   섹션 배경 위·in-flow 콘텐츠 아래에 칠해진다(CSS 2.1 페인트 순서). */
section.asu-native-1920-v5 .asu-bg-photo {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  z-index: -2;
  pointer-events: none;
}
section.asu-native-1920-v5 .asu-bg-wash {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}
section.asu-native-1920-v5 .asu-bg-wash.asu-wash-light {
  background: rgba(250, 246, 236, var(--asu-wash-opacity, .74));
}
section.asu-native-1920-v5 .asu-bg-wash.asu-wash-dark {
  background: linear-gradient(180deg,
    rgba(0, 0, 0, calc(var(--asu-wash-opacity, .6) * .82)),
    rgba(0, 0, 0, var(--asu-wash-opacity, .6)));
}

/* Tier 3 ON: 카드(.asu-card/.dgroup/.asu-bento/.asu-callout 등)는 --asu-surface*
   를 소비하므로 wash 모드에 맞춰 그 변수만 반투명으로 바꾸면 사진이 카드 뒤로
   비친다. .image-card/.video-thumb는 하드코딩 gradient라 불변(콘텐츠 미디어 유지). */
section.asu-native-1920-v5.asu-tier3-bg.asu-wash-dark {
  --asu-surface: rgba(255, 255, 255, .10);
  --asu-surface-strong: rgba(255, 255, 255, .16);
  --asu-surface-dark: rgba(0, 0, 0, .32);
}
section.asu-native-1920-v5.asu-tier3-bg.asu-wash-light {
  --asu-surface: rgba(255, 255, 255, .66);
  --asu-surface-strong: rgba(255, 255, 255, .80);
  --asu-surface-dark: rgba(244, 246, 248, .70);
}
section.asu-native-1920-v5.asu-tier3-bg :is(.asu-card, .dgroup, .asu-callout) {
  backdrop-filter: blur(10px) saturate(1.05);
  -webkit-backdrop-filter: blur(10px) saturate(1.05);
}

/* B3 가독성 — wash 모드가 본문 글자색을 결정(테마와 분리). raw-flow 슬라이드만 대상
   (카드 슬라이드는 .asu-content라 비대상, 카드 글자는 카드 룰이 담당). dark wash=
   흰 글자+그림자, light wash=짙은 글자. 사진 위 분리를 위해 dark wash 헤딩에도 그림자. */
section.asu-native-1920-v5.asu-tier3-bg.asu-wash-dark.asu-raw-flow :is(p, li) {
  color: #fff;
  text-shadow: 0 4px 26px rgba(0, 0, 0, .4);
}
section.asu-native-1920-v5.asu-tier3-bg.asu-wash-dark.asu-raw-flow :is(h1, h2, h3, h4, h5, h6) {
  text-shadow: 0 4px 26px rgba(0, 0, 0, .45);
}
section.asu-native-1920-v5.asu-tier3-bg.asu-wash-light.asu-raw-flow :is(p, li) {
  color: #16202c;
}

/* v7.0 (과제 A) — body 폴리싱: sparse 본문 슬라이드(asu-body-spacious)에서 본문 문단을
   화면 가로 중앙의 좁은 컬럼(--body-colw)에 놓고 왼쪽정렬한다(중앙 center 정렬의
   들쭉날쭉 회피). 폰트 크기/행간은 inline per-element var(--body-N-fs/lh)로 확대됨.
   배경(asu-tier3-bg)과 독립이라 배경 없이 body 폴리싱만 켜도 동작. heading은 원폭 유지. */
section.asu-native-1920-v5.asu-raw-flow.asu-body-spacious p {
  max-width: var(--body-colw, none);
  margin-inline: auto;
  text-align: left;
}

/* v5.7 — 결정론적 파일명 타이틀 슬라이드. 프레임 안 정중앙; 색은 테마 변수만
   소비(신규 색 0개) → dark/light 자동 분기. 타이틀은 <div>(헤딩 아님)라
   hallym-light의 :is(h1,h2)::after teal 밑줄 룰을 타지 않는다. clamp는 1920px
   stage 기준 정적 rule-level 값이라 Marp SVG cascade(dogma #15)와 무관. */
section.asu-native-1920-v5.asu-title-slide {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
section.asu-native-1920-v5.asu-title-slide .asu-title-block {
  max-width: 1600px;
  margin: 0 auto;
  padding: 0 80px;
}
section.asu-native-1920-v5.asu-title-slide .asu-title-text {
  font-family: var(--asu-font-body);
  /* 캔버스는 항상 1920×1080 고정이라 viewport 단위(vw)는 위험(Marp
     foreignObject에서 1920 캔버스가 아닌 실제 뷰포트로 해석됨). 캔버스 좌표계
     기준 고정 px를 쓴다. 긴 제목은 아래 줄바꿈 규칙으로 2~3줄 흐른다. */
  font-size: 104px;
  line-height: 1.1;
  font-weight: 850;
  letter-spacing: -0.015em;
  margin: 0;
  overflow-wrap: anywhere;
  word-break: keep-all;
  text-wrap: balance;
  color: var(--asu-accent-text);
  text-shadow: var(--asu-accent-shadow);
}

/* v6.0 (Tier 2) — section divider(섹션 구분 슬라이드). 헤딩만(또는 헤딩+짧은 부제)인
   logical 슬라이드를 hero로. 타이틀 슬라이드와 같은 정중앙·테마변수 원칙, 다만 본문 중간
   구분자라 약간 작은 타이포 + accent rule로 cover와 구분. 색은 기존 --asu-* 변수만 소비. */
section.asu-native-1920-v5.asu-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
section.asu-native-1920-v5.asu-divider .asu-divider-block {
  max-width: 1600px;
  margin: 0 auto;
  padding: 0 80px;
}
section.asu-native-1920-v5.asu-divider .asu-divider-text {
  font-family: var(--asu-font-body);
  font-size: 84px;
  line-height: 1.12;
  font-weight: 840;
  letter-spacing: -0.012em;
  margin: 0;
  overflow-wrap: anywhere;
  word-break: keep-all;
  text-wrap: balance;
  color: var(--asu-accent-text);
  text-shadow: var(--asu-accent-shadow);
}
/* accent rule — divider 시그니처. 색은 테마 accent. */
section.asu-native-1920-v5.asu-divider .asu-divider-text::after {
  content: "";
  display: block;
  width: 96px;
  height: 4px;
  margin: 24px auto 0;
  background: var(--asu-accent);
  border-radius: 999px;
}
section.asu-native-1920-v5.asu-divider .asu-divider-sub {
  font-family: var(--asu-font-body);
  font-size: 32px;
  line-height: 1.4;
  font-weight: 500;
  margin: 28px auto 0;
  max-width: 1200px;
  overflow-wrap: anywhere;
  word-break: keep-all;
  text-wrap: balance;
  color: var(--asu-text-soft);
}

section.asu-native-1920-v5 .asu-content {
  position: absolute;
  left: var(--asu-frame-x);
  top: var(--asu-frame-y);
  z-index: 2;
  width: var(--asu-frame-w);
  height: var(--asu-frame-h);
  display: grid;
  grid-template-columns: repeat(12, var(--asu-col-w));
  grid-template-rows: repeat(12, var(--asu-row-h));
  column-gap: var(--asu-gutter-x);
  row-gap: var(--asu-gutter-y);
  padding: 0;
}

section.asu-native-1920-v5 .asu-slot {
  grid-column: var(--asu-slot-col-start) / span var(--asu-slot-col-span);
  grid-row: var(--asu-slot-row-start) / span var(--asu-slot-row-span);
  position: relative;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  min-height: 0;
  max-height: 100%;
  overflow: visible;
}

section.asu-native-1920-v5 .asu-slot-inner {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  overflow: visible;
  display: flex;
  flex-direction: column;
}

section.asu-native-1920-v5 .kicker,
section.asu-native-1920-v5 .hero,
section.asu-native-1920-v5 .title,
section.asu-native-1920-v5 .body,
section.asu-native-1920-v5 .small,
section.asu-native-1920-v5 .meta,
section.asu-native-1920-v5 .card h3,
section.asu-native-1920-v5 .card p,
section.asu-native-1920-v5 .card li,
section.asu-native-1920-v5 .card td,
section.asu-native-1920-v5 .card th,
section.asu-native-1920-v5 td,
section.asu-native-1920-v5 th,
section.asu-native-1920-v5 pre,
section.asu-native-1920-v5 code,
section.asu-native-1920-v5 .quote,
section.asu-native-1920-v5 .caption,
section.asu-native-1920-v5 .table-note,
section.asu-native-1920-v5 .terminal-line,
section.asu-native-1920-v5 .kpi .val,
section.asu-native-1920-v5 .kpi .label,
section.asu-native-1920-v5 .kpi .delta,
section.asu-native-1920-v5 .section-label,
section.asu-native-1920-v5 .video-card,
section.asu-native-1920-v5 .video-url,
section.asu-native-1920-v5 .markdown-tag,
section.asu-native-1920-v5 .asu-source-strip,
section.asu-native-1920-v5 .asu-source-item,
section.asu-native-1920-v5 .asu-debug-overlay,
section.asu-native-1920-v5 .asu-callout,
section.asu-native-1920-v5 .callout-heading,
section.asu-native-1920-v5 .callout-title,
section.asu-native-1920-v5 .callout-body,
section.asu-native-1920-v5 .asu-list li {
  color: var(--asu-text);
  -webkit-text-stroke: var(--asu-text-stroke);
  paint-order: stroke fill;
  text-shadow: var(--asu-text-shadow-a), var(--asu-text-shadow-b);
}

section.asu-native-1920-v5 .soft {
  color: var(--asu-text);
}

section.asu-native-1920-v5 .faint {
  color: var(--asu-text);
  -webkit-text-stroke: var(--asu-text-stroke);
}

section.asu-native-1920-v5 .hero {
  font-size: var(--asu-fs-h1);
  font-weight: 840;
  line-height: .94;
  letter-spacing: 0;
  margin: 0;
}

section.asu-native-1920-v5 .title,
section.asu-native-1920-v5 .asu-title {
  font-size: var(--asu-fs-h2);
  font-weight: 760;
  line-height: 1.04;
  letter-spacing: 0;
  margin: 0;
}

section.asu-native-1920-v5 .kicker,
section.asu-native-1920-v5 .asu-kicker {
  font-size: var(--asu-fs-kicker);
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: .15em;
  text-transform: uppercase;
  font-family: var(--asu-font-code);
  margin: 0 0 30px;
  color: ${isCmds ? "var(--asu-accent-text)" : "var(--asu-text)"};
}

section.asu-native-1920-v5 .asu-plan-frame > .asu-kicker,
section.asu-native-1920-v5 .asu-group-frame > .asu-kicker,
section.asu-native-1920-v5 .asu-plan-frame .asu-slot-inner > .asu-kicker,
section.asu-native-1920-v5 .asu-group-frame .asu-slot-inner > .asu-kicker {
  margin-bottom: 12px;
  letter-spacing: .08em;
  text-transform: none;
}

section.asu-native-1920-v5 .body,
section.asu-native-1920-v5 .asu-body {
  font-size: var(--asu-fs-body);
  font-weight: 430;
  line-height: 1.58;
  letter-spacing: 0;
  margin: 0;
}

section.asu-native-1920-v5 .small,
section.asu-native-1920-v5 .caption,
section.asu-native-1920-v5 .asu-caption,
section.asu-native-1920-v5 .table-note {
  font-size: var(--asu-fs-small);
  font-weight: 430;
  line-height: 1.5;
  letter-spacing: 0;
  margin: 0;
}

section.asu-native-1920-v5 .hero-box {
  grid-column: 2 / 10;
  grid-row: 2 / 8;
  align-self: center;
}

section.asu-native-1920-v5 .hero-box .body {
  margin-top: 35px;
  max-width: 845px;
}

section.asu-native-1920-v5 .hero-box .small {
  margin-top: 24px;
  max-width: 768px;
}

section.asu-native-1920-v5 .two-col-left {
  grid-column: var(--asu-slot-col-start, 2) / span var(--asu-slot-col-span, 5);
  grid-row: var(--asu-slot-row-start, 2) / span var(--asu-slot-row-span, 6);
  align-self: center;
  min-width: 0;
  max-width: 100%;
  overflow: visible;
}

section.asu-native-1920-v5 .two-col-right {
  grid-column: var(--asu-slot-col-start, 7) / span var(--asu-slot-col-span, 5);
  grid-row: var(--asu-slot-row-start, 2) / span var(--asu-slot-row-span, 6);
  align-self: center;
  min-width: 0;
  max-width: 100%;
  overflow: visible;
}

section.asu-native-1920-v5 .center-box {
  grid-column: 2 / 12;
  /* M3-D: grid-row is overridable via CSS var so PR-B2b resolver / catalog
   * slots(ctx) can override at large typography per-pattern.
   * V5 PR-A3 removed slideRenderer's *forced* injection ??fallback 2 / 8 is
   * the default for all typography. Resolver-driven overrides arrive via
   * this var seam (chrome/spacing scale via chromeMetrics keeps content in
   * the row 2-8 budget at largeStack now). */
  grid-row: var(--asu-center-box-row, 2 / 8);
  align-self: center;
  justify-self: center;
  text-align: center;
  max-width: 1229px;
}

section.asu-native-1920-v5.asu-layout-code-full .asu-code-full-frame {
  grid-column: 2 / 12;
  grid-row: 1 / 9;
  align-self: start;
  justify-self: stretch;
  text-align: left;
  max-width: 100%;
  padding-top: 32px;
  box-sizing: border-box;
}

section.asu-native-1920-v5.asu-layout-code-full .asu-code-full-frame .title {
  margin-bottom: 13px;
}

section.asu-native-1920-v5.asu-layout-code-full .asu-code-full-frame pre {
  padding-top: 1.05rem;
  padding-bottom: 1.05rem;
}

section.asu-native-1920-v5.asu-continued .asu-plan-frame:not(.asu-code-full-frame):not(.asu-media-frame):not(.asu-table-frame) {
  grid-column: 2 / 12;
  grid-row: 1 / 9;
  align-self: start;
  justify-self: stretch;
  text-align: left;
  max-width: 100%;
  padding-top: 32px;
  padding-bottom: 86px;
  box-sizing: border-box;
}

section.asu-native-1920-v5.asu-continued .asu-plan-frame:not(.asu-code-full-frame):not(.asu-media-frame) .title {
  font-size: var(--asu-fs-h2);
  margin-bottom: 13px;
}

section.asu-native-1920-v5.asu-continued .asu-media-frame {
  grid-column: var(--asu-slot-col-start) / span var(--asu-slot-col-span);
  grid-row: var(--asu-slot-row-start) / span var(--asu-slot-row-span);
  align-self: stretch !important;
  justify-self: stretch;
  text-align: initial;
  max-width: none;
  padding: 0;
  box-sizing: border-box;
}

section.asu-native-1920-v5.asu-continued .asu-media-frame .asu-image-figure,
section.asu-native-1920-v5.asu-continued .asu-media-frame .image-card {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
}

section.asu-native-1920-v5.asu-continued .asu-table-frame {
  grid-column: var(--asu-slot-col-start) / span var(--asu-slot-col-span);
  grid-row: var(--asu-slot-row-start) / span var(--asu-slot-row-span);
  align-self: stretch;
  justify-self: stretch;
  text-align: left;
  max-width: 100%;
  padding-top: 0;
  padding-bottom: 0;
  box-sizing: border-box;
}

section.asu-native-1920-v5.asu-continued .asu-table-frame .title {
  font-size: var(--asu-fs-h2);
  margin-bottom: 13px;
}

section.asu-native-1920-v5.asu-continued .asu-table-frame .table-wrap {
  max-width: 100%;
}

section.asu-native-1920-v5.asu-layout-callout-panel .asu-media-frame[data-achmage-slot-dominance="support"] {
  align-self: stretch;
  justify-self: stretch;
  text-align: left;
  max-width: 100%;
  box-sizing: border-box;
}

section.asu-native-1920-v5.asu-layout-callout-panel .asu-media-frame[data-achmage-slot-dominance="support"] .title {
  font-size: var(--asu-fs-h2);
  margin-bottom: 13px;
}

section.asu-native-1920-v5.asu-layout-callout-panel .asu-media-frame[data-achmage-slot-dominance="support"] .asu-image-figure {
  width: 100%;
  max-width: 100%;
  margin-left: 0;
  margin-right: auto;
}

section.asu-native-1920-v5 .two-col-left > *,
section.asu-native-1920-v5 .two-col-right > *,
section.asu-native-1920-v5 .two-col-left .card,
section.asu-native-1920-v5 .two-col-right .card,
section.asu-native-1920-v5 .two-col-left .asu-card,
section.asu-native-1920-v5 .two-col-right .asu-card,
section.asu-native-1920-v5 .two-col-left .asu-section-list-card,
section.asu-native-1920-v5 .two-col-right .asu-section-list-card,
section.asu-native-1920-v5 .two-col-left .asu-quote-card,
section.asu-native-1920-v5 .two-col-right .asu-quote-card,
section.asu-native-1920-v5 .two-col-left .video-card,
section.asu-native-1920-v5 .two-col-right .video-card,
section.asu-native-1920-v5 .two-col-left .table-wrap,
section.asu-native-1920-v5 .two-col-right .table-wrap,
section.asu-native-1920-v5 .two-col-left pre,
section.asu-native-1920-v5 .two-col-right pre,
section.asu-native-1920-v5 .two-col-left img,
section.asu-native-1920-v5 .two-col-right img {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

section.asu-native-1920-v5 .grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 38px;
}

section.asu-native-1920-v5 .grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 31px;
}

/* ── Tier 2 — N-up 카드 그리드 (shapeTemplates.composeCardGrid). 측정과 단일 진실원:
 * gap/padding/line-height 변경 시 shapeTemplates CARD_METRICS/SECTION_METRICS도 함께 조정.
 * 카드 내부는 div-class(.asu-card-title/-body)라 injectPerElementStyles inline 주입을 받지
 * 않고, 폰트는 --asu-fs-* 스케일 var을 소비(설정 폰트 가변, dogma #15 — 동적값 inline 없음). ── */
section.asu-native-1920-v5 .asu-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px;
  align-items: stretch; /* 카드 높이 균일 = "정렬된" 인상 */
  margin: 0;
}
section.asu-native-1920-v5 .asu-card-grid.cards-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}
section.asu-native-1920-v5 .asu-card-grid.cards-4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}
section.asu-native-1920-v5 .asu-card-grid > .asu-card {
  display: flex;
  flex-direction: column;
  min-width: 0; /* grid blowout 방지 */
  margin: 0;
}
section.asu-native-1920-v5 .asu-card-title {
  font-size: var(--asu-fs-h3);
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -0.005em;
  margin: 0 0 14px;
  color: var(--asu-accent-text);
  word-break: keep-all;
  text-wrap: balance;
}
section.asu-native-1920-v5 .asu-card-body {
  font-size: var(--asu-fs-small);
  font-weight: 430;
  line-height: 1.5;
  margin: 0;
  color: var(--asu-text-soft);
  word-break: keep-all;
}
section.asu-native-1920-v5 .asu-card-body + .asu-card-body {
  margin-top: 12px;
}
section.asu-native-1920-v5 .asu-card-stat {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-weight: 760;
  letter-spacing: -0.01em;
}
/* 섹션 헤더 — divider teal rule의 좌측정렬·슬라이드타이틀급(divider 84px hero와 구분). */
section.asu-native-1920-v5 .asu-section-head {
  margin: 0 0 36px;
}
section.asu-native-1920-v5 .asu-section-title {
  font-family: var(--asu-font-body);
  font-size: var(--asu-fs-h1);
  font-weight: 760;
  line-height: 1.14;
  letter-spacing: -0.012em;
  margin: 0;
  color: var(--asu-accent-text);
  word-break: keep-all;
  text-wrap: balance;
}
section.asu-native-1920-v5 .asu-section-title::after {
  content: "";
  display: block;
  width: 80px;
  height: 4px;
  margin: 16px 0 0;
  background: var(--asu-accent);
  border-radius: 999px;
}

/* ── Tier 2 — definition-grid (shapeTemplates.composeDefGrid). 측정과 단일 진실원:
 * DEFGRID_METRICS(labelColW/colGap/padding/divider/line-height) 변경 시 함께 조정.
 * 각 .dgroup은 독립 2칼럼 grid라 라벨 cell이 우측 칼럼 높이만큼 자동 span(align-self:stretch).
 * 내부 전부 div-class → injectPerElementStyles inline 주입 회피, --asu-fs-* var 소비. ── */
section.asu-native-1920-v5 .asu-defgrid {
  display: flex;
  flex-direction: column;
  gap: 20px; /* 카드(.dgroup) 사이 간격 */
  margin: 0;
}
/* .dgroup = bento .asu-card와 동일한 둥근 카드 박스(미적 통일). 안에 라벨|본문 grid. */
section.asu-native-1920-v5 .asu-defgrid > .dgroup {
  display: grid;
  grid-template-columns: var(--asu-defgrid-label-w, 320px) 1fr;
  column-gap: 32px;
  align-items: start;
  background: linear-gradient(180deg, var(--asu-surface-strong), var(--asu-surface));
  border: 1px solid var(--asu-border);
  border-radius: 22px;
  box-shadow: var(--asu-card-shadow), inset 0 1px 0 var(--asu-card-highlight);
  padding: 1.45rem 1.55rem;
}
section.asu-native-1920-v5 .asu-def-label {
  font-size: var(--asu-fs-h3);
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -0.005em;
  margin: 0;
  padding-right: 8px;
  color: var(--asu-accent-text);
  word-break: keep-all;
  text-wrap: balance;
  align-self: stretch; /* 우측 칼럼 높이만큼 라벨 cell이 세로 span */
}
section.asu-native-1920-v5 .asu-def-main {
  display: flex;
  flex-direction: column;
  min-width: 0; /* grid blowout 방지 */
}
section.asu-native-1920-v5 .asu-def-row {
  font-size: var(--asu-fs-body);
  font-weight: 430;
  line-height: 1.5;
  margin: 0;
  color: var(--asu-text);
  word-break: keep-all;
}
section.asu-native-1920-v5 .asu-def-row.is-sub {
  font-size: var(--asu-fs-small);
  color: var(--asu-text-soft);
  /* padding-left는 컴포저가 level별 inline 주입(3단+ 중첩 들여쓰기) */
}
section.asu-native-1920-v5 .asu-def-row + .asu-def-row {
  margin-top: 10px; /* 카드 안이라 hairline 없이 간격만 (깔끔한 카드 인상) */
}
/* solo(n=1 통카드): 라벨을 좌측 칼럼이 아니라 풀폭 상단에, 본문 행을 그 아래로 적층. */
section.asu-native-1920-v5 .asu-defgrid.is-solo > .dgroup {
  grid-template-columns: 1fr;
  row-gap: 14px;
}

/* ── Tier 2 — bento (shapeTemplates.composeBento). 측정 span 비대칭 dense 패킹.
 * 카드 = card-grid와 동일 .asu-card(룰 재사용). span은 div의 --asu-card-span 토큰(dogma #15 OK).
 * 기본 grid-auto-flow(row, non-dense)라 packBento 측정과 1:1 일치 — dense 금지. ── */
/* 세로 fill: bento 슬라이드 섹션을 flex 컬럼으로 → 스택/bento가 슬라이드 높이를 꽉 채운다.
 * .asu-slide-frame은 position:absolute(out of flow)라 영향 없음. */
section.asu-native-1920-v5.asu-card-grid-slide {
  display: flex;
  flex-direction: column;
  padding: var(--asu-frame-y) var(--asu-frame-x);
}
section.asu-native-1920-v5.asu-card-grid-slide .asu-card-grid-stack {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* bento: 단일 grid라 칼럼이 모든 행에서 정렬. grid-template-columns는 컴포저가 inline 주입
 * (깔끔한 정수 비율, 예 3fr 1fr). grid-auto-rows로 행 균등 stretch → 세로 fill. */
section.asu-native-1920-v5 .asu-bento {
  display: grid;
  grid-template-columns: 1fr 1fr; /* fallback; 컴포저 inline이 덮어씀 */
  gap: 20px;
  grid-auto-rows: minmax(min-content, 1fr); /* 행 균등 fill(content보다 작아지지 않음) */
  margin: 0;
  flex: 1 1 auto; /* stack 안에서 세로 fill(flex 부모일 때) */
  min-height: 0;
}
section.asu-native-1920-v5 .asu-bento > .asu-card {
  min-width: 0; /* grid blowout 방지 */
  display: flex;
  flex-direction: column;
}
/* nested-short → bento일 때 서브를 칩으로(데이터 손실 0). flat은 칩 없음. */
section.asu-native-1920-v5 .asu-card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
section.asu-native-1920-v5 .asu-chip {
  font-size: var(--asu-fs-small);
  line-height: 1.3;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--asu-surface-strong);
  border: 1px solid var(--asu-border);
  color: var(--asu-text-soft);
  word-break: keep-all;
}
/* 블록 단위 카드(혼합 섹션 내 콜아웃·이미지와 나란히). 내부 .asu-bento/.asu-defgrid는 부모가
 * flex 아니라 content-sized(whole-slide의 세로 fill과 달리 인라인 블록처럼 동작). */
section.asu-native-1920-v5 .asu-listcard {
  margin: 0.7em 0;
}

section.asu-native-1920-v5 .asu-atlas-grid-frame,
section.asu-native-1920-v5 .asu-atlas-stack-frame,
section.asu-native-1920-v5 .asu-atlas-strip-frame {
  max-width: 100%;
  justify-self: stretch;
  text-align: left;
}

section.asu-native-1920-v5 .asu-semantic-debug[data-achmage-density="dense"] ~ .center-box.asu-atlas-grid-frame,
section.asu-native-1920-v5 .asu-semantic-debug[data-achmage-density="dense"] ~ .center-box.asu-atlas-stack-frame,
section.asu-native-1920-v5 .asu-semantic-debug[data-achmage-density="dense"] ~ .center-box.asu-atlas-strip-frame,
section.asu-native-1920-v5 .asu-semantic-debug[data-achmage-density="dense"] ~ .center-box.asu-table-frame {
  grid-row: 1 / 9;
  align-self: start;
  justify-self: stretch;
  max-width: 100%;
  padding-top: 32px;
  padding-bottom: 0;
}

section.asu-native-1920-v5 .center-box.asu-callout-frame {
  align-self: center;
  justify-self: stretch;
  max-width: 100%;
  padding-top: 0;
}

section.asu-native-1920-v5 .asu-atlas-grid {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  align-items: start;
}

section.asu-native-1920-v5 .asu-atlas-grid-cell,
section.asu-native-1920-v5 .asu-atlas-stack-frame > .card,
section.asu-native-1920-v5 .asu-atlas-stack-frame > .asu-card {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}

section.asu-native-1920-v5 .asu-atlas-grid > .asu-slot {
  grid-column: var(--asu-slot-col-start) / span var(--asu-slot-col-span);
  grid-row: var(--asu-slot-row-start) / span var(--asu-slot-row-span);
}

section.asu-native-1920-v5 .asu-atlas-grid-cell > *,
section.asu-native-1920-v5 .asu-atlas-grid-cell .card,
section.asu-native-1920-v5 .asu-atlas-grid-cell .asu-card,
section.asu-native-1920-v5 .asu-atlas-grid-cell .asu-section-list-card,
section.asu-native-1920-v5 .asu-atlas-grid-cell .asu-list-card,
section.asu-native-1920-v5 .asu-atlas-grid-cell .asu-quote-card,
section.asu-native-1920-v5 .asu-atlas-grid-cell .video-card,
section.asu-native-1920-v5 .asu-atlas-grid-cell .table-wrap,
section.asu-native-1920-v5 .asu-atlas-grid-cell pre,
section.asu-native-1920-v5 .asu-atlas-grid-cell img {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin-left: 0;
  margin-right: 0;
  box-sizing: border-box;
}

section.asu-native-1920-v5 .asu-atlas-grid-cell .body,
section.asu-native-1920-v5 .asu-atlas-grid-cell .asu-body,
section.asu-native-1920-v5 .asu-atlas-grid-cell p,
section.asu-native-1920-v5 .asu-atlas-grid-cell li {
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
}

section.asu-native-1920-v5 .asu-atlas-grid-cell > .card,
section.asu-native-1920-v5 .asu-atlas-grid-cell > .asu-card {
  max-height: 100%;
  overflow: visible;
}

section.asu-native-1920-v5 .asu-atlas-grid-cell ul,
section.asu-native-1920-v5 .asu-atlas-grid-cell ol {
  max-width: 100%;
  padding-right: 0;
  box-sizing: border-box;
}

section.asu-native-1920-v5 .asu-atlas-stack-frame > * + *,
section.asu-native-1920-v5 .asu-atlas-strip-frame > * + *,
section.asu-native-1920-v5 .asu-atlas-stack-frame .asu-slot-inner > * + *,
section.asu-native-1920-v5 .asu-atlas-strip-frame .asu-slot-inner > * + * {
  margin-top: 13px;
}

section.asu-native-1920-v5 .asu-atlas-support-strip {
  max-width: 1114px;
  opacity: 0.92;
}

section.asu-native-1920-v5 .card,
section.asu-native-1920-v5 .asu-card {
  position: relative;
  background: linear-gradient(180deg, var(--asu-surface-strong), var(--asu-surface));
  border: 1px solid var(--asu-border);
  border-radius: 22px;
  /* V5 PR-A3 amendment 3 (2026-05-09): static rem values, slideRenderer overrides
   * for largeStack with !important. calc(rem * var(...)) was empirically broken
   * inside Marp's SVG/foreignObject (var resolution evaluated to fallback 1 even
   * when var=0.75 cascaded to the element). Static rule is byte-equal default. */
  padding: 1.45rem 1.55rem;
  box-shadow: var(--asu-card-shadow), inset 0 1px 0 var(--asu-card-highlight);
  backdrop-filter: blur(${isCmds ? "12px" : "14px"});
  -webkit-backdrop-filter: blur(${isCmds ? "12px" : "14px"});
  overflow: visible;
}

section.asu-native-1920-v5 .asu-card-content {
  display: contents;
}

section.asu-native-1920-v5 .asu-card-clip {
  min-width: 0;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  max-height: 100%;
  box-sizing: border-box;
  overflow: visible;
}

section.asu-native-1920-v5 .asu-callout-content {
  display: contents;
}

section.asu-native-1920-v5 .asu-callout-clip {
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  overflow: visible;
}

section.asu-native-1920-v5 .asu-atlas-stack-frame .card,
section.asu-native-1920-v5 .asu-atlas-stack-frame .asu-card,
section.asu-native-1920-v5 .asu-table-frame .card,
section.asu-native-1920-v5 .asu-table-frame .asu-card,
section.asu-native-1920-v5 .two-col-left .asu-table-card,
section.asu-native-1920-v5 .two-col-right .asu-table-card {
  padding: 1rem 1.05rem;
}

section.asu-native-1920-v5 .asu-atlas-stack-frame .asu-image-figure {
  width: 100%;
}

section.asu-native-1920-v5 .asu-atlas-stack-frame .image-card {
  max-height: none;
}

section.asu-native-1920-v5 .asu-media-frame .asu-image-figure {
  width: 100%;
}

section.asu-native-1920-v5 .asu-media-frame .image-card {
  min-height: 0;
  max-height: none;
}

section.asu-native-1920-v5 .asu-media-frame .image-card img,
section.asu-native-1920-v5 .asu-media-frame .image-card svg {
  max-height: none;
}

section.asu-native-1920-v5 .asu-atlas-stack-frame .asu-callout {
  width: 100%;
  max-width: none;
  margin: 0 auto;
  padding: .82rem .95rem .9rem;
}

section.asu-native-1920-v5 .asu-atlas-stack-frame .callout-heading {
  margin-bottom: .45rem;
}

section.asu-native-1920-v5 .asu-atlas-stack-frame .callout-body {
  font-size: var(--asu-fs-small);
  line-height: 1.38;
}

section.asu-native-1920-v5 .card::before,
section.asu-native-1920-v5 .asu-card::before {
  content: "";
  position: absolute;
  left: 16px;
  right: 16px;
  top: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--asu-card-highlight), transparent);
  opacity: .92;
}

section.asu-native-1920-v5.asu-gradient-md .card::after,
section.asu-native-1920-v5.asu-gradient-md .asu-card::after {
  content: "";
  position: absolute;
  right: -10%;
  top: -14%;
  width: 44%;
  height: 56%;
  background: radial-gradient(circle, rgba(var(--asu-tone-b), .24) 0%, rgba(var(--asu-tone-c), .08) 28%, transparent 68%);
  filter: blur(18px);
  opacity: .65;
  pointer-events: none;
}

section.asu-native-1920-v5 .card h3,
section.asu-native-1920-v5 .asu-card h3 {
  font-size: var(--asu-fs-h3);
  font-weight: 730;
  line-height: 1.18;
  letter-spacing: 0;
  margin: 0 0 .8rem;
}

section.asu-native-1920-v5 .card p,
section.asu-native-1920-v5 .asu-card p {
  font-size: var(--asu-fs-small);
  font-weight: 430;
  line-height: 1.54;
  letter-spacing: 0;
  margin: .2rem 0 0;
}

section.asu-native-1920-v5 .card ul,
section.asu-native-1920-v5 .card ol,
section.asu-native-1920-v5 .asu-card ul,
section.asu-native-1920-v5 .asu-card ol {
  /* V5 PR-A3 amendment 3: static value, slideRenderer overrides for largeStack. */
  margin: .7rem 0 0 1.1rem;
  padding: 0;
}

section.asu-native-1920-v5 .card li,
section.asu-native-1920-v5 .asu-card li {
  font-size: var(--asu-fs-small);
  line-height: 1.48;
  margin: .28rem 0;
}

section.asu-native-1920-v5 li::marker {
  color: var(--asu-accent-text);
}

/* PR1 (majestic-eagle, 2026-05-15): blockquote strengthened so raw Obsidian
   callouts (Obsidian NOTE/QUOTE syntax converted to bold-prefixed blockquote
   by obsidianCompat) stay visible without the deleted .asu-callout wrapper.
   The previous 4% white background was nearly invisible against cmds-dark
   base 020303. */
section.asu-native-1920-v5 blockquote {
  margin: 0.85rem 0;
  padding: 1.35rem 1.7rem 1.35rem 1.85rem;
  border-left: 5px solid var(--asu-accent);
  background: var(--asu-surface-strong);
  border-radius: 18px;
  color: var(--asu-text);
  box-shadow: 0 10px 28px rgba(0,0,0,0.22), inset 0 1px 0 var(--asu-card-highlight);
}

section.asu-native-1920-v5 blockquote > :first-child {
  margin-top: 0;
}

section.asu-native-1920-v5 blockquote > :last-child {
  margin-bottom: 0;
}

section.asu-native-1920-v5 blockquote p {
  margin: 0.5rem 0;
}

section.asu-native-1920-v5 blockquote :is(h1, h2, h3, h4, h5, h6) {
  margin: 0.7rem 0 0.4rem 0;
}

/* The first bold-prefixed paragraph inside a callout-converted blockquote
   is the callout header (obsidianCompat strips the NOTE/QUOTE bracket
   syntax and converts it to a bold-prefixed paragraph). Strengthen its
   presence so the callout reads as a labeled card without the deleted
   .asu-callout-label rule. */
section.asu-native-1920-v5 blockquote > p:first-child > strong:first-child,
section.asu-native-1920-v5 blockquote > p:first-of-type > strong:first-child {
  display: inline-block;
  font-size: 1.08em;
  margin-bottom: 0.35em;
  color: var(--asu-accent-text);
  letter-spacing: 0.01em;
}

section.asu-native-1920-v5 blockquote pre {
  margin: 0.85rem 0;
  background: var(--asu-surface-dark) !important;
  border: 1px solid var(--asu-border);
  border-radius: 14px;
}

section.asu-native-1920-v5 blockquote code {
  background: rgba(0,0,0,0.32);
}

section.asu-native-1920-v5 .quote,
section.asu-native-1920-v5 .asu-quote {
  font-size: 32px;
  font-weight: 520;
  line-height: 1.42;
  letter-spacing: 0;
}

/* Theme color parity fix: raw-flow emits bare <h1..h6> (no .hero/.title/.kicker
   semantic wrapper), so NO heading colour/weight rule applied and every theme
   rendered Marp-default white headings — zero theme identity on the slide
   title. Bind the heading treatment to bare headings under .asu-raw-flow and
   colour them with the theme accent (user-chosen). font-size / line-height
   still arrive as inline per-element vars from injectPerElementStyles, so we
   only set colour, weight, and the accent text treatment here. */
section.asu-native-1920-v5.asu-raw-flow :is(h1, h2, h3, h4, h5, h6) {
  color: var(--asu-accent-text);
  letter-spacing: 0;
  margin: 0 0 .5em;
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}
section.asu-native-1920-v5.asu-raw-flow h1 { font-weight: 840; }
section.asu-native-1920-v5.asu-raw-flow h2 { font-weight: 780; }
section.asu-native-1920-v5.asu-raw-flow :is(h3, h4, h5, h6) { font-weight: 730; }

section.asu-native-1920-v5 strong,
section.asu-native-1920-v5 b,
section.asu-native-1920-v5 .accent {
  ${strongRule}
  font-weight: 770;
}

section.asu-native-1920-v5 em {
  font-style: normal;
  color: var(--asu-text);
}

section.asu-native-1920-v5 a {
  color: var(--asu-accent-text);
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--asu-accent-text) 58%, transparent);
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5 code {
  font: 600 .94em/1.4 var(--asu-font-code);
  background: rgba(255,255,255,.07);
  padding: .12em .38em;
  border-radius: 8px;
  color: var(--asu-accent-text);
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5 pre {
  margin: 0;
  background: var(--asu-surface-dark) !important;
  border: 1px solid var(--asu-border);
  border-radius: 18px;
  padding: 1.15rem 1.2rem;
  overflow: hidden;
  font: 500 clamp(13px, 17px, 17px)/1.56 var(--asu-font-code);
}

section.asu-native-1920-v5 pre code {
  display: block;
  background: transparent !important;
  border: 0;
  padding: 0;
  color: var(--asu-text);
  /* V5 PR-A2: code typography sourced from --asu-code-font-size /
     --asu-code-line-height (slideRenderer injects). Fallbacks match the
     28pt LOCK output of deriveCodeMetrics so Marp passthrough rendering
     without slideRenderer still picks the locked sizes. */
  font-size: var(--asu-code-font-size, 24px);
  line-height: var(--asu-code-line-height, 38px);
  -webkit-text-stroke: var(--asu-text-stroke);
  paint-order: stroke fill;
  text-shadow: var(--asu-text-shadow-a), var(--asu-text-shadow-b);
}

section.asu-native-1920-v5 .asu-atlas-stack-frame pre,
section.asu-native-1920-v5 .asu-atlas-grid-frame pre,
section.asu-native-1920-v5 .two-col-left pre,
section.asu-native-1920-v5 .two-col-right pre {
  padding: .82rem .9rem;
}

section.asu-native-1920-v5 .asu-atlas-stack-frame pre code,
section.asu-native-1920-v5 .asu-atlas-grid-frame pre code,
section.asu-native-1920-v5 .two-col-left pre code,
section.asu-native-1920-v5 .two-col-right pre code {
  font-size: min(var(--asu-code-font-size, 24px), 18px);
  line-height: 1.42;
}

section.asu-native-1920-v5 .asu-code-omission {
  display: block;
  padding: .45rem 0;
  color: var(--asu-accent-text);
  font: 700 clamp(10px, 12px, 13px)/1.6 var(--asu-font-code);
  text-align: center;
  letter-spacing: .08em;
  text-transform: uppercase;
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5 .table-wrap {
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid var(--asu-border);
  background: ${isCmds ? "rgba(0,0,0,.22)" : "rgba(0,7,20,.22)"} !important;
}

section.asu-native-1920-v5 .asu-table-card .table-wrap + .table-wrap {
  margin-top: .76px;
}

/* v6.0 Tier 2 — 표를 카드처럼: **<table> 요소에 직접** 라운드/테두리/그림자(별도 wrapper div
   없이). wrapper로 감싸면 atomic html_block이 되어 큰 폰트에서 잘림·overflow가 깨졌다. 표 요소에
   직접 주면 표는 여전히 분할/truncate 가능(엔진 auditor가 overflow 0 수렴)하면서 카드 룩을 낸다.
   또 Marp GitHub CSS가 table을 display:block + width:max-content로 깔아 내용 폭으로만 렌더되던
   것(오른쪽 빈 공간·들쭉날쭉)을 display:table + width:100%로 고쳐 프레임 폭을 꽉 채운다
   (table-layout:auto = 라벨 칼럼은 좁게, 내용 칼럼은 넓게 내용 비례 분배). border-collapse는
   separate(+spacing 0)라야 border-radius가 먹는다. 정적 px/색(dogma #15: rule-level var/calc만
   SVG cascade에 무력화, 정적값은 안전). */
section.asu-native-1920-v5 table {
  display: table;
  width: 100%;
  max-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: auto;
  font-variant-numeric: tabular-nums;
  background: var(--asu-surface) !important;
  border: 1px solid var(--asu-border);
  border-radius: 14px;
  box-shadow: var(--asu-card-shadow);
  overflow: hidden;
}
/* 코너 셀을 표 라운드에 맞춰 navy 헤더 상단/마지막 행 하단 모서리를 둥글게(overflow:hidden 미지원
   브라우저 대비 이중 안전). 마지막 행 하단 보더는 표 보더와 겹치니 제거. */
section.asu-native-1920-v5 thead tr:first-child th:first-child { border-top-left-radius: 13px; }
section.asu-native-1920-v5 thead tr:first-child th:last-child { border-top-right-radius: 13px; }
section.asu-native-1920-v5 tbody tr:last-child td:first-child { border-bottom-left-radius: 13px; }
section.asu-native-1920-v5 tbody tr:last-child td:last-child { border-bottom-right-radius: 13px; }
section.asu-native-1920-v5 tbody tr:last-child td { border-bottom: 0 !important; }

/* Theme color parity fix: raw-flow emits a bare table (no .table-wrap
   wrapper), so the previous ".table-wrap thead/tbody/tr" scope no-opped and
   Marp's "default" import left its white tr background showing through —
   white text on a white row, unreadable in every theme. Generic scope so the
   reset reaches raw tables too; the per-cell color/bg lives on th/td below. */
section.asu-native-1920-v5 thead,
section.asu-native-1920-v5 tbody,
section.asu-native-1920-v5 tr {
  background: transparent !important;
  background-color: transparent !important;
}

section.asu-native-1920-v5 th,
section.asu-native-1920-v5 td {
  padding: .85rem .8rem;
  text-align: left;
  border: 0 !important;
  border-bottom: 1px solid rgba(255,255,255,.08) !important;
  overflow-wrap: break-word;
  background: transparent !important;
  background-color: transparent !important;
}

section.asu-native-1920-v5 .asu-table-frame th,
section.asu-native-1920-v5 .asu-table-frame td,
section.asu-native-1920-v5 .two-col-left .asu-table-card th,
section.asu-native-1920-v5 .two-col-left .asu-table-card td,
section.asu-native-1920-v5 .two-col-right .asu-table-card th,
section.asu-native-1920-v5 .two-col-right .asu-table-card td {
  padding: .56rem .5rem;
}

section.asu-native-1920-v5 .asu-table-frame th,
section.asu-native-1920-v5 .asu-table-frame td,
section.asu-native-1920-v5 .two-col-left .asu-table-card th,
section.asu-native-1920-v5 .two-col-left .asu-table-card td,
section.asu-native-1920-v5 .two-col-right .asu-table-card th,
section.asu-native-1920-v5 .two-col-right .asu-table-card td {
  font-size: var(--asu-fs-small);
  line-height: 1.25;
}

section.asu-native-1920-v5 th {
  font-size: var(--asu-fs-small);
  font-weight: 670;
  color: var(--asu-text);
}

/* Theme color parity fix: raw-flow tables have no semantic .asu-table-card
   header rule, so the header row was indistinguishable from body rows. Give
   the <thead> header a theme surface fill and an accent underline so the
   header reads as a header AND carries the theme's identity. The generic
   th/td rule above sets a transparent background with !important, so this rule
   must also use !important to win (thead th is also higher specificity). */
section.asu-native-1920-v5 thead th {
  background: var(--asu-surface-strong) !important;
  border-bottom: 2px solid color-mix(in srgb, var(--asu-accent) 48%, var(--asu-border)) !important;
}

section.asu-native-1920-v5 td {
  font-size: var(--asu-fs-small);
  font-weight: 430;
  line-height: 1.45;
  color: var(--asu-text);
}

section.asu-native-1920-v5 tr:last-child td {
  border-bottom: none;
}

section.asu-native-1920-v5 .asu-image-figure {
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

section.asu-native-1920-v5 .two-col-left .asu-image-figure,
section.asu-native-1920-v5 .two-col-right .asu-image-figure {
  width: 100%;
}

section.asu-native-1920-v5.asu-layout-image-panel .two-col-left .image-card,
section.asu-native-1920-v5.asu-layout-image-panel .two-col-right .image-card {
  min-height: 0;
  max-height: none;
}

section.asu-native-1920-v5.asu-layout-image-panel .two-col-left .image-card img,
section.asu-native-1920-v5.asu-layout-image-panel .two-col-left .image-card svg,
section.asu-native-1920-v5.asu-layout-image-panel .two-col-right .image-card img,
section.asu-native-1920-v5.asu-layout-image-panel .two-col-right .image-card svg {
  max-height: none;
}

section.asu-native-1920-v5 .image-card {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  place-items: center;
  width: 100%;
  max-width: 100%;
  max-height: none;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 20px;
  border: 1px solid var(--asu-border);
  background:
    linear-gradient(140deg, rgba(10,20,44,.95), rgba(18,44,88,.82)),
    radial-gradient(circle at 82% 18%, rgba(var(--asu-tone-b), .22), transparent 28%),
    radial-gradient(circle at 24% 78%, rgba(var(--asu-tone-a), .24), transparent 34%);
}

section.asu-native-1920-v5 .image-card::before {
  content: "";
  position: absolute;
  inset: 0;
  opacity: .28;
  background-image: linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px);
  background-size: 24px 24px;
}

section.asu-native-1920-v5 .image-card img,
section.asu-native-1920-v5 .image-card svg {
  position: relative;
  z-index: 1;
  min-width: 0;
  min-height: 0;
  width: calc(100% - 8px);
  height: calc(100% - 8px);
  max-width: 100%;
  max-height: 100%;
  object-fit: var(--asu-image-fit, contain);
  object-position: center center;
  display: block;
}

section.asu-native-1920-v5 .asu-slot[data-achmage-media-fit="cover"] .image-card img,
section.asu-native-1920-v5 .asu-slot[data-achmage-media-fit="cover"] .image-card svg {
  object-fit: cover;
}

section.asu-native-1920-v5 .asu-slot[data-achmage-media-fit="contain"] .image-card img,
section.asu-native-1920-v5 .asu-slot[data-achmage-media-fit="contain"] .image-card svg {
  object-fit: contain;
}

section.asu-native-1920-v5 .asu-media-lead {
  flex: 0 0 auto;
  margin: 0 0 .75rem;
  color: var(--asu-text);
  font-size: var(--asu-fs-small);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

section.asu-native-1920-v5 .asu-image-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  width: 100%;
  margin: 0 auto;
}

section.asu-native-1920-v5 .asu-image-grid .asu-image-figure {
  width: 100%;
  margin: 0;
}

section.asu-native-1920-v5 .asu-image-grid .image-card {
  border-radius: 16px;
  min-height: 194px;
}

section.asu-native-1920-v5 .video-card {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(220px, .88fr);
  gap: 1.2rem;
  align-items: stretch;
  width: 100%;
  min-height: 281px;
  margin: 0 auto;
  padding: 1rem;
  border-radius: 22px;
  border: 1px solid var(--asu-border);
  background: linear-gradient(180deg, var(--asu-surface-strong), var(--asu-surface));
  box-shadow: var(--asu-card-shadow), inset 0 1px 0 var(--asu-card-highlight);
  color: var(--asu-text);
  text-decoration: none;
  border-bottom: 0;
  pointer-events: auto;
  overflow: hidden;
}

section.asu-native-1920-v5 .asu-video-standalone {
  width: 100%;
  max-width: 100%;
  min-height: 454px;
  margin: 11px auto 0;
}

section.asu-native-1920-v5 .asu-video-frame {
  max-width: 1459px;
}

section.asu-native-1920-v5 .asu-video-frame .title {
  margin-bottom: 26px;
}

section.asu-native-1920-v5 .video-thumb {
  position: relative;
  min-height: 238px;
  border-radius: 16px;
  background:
    linear-gradient(140deg, rgba(10,20,44,.95), rgba(18,44,88,.82)),
    radial-gradient(circle at 82% 18%, rgba(var(--asu-tone-b), .22), transparent 28%),
    radial-gradient(circle at 24% 78%, rgba(var(--asu-tone-a), .24), transparent 34%);
  background-size: cover;
  background-position: center;
  overflow: hidden;
}

section.asu-native-1920-v5 .video-thumb::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,.44));
}

section.asu-native-1920-v5 .video-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 999px;
  background: rgba(0,0,0,.54);
  border: 1px solid rgba(255,255,255,.18);
  color: var(--asu-accent-text);
  font-size: 24px;
  font-weight: 800;
  box-shadow: 0 0 24px rgba(199,255,100,.18);
}

section.asu-native-1920-v5 .video-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: .75rem;
}

section.asu-native-1920-v5 .video-copy strong {
  display: block;
  font-size: var(--asu-fs-h3);
  line-height: 1.16;
}

section.asu-native-1920-v5 .video-url {
  color: var(--asu-text);
  font: 600 var(--asu-fs-small)/1.35 var(--asu-font-code);
  overflow-wrap: anywhere;
}

section.asu-native-1920-v5 .external-thumb {
  background:
    linear-gradient(135deg, rgba(255,255,255,.09), rgba(255,255,255,.035)),
    radial-gradient(circle at 50% 50%, rgba(199,255,100,.16), transparent 52%);
}

/* PR1 (majestic-eagle, 2026-05-15) + PR3 follow-up (2026-05-19): raw markdown
   image safety. The previous max-height: none let user screenshots render at
   native pixel height, which overflowed the 936px frame inner area and
   spilled across the lime accent frame lines. With the v5 atlas wrapper
   deleted there is no .image-card anymore, so this general rule must enforce
   the cap.
   PR3 follow-up: 820px felt overwhelming for icon/emoji-like images (user
   feedback — a single pencil icon dominated the whole frame). Lowered to
   540px and added max-width clamp so square-ish images don't fill horizontal
   space either. Matches estimateImageHeight unknown-aspect default 700→540
   range comfortably (render still has headroom vs measurement).
   The marp-emoji / emoji inline rule below keeps shortcode emoji at text
   size so they don't trigger the block-image path. */
section.asu-native-1920-v5 img {
  max-width: min(960px, 100%);
  max-height: 540px;
  height: auto;
  width: auto;
  object-fit: contain;
  display: block;
  margin: 0 auto;
}

/* Marp converts emoji shortcodes (e.g. :pencil:) and Unicode emoji into
   inline <img class="marp-emoji"> elements. Without this override the block
   image rule above would scale them to 540px tall — wrong for inline icons.
   1em keeps them text-sized; vertical-align prevents baseline drift. */
section.asu-native-1920-v5 img.marp-emoji,
section.asu-native-1920-v5 img.emoji,
section.asu-native-1920-v5 .marp-emoji {
  display: inline-block;
  width: 1em;
  height: 1em;
  max-width: 1em;
  max-height: 1em;
  vertical-align: -0.15em;
  margin: 0;
}

section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"] .asu-image-figure,
section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"] .image-card,
section.asu-native-1920-v5 .asu-slot[data-role="image-a"] .asu-image-figure,
section.asu-native-1920-v5 .asu-slot[data-role="image-a"] .image-card,
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] .asu-image-figure,
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] .image-card,
section.asu-native-1920-v5 .asu-slot[data-role="dominant-video"] .video-card,
section.asu-native-1920-v5 .asu-slot[data-role="table"] .table-wrap,
section.asu-native-1920-v5 .asu-slot[data-role="code"] pre,
section.asu-native-1920-v5 .asu-slot[data-role="quote"] .asu-quote-card {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  box-sizing: border-box;
}

section.asu-native-1920-v5 .asu-code-card {
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: clip;
}

section.asu-native-1920-v5 .asu-code-card .asu-body,
section.asu-native-1920-v5 .asu-code-card .asu-code-label {
  flex: 0 0 auto;
}

section.asu-native-1920-v5 .asu-slot[data-role="code"] .asu-code-card pre {
  height: auto;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
}

section.asu-native-1920-v5 .asu-slot[data-role="quote"] .asu-quote-card {
  width: min(100%, calc(var(--asu-frame-w) * .58));
  height: auto;
  max-width: min(100%, calc(var(--asu-frame-w) * .58));
  margin: 0 auto;
}

section.asu-native-1920-v5 .asu-slot[data-role="callout"][data-achmage-slot-dominance="solo"] {
  display: flex;
  align-items: center;
  justify-content: center;
}

section.asu-native-1920-v5 .asu-slot[data-role="callout"][data-achmage-slot-dominance="solo"] .asu-slot-inner {
  justify-content: center;
}

section.asu-native-1920-v5 .asu-slot[data-role="callout"] .asu-callout {
  width: 100%;
  max-width: 100%;
  height: auto;
  max-height: 100%;
  margin: 0 auto;
}

section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"] .image-card,
section.asu-native-1920-v5 .asu-slot[data-role="image-a"] .image-card,
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] .image-card {
  aspect-ratio: auto;
}

section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"] .image-card img,
section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"] .image-card svg,
section.asu-native-1920-v5 .asu-slot[data-role="image-a"] .image-card img,
section.asu-native-1920-v5 .asu-slot[data-role="image-a"] .image-card svg,
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] .image-card img,
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] .image-card svg {
  width: calc(100% - 8px);
  height: calc(100% - 8px);
  max-width: 100%;
  max-height: 100%;
  object-fit: var(--asu-image-fit, contain);
  object-position: center center;
}

section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"],
section.asu-native-1920-v5 .asu-slot[data-role="image-a"],
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] {
  display: block;
}

section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"] .asu-slot-inner,
section.asu-native-1920-v5 .asu-slot[data-role="image-a"] .asu-slot-inner,
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] .asu-slot-inner {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
}

section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"] .asu-slot-inner > .asu-kicker,
section.asu-native-1920-v5 .asu-slot[data-role="image-a"] .asu-slot-inner > .asu-kicker,
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] .asu-slot-inner > .asu-kicker,
section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"] .asu-caption,
section.asu-native-1920-v5 .asu-slot[data-role="image-a"] .asu-caption,
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] .asu-caption {
  flex: 0 0 auto;
}

section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"] .asu-image-figure,
section.asu-native-1920-v5 .asu-slot[data-role="image-a"] .asu-image-figure,
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] .asu-image-figure {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 12px;
  height: 100%;
  min-height: 0;
  align-items: stretch;
  justify-content: stretch;
}

section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"] .asu-caption,
section.asu-native-1920-v5 .asu-slot[data-role="image-a"] .asu-caption,
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] .asu-caption {
  margin-top: 0 !important;
}

section.asu-native-1920-v5 .asu-slot[data-role="dominant-image"] .image-card,
section.asu-native-1920-v5 .asu-slot[data-role="image-a"] .image-card,
section.asu-native-1920-v5 .asu-slot[data-role="image-b"] .image-card {
  min-height: 0;
  height: 100%;
  max-height: 100%;
}

section.asu-native-1920-v5 .asu-slot[data-role="support-image"] .image-card,
section.asu-native-1920-v5 .asu-slot[data-role="source-strip"] .asu-source-strip {
  max-height: 100%;
}

section.asu-native-1920-v5 .kpi-grid,
section.asu-native-1920-v5 .asu-kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-top: 1rem;
}

section.asu-native-1920-v5 .kpi,
section.asu-native-1920-v5 .asu-kpi {
  padding: 1rem .9rem;
  border-radius: 18px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.10);
}

section.asu-native-1920-v5 .kpi .label,
section.asu-native-1920-v5 .asu-kpi-label {
  font-size: var(--asu-fs-small);
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--asu-text);
  margin: 0 0 .45rem;
  font-family: var(--asu-font-code);
}

section.asu-native-1920-v5 .kpi .val,
section.asu-native-1920-v5 .asu-kpi-value {
  font-size: 40px;
  font-weight: 860;
  line-height: .94;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
  color: ${isCmds ? "var(--asu-accent-text)" : "var(--asu-text)"};
}

section.asu-native-1920-v5 .kpi .delta,
section.asu-native-1920-v5 .asu-kpi-delta {
  font-size: var(--asu-fs-small);
  color: var(--asu-text);
  margin-top: .32rem;
}

section.asu-native-1920-v5 .terminal {
  font-family: var(--asu-font-code);
  background: rgba(0,0,0,.34);
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 18px;
  padding: 1rem 1.1rem;
}

section.asu-native-1920-v5 .terminal-line {
  font-size: 18px;
  line-height: 1.55;
  margin: .25rem 0;
  color: var(--asu-text);
}

section.asu-native-1920-v5 .terminal-line .prompt {
  color: var(--asu-accent-text);
  font-weight: 780;
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5 .tasklist {
  list-style: none;
  margin: .8rem 0 0;
  padding: 0;
}

section.asu-native-1920-v5 .tasklist li {
  position: relative;
  padding-left: 1.7rem;
  margin: .42rem 0;
  font-size: var(--asu-fs-small);
  line-height: 1.48;
  color: var(--asu-text);
}

section.asu-native-1920-v5 .tasklist li::before {
  content: "\\2713";
  position: absolute;
  left: 0;
  top: .02em;
  color: var(--asu-accent-text);
  font-weight: 780;
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5 .small-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-top: 1rem;
}

section.asu-native-1920-v5 .asu-group-frame .title {
  margin-bottom: 23px;
}

section.asu-native-1920-v5 .asu-copy-stack {
  display: grid;
  gap: 12px;
}

section.asu-native-1920-v5 .asu-section-list-card {
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  text-align: left;
}

section.asu-native-1920-v5 .section-label {
  margin: 0 0 1rem;
  color: var(--asu-accent-text);
  font-size: var(--asu-fs-h3);
  line-height: 1.2;
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5 .card .section-label,
section.asu-native-1920-v5 .asu-card .section-label {
  color: var(--asu-accent-text);
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5 .asu-list {
  /* V5 PR-A3 amendment 3: static, slideRenderer overrides for largeStack. */
  margin: .5rem 0 0 1.15rem;
  padding: 0;
}

section.asu-native-1920-v5 .asu-list li {
  font-size: var(--asu-fs-body);
  line-height: 1.42;
  /* V5 PR-A3 amendment 3: static, slideRenderer overrides for largeStack. */
  margin: .55rem 0;
}

section.asu-native-1920-v5 .asu-quote-card {
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
}

section.asu-native-1920-v5 .asu-callout {
  position: relative;
  width: 100%;
  max-width: 100%;
  margin: 23px auto 0;
  padding: 1.05rem 1.2rem 1.15rem;
  text-align: left;
  border-radius: 10px;
  border: 1px solid var(--asu-border);
  border-left: 2px solid var(--asu-accent-text);
  background: var(--asu-callout-bg);
  box-shadow: inset 0 1px 0 var(--asu-card-highlight), 0 8px 28px rgba(0,0,0,.12);
  overflow: visible;
}

section.asu-native-1920-v5 .card .asu-callout,
section.asu-native-1920-v5 .asu-card .asu-callout,
section.asu-native-1920-v5 .asu-atlas-grid-cell .asu-callout {
  width: 100%;
  max-width: 100%;
  margin: .9rem 0 0;
  box-sizing: border-box;
}

section.asu-native-1920-v5 .asu-atlas-grid-cell .asu-callout {
  margin: 0;
}

section.asu-native-1920-v5 .asu-callout::before {
  content: none;
}

/* v6.0 (Tier 2) — 콜아웃 타입별 강조색 + 타이틀(label) 스타일. 색은 light/dark 양쪽에서
   읽히는 고정 hue. 미정의 타입은 기본 .asu-callout(테마 accent)로 폴백. 타이틀은
   obsidianCompat가 만든 첫 줄 **Label: title** = 첫 문단의 strong. */
section.asu-native-1920-v5 .asu-callout > :first-child { margin-top: 0; }
section.asu-native-1920-v5 .asu-callout > p:first-of-type { margin: 0 0 .5rem; }
section.asu-native-1920-v5 .asu-callout p:first-of-type strong:first-child {
  font-weight: 800;
  letter-spacing: -0.005em;
}
/* note 계열 — 파랑 */
section.asu-native-1920-v5 .asu-callout-note,
section.asu-native-1920-v5 .asu-callout-info,
section.asu-native-1920-v5 .asu-callout-tip,
section.asu-native-1920-v5 .asu-callout-hint,
section.asu-native-1920-v5 .asu-callout-abstract,
section.asu-native-1920-v5 .asu-callout-summary,
section.asu-native-1920-v5 .asu-callout-tldr { border-left-color: var(--asu-cl-info); }
section.asu-native-1920-v5 .asu-callout-note p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-info p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-tip p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-hint p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-abstract p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-summary p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-tldr p:first-of-type strong:first-child { color: var(--asu-cl-info); }
/* important/warning 계열 — 앰버 */
section.asu-native-1920-v5 .asu-callout-important,
section.asu-native-1920-v5 .asu-callout-warning,
section.asu-native-1920-v5 .asu-callout-attention,
section.asu-native-1920-v5 .asu-callout-caution,
section.asu-native-1920-v5 .asu-callout-todo { border-left-color: var(--asu-cl-warn); }
section.asu-native-1920-v5 .asu-callout-important p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-warning p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-attention p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-caution p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-todo p:first-of-type strong:first-child { color: var(--asu-cl-warn); }
/* success 계열 — 초록 */
section.asu-native-1920-v5 .asu-callout-success,
section.asu-native-1920-v5 .asu-callout-check,
section.asu-native-1920-v5 .asu-callout-done { border-left-color: var(--asu-cl-ok); }
section.asu-native-1920-v5 .asu-callout-success p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-check p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-done p:first-of-type strong:first-child { color: var(--asu-cl-ok); }
/* question 계열 — 보라 */
section.asu-native-1920-v5 .asu-callout-question,
section.asu-native-1920-v5 .asu-callout-faq { border-left-color: var(--asu-cl-q); }
section.asu-native-1920-v5 .asu-callout-question p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-faq p:first-of-type strong:first-child { color: var(--asu-cl-q); }
/* danger 계열 — 빨강 */
section.asu-native-1920-v5 .asu-callout-danger,
section.asu-native-1920-v5 .asu-callout-error,
section.asu-native-1920-v5 .asu-callout-fail,
section.asu-native-1920-v5 .asu-callout-bug,
section.asu-native-1920-v5 .asu-callout-missing { border-left-color: var(--asu-cl-danger); }
section.asu-native-1920-v5 .asu-callout-danger p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-error p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-fail p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-bug p:first-of-type strong:first-child,
section.asu-native-1920-v5 .asu-callout-missing p:first-of-type strong:first-child { color: var(--asu-cl-danger); }
/* quote/cite 계열 — slate. 마커 없는 평범한 인용문(.asu-callout--plain)도 여기로. */
section.asu-native-1920-v5 .asu-callout-quote,
section.asu-native-1920-v5 .asu-callout-cite { border-left-color: var(--asu-cl-quote); }
/* 평범한 인용문 — 따옴표 장식 + 약한 이탤릭으로 '인용' 느낌. */
section.asu-native-1920-v5 .asu-callout--plain {
  position: relative;
  padding-left: 2.4rem;
  font-style: italic;
}
section.asu-native-1920-v5 .asu-callout--plain::before {
  content: "\\201C";
  position: absolute;
  left: 0.7rem;
  top: 0.1rem;
  font-size: 2.6rem;
  line-height: 1;
  font-style: normal;
  font-weight: 800;
  color: color-mix(in srgb, var(--asu-cl-quote) 70%, transparent);
}

section.asu-native-1920-v5 .asu-callout-blockquote {
  width: 100%;
  max-width: min(100%, calc(var(--asu-frame-w) * .58));
  margin: 23px auto 0;
}

section.asu-native-1920-v5 .callout-heading {
  display: flex;
  align-items: center;
  gap: .55rem;
  width: calc(100% - 8px);
  margin-bottom: .72rem;
  margin-left: 2px;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

section.asu-native-1920-v5 .callout-icon {
  display: inline-grid;
  place-items: center;
  width: .72rem;
  height: .72rem;
  flex: 0 0 auto;
  color: var(--asu-accent-text);
  border: 1px solid color-mix(in srgb, var(--asu-accent-text) 54%, transparent);
  border-radius: 999px;
  font: 760 .46rem/1 var(--asu-font-code);
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5 .callout-label {
  color: var(--asu-accent-text);
  font: 760 clamp(10px, 12px, 13px)/1.1 var(--asu-font-code);
  letter-spacing: .12em;
  text-transform: uppercase;
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5 .callout-title {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--asu-fs-h3);
  line-height: 1.2;
  color: var(--asu-text);
  -webkit-text-stroke: var(--asu-text-stroke);
  paint-order: stroke fill;
  text-shadow: var(--asu-text-shadow-a), var(--asu-text-shadow-b);
}

section.asu-native-1920-v5 .callout-body {
  margin: .45rem 0 0;
  color: var(--asu-text);
  font-size: var(--asu-fs-small);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

section.asu-native-1920-v5 .callout-body code {
  overflow-wrap: anywhere;
  word-break: break-word;
}

section.asu-native-1920-v5 .asu-callout .callout-list,
section.asu-native-1920-v5 .asu-callout-blockquote .callout-list {
  margin: .45em 0 0 1.1em;
  padding: 0;
}

section.asu-native-1920-v5 .asu-callout .callout-list li,
section.asu-native-1920-v5 .asu-callout-blockquote .callout-list li {
  color: var(--asu-text);
  font-size: var(--asu-fs-small);
  line-height: 1.45;
  margin: .28em 0;
  overflow-wrap: anywhere;
}

section.asu-native-1920-v5 .asu-slot[data-achmage-singleton-short="true"] {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

section.asu-native-1920-v5 .asu-slot[data-achmage-singleton-short="true"] > .asu-slot-inner {
  justify-content: center;
}

section.asu-native-1920-v5 .asu-slot[data-achmage-singleton-short="true"] .asu-slot-inner > .card,
section.asu-native-1920-v5 .asu-slot[data-achmage-singleton-short="true"] .asu-slot-inner > .asu-card,
section.asu-native-1920-v5 .asu-slot[data-achmage-singleton-short="true"] .asu-slot-inner > .asu-callout {
  flex: 0 0 auto;
}

section.asu-native-1920-v5 .markdown-tag {
  display: inline-flex;
  align-items: center;
  gap: .45rem;
  padding: .5rem .75rem;
  border-radius: 999px;
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.12);
  font-size: var(--asu-fs-small);
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--asu-text);
}

section.asu-native-1920-v5 .asu-source-strip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 43px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: .55rem;
  min-width: 0;
  font-family: var(--asu-font-code);
  pointer-events: none;
}

section.asu-native-1920-v5 .asu-source-strip .markdown-tag {
  padding: .26rem .48rem;
  font-size: 9px;
  opacity: .72;
}

section.asu-native-1920-v5 .asu-source-item {
  display: inline-block;
  max-width: min(365px, 260px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--asu-text);
  font: 600 var(--asu-fs-small)/1.35 var(--asu-font-code);
  letter-spacing: .02em;
}

section.asu-native-1920-v5 .asu-source-tag {
  color: var(--asu-accent-text);
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5 .asu-source-card .asu-source-strip {
  position: relative;
  left: auto;
  right: auto;
  bottom: auto;
  justify-content: flex-start;
  flex-wrap: wrap;
}

section.asu-native-1920-v5 .asu-debug-overlay {
  position: absolute;
  right: calc(var(--asu-frame-x) + 1px);
  top: calc(var(--asu-rule-y) + 13px);
  z-index: 12;
  width: min(576px, 360px);
  max-height: 302px;
  overflow: hidden;
  padding: .72rem .82rem;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.18);
  background: rgba(0,0,0,.58);
  box-shadow: 0 12px 32px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.14);
  color: var(--asu-text);
  font: 600 var(--asu-fs-small)/1.35 var(--asu-font-code);
  text-align: left;
}

section.asu-native-1920-v5 .asu-debug-overlay .markdown-tag {
  padding: .22rem .42rem;
  margin-bottom: .35rem;
  font-size: var(--asu-fs-small);
}

section.asu-native-1920-v5 .asu-debug-overlay div {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

section.asu-native-1920-v5 .asu-debug-overlay strong {
  color: var(--asu-accent-text);
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5 .meta,
section.asu-native-1920-v5 .asu-meta {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -27px;
  z-index: 9;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: var(--asu-fs-footer);
  font-weight: 680;
  letter-spacing: .075em;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
  font-family: var(--asu-font-code);
  color: var(--asu-text-faint);
  -webkit-text-stroke: var(--asu-text-stroke-faint);
  paint-order: stroke fill;
  text-shadow: var(--asu-text-shadow-a), var(--asu-text-shadow-b);
}

section.asu-native-1920-v5 .asu-meta span:first-child {
  color: var(--asu-footer-accent);
}

section.asu-native-1920-v5 .asu-meta span:last-child {
  color: var(--asu-footer-muted);
}

section.asu-native-1920-v5 hr {
  border: none;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent);
  margin: 1rem 0;
}

section.asu-native-1920-v5.asu-detail-minimal::before {
  opacity: .55;
}

section.asu-native-1920-v5.asu-detail-minimal {
  --asu-text-stroke: .22px ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.58)" : "rgba(2,4,10,.54)"};
  --asu-text-stroke-faint: .18px ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.48)" : "rgba(2,4,10,.46)"};
  --asu-text-shadow-a: 0 1px 3px ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.22)" : "rgba(0,0,0,.18)"};
  --asu-text-shadow-b: 0 5px 14px ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.12)" : "rgba(0,0,0,.10)"};
  --asu-card-shadow: ${isLight ? "0 1px 2px rgba(15,22,32,.05), 0 2px 8px rgba(15,22,32,.04)" : "0 10px 30px rgba(0,0,0,.18)"};
  --asu-card-highlight: ${isLight ? "transparent" : isCmds ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.18)"};
}

section.asu-native-1920-v5.asu-detail-standard {
  --asu-text-stroke: .68px var(--asu-stroke);
  --asu-text-stroke-faint: .68px ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.90)" : "rgba(2,4,10,.88)"};
  --asu-text-shadow-a: 0 2px 8px var(--asu-shadow-a);
  --asu-text-shadow-b: 0 12px 34px var(--asu-shadow-b);
  --asu-card-shadow: ${isLight ? "0 4px 12px rgba(15,22,32,.06), 0 10px 28px rgba(15,22,32,.06)" : isCmds ? "0 12px 40px rgba(0,0,0,.26)" : "0 12px 40px rgba(0,0,0,.18)"};
  --asu-card-highlight: ${isLight ? "transparent" : isCmds ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.28)"};
}

section.asu-native-1920-v5.asu-detail-ultra {
  --asu-text-stroke: .94px ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.97)" : "rgba(2,4,10,.94)"};
  --asu-text-stroke-faint: .94px ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.95)" : "rgba(2,4,10,.92)"};
  --asu-text-shadow-a: 0 2px 9px ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.68)" : "rgba(0,0,0,.58)"};
  --asu-text-shadow-b: 0 14px 42px ${isLight ? "transparent" : isCmds ? "rgba(0,0,0,.44)" : "rgba(0,0,0,.36)"};
  --asu-card-shadow: ${isLight ? "0 12px 32px rgba(0,46,110,.10), 0 32px 64px rgba(0,46,110,.10)" : isCmds ? "0 28px 92px rgba(0,0,0,.42)" : "0 28px 92px rgba(0,0,0,.34)"};
  --asu-card-highlight: ${isLight ? "transparent" : isCmds ? "rgba(255,255,255,.30)" : "rgba(255,255,255,.34)"};
}

section.asu-native-1920-v5.asu-detail-ultra .hero,
section.asu-native-1920-v5.asu-detail-ultra .title,
section.asu-native-1920-v5.asu-detail-ultra .body,
section.asu-native-1920-v5.asu-detail-ultra .small,
section.asu-native-1920-v5.asu-detail-ultra .meta,
section.asu-native-1920-v5.asu-detail-ultra .card h3,
section.asu-native-1920-v5.asu-detail-ultra .card p,
section.asu-native-1920-v5.asu-detail-ultra .card li,
section.asu-native-1920-v5.asu-detail-ultra .quote,
section.asu-native-1920-v5.asu-detail-ultra .caption,
section.asu-native-1920-v5.asu-detail-ultra .video-card,
section.asu-native-1920-v5.asu-detail-ultra .markdown-tag,
section.asu-native-1920-v5.asu-detail-ultra .asu-source-strip,
section.asu-native-1920-v5.asu-detail-ultra .asu-debug-overlay,
section.asu-native-1920-v5.asu-detail-ultra .asu-callout {
  -webkit-text-stroke: var(--asu-text-stroke);
  paint-order: stroke fill;
  text-shadow: var(--asu-text-shadow-a), var(--asu-text-shadow-b);
}

section.asu-native-1920-v5.asu-detail-ultra .card h3.section-label,
section.asu-native-1920-v5.asu-detail-ultra .asu-card h3.section-label,
section.asu-native-1920-v5.asu-detail-ultra strong:not(.callout-title),
section.asu-native-1920-v5.asu-detail-ultra b,
section.asu-native-1920-v5.asu-detail-ultra a,
section.asu-native-1920-v5.asu-detail-ultra code:not(pre code),
section.asu-native-1920-v5.asu-detail-ultra .accent,
section.asu-native-1920-v5.asu-detail-ultra .section-label,
section.asu-native-1920-v5.asu-detail-ultra .callout-label,
section.asu-native-1920-v5.asu-detail-ultra .callout-icon,
section.asu-native-1920-v5.asu-detail-ultra .terminal-line .prompt,
section.asu-native-1920-v5.asu-detail-ultra .tasklist li::before,
section.asu-native-1920-v5.asu-detail-ultra .asu-source-tag,
section.asu-native-1920-v5.asu-detail-ultra .asu-debug-overlay strong {
  color: var(--asu-accent-text);
  -webkit-text-stroke: 0;
  paint-order: normal;
  text-shadow: var(--asu-accent-shadow);
}

section.asu-native-1920-v5.asu-detail-ultra .card,
section.asu-native-1920-v5.asu-detail-ultra .asu-card,
section.asu-native-1920-v5.asu-detail-ultra .video-card,
section.asu-native-1920-v5.asu-detail-ultra .asu-callout {
  box-shadow: var(--asu-card-shadow), inset 0 1px 0 var(--asu-card-highlight);
}
${isLight ? `
/* ─────────────────────────────────────────────────────────────────────
   hallym-light — light-mode rule-body overrides (first light theme).
   Scoped to .asu-hallym-light (one extra class) so these win over the
   generic dark rules above on specificity; appended last so equal-
   specificity ties (e.g. .asu-detail-ultra re-colour rules) resolve to
   light by source order. The variable layer (vars()/detail variants) is
   already light; this block carries the Hallym 3-colour split that a
   single --asu-accent-text cannot express: heading/strong = navy,
   link/inline-code = blue, accent/marker/rule = teal. Static literals /
   var() only — no dynamic calc() or per-element !important (Dogma #15). */

/* Headings → navy, plus the Hallym signature 3px×80px teal accent rule
   under the slide-title levels (h1/h2). */
section.asu-native-1920-v5.asu-hallym-light.asu-raw-flow :is(h1, h2, h3, h4, h5, h6) {
  color: var(--asu-accent-dim);
}
section.asu-native-1920-v5.asu-hallym-light.asu-raw-flow :is(h1, h2)::after {
  content: "";
  display: block;
  width: 80px;
  height: 3px;
  margin: 12px 0 0;
  background: var(--asu-accent);
  border-radius: 999px;
}

/* Strong → navy, link → blue. */
section.asu-native-1920-v5.asu-hallym-light strong,
section.asu-native-1920-v5.asu-hallym-light b,
section.asu-native-1920-v5.asu-hallym-light .accent {
  color: var(--asu-accent-dim);
}

/* Tier 2 카드/섹션 타이틀 → navy (raw-flow 헤딩·strong과 동일 정책; div라 위 h1-6 룰을
   안 타므로 별도 override). rule(::after)은 공통 블록이 이미 teal(var(--asu-accent)). */
section.asu-native-1920-v5.asu-hallym-light :is(.asu-card-title, .asu-section-title) {
  color: var(--asu-accent-dim);
}
/* defgrid 라벨 → navy (card-title과 동일 정책; div라 위 h1-6 룰을 안 타므로 별도 override). */
section.asu-native-1920-v5.asu-hallym-light .asu-def-label {
  color: var(--asu-accent-dim);
}
/* 칩(nested 짧은 서브)은 키컬러(navy) 리스트 카드(v7.0) 안에 놓인다. 기본 칩 배경은
   테마 surface(--asu-surface-strong)라 light에선 near-white(#FAFBFC)인데, v7.0이 카드
   후손 텍스트를 흰색으로 강제하므로 흰 글씨가 밝은 pill에 묻혔다. 카드 상대 반투명
   오버레이 pill로 교체해 다크 테마처럼 또렷하게. (다크는 이 블록 미emit → 무영향) */
section.asu-native-1920-v5.asu-hallym-light .asu-chip {
  background: rgba(255, 255, 255, .16);
  border-color: rgba(255, 255, 255, .28);
  color: #ffffff;
}
section.asu-native-1920-v5.asu-hallym-light a {
  color: var(--asu-accent-soft);
  border-bottom-color: color-mix(in srgb, var(--asu-accent-soft) 50%, transparent);
}

/* Inline code → pale gray chip, blue text (exclude pre code, which stays
   navy-black body text on the gray-100 code card). */
section.asu-native-1920-v5.asu-hallym-light code:not(pre code) {
  background: var(--asu-surface-dark);
  color: var(--asu-accent-soft);
}

/* Code card → gray-100 surface (via --asu-surface-dark), 22px round, e1. */
section.asu-native-1920-v5.asu-hallym-light pre {
  border-radius: 22px;
  box-shadow: 0 1px 2px rgba(15,22,32,.05), 0 2px 8px rgba(15,22,32,.04);
}

/* Blockquote → off-white card, soft e1, teal left rule, navy header. */
section.asu-native-1920-v5.asu-hallym-light blockquote {
  box-shadow: 0 1px 2px rgba(15,22,32,.05), 0 2px 8px rgba(15,22,32,.04);
}
section.asu-native-1920-v5.asu-hallym-light blockquote > p:first-child > strong:first-child,
section.asu-native-1920-v5.asu-hallym-light blockquote > p:first-of-type > strong:first-child {
  color: var(--asu-accent-dim);
}
section.asu-native-1920-v5.asu-hallym-light blockquote code {
  background: var(--asu-base-3);
}

/* Tables → navy header with white text, gray-200 row separators, off-white
   even-row stripe. v5.5-style generic scope (no .table-wrap dependency) so
   the rules reach bare raw-flow tables; on a white surface, transparent
   separators would otherwise collapse header and body into one block. */
section.asu-native-1920-v5.asu-hallym-light th,
section.asu-native-1920-v5.asu-hallym-light td {
  border-bottom: 1px solid var(--asu-border) !important;
}
section.asu-native-1920-v5.asu-hallym-light thead th {
  background: var(--asu-accent-dim) !important;
  color: #ffffff !important;
  border-bottom: 0 !important;
}
section.asu-native-1920-v5.asu-hallym-light tbody tr:nth-child(even) {
  background: var(--asu-surface-strong) !important;
}
section.asu-native-1920-v5.asu-hallym-light .table-wrap {
  background: var(--asu-base-0) !important;
}

/* Horizontal rule → faint navy hairline. */
section.asu-native-1920-v5.asu-hallym-light hr {
  background: linear-gradient(90deg, transparent, rgba(15,22,32,.14), transparent);
}

/* v5.7 — 타이틀 슬라이드(light 전용): navy 타이틀 + Hallym teal 시그니처 밑줄.
   타이틀은 <div>라 :is(h1,h2)::after 룰을 안 타므로 여기서 별도 ::after를 단다. */
section.asu-native-1920-v5.asu-hallym-light.asu-title-slide .asu-title-text {
  color: var(--asu-accent-dim);
  text-shadow: none;
}
section.asu-native-1920-v5.asu-hallym-light.asu-title-slide .asu-title-text::after {
  content: "";
  display: block;
  width: 120px;
  height: 4px;
  margin: 28px auto 0;
  background: var(--asu-accent);
  border-radius: 999px;
}

/* v6.0 — divider(light 전용): navy hero. accent rule은 공통 규칙이 이미 teal. */
section.asu-native-1920-v5.asu-hallym-light.asu-divider .asu-divider-text {
  color: var(--asu-accent-dim);
  text-shadow: none;
}
` : ""}

/* ── v7.0 — 리스트 카드 키컬러 통일 + (Tier 3) 본문 반투명 패널 ───────────────────
   템플릿 맨 끝(모든 공통·hallym 룰 뒤)이라 기존 카드 배경/글자색 룰을 전부 덮는다. */

/* (1) 모든 리스트 카드(bento/defgrid/card-grid + nested) → 테마 키컬러(accent-dim)
   진한 배경 + 흰 글씨로 통일. 배경 ON/OFF 무관(항상). 밝은 테마(hallym)의 흰/유리
   카드가 밋밋하던 문제 해소. .image-card/.video-thumb(콘텐츠 미디어)·코드·콜아웃은 제외. */
section.asu-native-1920-v5 :is(.asu-card, .dgroup) {
  background:
    linear-gradient(160deg,
      color-mix(in srgb, ${cardKey} 90%, #060a14),
      color-mix(in srgb, ${cardKey} 64%, #02040a)) !important;
  border: 1px solid color-mix(in srgb, ${cardKey} 44%, #ffffff 30%) !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
/* 카드 내부 모든 글씨 흰색 통일 — 클래스 열거(.asu-def-main 등) 누락을 피하려 후손
   전체(*)에 적용. 라벨/본문/통계/nested sub 전부 흰색. !important로 테마 회색·navy 룰 덮음. */
section.asu-native-1920-v5 :is(.asu-card, .dgroup),
section.asu-native-1920-v5 :is(.asu-card, .dgroup) * {
  color: #ffffff !important;
  text-shadow: none !important;
}
section.asu-native-1920-v5 :is(.asu-card, .dgroup) li::marker {
  color: rgba(255, 255, 255, .72);
}

/* (1b) 인라인 코드(백틱 1개) → 테마 키컬러 칩 + 흰 글자로 통일. 기존 테마 룰은 밝은
   칩+옅은 글자라 light wash 본문 패널(흰 배경) 위에서 흰배경+흰글자처럼 묻혔다.
   카드와 같은 cardKey를 쓰되 흰 보더로 본문/카드 위 모두 또렷하게. pre code(코드블록) 제외. */
section.asu-native-1920-v5 code:not(pre code) {
  background: ${cardKey} !important;
  color: #ffffff !important;
  border: 1px solid color-mix(in srgb, #ffffff 26%, transparent);
  border-radius: 7px;
  padding: .08em .4em;
  text-shadow: none !important;
}

/* (2) Tier 3 배경 ON일 때만 — raw-flow 본문 문단에만 콜아웃 패널(반투명, 가로 꽉차게)을
   깔아 사진 위 가독성 확보. light wash=밝은 패널+navy, dark wash=어두운 패널+흰.
   셀렉터를 직속 자식 p(section 바로 아래)로 좁혀 콜아웃/인용/카드 내부 문단을 제외하고
   (중첩 박스 방지), :not(:has(img))로 이미지 문단(p로 감싼 img)도 제외(이미지 뒤 박스 방지). */
section.asu-native-1920-v5.asu-tier3-bg.asu-raw-flow > p:not(:has(img)) {
  padding: .48em .9em;
  margin-block: .32em;
  border-radius: 14px;
  -webkit-backdrop-filter: blur(7px) saturate(1.04);
  backdrop-filter: blur(7px) saturate(1.04);
  text-shadow: none;
}
section.asu-native-1920-v5.asu-tier3-bg.asu-wash-light.asu-raw-flow > p:not(:has(img)) {
  background: rgba(255, 255, 255, .76);
  color: #16202c;
}
section.asu-native-1920-v5.asu-tier3-bg.asu-wash-dark.asu-raw-flow > p:not(:has(img)) {
  background: rgba(8, 12, 20, .5);
  color: #ffffff;
}
section.asu-native-1920-v5.asu-tier3-bg.asu-body-spacious > p:not(:has(img)) {
  max-width: none;
  margin-inline: 0;
}

/* (3) 이미지 단독/주력 슬라이드 — 이미지를 제목 아래 가용 영역에 ratio 유지로 꽉 채운다.
   section을 flex 컬럼으로, 이미지 문단(p:has(img))을 flex:1로 늘려 generic img 540px 캡을
   해제한다. 이미지는 max 100%+auto라 세로형은 세로 꽉, 가로형은 가로 꽉, 정사각은 작은 쪽
   기준으로 ratio 유지하며 최대 크게(contain). Tier 1/2/3·모든 폰트스케일 공통. */
section.asu-native-1920-v5.asu-image-slide.asu-raw-flow {
  display: flex;
  flex-direction: column;
}
section.asu-native-1920-v5.asu-image-slide.asu-raw-flow > p:has(img) {
  flex: 1 1 auto;
  min-height: 0;
  margin: .5em 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
section.asu-native-1920-v5.asu-image-slide.asu-raw-flow > p:has(img) img {
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 10px 44px rgba(0, 0, 0, .34);
}
`;
}

function themeCss(id: string, cssThemeId = id): string {
  const profile = getThemeProfile(id);
  return baseTheme({ ...profile, id: cssThemeId });
}

export const CMDS_DARK_THEME = themeCss("cmds-dark-native-1920-v5");
export const OBSIDIAN_CYAN_THEME = themeCss("obsidian-cyan");
export const DEEP_NAVY_ICE_THEME = themeCss("deep-navy-ice");
export const COBALT_SAND_THEME = themeCss("cobalt-sand");
export const GRAPHITE_TOPAZ_THEME = themeCss("graphite-topaz");
export const ARCTIC_VIOLET_THEME = themeCss("arctic-violet");
export const HALLYM_LIGHT_THEME = themeCss("hallym-light");

export function getDefaultLayoutProfile(themeId: string): LayoutProfile {
  return getThemeProfile(themeId).layoutProfile;
}
