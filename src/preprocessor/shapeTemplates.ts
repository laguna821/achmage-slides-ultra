/**
 * v6.0 — Tier 2 deterministic layouts (shape-signature → HTML 사전조립).
 *
 * 목표: plain markdown만 써도 정교한 레이아웃을 내되 **AI 의미 판단 0 · overflow 0**.
 * 레이아웃 선택은 markdown의 **순수 구조 시그니처**(블록 타입/개수/길이)에서만 한다.
 *
 * dogma #18 준수 — 절대 금지:
 *   - role/density "추론"(이 슬라이드가 'SWOT다' 같은 의미 판단) 금지.
 *   - 후보 레이아웃 스코어링/랭킹 금지(폐기된 Atlas detour로의 회귀).
 *   selectTemplate은 개수·길이만 보는 **순수 switch**여야 한다. 매치 안 되면 raw-flow로
 *   손대지 않는다(현행 v5 경로 byte-identical).
 *
 * 통합: render()에서 injectTypographyStyle 다음·splitOverflowingSlides 앞에 1단계.
 * 첫 증분은 **section divider**(가장 sparse, overflow 위험 ≈ 0)만 구현한다. divider는
 * `asu-content`/`<!-- asu-frame -->` 마커를 쓰지 않으므로 isSemanticLayoutMarkdown을
 * 트리거하지 않고 greedy packer 경로를 그대로 탄다 → 같은 deck의 raw 슬라이드 패킹이
 * 깨지지 않는다(혼합 deck 안전). dense 템플릿(2-column 등 자체분할 필요)은 후속 증분에서
 * seam 통합과 함께 추가한다.
 */

import type { AchmageSettings } from "../settings";
import {
  parseContentBlocks,
  measureBlockHeight,
  measureTextHeight,
  buildTypographyConfig,
  type ContentBlock,
  type TypographyConfig,
} from "./pretextMeasurer";
import {
  extractFrontmatter,
  splitByHeadings,
  computeFrameBudget,
  type LogicalSlide,
} from "./overflowSplitter";

// ─────────────────────────────────────────────────────────────────────────────
// Shape signature (순수 구조)
// ─────────────────────────────────────────────────────────────────────────────

/** bold-lead 리스트 항목 1개 → 카드 1개 (composer가 소비). */
export interface CardItem {
  /** `**라벨**`에서 추출한 카드 타이틀(asterisk 제거) */
  label: string;
  /** 라벨 뒤 본문 텍스트(없으면 "") — inline md 포함 가능 */
  tail: string;
}

/** nested bold-lead 항목 1개 → defgrid 그룹 1개 (composeDefGrid가 소비). */
export interface DefItem extends CardItem {
  /** 라벨/tail 아래 중첩 서브 줄들. level=중첩 깊이(1=L2, 2=L3, …) → 들여쓰기로 렌더. 없으면 [] */
  subs: { text: string; level: number }[];
}

export interface ShapeSignature {
  /** 실질 블록(empty/html_comment/html_style 제외)의 타입 시퀀스 */
  blockTypeSequence: string[];
  counts: {
    headings: number;
    paragraphs: number;
    lists: number;
    tables: number;
    code: number;
    images: number;
    blockquotes: number;
    htmlBlocks: number;
  };
  /** 첫 헤딩 텍스트(`#` 제거). 없으면 "" */
  headingText: string;
  /** 첫 헤딩 레벨 1/2/3. 없으면 0 */
  headingLevel: number;
  /** 첫 문단 텍스트(있으면). 없으면 "" */
  firstParagraphText: string;
  firstParagraphChars: number;
  /** 실질 블록이 헤딩 1개뿐 */
  isHeadingOnly: boolean;
  /** top-level 리스트가 정확히 1개일 때 그 항목 수. 아니면 0 */
  listItemCount: number;
  /** 모든 top-level 항목이 bold-lead(`**라벨** tail`)이면 true */
  listItemsAreBoldLead: boolean;
  /** 가장 긴 카드 tail 글자수 */
  maxListItemTailChars: number;
  /** top-level보다 깊은 중첩 리스트가 있으면 true */
  hasNestedList: boolean;
  /** 작성자 마커 `<!-- cards: N -->`의 N(2~4). 없으면 0 */
  cardsMarker: number;
  /** 작성자 가족 마커 `<!-- bento -->`/`<!-- rows -->`. 없으면 null */
  familyMarker: "bento" | "rows" | null;
  /** bold-lead 파싱 결과(카드 composer가 소비). 비-카드 슬라이드는 [] */
  cardItems: CardItem[];
  /** nested bold-lead 파싱 결과(defgrid composer가 소비). 비-defgrid는 [] */
  defItems: DefItem[];
  /** 리스트 최대 들여쓰기 레벨. 1=평면, 2=L2 서브, 3+=깊음. 비-리스트는 0 */
  maxListDepth: number;
  /** 가장 긴 sub 글자수(측정 강등 입력). 없으면 0 */
  maxSubChars: number;
}

const HEADING_TYPES = new Set(["heading1", "heading2", "heading3"]);
/** 시그니처 계산에서 무시하는 비실질 블록 */
const NON_SUBSTANTIVE = new Set(["empty", "html_comment", "html_style"]);

function headingLevelOf(type: string): number {
  return type === "heading1" ? 1 : type === "heading2" ? 2 : type === "heading3" ? 3 : 0;
}

function blockText(block: ContentBlock): string {
  return block.rawLines.join(" ").trim();
}

/** 헤딩 rawLine에서 선두 `#`들 + trailing 콜론(B3)을 제거한 텍스트 */
function headingTextOf(block: ContentBlock): string {
  return block.rawLines
    .join(" ")
    .replace(/^\s*#{1,6}\s*/, "")
    .trim()
    .replace(/[\s:：]+$/, "");
}

// ─── bold-lead 리스트 파싱 (card-grid 트리거용, 순수 정규식 — 의미추론 0) ───

/** top-level 리스트 항목 마커(`- `/`* `/`+ `/`1. `). 선두 공백 0 = top-level. */
const TOP_LEVEL_ITEM = /^([-*+]|\d+[.)])\s+(.*)$/;
/** 들여쓰기된(중첩) 리스트 항목. */
const NESTED_ITEM = /^\s+([-*+]|\d+[.)])\s+/;
/** bold-lead 게이트: 항목이 `**`로 시작. */
const STARTS_BOLD = /^\*\*/;
/** 라벨-구분 콜론류. ASCII '-'는 제외(tail 내부 범위표기 오인 방지). */
const LABEL_COLON = /[:：—–]/;
/** 작성자 마커 `<!-- cards: N -->` (N=2|3|4). */
const CARDS_MARKER = /<!--\s*cards:\s*([234])\s*-->/;
/** 작성자 가족 마커 `<!-- bento -->` / `<!-- rows -->`(=defgrid). 순수 토큰(의미추론 0). */
const FAMILY_MARKER = /<!--\s*(bento|rows)\s*-->/;

/**
 * 단일 리스트 블록의 rawLines를 top-level 항목 텍스트 배열로 묶는다.
 * 중첩(들여쓰기) 항목이 하나라도 있으면 hasNested=true(이 경우 card-grid 트리거 제외).
 */
function groupTopLevelItems(listBlock: ContentBlock): { items: string[]; hasNested: boolean } {
  const items: string[] = [];
  let current: string[] = [];
  let hasNested = false;
  const flush = () => {
    if (current.length) items.push(current.join(" ").replace(/\s+/g, " ").trim());
    current = [];
  };
  for (const line of listBlock.rawLines) {
    if (NESTED_ITEM.test(line)) {
      hasNested = true; // 중첩 항목 — card-grid 제외 신호. 내용은 무시(어차피 강등).
      continue;
    }
    const m = line.match(TOP_LEVEL_ITEM);
    if (m) {
      flush();
      current.push(m[2]);
    } else if (line.trim()) {
      current.push(line.trim()); // 항목의 연속(lazy continuation) 줄
    }
  }
  flush();
  return { items, hasNested };
}

/** 선두 공백/탭 폭(탭=4칸 환산). 중첩 깊이를 **상대적**으로 판정해 2/4-space·탭 모두 대응. */
function leadingWidth(line: string): number {
  const lead = line.match(/^[ \t]*/)?.[0] ?? "";
  return lead.replace(/\t/g, "    ").length;
}

/** 한 항목의 중첩 줄들을 {text, level} subs로. 들여쓰기 폭의 순위 = level(1=L2, 2=L3, …). */
function buildSubs(nested: { width: number; body: string }[]): { text: string; level: number }[] {
  if (!nested.length) return [];
  const widths = [...new Set(nested.map((n) => n.width))].sort((a, b) => a - b);
  return nested.map((n) => ({ text: n.body, level: widths.indexOf(n.width) + 1 }));
}

/**
 * 단일 리스트 블록을 {text, subs[]} 항목으로 묶되 서브불릿을 **보존**한다(card-grid용
 * groupTopLevelItems는 서브를 버림 — 불변 유지). L2(최소 중첩 들여쓰기) 줄 = sub 1개,
 * L3+(더 깊음)는 직전 sub에 평탄화 append(핸드오버 "L2 행 안 들여쓴 줄로"; 너무 길면
 * composeDefGrid가 크기측정으로 강등). maxDepth/hasNested 반환.
 */
