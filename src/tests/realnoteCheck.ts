/**
 * 실 노트(임의 .md)를 tier2 on/off로 렌더해 **logical group별 적용된 가족**을 보고한다.
 * 브라우저 불요(canvas-shim). 픽셀 ground-truth는 실 Obsidian이 유일하지만, 이 점검으로
 * "어느 섹션이 defgrid/card-grid/divider/raw로 라우팅되는지 + on/off slide 수"를 확인한다.
 *
 * Run: `node scripts/realnote-check.mjs "<note.md 경로>"`
 */
import "./pretextCanvasShim";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { Vault } from "obsidian";
import { SlideRenderer } from "../engine/slideRenderer";
import { DEFAULT_SETTINGS } from "../settingsDefaults";

const notePath = process.argv[2];
if (!notePath) {
  console.error("usage: node scripts/realnote-check.mjs <note.md>");
  process.exit(2);
}

const fakeVault = {
  getFiles: () => [],
  getResourcePath: (f: { path: string }) => f.path,
  getAbstractFileByPath: () => null,
} as unknown as Vault;

const THEME = process.env.THEME ?? "hallym-light";

// v7.0 — env 훅으로 Tier 3을 켜서 배경 주입을 점검할 수 있다(픽셀은 실 Obsidian).
//   TIER3_BODY=1                  body 폴리싱 ON
//   TIER3_BG=<https URL>          배경 ON + 이 테마(THEME) override
//   TIER3_WASH=auto|light|dark    wash 모드(기본 auto)
const TIER3_BODY = process.env.TIER3_BODY === "1";
const TIER3_BG_URL = process.env.TIER3_BG ?? "";
const TIER3_WASH = (process.env.TIER3_WASH ?? "auto") as
  | "auto"
  | "light"
  | "dark";

//   TIER3_LOCAL=1   로컬 override(비URL ref) + 미리 해석된 data URI 주입을 흉내내
//                   렌더러가 resolved 맵을 우선 쓰는지 검증(실제 파일 읽기는 main.ts).
const TIER3_LOCAL = process.env.TIER3_LOCAL === "1";
const LOCAL_REF = "test-local.webp";
const LOCAL_DATA_URI = "data:image/png;base64,TESTLOCALMARKER";

const tier3Overrides: Record<string, string> = TIER3_LOCAL
  ? { [THEME]: LOCAL_REF }
  : TIER3_BG_URL
    ? { [THEME]: TIER3_BG_URL }
    : {};

function render(body: string, tier2: boolean) {
  const settings = {
    ...DEFAULT_SETTINGS,
    defaultTheme: THEME,
    tier2Layouts: tier2,
    tier3BodyPolishing: TIER3_BODY,
    tier3Backgrounds: TIER3_BG_URL !== "" || TIER3_LOCAL,
    tier3WashMode: TIER3_WASH,
    tier3BgOverrides: tier3Overrides,
  };
  const renderer = new SlideRenderer(settings);
  if (TIER3_LOCAL) {
    renderer.setTier3ResolvedOverrides({ [THEME]: LOCAL_DATA_URI });
  }
  return renderer.render(body, fakeVault, {});
}

const raw = readFileSync(notePath, "utf8");
const off = render(raw, false);
const on = render(raw, true);

// logical group별 가족 판정.
const GROUP_RE = /<div class="achmage-logical-group"[^>]*data-title="([^"]*)"([\s\S]*?)(?=<div class="achmage-logical-group"|$)/g;
function familyOf(chunk: string): string {
  const card = /class="asu-listcard"/.test(chunk); // block-level 카드 동반 여부
  if (/class="[^"]*asu-defgrid/.test(chunk)) return card ? "defgrid*" : "defgrid";
  if (/class="[^"]*asu-bento/.test(chunk)) return card ? "bento*" : "bento";
  if (/asu-card-grid cards-\d/.test(chunk)) return "card-grid";
  if (/asu-divider-block/.test(chunk)) return "divider";
  return "raw";
}

const rows: { title: string; family: string; frames: number }[] = [];
let m: RegExpExecArray | null;
while ((m = GROUP_RE.exec(on.html)) !== null) {
  const title = m[1];
  const chunk = m[2];
  const frames = (chunk.match(/achmage-frame"/g) ?? []).length;
  rows.push({ title, family: familyOf(chunk), frames });
}

console.log(`\n# ${basename(notePath)}`);
console.log(`slides: off=${off.slideCount}, on=${on.slideCount}\n`);
for (const r of rows) {
  console.log(`  [${r.family.padEnd(9)}] frames=${r.frames}  ${r.title}`);
}
const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.family] = (a[r.family] ?? 0) + 1), a), {});
console.log(`\n  가족 분포: ${JSON.stringify(counts)}`);

const outDir = join(process.cwd(), "build", "test", "tier2-dump");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "realnote-on.html"), on.html);
console.log(`\n  렌더 HTML: build/test/tier2-dump/realnote-on.html`);
