import type { AchmageSettings } from "./settings";

/**
 * v7.0 — 테마별 Tier 3 배경의 기본 override(고급 R2 호스팅 이미지). 번들된 작은 webp
 * 보다 화질이 좋아 기본값으로 미리 채운다. 토글 ON이면 바로 이 이미지가 깔린다.
 * export 시에는 main.ts가 이 URL을 data URI로 임베드 → 공유한 덱은 R2를 거치지 않음
 * (보는 사람 트래픽 0). 비우면 번들 webp로 폴백. 사용자가 자기 이미지로 교체 가능.
 */
export const TIER3_R2_DEFAULTS: Record<string, string> = {
  "cmds-dark-native-1920-v5":
    "https://pub-acf6ad93f2ec4a5e8fa12e94d0c9b151.r2.dev/1782455192282-25e3327d-8e22-4875-8067-e1ab475d9804.png",
  "obsidian-cyan":
    "https://pub-acf6ad93f2ec4a5e8fa12e94d0c9b151.r2.dev/1782456921569-446811ce-af08-4ffb-83ef-82899708103e.png",
  "cobalt-sand":
    "https://pub-acf6ad93f2ec4a5e8fa12e94d0c9b151.r2.dev/1782457033197-20e26db9-2809-48cd-b991-f603129168f6.png",
  "deep-navy-ice":
    "https://pub-acf6ad93f2ec4a5e8fa12e94d0c9b151.r2.dev/1782460619709-a60262ce-d7c3-4ef3-984d-384877843606.png",
  "graphite-topaz":
    "https://pub-acf6ad93f2ec4a5e8fa12e94d0c9b151.r2.dev/1782460724511-9be9cec8-3406-48e5-97e6-82f0a8c3871d.png",
  "arctic-violet":
    "https://pub-acf6ad93f2ec4a5e8fa12e94d0c9b151.r2.dev/1782460840473-cb21efc2-6980-4206-83e2-611581451ca0.png",
  "hallym-light":
    "https://pub-acf6ad93f2ec4a5e8fa12e94d0c9b151.r2.dev/1782461087155-a90098fc-9b4e-451a-8039-812109ca1f5a.png",
};

export const DEFAULT_SETTINGS: AchmageSettings = {
  settingsVersion: 9,
  defaultTheme: "hallym-light",
  baseFontSize: 28,
  typographicScale: "minorThird",
  headingDivider: [1, 2],
  autoPaginate: true,
  defaultTransition: "fade",
  mathEngine: "mathjax",
  autoContinuedFrames: true,
  tier2Layouts: false,
  // v7.0 — Tier 3 (기본 off, 켜야만 동작 → off면 회귀 0)
  tier3BodyPolishing: false,
  tier3Backgrounds: false,
  tier3WashMode: "auto",
  tier3WashOpacity: 0.6,
  tier3BgOverrides: { ...TIER3_R2_DEFAULTS },
};