function groupItemsWithSubs(rawLines: string[]): {
  rawItems: { text: string; subs: { text: string; level: number }[] }[];
  maxDepth: number;
  hasNested: boolean;
} {
  const rawItems: { text: string; subs: { text: string; level: number }[] }[] = [];
  let curText: string[] = [];
  let curNested: { width: number; body: string }[] = [];
  let started = false;
  let maxDepth = 1;
  let hasNested = false;

  const flush = () => {
    if (!started) return;
    if (curNested.length) {
      hasNested = true;
      const levels = new Set(curNested.map((n) => n.width)).size;
      maxDepth = Math.max(maxDepth, 1 + levels);
    }
    rawItems.push({
      text: curText.join(" ").replace(/\s+/g, " ").trim(),
      subs: buildSubs(curNested),
    });
    curText = [];
    curNested = [];
  };

  for (const line of rawLines) {
    if (!line.trim()) continue;
    if (NESTED_ITEM.test(line)) {
      curNested.push({ width: leadingWidth(line), body: line.replace(NESTED_ITEM, "").trim() });
      continue;
    }
    const m = line.match(TOP_LEVEL_ITEM);
    if (m) {
      flush();
      started = true;
      curText = [m[2]];
    } else if (curNested.length) {
      curNested[curNested.length - 1].body += " " + line.trim(); // 서브 lazy continuation
    } else if (started) {
      curText.push(line.trim()); // top-level lazy continuation
    }
  }
  flush();
  return { rawItems, maxDepth, hasNested };
}

/** 라벨 정제: 내부 `**` 제거 + 공백 정규화 + trailing 콜론/대시/공백 제거(B3). */
function normalizeLabel(raw: string): string {
  return raw
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s:：—–-]+$/, "")
    .trim();
}

/**
 * bold span **밖**에서 등장하는 첫 라벨-콜론의 인덱스. 없으면 -1.
 * `**A:B** 본문`처럼 콜론이 bold 안이면 건너뛰고, bold 밖 첫 콜론을 찾는다.
 * `**국가** **AI 전략** **수립**: …` → 마지막 `**` 뒤의 `:`.
 */
function firstLabelColon(s: string): number {
  let inBold = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "*" && s[i + 1] === "*") {
      inBold = !inBold;
      i++; // `**` 한 쌍 건너뜀
      continue;
    }
    if (!inBold && LABEL_COLON.test(s[i])) return i;
  }
  return -1;
}

/**
 * 선두 연속 bold-run을 한 라벨로. `**A** **B** C` → {label:"A B", rest:"C"}.
 * bold 사이가 공백뿐이면 같은 run으로 잇고, 일반 텍스트가 끼면 거기서 run 종료.
 */
function leadingBoldRun(s: string): { label: string; rest: string } | null {
  const parts: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "*" && s[i + 1] === "*") {
      const end = s.indexOf("**", i + 2);
      if (end < 0) break; // 미닫힘 bold → run 종료
      parts.push(s.slice(i + 2, end));
      i = end + 2;
      const gap = s.slice(i).match(/^\s+/)?.[0] ?? "";
      if (s.startsWith("**", i + gap.length)) {
        i += gap.length; // 공백 후 다음 bold면 run 계속
        continue;
      }
      return { label: parts.join(" "), rest: s.slice(i) };
    }
    break;
  }
  return parts.length ? { label: parts.join(" "), rest: s.slice(i) } : null;
}

/**
 * 항목 텍스트가 bold-lead면 {label, tail} 반환, 아니면 null. (B2: 멀티 bold 라벨 지원)
 * 1) bold 밖 첫 콜론(`:`/`：`/`—`/`–`)으로 분리(label=앞 전체, tail=뒤).
 * 2) 콜론 없으면 선두 연속 bold-run 전체를 라벨로, 잔여를 tail로.
 */
function parseBoldLead(itemText: string): CardItem | null {
  const s = itemText.trim();
  if (!STARTS_BOLD.test(s)) return null;
  const colonIdx = firstLabelColon(s);
  if (colonIdx >= 0) {
    const label = normalizeLabel(s.slice(0, colonIdx));
    if (!label) return null;
    return { label, tail: s.slice(colonIdx + 1).trim() };
  }
  const run = leadingBoldRun(s);
  if (!run) return null;
  const label = normalizeLabel(run.label);
  if (!label) return null;
  return { label, tail: run.rest.trim() };
}

/**
 * 일반 리스트 항목 → {label, body}. bold-lead면 label=라벨, body=tail. 아니면 label=""(라벨 없음),
 * body=항목 전체. 모든 리스트(bold-lead 아니어도)를 카드로 만들기 위한 범용 파서.
 */
function parseListItem(text: string): { label: string; body: string } {
  const bl = parseBoldLead(text);
  return bl ? { label: bl.label, body: bl.tail } : { label: "", body: text.trim() };
}

