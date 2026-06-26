/**
 * Tier 2 통합 라우터 결정론 검증(브라우저 불요). 이 Dropbox/한글 경로 환경에서는 헤드리스
 * overflow harness가 환경 문제로 안 돌아가므로, 라우터/composer 로직을 직접 렌더해 검증한다.
 *
 * Run: `node scripts/tier2-dump.mjs`
 *  - 각 fixture의 routeListSlide 1순위 가족(개수/깊이/측정줄수/마커 기반)
 *  - composeListSlide 결과 가족(bento/defgrid/강등) + bento span 패턴
 *  - full 렌더와의 일관성(compose 가족 == render 가족), 미매치 슬라이드 byte-identical(회귀 0)
 *  - composer atomic HTML에 inline font-size 주입 0(dogma #15; --asu-* 토큰은 허용)
 */
// 가장 먼저: OffscreenCanvas shim 설치(글로벌). 미설치 시 measureTextHeight가 crude fallback
// (한국어 폭 과소예측)으로 빠져 라우팅/fit이 틀어진다. 반드시 SlideRenderer import보다 먼저.
import "./pretextCanvasShim";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Vault } from "obsidian";
import { SlideRenderer } from "../engine/slideRenderer";
import { DEFAULT_SETTINGS } from "../settingsDefaults";
import { TYPOGRAPHIC_SCALES, type TypographicScaleName } from "../settings";
import {
  computeShapeSignature,
  routeListSlide,
  composeListSlide,
} from "../preprocessor/shapeTemplates";
import { buildTypographyConfig } from "../preprocessor/pretextMeasurer";

const fakeVault = {
  getFiles: () => [],
  getResourcePath: (f: { path: string }) => f.path,
  getAbstractFileByPath: () => null,
} as unknown as Vault;

const DIR = join(process.cwd(), "src", "tests", "fixtures", "native-1920-v5-prd");

type Fam = "bento" | "defgrid" | "(none)";
/** name + 기대 1순위 가족(routeListSlide). 강등은 compose 단계에서 별도 관찰. */
const FIXTURES: { name: string; primary: Fam }[] = [
  { name: "card-grid-2up", primary: "bento" },
  { name: "card-grid-3up", primary: "bento" },
  { name: "card-grid-4up", primary: "bento" },
  { name: "card-grid-overflow", primary: "bento" },
  { name: "card-grid-plain-bullets", primary: "defgrid" }, // 라벨 없는 리스트도 stacked defgrid 카드
  { name: "defgrid-nested-2level", primary: "defgrid" },
  { name: "defgrid-multibold-label", primary: "defgrid" }, // 멀티bold 라벨 파싱 + nested 문장
  { name: "defgrid-deep-degrade", primary: "defgrid" }, // 1순위 defgrid이나 크기 강등
  { name: "bento-uneven-5", primary: "bento" },
  { name: "bento-n1", primary: "defgrid" }, // n=1 → defgrid solo(hero 통카드)
  { name: "bento-mixed-span", primary: "bento" },
  { name: "router-nested-chips-bento", primary: "bento" },
  { name: "router-n1-flat", primary: "defgrid" }, // n=1 → defgrid solo
  { name: "router-n1-nested", primary: "defgrid" },
  { name: "router-marker-bento", primary: "bento" },
  { name: "router-marker-cards3", primary: "bento" },
];
const BASES = [28, 40];
const THEME = "hallym-light";
const SCALE: TypographicScaleName = "minorThird";
const RATIO = TYPOGRAPHIC_SCALES[SCALE].ratio;

function render(body: string, base: number, tier2: boolean) {
  const settings = {
    ...DEFAULT_SETTINGS,
    defaultTheme: THEME,
    baseFontSize: base,
    typographicScale: SCALE,
    tier2Layouts: tier2,
  };
  return new SlideRenderer(settings).render(
    `---\nmarp: true\ntheme: ${THEME}\n---\n\n${body}\n`,
    fakeVault,
    {}
  );
}

