// v7.0 (과제 B-4) — 테마별 raw-5 배경 이미지 "생성 프롬프트". 설정창의 테마별
// "Copy prompt" 버튼이 이 문자열을 클립보드에 복사한다. 사용자는 이를 이미지
// 생성 모델(예: GPT image)에 붙여넣고, 슬라이드로 만들 노트 MD를 첨부한 뒤
// 1920×1080 배경을 바로 뽑아 `assets/tier3-bg/<themeId>.webp` 로 저장하고
// `npm run generate:tier3-bg` 로 번들에 인라인한다.
//
// 설계 의도: 이 이미지 위에 반투명 wash 막 + 슬라이드 콘텐츠/카드가 올라간다.
// 따라서 배경은 (1) 글자·로고·UI가 없고 (2) 중앙/상단이 비교적 평탄하며
// (3) 저~중 대비로 콘텐츠 가독을 방해하지 않아야 한다. 아래 COMMON 제약이 이를
// 강제하고, 테마별 한 줄(palette/mood)이 색·분위기를 입힌다.

/** 모든 테마 공통 raw-5 배경 제약. */
const COMMON = [
  "Generate a single full-bleed background image, 1920×1080 (16:9), for use BEHIND presentation slide content.",
  "",
  "Hard constraints (must all hold):",
  "- Absolutely NO text, letters, numbers, words, logos, watermarks, UI, charts, graphs, or any readable/symbolic marks.",
  "- It is a BACKGROUND, not an illustration: atmospheric, ambient, environmental. No single dominant focal subject that competes with foreground content.",
  "- Keep the central and upper-left region relatively calm and uncluttered (slide text and cards sit there). Push any visual interest toward the edges and lower area.",
  "- Low-to-medium contrast and soft detail. A translucent wash layer and text will be composited on top, so avoid busy high-frequency texture, harsh edges, or hotspots that would fight legibility.",
  "- Cinematic, premium, tasteful. Subtle depth, gentle gradients, soft light. No memey or cliché stock-photo look.",
  "- No people's faces or readable signage.",
].join("\n");

/** 노트 매칭 지시(공통 꼬리말). */
const TAIL =
  "If a note/markdown is attached, let ITS topic and mood guide the scene's setting, materials, and atmosphere — while strictly preserving every hard constraint above. Output one image at 1920×1080.";

/** 테마별 색·분위기 한 줄. */
const THEME_SPEC: Record<string, string> = {
  "cmds-dark-native-1920-v5":
    "Palette & mood: near-black graphite base (#020303–#141716) with a single restrained electric-lime accent (#c7ff64) used sparingly as a faint glow or edge light. High-tech, minimal, terminal/engineering feeling. Think dark brushed metal, carbon, faint scanline/grid ambience deep in shadow — kept very subtle and dark so white text reads on top.",
  "obsidian-cyan":
    "Palette & mood: deep dark navy base (#06080f–#081827) with a cool cyan glow (#73f1ff) and electric-blue undertone (#1081ff). Calm, glassy, futuristic night atmosphere — soft cyan light blooming from the lower edge, like cold mist over dark water. Dark enough for white text.",
  "deep-navy-ice":
    "Palette & mood: rich deep navy (#050812–#102652) lit by pale ice-blue light (#c2f4ff) and cobalt (#487eff). Glacial, serene, vast — like polar twilight or ice under a dim blue sky. Smooth gradients, faint frost texture at the edges only. Dark enough for white text.",
  "cobalt-sand":
    "Palette & mood: a meeting of cool cobalt-navy (#0d1f43) and warm sand/charcoal (#2c2617) with a soft gold accent (#ffd484). Dusk-meets-desert mood — cool shadow on one side, warm low sun on the other, blended softly. Muted, cinematic. Dark enough for white text.",
  "graphite-topaz":
    "Palette & mood: graphite/charcoal base (#070a10–#2f2618) warmed by a topaz/amber glow (#ffba5c) and a cool steel-blue counterlight (#609eff). Industrial, refined, like dim metal lit by a single warm lamp. Soft and dark, low contrast. Dark enough for white text.",
  "arctic-violet":
    "Palette & mood: dark blue-violet base (#060911–#172551) with a soft lavender/violet luminescence (#a995ff) and pale blue (#79bdff). Quiet, dreamlike, aurora-at-night feeling — gentle violet light diffusing through dark haze. Dark enough for white text.",
  "hallym-light":
    "Palette & mood: BRIGHT and airy. Near-white paper base (#FFFFFF–#F4F6F8) with the faintest teal (#00B5AD) and navy (#002E6E) tints. Clean, minimal, academic-modern — soft daylight, pale paper/architectural surfaces, very gentle. This theme uses a LIGHT paper wash, so keep the image bright, high-key, and low-saturation so dark navy text stays readable on top.",
};

/** themeId → 복사용 전체 프롬프트. */
export const TIER3_BG_PROMPTS: Record<string, string> = Object.fromEntries(
  Object.entries(THEME_SPEC).map(([id, spec]) => [
    id,
    `${COMMON}\n\n${spec}\n\n${TAIL}`,
  ])
);