export function computeShapeSignature(content: string): ShapeSignature {
  const blocks = parseContentBlocks(content);
  const substantive = blocks.filter((b) => !NON_SUBSTANTIVE.has(b.type));

  const counts = {
    headings: 0,
    paragraphs: 0,
    lists: 0,
    tables: 0,
    code: 0,
    images: 0,
    blockquotes: 0,
    htmlBlocks: 0,
  };
  let headingText = "";
  let headingLevel = 0;
  let firstParagraphText = "";
  let listBlock: ContentBlock | null = null;

  for (const b of substantive) {
    if (HEADING_TYPES.has(b.type)) {
      counts.headings++;
      if (headingLevel === 0) {
        headingLevel = headingLevelOf(b.type);
        headingText = headingTextOf(b);
      }
    } else if (b.type === "paragraph") {
      counts.paragraphs++;
      if (!firstParagraphText) firstParagraphText = blockText(b);
    } else if (b.type === "list") {
      counts.lists++;
      listBlock = b;
    } else if (b.type === "table") counts.tables++;
    else if (b.type === "code") counts.code++;
    else if (b.type === "image") counts.images++;
    else if (b.type === "blockquote") counts.blockquotes++;
    else if (b.type === "html_block") counts.htmlBlocks++;
  }

  // 카드(bold-lead) 분석 — 리스트가 정확히 1개일 때만. 그 외엔 비-카드 기본값.
  let listItemCount = 0;
  let listItemsAreBoldLead = false;
  let maxListItemTailChars = 0;
  let hasNestedList = false;
  let cardItems: CardItem[] = [];
  let defItems: DefItem[] = [];
  let maxListDepth = 0;
  let maxSubChars = 0;
  if (counts.lists === 1 && listBlock) {
    // (A) card-grid 경로 — 불변(서브불릿 폐기, top-level만). 회귀 0.
    const { items, hasNested } = groupTopLevelItems(listBlock);
    hasNestedList = hasNested;
    listItemCount = items.length;
    const parsed = items.map(parseBoldLead);
    if (items.length > 0 && parsed.every((p): p is CardItem => p !== null)) {
      listItemsAreBoldLead = true;
      cardItems = parsed as CardItem[];
      maxListItemTailChars = cardItems.reduce((m, c) => Math.max(m, c.tail.length), 0);
    }
    // (B) defgrid/bento 경로 — **모든** top-level 리스트를 항목으로 보존(bold-lead 아니어도 label="").
    const withSubs = groupItemsWithSubs(listBlock.rawLines);
    maxListDepth = withSubs.maxDepth;
    if (withSubs.rawItems.length > 0) {
      defItems = withSubs.rawItems.map((ri) => {
        const { label, body } = parseListItem(ri.text);
        return { label, tail: body, subs: ri.subs } as DefItem;
      });
      // 모든 항목이 라벨(bold-lead)을 가지면 bento 후보, 아니면 stacked defgrid.
      listItemsAreBoldLead = defItems.every((d) => d.label !== "");
      maxSubChars = defItems.reduce((mx, d) => Math.max(mx, ...d.subs.map((s) => s.text.length), 0), 0);
    }
  }
  const cardsMarker = Number(content.match(CARDS_MARKER)?.[1] ?? 0);
  const fm = content.match(FAMILY_MARKER)?.[1];
  const familyMarker: "bento" | "rows" | null = fm === "bento" || fm === "rows" ? fm : null;

  return {
    blockTypeSequence: substantive.map((b) => b.type),
    counts,
    headingText,
    headingLevel,
    firstParagraphText,
    firstParagraphChars: firstParagraphText.length,
    isHeadingOnly: substantive.length === 1 && counts.headings === 1,
    listItemCount,
    listItemsAreBoldLead,
    maxListItemTailChars,
    hasNestedList,
    cardsMarker,
    familyMarker,
    cardItems,
    defItems,
    maxListDepth,
    maxSubChars,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Template selection (순수 switch — 점수/랭킹 없음)
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateId = "divider" | "card-grid" | "defgrid" | "bento";

/**
 * card-grid 트리거 — **순수 구조 switch**(dogma #18: 개수·길이·정규식만, role/의미 추론 0).
 * 헤딩 1개 + bold-lead top-level 리스트(2~4항목)만 있는, 구조적으로 모호함 없는 케이스.
 * 평범한 불릿(bold-lead 아님)은 제외 — 사용자의 일반 리스트를 카드로 둔갑시키지 않는다
 * (divider가 "헤딩+짧은문단"을 제외한 것과 동일 보수성).
 */
export function isCardGridShape(sig: ShapeSignature): boolean {
  const c = sig.counts;
  const otherBlocks =
    c.paragraphs + c.tables + c.code + c.images + c.blockquotes + c.htmlBlocks;
  return (
    c.headings === 1 &&
    (sig.headingLevel === 1 || sig.headingLevel === 2) &&
    c.lists === 1 &&
    sig.listItemCount >= 2 &&
    sig.listItemCount <= 4 &&
    sig.listItemsAreBoldLead &&
    !sig.hasNestedList &&
    otherBlocks === 0
  );
}

/**
 * defgrid 트리거 — isCardGridShape의 미러(dogma #18 순수 구조). 헤딩 1개 + bold-lead
 * top-level 리스트가 **중첩(hasNestedList)** 을 가진 경우. flat은 card-grid가, nested는
 * defgrid가 받는다(hasNestedList로 상호배타). 깊이 하드캡 없음 — L3/큰 섹션은
 * composeDefGrid의 크기측정이 raw-flow로 강등한다(overflow 0).
 */
export function isDefGridShape(sig: ShapeSignature): boolean {
  const c = sig.counts;
  const otherBlocks =
    c.paragraphs + c.tables + c.code + c.images + c.blockquotes + c.htmlBlocks;
  return (
    c.headings === 1 &&
    (sig.headingLevel === 1 || sig.headingLevel === 2) &&
    c.lists === 1 &&
    sig.listItemsAreBoldLead &&
    sig.hasNestedList &&
    sig.defItems.length >= 2 &&
    otherBlocks === 0
  );
}

/**
 * Stage 3 이후: selectTemplate은 **divider 판정만** 담당한다(heading-only). 리스트 슬라이드
 * (flat/nested bold-lead)는 `composeListSlide`(통합 라우터)가 흡수했다. `isCardGridShape`/
 * `isDefGridShape`는 구조 분류용으로 export 유지(파이프라인 미사용). dogma #18 순수 switch.
 */
export function selectTemplate(sig: ShapeSignature): TemplateId | null {
  if (sig.isHeadingOnly) return "divider";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compose (사전조립 HTML)
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML 주석 안에서 `-->` 조기 종료 방지 */
function escapeComment(value: string): string {
  return value.replace(/-->/g, "--&gt;");
}

/**
 * 시그니처로 whole-slide 템플릿 HTML을 사전조립한다. divider는 항상 fit(sparse)이라 string,
 * card-grid는 자체측정 실패 시 null(강등)을 반환할 수 있다.
 */
export function composeTemplate(
  id: TemplateId,
  sig: ShapeSignature,
  typo: TypographyConfig
): string | null {
  switch (id) {
    case "divider":
      return composeDivider(sig);
    case "card-grid":
      return composeCardGrid(sig, typo);
    case "defgrid":
      return composeDefGrid(sig, typo);
    case "bento":
      return composeBento(sig, typo);
  }
}

function composeDivider(sig: ShapeSignature): string {
  const heading = escapeHtml(sig.headingText);
  const sub = sig.firstParagraphText
    ? `<div class="asu-divider-sub">${escapeHtml(sig.firstParagraphText)}</div>`
    : "";
  // - `<!-- _class: asu-divider -->` → Marp이 section 클래스로 변환(테마 CSS 진입점).
  // - `<!-- asu-title: … -->` → 헤딩을 div로 바꿔도 slideMap 타이틀 보존(extractAsuTitle).
  // - 헤딩이 아니라 `<div>`로 두는 이유: injectPerElementStyles의 per-element inline
  //   font-size(dogma #15: inline이 rule을 이김)를 피해 hero 타이포를 CSS로 제어.
  // - asu-content/asu-frame 마커 미사용 → greedy 경로 유지(혼합 deck 안전).
  return [
    `<!-- _class: asu-divider -->`,
    `<!-- asu-title: ${escapeComment(sig.headingText)} -->`,
    `<div class="asu-divider-block"><div class="asu-divider-text">${heading}</div>${sub}</div>`,
  ].join("\n");
}

// ─── N-up 카드 그리드 (Tier 2 dense — atomic html_block + 자체측정 + null=강등) ───

/**
 * 카드 측정 상수. CSS(themeRegistry `.asu-card`/`.asu-card-title`/`.asu-card-body`)와
 * **단일 진실원**으로 동기해야 한다. rem 해상도가 Marp SVG/foreignObject에서 불확실하므로
 * chrome 값은 보수적(over-predict). 변경 시 themeRegistry CSS도 함께 조정.
 */
const CARD_METRICS = {
  /** grid gap (cols별). themeRegistry `.asu-card-grid`/`.cards-N` gap과 일치. */
  gap: { 2: 28, 3: 24, 4: 20 } as Record<number, number>,
  /** 카드 좌우 chrome(padding 1.55rem*2 + border). cellInner = cellOuter − chromeX. */
  chromeX: 60,
  /** 카드 상하 chrome(padding 1.45rem*2 + border). pretextMeasurer cardPadding(52) + 마진. */
  chromeY: 56,
  titleLineHeight: 1.18,
  bodyLineHeight: 1.5,
  /** 타이틀↔본문 간격 (.asu-card-title margin-bottom). */
  titleGap: 14,
  /** keep-all 줄바꿈 over-predict 마진. */
  overPredict: 1.08,
};

/** 섹션 헤더(헤딩 + teal rule) 측정 상수 — themeRegistry `.asu-section-*`와 동기. */
const SECTION_METRICS = {
  /** .asu-section-head margin-bottom (헤더↔그리드 간격). */
  headMargin: 36,
  titleLineHeight: 1.14,
  /** rule: margin-top 16 + height 4. */
  ruleChrome: 20,
};

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** typo에서 폰트 패밀리 스택만("28px Family" → "Family"). */
function familyOf(typo: TypographyConfig): string {
  return typo.bodyFont.replace(/^\d+px\s*/, "");
}

/** --asu-fs-small = clamp(round(bodyFontSize*0.85),16,40) — slideRenderer와 동일 공식. */
function smallFontSize(typo: TypographyConfig): number {
  return clampInt(typo.bodyFontSize * 0.85, 16, 40);
}

/**
 * Tier 2 wrapper에 박는 폰트 var 로컬 override. composer가 **측정한 typo**의 폰트를 그대로
 * 렌더에 강제 → measure==render 보장(폰트 캐스케이드로 stepped-down typo를 받아도 안전).
 * 전역 폰트일 땐 deck-global --asu-fs-*와 동일값(중복일 뿐 무해). div의 custom property라
 * injectPerElementStyles inline 주입 대상 아님(dogma #15: font-size 선언 아닌 토큰).
 */
function fontVarStyle(typo: TypographyConfig): string {
  return (
    `--asu-fs-h1:${typo.h1FontSize}px;` +
    `--asu-fs-h3:${typo.h3FontSize}px;` +
    `--asu-fs-body:${typo.bodyFontSize}px;` +
    `--asu-fs-small:${smallFontSize(typo)}px`
  );
}

interface CardLayout {
  cols: number;
  rows: CardItem[][];
}

/** n개 카드를 후보 레이아웃(측정 순서)으로. cardsMarker(2~4)면 그 cols만. */
function candidateLayouts(items: CardItem[], cardsMarker: number): CardLayout[] {
  const n = items.length;
  const chunk = (cols: number): CardItem[][] => {
    const rows: CardItem[][] = [];
    for (let i = 0; i < n; i += cols) rows.push(items.slice(i, i + cols));
    return rows;
  };
  if (cardsMarker >= 2 && cardsMarker <= 4) return [{ cols: cardsMarker, rows: chunk(cardsMarker) }];
  // 자동: 1행 우선(가로 배치), 실패 시 2-col 다행. 4-up 1행은 셀폭이 좁아 제외.
  if (n === 2) return [{ cols: 2, rows: chunk(2) }];
  if (n === 3) return [{ cols: 3, rows: chunk(3) }, { cols: 2, rows: chunk(2) }];
  return [{ cols: 2, rows: chunk(2) }]; // n === 4 → 2×2
}

/** 한 카드의 예측 높이(px). dogma #17 over-predict. */
function measureCard(item: CardItem, cellInner: number, typo: TypographyConfig, fam: string): number {
  const titleH = measureTextHeight(
    visibleText(item.label),
    `700 ${typo.h3FontSize}px ${fam}`,
    cellInner,
    typo.h3FontSize * CARD_METRICS.titleLineHeight
  );
  const smallFs = smallFontSize(typo);
  const bodyH = item.tail
    ? measureTextHeight(visibleText(item.tail), `430 ${smallFs}px ${fam}`, cellInner, smallFs * CARD_METRICS.bodyLineHeight)
    : 0;
  const titleGap = item.tail ? CARD_METRICS.titleGap : 0;
  return Math.ceil((titleH + titleGap + bodyH + CARD_METRICS.chromeY) * CARD_METRICS.overPredict);
}

/** 레이아웃 그리드 부분 높이(헤더 제외). */
function measureLayout(layout: CardLayout, typo: TypographyConfig, fam: string): number {
  const gap = CARD_METRICS.gap[layout.cols];
  const cellOuter = (typo.contentWidth - gap * (layout.cols - 1)) / layout.cols;
  const cellInner = cellOuter - CARD_METRICS.chromeX;
  let total = 0;
  layout.rows.forEach((row, ri) => {
    const rowH = Math.max(...row.map((it) => measureCard(it, cellInner, typo, fam)));
    total += rowH;
    if (ri < layout.rows.length - 1) total += gap;
  });
  return total;
}

/** 섹션 헤더(헤딩 + rule) 높이. */
function measureSectionHeader(heading: string, typo: TypographyConfig, fam: string): number {
  const titleH = measureTextHeight(
    visibleText(heading),
    `760 ${typo.h1FontSize}px ${fam}`,
    typo.contentWidth,
    typo.h1FontSize * SECTION_METRICS.titleLineHeight
  );
  return titleH + SECTION_METRICS.ruleChrome + SECTION_METRICS.headMargin;
}

/**
 * 측정용 "보이는 텍스트" — 인라인 md에서 렌더 후 화면에 보이는 글자만 남긴다.
 * renderInline이 `[label](url)`을 `<a>label</a>`로 만들어 label만 보이는데, 측정이 raw
 * 문자열(긴 URL 포함)을 재면 카드 높이가 몇 배로 과대평가된다(예: 목차 wikilink → URL이
 * 150자라 1줄짜리가 3줄로 측정 → 슬라이드당 2개만). 링크 URL/마커를 제거해 measureTextHeight가
 * 실제 렌더와 일치하게 한다.
 */
function visibleText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1") // [label](url) → label (URL 제거)
    .replace(/`([^`]+)`/g, "$1") // `code` → code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** → bold
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2") // *em* → em
    .replace(/==([^=]+)==/g, "$1") // ==highlight== → highlight
    .replace(/<\/?[a-z][^>]*>/gi, ""); // 남은 인라인 태그(mark 등) 제거
}

/** 인라인 md를 안전 HTML로(escape 후 강조/코드/링크만). */
function renderInline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

/**
 * N-up 카드 그리드 사전조립. 후보 레이아웃을 순서대로 자체측정해 첫 fit을 반환,
 * 전부 실패하면 null(applyShapeTemplates가 raw-flow로 강등 — overflow 카드 emit 0).
 *
 * - 카드 내부는 **div-class**(`.asu-card-title`/`.asu-card-body`)로 emit → injectPerElementStyles
 *   의 per-element inline font-size 주입을 회피(divider와 동일 원리, dogma #15).
 * - 전체를 하나의 atomic wrapper div로 감싸 한 줄로 emit → parseContentBlocks가 한 덩어리로
 *   읽어(빈 줄 조기종료 없음) packer가 헤더↔카드를 두 프레임으로 못 찢는다.
 */
export function composeCardGrid(sig: ShapeSignature, typo: TypographyConfig): string | null {
  if (sig.cardItems.length < 2) return null;
  const fam = familyOf(typo);
  const budget = computeFrameBudget(typo) * 0.95; // dogma #17 over-predict 마진
  const headerH = measureSectionHeader(sig.headingText, typo, fam);

  let chosen: CardLayout | null = null;
  for (const layout of candidateLayouts(sig.cardItems, sig.cardsMarker)) {
    if (headerH + measureLayout(layout, typo, fam) <= budget) {
      chosen = layout;
      break;
    }
  }
  if (!chosen) return null; // 어떤 cols도 안 맞음 → 강등

  const cards = sig.cardItems
    .map((c) => {
      const body = c.tail ? `<div class="asu-card-body">${renderInline(c.tail)}</div>` : "";
      return `<div class="asu-card"><div class="asu-card-title">${escapeHtml(c.label)}</div>${body}</div>`;
    })
    .join("");
  const stack =
    `<div class="asu-card-grid-stack">` +
    `<div class="asu-section-head"><div class="asu-section-title">${escapeHtml(sig.headingText)}</div></div>` +
    `<div class="asu-card-grid cards-${chosen.cols}">${cards}</div>` +
    `</div>`;
  return [
    `<!-- _class: asu-card-grid-slide -->`,
    `<!-- asu-title: ${escapeComment(sig.headingText)} -->`,
    stack,
  ].join("\n");
}

// ─── Definition-grid (C+) — nested bold-lead: 라벨 세로 span | 설명+서브 행 ───

/**
 * defgrid 측정 상수. themeRegistry `.asu-defgrid`/`.dgroup`/`.asu-def-*`와 **단일 진실원**.
 * 변경 시 CSS도 함께 조정. chrome은 rem 해상도 불확실로 보수적(over-predict).
 */
const DEFGRID_METRICS = {
  /** 라벨 칼럼폭 clamp(measureTextHeight는 height만 반환 → 폭은 어절 근사 + 상한 안전망). */
  labelColMin: 240,
  labelColMax: 480,
  /** .asu-def-label padding-right + 측정 여유(측정은 labelColW−labelPad에서 → over-predict). */
  labelPad: 16,
  /** .dgroup column-gap (라벨↔본문) */
  colGap: 32,
  /** 서브 레벨당 들여쓰기(px). L2→22, L3→44 … (3단+ 중첩 지원) */
  subIndent: 22,
  /** 카드(.dgroup) 사이 간격(.asu-defgrid gap) */
  cardGap: 20,
  /** .asu-def-row 사이 간격 */
  rowGap: 14,
  labelLineHeight: 1.18,
  rowLineHeight: 1.5,
  /** keep-all 한국어 어절 폭 근사(em). */
  labelAdvance: 0.62,
  /** keep-all 줄바꿈 over-predict 마진(CARD와 동일). */
  overPredict: 1.08,
  // 카드 chrome(padding+border)은 CARD_METRICS.chromeX(60)/chromeY(56) 재사용 — .dgroup이 bento
  // .asu-card와 동일 padding(1.45rem 1.55rem). 측정/CSS 단일 진실원.
};

/** 라벨 칼럼폭 — 최장 어절 근사폭 + clamp(상한이 우측 칼럼 최소폭 보장 = 안전망). */
function measureLabelColWidth(items: DefItem[], typo: TypographyConfig): number {
  const fs = typo.h3FontSize;
  let maxWordW = 0;
  for (const it of items) {
    for (const word of it.label.split(/\s+/)) {
      const w = word.length * fs * DEFGRID_METRICS.labelAdvance;
      if (w > maxWordW) maxWordW = w;
    }
  }
  return clampInt(maxWordW + DEFGRID_METRICS.labelPad, DEFGRID_METRICS.labelColMin, DEFGRID_METRICS.labelColMax);
}

/** 한 dgroup 높이 = max(라벨 높이, tail+서브 행 합) + chrome. dogma #17 over-predict. */
function measureDefGroup(
  item: DefItem,
  labelColW: number,
  rightColW: number,
  typo: TypographyConfig,
  fam: string,
  stacked: boolean
): number {
  const labelFs = typo.h3FontSize;
  const labeled = item.label !== "";
  // stacked는 라벨이 풀폭 상단, 본문 아래 → 라벨도 full width에서 측정. 라벨 없으면 labelH=0.
  const labelW = stacked ? rightColW : labelColW - DEFGRID_METRICS.labelPad;
  const labelH = labeled
    ? measureTextHeight(visibleText(item.label), `700 ${labelFs}px ${fam}`, labelW, labelFs * DEFGRID_METRICS.labelLineHeight)
    : 0;
  const smallFs = smallFontSize(typo);
  const rows: { text: string; fs: number; indent: number }[] = [];
  if (item.tail) rows.push({ text: item.tail, fs: typo.bodyFontSize, indent: 0 });
  for (const sub of item.subs) {
    rows.push({ text: sub.text, fs: smallFs, indent: sub.level * DEFGRID_METRICS.subIndent });
  }
  let rightH = 0;
  rows.forEach((r, ri) => {
    const lh = r.fs * DEFGRID_METRICS.rowLineHeight;
    rightH += measureTextHeight(visibleText(r.text), `430 ${r.fs}px ${fam}`, Math.max(80, rightColW - r.indent), lh);
    if (ri > 0) rightH += DEFGRID_METRICS.rowGap;
  });
  // stacked는 라벨↕본문 세로 적층(합), 일반은 라벨↔본문 좌우(max). 라벨 없으면 rightH만.
  const inner = stacked ? labelH + (labeled && rightH > 0 ? DEFGRID_METRICS.rowGap : 0) + rightH : Math.max(labelH, rightH);
  // 카드 박스 chrome(.dgroup padding+border = bento .asu-card와 동일) 재사용.
  return Math.ceil((inner + CARD_METRICS.chromeY) * DEFGRID_METRICS.overPredict);
}

/** defgrid 전체 높이(헤더 제외) + 라벨 칼럼폭 + stacked 여부. */
function measureDefGrid(
  items: DefItem[],
  typo: TypographyConfig,
  fam: string
): { totalH: number; labelColW: number; stacked: boolean } {
  // stacked: n=1(hero 통카드) 또는 라벨 없는 항목 포함 → 라벨을 좌측 칼럼이 아니라 풀폭 상단/생략.
  const stacked = items.length === 1 || !items.every((d) => d.label !== "");
  const cardInnerW = typo.contentWidth - CARD_METRICS.chromeX; // 카드 박스 padding 내부폭
  const labelColW = stacked ? cardInnerW : measureLabelColWidth(items, typo);
  const rightColW = stacked ? cardInnerW : cardInnerW - labelColW - DEFGRID_METRICS.colGap;
  let total = 0;
  items.forEach((it, i) => {
    total += measureDefGroup(it, labelColW, rightColW, typo, fam, stacked);
    if (i < items.length - 1) total += DEFGRID_METRICS.cardGap; // 카드 사이 간격
  });
  return { totalH: total, labelColW, stacked };
}

/** defgrid 그룹들 → HTML(헤더/wrapper 제외). whole-slide·block-level 공용. 라벨 없으면 label div 생략. */
function defGridGroupsHtml(items: DefItem[]): string {
  return items
    .map((it) => {
      const rows: string[] = [];
      if (it.tail) rows.push(`<div class="asu-def-row">${renderInline(it.tail)}</div>`);
      for (const sub of it.subs) {
        const pad = sub.level * DEFGRID_METRICS.subIndent;
        rows.push(`<div class="asu-def-row is-sub" style="padding-left:${pad}px">${renderInline(sub.text)}</div>`);
      }
      const labelDiv = it.label ? `<div class="asu-def-label">${escapeHtml(it.label)}</div>` : "";
      return `<div class="dgroup">${labelDiv}<div class="asu-def-main">${rows.join("")}</div></div>`;
    })
    .join("");
}

/**
 * 정의 그리드 사전조립. card-grid 동형: 자체측정 fit 실패 시 null(raw-flow 강등 — overflow 0).
 *
 * - 내부 전부 div-class(`.asu-def-*`) → injectPerElementStyles inline 주입 회피(dogma #15).
 *   `--asu-defgrid-label-w`는 div의 custom property(font-size 아닌 토큰 → div는 inject 대상 아님).
 * - 한 줄 atomic wrapper → packer가 헤더↔본문을 두 프레임으로 못 찢음.
 * - Stage 1은 폰트 stepdown 없음(렌더 폰트=덱-전역 --asu-fs-* 이므로 측정 typo와 항상 일치).
 *   폰트 캐스케이드는 Stage 3 라우터가 로컬 var override로 처리.
 */
export function composeDefGrid(sig: ShapeSignature, typo: TypographyConfig): string | null {
  if (sig.defItems.length < 1) return null; // n=1(nested 단일) → 1그룹 defgrid 허용(라우터 경유)
  const fam = familyOf(typo);
  const budget = computeFrameBudget(typo) * 0.95; // dogma #17 over-predict 마진
  const headerH = measureSectionHeader(sig.headingText, typo, fam);
  const { totalH, labelColW, stacked } = measureDefGrid(sig.defItems, typo, fam);
  if (headerH + totalH > budget) return null; // 어떤 그룹도 안 맞음 → 강등

  const groups = defGridGroupsHtml(sig.defItems);
  const cls = stacked ? "asu-defgrid is-solo" : "asu-defgrid";
  const stack =
    `<div class="asu-card-grid-stack" style="${fontVarStyle(typo)}">` +
    `<div class="asu-section-head"><div class="asu-section-title">${escapeHtml(sig.headingText)}</div></div>` +
    `<div class="${cls}" style="--asu-defgrid-label-w:${labelColW}px">${groups}</div>` +
    `</div>`;
  return [
    `<!-- _class: asu-defgrid-slide -->`,
    `<!-- asu-title: ${escapeComment(sig.headingText)} -->`,
    stack,
  ].join("\n");
}

// ─── Bento (A) — flat 카드: 단일 grid + 깔끔한 정수 비율 칼럼(위치별 mass 스냅, 칼럼 정렬) ───

/**
 * bento 측정 상수. chrome/lineHeight/overPredict는 CARD_METRICS 재사용.
 * **핵심**: 단일 CSS grid라 **칼럼이 모든 행에서 정렬**된다(위·아래 가로폭 동일). 2칼럼 폭은
 * 깔끔한 정수 비율([1,1]/[2,1]/[1,2]/[3,1]/[1,3])로 스냅 — 칼럼 위치별(짝수=col0/홀수=col1)
 * content mass가 일관되게 다를 때만 uneven, 비슷하면 균등. dogma #18: 비율은 측정 px mass로만.
 */
const BENTO_METRICS = {
  gap: 20,
  cols: 2, // 기본 2칼럼(2×2 스타일). cards:N 마커면 N칼럼 균등.
};

/** 칩 판정(subsAreShort)용 고정 좁은 기준폭. */
function chipProbeInner(typo: TypographyConfig): number {
  return (typo.contentWidth - BENTO_METRICS.gap * 3) / 4 - CARD_METRICS.chromeX;
}

/** content mass 측정용 고정 probe 폭(칼럼 배치와 독립적인 비교 기준). */
function bentoProbeInner(typo: TypographyConfig): number {
  return (typo.contentWidth - BENTO_METRICS.gap * 2) / 3 - CARD_METRICS.chromeX;
}

/**
 * bento 카드 1개 높이(px). measureCard(title+tail+chrome)에 더해 **서브 칩** 높이를 포함한다
 * (nested-short → bento일 때 서브를 칩으로 렌더). flat(subs=[])은 measureCard와 동일.
 */
function measureBentoCard(item: DefItem, cellInner: number, typo: TypographyConfig, fam: string): number {
  const titleH = measureTextHeight(
    visibleText(item.label),
    `700 ${typo.h3FontSize}px ${fam}`,
    cellInner,
    typo.h3FontSize * CARD_METRICS.titleLineHeight
  );
  const smallFs = smallFontSize(typo);
  const bodyH = item.tail
    ? measureTextHeight(visibleText(item.tail), `430 ${smallFs}px ${fam}`, cellInner, smallFs * CARD_METRICS.bodyLineHeight)
    : 0;
  const titleGap = item.tail ? CARD_METRICS.titleGap : 0;
  let chipsH = 0;
  if (item.subs.length) {
    const joined = item.subs.map((s) => s.text).join("   ");
    const flowH = measureTextHeight(visibleText(joined), `500 ${smallFs}px ${fam}`, cellInner, smallFs * 1.4);
    chipsH = Math.ceil(flowH * 1.5) + 14; // 칩 패딩/gap over-predict(보수적)
  }
  return Math.ceil((titleH + titleGap + bodyH + chipsH + CARD_METRICS.chromeY) * CARD_METRICS.overPredict);
}

/**
 * 2칼럼 폭 비율(정수 fr). col0(짝수 인덱스)·col1(홀수 인덱스) 측정 mass 합을 비교해 깔끔한
 * 비율에 스냅. 비슷하면 [1,1], 한쪽이 일관되게 크면 [2,1]/[3,1](또는 반대). 모든 행 동일 적용
 * → 칼럼 정렬 + uneven이되 "비율 맞는" 안정 배치. 텍스트량이 위치별로 섞일 때만 발동.
 */
function bentoColTemplate(items: DefItem[], typo: TypographyConfig, fam: string): number[] {
  const probe = bentoProbeInner(typo);
  let m0 = 0;
  let m1 = 0;
  items.forEach((it, i) => {
    const mass = measureBentoCard(it, probe, typo, fam);
    if (i % 2 === 0) m0 += mass;
    else m1 += mass;
  });
  if (m0 === 0 || m1 === 0) return [1, 1];
  const r = m0 / m1;
  if (r >= 2.3) return [3, 1];
  if (r >= 1.45) return [2, 1];
  if (r > 1 / 1.45) return [1, 1];
  if (r > 1 / 2.3) return [1, 2];
  return [1, 3];
}

/** 칼럼별 내부폭(px). template 합 비례로 contentWidth 분배 − 카드 chrome. */
function bentoColInners(template: number[], typo: TypographyConfig): number[] {
  const cols = template.length;
  const sum = template.reduce((a, b) => a + b, 0);
  const availW = typo.contentWidth - BENTO_METRICS.gap * (cols - 1);
  return template.map((w) => (availW * w) / sum - CARD_METRICS.chromeX);
}

/** startCol부터 spanCols개 칼럼을 차지하는 카드 내부폭. */
function bentoSpanInner(colInner: number[], startCol: number, spanCols: number): number {
  let outer = 0;
  for (let k = 0; k < spanCols; k++) outer += colInner[startCol + k] + CARD_METRICS.chromeX;
  outer += BENTO_METRICS.gap * (spanCols - 1);
  return outer - CARD_METRICS.chromeX;
}

interface BentoSlot {
  item: DefItem;
  span: number;
}

/** 카드를 cols 칼럼 grid에 행 단위 배치(순서 보존). 미완성 마지막 행은 마지막 카드가 남은 칼럼 span. */
function arrangeBento(items: DefItem[], cols: number): BentoSlot[][] {
  const rows: BentoSlot[][] = [];
  for (let i = 0; i < items.length; i += cols) {
    const row: BentoSlot[] = items.slice(i, i + cols).map((it) => ({ item: it, span: 1 }));
    if (row.length < cols) row[row.length - 1].span = cols - row.length + 1; // 남은 칼럼 span → 풀폭
    rows.push(row);
  }
  return rows;
}

/** bento 그리드 높이(헤더 제외). 각 카드는 자기 칼럼폭(span 반영)에서 측정. */
function measureBentoGrid(items: DefItem[], template: number[], typo: TypographyConfig, fam: string): number {
  const colInner = bentoColInners(template, typo);
  const rows = arrangeBento(items, template.length);
  let total = 0;
  rows.forEach((row, ri) => {
    let rowH = 0;
    let col = 0;
    for (const slot of row) {
      const w = bentoSpanInner(colInner, col, slot.span);
      rowH = Math.max(rowH, measureBentoCard(slot.item, Math.max(120, w), typo, fam));
      col += slot.span;
    }
    total += rowH;
    if (ri < rows.length - 1) total += BENTO_METRICS.gap;
  });
  return total;
}

/** bento 카드들 → HTML(헤더/wrapper 제외, 단일 grid 흐름). span>1은 grid-column span. */
function bentoCardsHtml(rows: BentoSlot[][]): string {
  return rows
    .flat()
    .map((slot) => {
      const c = slot.item;
      const body = c.tail ? `<div class="asu-card-body">${renderInline(c.tail)}</div>` : "";
      const chips = c.subs.length
        ? `<div class="asu-card-chips">${c.subs
            .map((s) => `<span class="asu-chip">${renderInline(s.text)}</span>`)
            .join("")}</div>`
        : "";
      const spanStyle = slot.span > 1 ? ` style="grid-column:span ${slot.span}"` : "";
      return `<div class="asu-card"${spanStyle}><div class="asu-card-title">${escapeHtml(c.label)}</div>${body}${chips}</div>`;
    })
    .join("");
}

/** template fr 배열 → CSS grid-template-columns 문자열. */
function bentoColsCss(template: number[]): string {
  return template.map((w) => `${w}fr`).join(" ");
}

/**
 * Bento 사전조립. card-grid 동형(자체측정 fit 실패 시 null → raw-flow 강등). **단일 CSS grid**라
 * 칼럼이 모든 행에서 정렬되고, 칼럼 폭은 깔끔한 정수 비율(`bentoColTemplate`). 세로는 CSS가
 * 행을 stretch해 슬라이드를 꽉 채운다(`section.asu-card-grid-slide` flex 컬럼).
 *
 * - 카드 내부 div-class → injectPerElementStyles inline 주입 회피(dogma #15).
 * - grid-template-columns/grid-column span은 div의 inline(font-size 아니라 inject 대상 아님).
 */
export function composeBento(sig: ShapeSignature, typo: TypographyConfig): string | null {
  if (sig.defItems.length < 1) return null;
  const fam = familyOf(typo);
  const forced = sig.cardsMarker >= 2 && sig.cardsMarker <= 4 ? sig.cardsMarker : 0; // cards:N → N칼럼 균등
  const template = forced ? new Array(forced).fill(1) : bentoColTemplate(sig.defItems, typo, fam);
  const budget = computeFrameBudget(typo) * 0.95; // dogma #17 over-predict 마진
  const headerH = measureSectionHeader(sig.headingText, typo, fam);
  if (headerH + measureBentoGrid(sig.defItems, template, typo, fam) > budget) return null; // 강등 → raw-flow

  const cards = bentoCardsHtml(arrangeBento(sig.defItems, template.length));
  const stack =
    `<div class="asu-card-grid-stack" style="${fontVarStyle(typo)}">` +
    `<div class="asu-section-head"><div class="asu-section-title">${escapeHtml(sig.headingText)}</div></div>` +
    `<div class="asu-bento" style="grid-template-columns:${bentoColsCss(template)}">${cards}</div>` +
    `</div>`;
  return [
    `<!-- _class: asu-card-grid-slide -->`,
    `<!-- asu-title: ${escapeComment(sig.headingText)} -->`,
    stack,
  ].join("\n");
}

// ─── 통합 라우터 (Stage 3) — 리스트 슬라이드를 bento/defgrid 가족으로 결정론 라우팅 ───

type ListFamily = "bento" | "defgrid";

interface RouteAttempt {
  family: ListFamily;
  typo: TypographyConfig;
}

/** 폰트 캐스케이드 1스텝(−pt). buildTypographyConfig 단일소스 재호출(scaleRatio 정확 전달). */
const FONT_STEP_DOWN = 4;
/** nested 서브 길이 게이트: span2 셀폭에서 sub가 이 줄수를 초과하면 "문장"(→defgrid). */
const SUB_LINE_THRESHOLD = 2;

/**
 * 리스트 슬라이드 게이트 — 헤딩 1개(h1/h2) + top-level 리스트 1개 + 기타블록 0.
 * **모든** 리스트를 카드 후보로(bold-lead 아니어도). 사용자 요구: 리스트는 일관되게 카드로.
 * fit 실패(너무 큰 리스트)는 composer가 null → raw 강등(overflow 0)으로 안전.
 */
function isListSlideShape(sig: ShapeSignature): boolean {
  const c = sig.counts;
  const otherBlocks =
    c.paragraphs + c.tables + c.code + c.images + c.blockquotes + c.htmlBlocks;
  return (
    c.headings === 1 &&
    (sig.headingLevel === 1 || sig.headingLevel === 2) &&
    c.lists === 1 &&
    sig.defItems.length >= 1 &&
    otherBlocks === 0
  );
}

/**
 * nested 서브가 "짧은 칩"(→bento)인지 "긴 문장"(→defgrid)인지 결정론 측정 게이트.
 * span2 셀폭(보수적으로 좁게 → 줄수↑ → defgrid로 안전하게 기움)에서 각 sub 줄수, **하나라도**
 * 임계 초과면 김(any-초과: 결정론·단조·over-predict). 글자수·role 판단 0(dogma #18).
 */
function subsAreShort(items: DefItem[], typo: TypographyConfig): boolean {
  const fam = familyOf(typo);
  const smallFs = smallFontSize(typo);
  const lh = smallFs * CARD_METRICS.bodyLineHeight;
  // 좁은 기준폭(chipProbeInner=4칼럼 1칸) — 문장은 여러 줄로 wrap돼 defgrid로 가고, 진짜 짧은
  // 칩(단어/구)만 ≤2줄로 bento. 넓은 폭은 80자 문장도 2줄로 보여 칩으로 오판하므로 부적절.
  const cellInner = chipProbeInner(typo);
  for (const it of items) {
    for (const sub of it.subs) {
      if (!sub.text.trim()) continue;
      const h = measureTextHeight(visibleText(sub.text), `430 ${smallFs}px ${fam}`, cellInner, lh);
      if (Math.ceil(h / lh) > SUB_LINE_THRESHOLD) return false;
    }
  }
  return true;
}

/**
 * §2.2 라우팅 표를 단일 결정론 switch로 → **시도 순서 배열**(분기 결정과 fit 측정 분리 →
 * dogma #18 자기검증 용이). 마커 우선 > 자동(depth≤1 flat→bento / nested는 subsAreShort) >
 * fit 캐스케이드(가족전환 → 폰트↓ → [오케스트레이터가 raw-flow 강등]). 개수·깊이·측정줄수·
 * 폰트·마커토큰만 — 의미추론/스코어링 0. mosaic(거부안 B) 미도입(Family 2종 고정).
 */
export function routeListSlide(sig: ShapeSignature, typo: TypographyConfig): RouteAttempt[] {
  if (!isListSlideShape(sig)) return [];
  const allLabeled = sig.defItems.every((d) => d.label !== "");
  let primary: ListFamily;
  let secondary: ListFamily;
  if (!allLabeled) {
    primary = "defgrid"; // 라벨 없는 항목 포함 → stacked defgrid(행 카드). bento는 제목 필요.
    secondary = "defgrid";
  } else if (sig.familyMarker === "bento") {
    primary = "bento";
    secondary = "defgrid";
  } else if (sig.familyMarker === "rows") {
    primary = "defgrid";
    secondary = "bento";
  } else if (sig.defItems.length === 1) {
    primary = "defgrid"; // n=1 → hero 통카드(solo: 라벨 풀폭 + 본문 행)
    secondary = "bento";
  } else if (sig.maxListDepth <= 1) {
    primary = "bento"; // flat (전부 라벨)
    secondary = "defgrid";
  } else if (subsAreShort(sig.defItems, typo)) {
    primary = "bento"; // nested + 짧은 칩
    secondary = "defgrid";
  } else {
    primary = "defgrid"; // nested + 긴 문장
    secondary = "bento";
  }
  const down = buildTypographyConfig(Math.max(16, typo.bodyFontSize - FONT_STEP_DOWN), typo.scaleRatio);
  return [
    { family: primary, typo },
    { family: secondary, typo },
    { family: primary, typo: down },
    { family: secondary, typo: down },
  ];
}

function composeFamily(family: ListFamily, sig: ShapeSignature, typo: TypographyConfig): string | null {
  return family === "bento" ? composeBento(sig, typo) : composeDefGrid(sig, typo);
}

/**
 * 라우터 오케스트레이터 — routeListSlide 시도를 위에서부터 실행. 각 composer가 자체측정 후
 * null이면 다음 시도, 첫 non-null 채택, 전부 실패 시 null(applyShapeTemplates가 raw-flow 강등).
 * 마커는 1순위 가족을 강제하되 fit 실패 시 캐스케이드 폴백(overflow 방어선은 동일).
 */
export function composeListSlide(sig: ShapeSignature, typo: TypographyConfig): string | null {
  for (const a of routeListSlide(sig, typo)) {
    const html = composeFamily(a.family, sig, a.typo);
    if (html !== null) return html;
  }
  return null;
}

/**
 * v7.0 — 리스트가 한 슬라이드에 다 안 들어가면 **카드 그리드를 여러 슬라이드로 페이지네이션**한다.
 * 기존 composeListSlide는 all-or-nothing(전부 fit 아니면 null→블록레벨로 강등→1개씩 과분할)이라
 * 항목이 많은 리스트가 세로로 뚝뚝 띄어졌다. 여기서는:
 *   1) 단일 슬라이드로 fit하면 그대로(기존 거동 보존).
 *   2) 안 되면 라우팅 1순위 가족으로 항목을 **그리디(이진탐색) 청크 분할** — 각 청크는 그 가족
 *      composer가 fit하는 "최대" 개수(슬라이드당 최대한 채움). 청크마다 카드 슬라이드를 만들어
 *      `---`로 잇는다(2번째부터 제목에 (cont.)). 항목 1개도 안 들어가면 null(강등, 기존 안전망).
 * 각 청크가 자체측정으로 fit하므로 실 렌더 overflow가 작아 auditLoop의 과수축/깜빡임도 줄어든다.
 */
export function composeListSlidePaginated(
  sig: ShapeSignature,
  typo: TypographyConfig
): string | null {
  const single = composeListSlide(sig, typo);
  if (single !== null) return single;

  const attempts = routeListSlide(sig, typo);
  if (attempts.length === 0 || sig.defItems.length <= 1) return null;
  const { family, typo: ptypo } = attempts[0];

  const chunks: DefItem[][] = [];
  let rest = sig.defItems.slice();
  let guard = 0;
  while (rest.length > 0 && guard++ < 500) {
    // fit하는 최대 prefix를 이진탐색(개수↓ → 항상 더 작아 fit → 단조).
    let lo = 1;
    let hi = rest.length;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const subSig: ShapeSignature = { ...sig, defItems: rest.slice(0, mid) };
      if (composeFamily(family, subSig, ptypo) !== null) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best === 0) return null; // 1개도 안 들어감 → 페이지네이션 불가(강등)
    chunks.push(rest.slice(0, best));
    rest = rest.slice(best);
  }
  if (chunks.length <= 1) return null; // 1청크면 위 single에서 됐어야 함(방어)

  const slides = chunks.map((chunk, i) => {
    const subSig: ShapeSignature = {
      ...sig,
      defItems: chunk,
      headingText: i === 0 ? sig.headingText : `${sig.headingText} (cont.)`,
    };
    return composeFamily(family, subSig, ptypo);
  });
  if (slides.some((s) => s === null)) return null;
  return slides.join("\n\n---\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Block-level transforms (슬라이드 안의 일부 블록만 정돈 — 콜아웃 등)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * obsidianCompat가 `> [!NOTE] …`를 `> <!-- asu-callout:type:title -->\n> **Label: title**\n> …`
 * 으로 바꿔둔 콜아웃 blockquote를, 스타일된 `<div class="asu-callout asu-callout-{type}">`로
 * 감싼다.
 *
 * 핵심: div와 본문 사이에 **빈 줄**을 둔다. 그러면 (a) markdown-it(Marp)는 HTML block을 빈
 * 줄에서 닫고 사이 본문을 markdown으로 정상 렌더하고(CommonMark HTML block type 6),
 * (b) 우리 parseContentBlocks는 htmlDepthDelta로 `</div>`까지 한 덩어리로 읽어(빈 줄 포함)
 * overflow packer가 콜아웃을 두 프레임으로 찢지 않는다. 양쪽 요구를 동시에 만족.
 *
 * 마커는 Marp 렌더 시 사라지므로(주석 strip) 렌더-후 post-process가 아니라 여기 markdown
 * 단계에서 변환해야 한다.
 */
/**
 * 콜아웃/인용문 박스는 `</div>`까지 한 덩어리(atomic html_block)라 packer가 두 프레임으로
 * 쪼갤 수 없다. 따라서 내용이 한 프레임을 넘으면 박스로 감싸는 순간 overflow가 난다(auditor도
 * 원자 블록은 못 고침). inner markdown을 측정해 프레임 예산을 넘으면 박스를 포기하고 원래
 * blockquote 그대로 둔다 → packer가 정상 분할해 overflow 0(dogma #17: over-predict).
 */
function calloutFits(inner: string, typo: TypographyConfig): boolean {
  const blocks = parseContentBlocks(inner);
  const contentH = blocks.reduce((sum, b) => sum + measureBlockHeight(b, typo), 0);
  // dogma #17(over-predict): 박스로 감싸면 (a) measureBlockHeight가 잡는 full-width보다
  // 박스 안쪽 폭이 좁아 줄바꿈이 늘고(×1.3), (b) 패딩 ~2.2rem + 보더 + margin chrome가
  // 더해진다. 또 budget의 95%만 인정해 여유를 둔다. 추정이 한 프레임을 넘으면 박스를
  // 포기하고 blockquote로 폴백(packer가 baseline대로 분할 → tier2가 baseline보다 나빠지지
  // 않음). 분할 가능한 박스는 후속 dense-template 작업에서 도입.
  const boxChrome = Math.round(2.6 * typo.bodyFontSize) + 56;
  const estimated = contentH * 1.3 + boxChrome;
  return estimated <= computeFrameBudget(typo) * 0.95;
}

export function transformCallouts(content: string, typo: TypographyConfig): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;
  let changed = false;

  while (i < lines.length) {
    // 모든 top-level blockquote 블록을 박스로. 마커가 있으면 admonition(타입/라벨),
    // 없으면 평범한 인용문 → quote 박스. 단, 한 프레임을 넘는 큰 박스는 폴백.
    if (/^>/.test(lines[i])) {
      const bq: string[] = [];
      let j = i;
      while (j < lines.length && /^>/.test(lines[j])) {
        bq.push(lines[j]);
        j++;
      }
      const stripped = bq.map((l) => l.replace(/^>\s?/, ""));
      const marker = stripped[0].match(
        /^<!--\s*asu-callout:([a-z0-9_-]+):([^]*?)\s*-->\s*$/
      );
      let inner = "";
      let openTag = "";
      if (marker) {
        // admonition: [0]=마커(skip), [1]=readable label(**Label: title**), [2+]=본문.
        const type = marker[1];
        const label = stripped[1] ?? "";
        const body = stripped.slice(2).join("\n").trim();
        inner = body ? `${label}\n\n${body}` : label;
        openTag = `<div class="asu-callout asu-callout-${type}">`;
      } else {
        inner = stripped.join("\n").trim();
        openTag = `<div class="asu-callout asu-callout-quote asu-callout--plain">`;
      }

      if (inner && calloutFits(inner, typo)) {
        out.push(openTag, "", inner, "", "</div>");
        changed = true;
      } else {
        // 폴백: 한 프레임 초과(또는 빈 내용) → 박스 포기, 원래 blockquote 유지(packer가 분할).
        out.push(...bq);
      }
      i = j;
      continue;
    }
    out.push(lines[i]);
    i++;
  }

  return changed ? out.join("\n") : content;
}

/** raw GFM 표를 **단일** 표 카드 div로 감싼다(콜아웃과 동일한 type-6 빈 줄 트릭). */
function wrapTableCard(tableRaw: string): string {
  // 단일 div만 — 안쪽에 .table-wrap 2차 박스를 두지 않아 이중 테두리/패딩 간격이 없다.
  // 여는 div 직후 빈 줄 → markdown-it가 안쪽 표를 markdown으로 렌더(셀 inline md·정렬 보존).
  // 닫는 빈 줄 → 닫는 div도 통과. parseContentBlocks는 첫 `<div`~`</div>`를 atomic으로 읽음.
  return [`<div class="asu-table-card">`, ``, tableRaw, ``, `</div>`].join("\n");
}

/**
 * 슬라이드 안의 **모든 GFM 표 블록**을 단일 표 카드로 감싼다(콜아웃과 동형 block-level 변환).
 * 표가 다른 내용(인트로 문단·연속 프레임 등)과 같이 있어도 표만 골라 카드화한다.
 *
 * **항상 카드로 감싼다(fit 검사 없음).** 폰트/길이에 따라 카드가 생겼다 없어졌다 하면 안 되므로
 * (일관성), 한 프레임을 넘는 큰 표도 일단 카드로 감싸고 packer의 truncateTableForFrame이 잘라서
 * **같은 단일 카드로 다시 감싼다** → overflow 0 + 모든 폰트/길이에서 동일한 카드 모양 유지.
 */
function transformTables(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;
  let changed = false;
  while (i < lines.length) {
    // GFM 표: `|`로 시작하는 줄 + 다음 줄이 `|---|` 정렬 구분선(이게 있어야 진짜 GFM 표).
    const isTableStart =
      /^\s*\|/.test(lines[i]) &&
      i + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]);
    if (isTableStart) {
      const tbl: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        tbl.push(lines[i]);
        i++;
      }
      out.push(wrapTableCard(tbl.join("\n"))); // 항상 카드 (넘치면 packer가 truncate+재감싸기)
      changed = true;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return changed ? out.join("\n") : content;
}

// ─── 블록 단위 카드 (Stage 4) — 혼합 섹션 내 bold-lead 리스트 → 카드(콜아웃과 동형) ───

/** 헤더리스 bento body(자체측정 ≤ frame budget). 안 맞으면 null. */
function bentoBlockBody(items: DefItem[], typo: TypographyConfig): string | null {
  const fam = familyOf(typo);
  const template = bentoColTemplate(items, typo, fam);
  if (measureBentoGrid(items, template, typo, fam) > computeFrameBudget(typo) * 0.95) return null;
  const cards = bentoCardsHtml(arrangeBento(items, template.length));
  return `<div class="asu-bento" style="grid-template-columns:${bentoColsCss(template)}">${cards}</div>`;
}

/** 헤더리스 defgrid body(자체측정 ≤ frame budget). 안 맞으면 null. */
function defGridBlockBody(items: DefItem[], typo: TypographyConfig): string | null {
  const fam = familyOf(typo);
  const { totalH, labelColW, stacked } = measureDefGrid(items, typo, fam);
  if (totalH > computeFrameBudget(typo) * 0.95) return null;
  const cls = stacked ? "asu-defgrid is-solo" : "asu-defgrid";
  return `<div class="${cls}" style="--asu-defgrid-label-w:${labelColW}px">${defGridGroupsHtml(items)}</div>`;
}

/**
 * 블록 단위 bold-lead 리스트 → 헤더리스 카드(혼합 섹션 내 콜아웃·이미지와 나란히). 라우팅은
 * whole-slide와 동일(flat/짧은서브 → bento, nested 긴문장 → defgrid). 자체측정 ≤ frame budget
 * 일 때만 atomic html_block 반환(packer가 한 덩어리로 배치 → overflow 0), 아니면 null(raw 유지).
 */
function composeListCardBlock(items: DefItem[], maxListDepth: number, typo: TypographyConfig): string | null {
  const allLabeled = items.every((d) => d.label !== "");
  const short = maxListDepth <= 1 || subsAreShort(items, typo);
  // 라벨 없는 항목 포함 → defgrid(stacked)만. 전부 라벨이면: n=1→defgrid solo, flat/짧은서브→bento.
  const order: ListFamily[] = !allLabeled
    ? ["defgrid"]
    : items.length === 1
      ? ["defgrid", "bento"]
      : short
        ? ["bento", "defgrid"]
        : ["defgrid", "bento"];
  for (const fam of order) {
    const body = fam === "bento" ? bentoBlockBody(items, typo) : defGridBlockBody(items, typo);
    if (body) return `<div class="asu-listcard" style="${fontVarStyle(typo)}">${body}</div>`;
  }
  return null;
}

/**
 * 콘텐츠 안의 **모든 top-level 리스트 블록**을 그 자리에서 카드로 변환(콜아웃과 동형 block-level).
 * bold-lead 아니어도 카드(라벨 없는 항목은 stacked 행). 자체측정이 한 프레임에 맞으면 통카드,
 * 너무 크면 **항목별 카드로 분할**(프레임에 펼침), 그래도 안 맞는 항목은 raw. div-depth로 이미
 * 변환된 콜아웃 div 내부는 건너뛴다.
 */
function transformBoldLeadLists(content: string, typo: TypographyConfig): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;
  let changed = false;
  let divDepth = 0;
  const bumpDepth = (line: string) => {
    divDepth += (line.match(/<div\b/g) ?? []).length - (line.match(/<\/div>/g) ?? []).length;
    if (divDepth < 0) divDepth = 0;
  };
  const emitCards = (cards: string[]) => {
    if (out.length && out[out.length - 1].trim() !== "") out.push("");
    for (const c of cards) out.push(c, ""); // atomic html_block은 앞뒤 빈 줄로 격리
    changed = true;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (divDepth === 0 && TOP_LEVEL_ITEM.test(line)) {
      const block: string[] = [];
      let j = i;
      while (j < lines.length) {
        const lj = lines[j];
        if (TOP_LEVEL_ITEM.test(lj) || NESTED_ITEM.test(lj)) {
          block.push(lj);
          j++;
        } else if (
          lj.trim() === "" &&
          j + 1 < lines.length &&
          (TOP_LEVEL_ITEM.test(lines[j + 1]) || NESTED_ITEM.test(lines[j + 1]))
        ) {
          block.push(lj); // 항목 사이 빈 줄(loose list)
          j++;
        } else if (lj.trim() !== "" && /^\s+\S/.test(lj)) {
          block.push(lj); // 들여쓴 연속(lazy continuation)
          j++;
        } else {
          break;
        }
      }
      const { rawItems, maxDepth } = groupItemsWithSubs(block);
      const items: DefItem[] = rawItems.map((ri) => {
        const { label, body } = parseListItem(ri.text);
        return { label, tail: body, subs: ri.subs };
      });
      if (items.length >= 1) {
        // 1) 리스트 전체를 한 카드로 (들어가면).
        const whole = composeListCardBlock(items, maxDepth, typo);
        if (whole) {
          emitCards([whole]);
          i = j;
          continue;
        }
        // 2) 너무 큼 → 항목별 카드로 분할(각자 자체측정). 전부 카드 가능할 때만 채택.
        if (items.length >= 2) {
          const perItem = items.map((it) =>
            composeListCardBlock([it], it.subs.length ? 2 : 1, typo)
          );
          if (perItem.every((c): c is string => c !== null)) {
            emitCards(perItem);
            i = j;
            continue;
          }
        }
      }
      for (const bl of block) out.push(bl); // 카드화 실패 → raw 유지
      i = j;
      continue;
    }
    out.push(line);
    bumpDepth(line);
    i++;
  }
  return changed ? out.join("\n") : content;
}

/**
 * 슬라이드 콘텐츠에 block-level 정돈을 적용(콜아웃 → bold-lead 리스트 카드 순). 변화 없으면 입력 그대로.
 * 카드 변환은 자체측정 ≤ frame budget일 때만 atomic 카드, 아니면 raw 유지(overflow 0). 콜아웃을
 * 먼저 div로 감싼 뒤 리스트 스캔이 div-depth로 그 내부를 건너뛴다.
 *
 * 표 atomic 카드(transformTables)는 여전히 **비활성**(셀 padding rem 예측난 → 잔여 overflow).
 */
function applyBlockTransforms(content: string, typo: TypographyConfig): string {
  return transformBoldLeadLists(transformCallouts(content, typo), typo);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline stage
// ─────────────────────────────────────────────────────────────────────────────

/** 이미 스타일된(타이틀 슬라이드 등) · 사전조립 HTML인 슬라이드는 건드리지 않는다. */
function isAlreadyStyled(content: string): boolean {
  return (
    /<!--\s*_class:/.test(content) ||
    /<div\b[^>]*\basu-content\b/i.test(content) ||
    content.trimStart().startsWith("<style")
  );
}

/**
 * 각 logical 슬라이드의 구조 시그니처를 보고 매치되는 템플릿으로 HTML을 사전조립한다.
 * - tier2Layouts off → markdown 그대로(byte-identical).
 * - 매치된 슬라이드가 하나도 없으면 → 원본 markdown 그대로 반환(회귀 0 보장).
 * - 매치가 하나라도 있으면 → 변환분 + 미변환분을 `---`로 재조립(boundary는 동일하게 재분할됨).
 */
export function applyShapeTemplates(
  markdown: string,
  settings: AchmageSettings,
  typo: TypographyConfig
): string {
  if (!settings.tier2Layouts) return markdown;

  const { frontmatter, body } = extractFrontmatter(markdown);
  const logicalSlides: LogicalSlide[] = splitByHeadings(body, settings.headingDivider);
  if (logicalSlides.length === 0) return markdown;

  let changed = false;
  const out = logicalSlides.map((slide) => {
    if (isAlreadyStyled(slide.content)) return slide.content;
    const sig = computeShapeSignature(slide.content);
    // 1) divider (heading-only, 항상 fit sparse).
    if (sig.isHeadingOnly) {
      changed = true;
      return composeDivider(sig);
    }
    // 2) 리스트 슬라이드 통합 라우터(bento/defgrid + fit 캐스케이드 + 페이지네이션).
    //    한 슬라이드로 안 되면 카드 그리드를 여러 슬라이드로 분할. 전부 실패 시 null → 강등.
    const listHtml = composeListSlidePaginated(sig, typo);
    if (listHtml !== null) {
      changed = true;
      return listHtml;
    }
    // 3) 미매치 또는 강등 슬라이드: block-level 정돈(콜아웃)만 적용, 나머지는 raw-flow 유지.
    const transformed = applyBlockTransforms(slide.content, typo);
    if (transformed !== slide.content) changed = true;
    return transformed;
  });

  if (!changed) return markdown; // 회귀 0: 매치 없으면 원본 그대로

  // separator는 `\n\n---\n`(---  뒤에 빈 줄 없음). 빈 줄을 두면 splitByHeadings가
  // `---` 직후의 빈 줄을 누적하다 다음 헤딩에서 빈-content 슬라이드를 push해 가짜 빈
  // 슬라이드가 생긴다(prependTitleSlide와 동일 메커니즘). 각 조각은 trim해서 조각 자체의
  // 선/후행 빈 줄도 제거한다.
  return frontmatter + out.map((s) => s.trim()).join("\n\n---\n");
}