/** composer atomic HTML / 렌더 HTML에서 가족 판정. */
function famOf(html: string | null): "bento" | "defgrid" | "raw" {
  if (html === null) return "raw";
  if (/class="[^"]*asu-defgrid/.test(html)) return "defgrid"; // is-solo 등 modifier 포함
  if (/class="[^"]*asu-bento/.test(html)) return "bento";
  return "raw";
}

let fail = 0;
for (const fx of FIXTURES) {
  const body = readFileSync(join(DIR, `${fx.name}.md`), "utf8");
  const sig = computeShapeSignature(body);
  const typo28 = buildTypographyConfig(28, RATIO);
  const primary = (routeListSlide(sig, typo28)[0]?.family ?? "(none)") as Fam;
  console.log(
    `\n### ${fx.name}  route=${primary} (depth=${sig.maxListDepth} nested=${sig.hasNestedList}` +
      ` items=${sig.listItemCount} maxSub=${sig.maxSubChars} marker=${sig.familyMarker ?? (sig.cardsMarker || "-")})`
  );
  if (primary !== fx.primary) {
    console.log(`    !! ROUTE expected primary=${fx.primary} got=${primary}`);
    fail++;
  }

  for (const base of BASES) {
    const typo = buildTypographyConfig(base, RATIO);
    const composed = composeListSlide(sig, typo);
    const cFam = famOf(composed);
    // bento: 칼럼 비율 템플릿(grid-template-columns) — 모든 행 정렬, 깔끔한 정수 비율.
    const tmpl = composed?.match(/grid-template-columns:([^"]+)/)?.[1] ?? "";
    const spans = composed && /class="[^"]*asu-bento/.test(composed) ? ` cols=[${tmpl.trim()}]` : "";

    if (composed && /style="[^"]*font-size/.test(composed)) {
      console.log(`    !! INLINE font-size in composed atomic (dogma #15)`);
      fail++;
    }

    const off = render(body, base, false);
    const on = render(body, base, true);
    const outDir = join(process.cwd(), "build", "test", "tier2-dump");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${fx.name}__${base}.html`), on.html);
    const rFam = famOf(on.html);

    console.log(
      `  base=${base}: compose=${(cFam + spans).padEnd(16)} render=${rFam.padEnd(8)}` +
        ` slides(off=${off.slideCount}, on=${on.slideCount})`
    );

    // 일관성: composeListSlide가 **카드**면 렌더도 같은 가족이어야 한다(whole-slide 경로).
    // compose=raw(whole-slide 강등)인데 render가 카드인 건 정상 — block-level 항목별 분할 fallback.
    if (cFam !== "raw" && cFam !== rFam) {
      console.log(`    !! MISMATCH compose(${cFam}) vs render(${rFam})`);
      fail++;
    }
    // 회귀 0: 라우터 비대상(route=none) 슬라이드는 tier2 on/off byte-identical.
    if (fx.primary === "(none)" && on.html !== off.html) {
      console.log(`    !! NOT byte-identical on vs off (회귀)`);
      fail++;
    }
  }
}

// ── Stage 4: block-level 카드(혼합 섹션 내 bold-lead 리스트 → 카드). whole-slide 미적용. ──
console.log(`\n══ Block-level 카드 (혼합 섹션) ══`);
for (const name of ["blocklevel-mixed"]) {
  const body = readFileSync(join(DIR, `${name}.md`), "utf8");
  console.log(`\n### ${name}`);
  for (const base of BASES) {
    const on = render(body, base, true);
    const off = render(body, base, false);
    const hasCard = /class="asu-listcard"/.test(on.html);
    console.log(`  base=${base}: listcard=${hasCard} slides(off=${off.slideCount}, on=${on.slideCount})`);
    if (!hasCard) {
      console.log(`    !! expected a block-level listcard`);
      fail++;
    }
    if (/<div class="asu-listcard"[^>]*style="[^"]*font-size/.test(on.html)) {
      console.log(`    !! INLINE font-size on listcard (dogma #15)`);
      fail++;
    }
  }
}

console.log(`\n${fail === 0 ? "OK" : "FAIL=" + fail}`);
process.exit(fail === 0 ? 0 : 1);
