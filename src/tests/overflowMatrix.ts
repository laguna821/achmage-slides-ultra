/**
 * Geometric zero-overflow acceptance harness (v5.5, Phase 0).
 *
 * Renders fixtures via the REAL SlideRenderer across a {fixture × baseFontSize ×
 * typographicScale × theme} matrix, loads each deck in a headless Edge/Chrome
 * instance over CDP, reveals every stacked overflow frame, and asserts that no
 * block element's rendered geometry exceeds its slide's content box. This is the
 * regression net the predictive engine work (Phase 1+) is tuned against — it
 * measures the TRUTH (Chromium layout) rather than the pretext prediction.
 *
 * Unlike the legacy atlas acceptance suite, this harness has ZERO dependency on
 * the removed semantic wrapper classes — it checks raw-flow geometry only, so it
 * stays valid as the engine evolves.
 *
 * Run: `node scripts/render-overflow-matrix.mjs`  (bundles this file w/ the
 * obsidian stub, then executes it). Exit code 1 if any cell overflows.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Vault } from "obsidian";
import { SlideRenderer } from "../engine/slideRenderer";
import { DEFAULT_SETTINGS } from "../settingsDefaults";
import type { TypographicScaleName } from "../settings";
import {
  accumulateBudgetShrink,
  aggregateOverflow,
  buildProbeExpression,
  type ProbeResult,
} from "../audit/overflowProbe";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration (env-overridable)
// ─────────────────────────────────────────────────────────────────────────────

// The runner script spawns this bundle with cwd = project root.
const ROOT = resolve(process.cwd());
const FIXTURE_DIR = join(ROOT, "src", "tests", "fixtures", "native-1920-v5-prd");
const OUT_DIR = join(ROOT, "build", "acceptance", "native-1920-v5-overflow");

/** Bottom-edge tolerance in px (absorbs sub-pixel rounding in headless render). */
const OVERFLOW_TOLERANCE_PX = 2;

/**
 * Closed-loop (Phase 4): max render→measure→shrink passes per cell. The auditor
 * measures the real rendered overflow, feeds a per-logical budget shrink back to
 * the engine, and re-renders until nothing overflows. Set OVERFLOW_AUDIT=0 to
 * measure the pure predictive (open-loop) engine instead.
 */
const AUDIT_MAX_PASSES = process.env.OVERFLOW_AUDIT === "0" ? 0 : 4;
/** Extra px added to each shrink so the re-split clears the measured overflow. */
const AUDIT_SHRINK_MARGIN = 28;

/** Curated default fixtures most likely to surface overflow under font change. */
const DEFAULT_FIXTURES = [
  "04-dense-body",
  "35-korean-dense",
  "stress-cjk-eng-dense",
  "stress-list-15items",
  "stress-list-nested-3level",
  "stress-table-50rows",
  "stress-code-50lines",
  "stress-quote-long-multi-source",
  "split-stress-cjk-clause-overflow",
  "split-stress-table-25rows-narrow",
  "font-stress-minor-40pt-50line-code",
  "font-stress-32pt-12item-list",
];

const DEFAULT_BASES = [16, 28, 40];
const DEFAULT_SCALES: TypographicScaleName[] = ["minorThird"];
const DEFAULT_THEMES = ["cmds-dark-native-1920-v5"];

function envList(name: string): string[] | null {
  const raw = process.env[name];
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const FIXTURES = envList("OVERFLOW_FIXTURES") ?? DEFAULT_FIXTURES;
const BASES = (envList("OVERFLOW_BASES") ?? DEFAULT_BASES.map(String)).map((s) =>
  parseInt(s, 10)
);
const SCALES = (envList("OVERFLOW_SCALES") ??
  DEFAULT_SCALES) as TypographicScaleName[];
const THEMES = envList("OVERFLOW_THEMES") ?? DEFAULT_THEMES;

// ─────────────────────────────────────────────────────────────────────────────
// Render plumbing
// ─────────────────────────────────────────────────────────────────────────────

const fakeVault = {
  getFiles: () => [],
  getResourcePath: (file: { path: string }) => file.path,
  getAbstractFileByPath: () => null,
} as unknown as Vault;

function deckMarkdown(theme: string, body: string): string {
  return `---\nmarp: true\ntheme: ${theme}\n---\n\n${body}\n`;
}

interface Cell {
  fixture: string;
  base: number;
  scale: TypographicScaleName;
  theme: string;
}

function renderCell(
  cell: Cell,
  budgetShrink?: Record<number, number>
): { html: string; slideCount: number } {
  const body = readFileSync(join(FIXTURE_DIR, `${cell.fixture}.md`), "utf8");
  const settings = {
    ...DEFAULT_SETTINGS,
    defaultTheme: cell.theme,
    baseFontSize: cell.base,
    typographicScale: cell.scale,
    // v6.0 — OVERFLOW_TIER2=1 로 Tier 2 레이아웃을 켜고 overflow 회귀를 검증(기본 off).
    tier2Layouts: process.env.OVERFLOW_TIER2 === "1",
  };
  const renderer = new SlideRenderer(settings);
  const result = renderer.render(deckMarkdown(cell.theme, body), fakeVault, {
    budgetShrink,
  });
  return { html: result.html, slideCount: result.slideCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// CDP plumbing (ported from the proven legacy acceptance harness)
// ─────────────────────────────────────────────────────────────────────────────

function findBrowser(): string | undefined {
  const override = process.env.CHROME_PATH;
  if (override && existsSync(override)) return override;
  const programFiles = process.env.ProgramFiles ?? "";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
  ].map((c) => resolve(c));
  return candidates.find((c) => existsSync(c));
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForProcessExit(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => {
    proc.once("exit", () => resolveExit());
    setTimeout(resolveExit, 1500);
  });
}

interface CdpPending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

class CdpClient {
  private id = 0;
  private pending = new Map<number, CdpPending>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        error?: { message?: string };
        result?: unknown;
      };
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "CDP error"));
      else pending.resolve(message.result);
    });
  }
  static connect(url: string): Promise<CdpClient> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => res(new CdpClient(ws)), { once: true });
      ws.addEventListener(
        "error",
        () => rej(new Error(`Failed to connect CDP websocket: ${url}`)),
        { once: true }
      );
    });
  }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    const payload = JSON.stringify({ id, method, params });
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { resolve: res as (v: unknown) => void, reject: rej });
      this.ws.send(payload);
    });
  }
  close(): void {
    this.ws.close();
  }
}

async function waitForPageWebSocket(port: number): Promise<string> {
  const url = `http://127.0.0.1:${port}/json/list`;
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(url);
      const targets = (await response.json()) as {
        type: string;
        webSocketDebuggerUrl?: string;
      }[];
      const page = targets.find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl
      );
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // browser not ready yet
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for browser debugger on port ${port}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// In-page geometric overflow probe — shared with the live preview (../audit).
// ─────────────────────────────────────────────────────────────────────────────

async function inspectDeck(
  browser: string,
  htmlPath: string,
  port: number
): Promise<ProbeResult> {
  // Keep the browser profile OUTSIDE OUT_DIR so lingering headless handles
  // never lock the report directory (Windows EPERM on cleanup).
  const userDataDir = join(tmpdir(), "achmage-overflow", `${port}-${Date.now()}`);
  mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(browser, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--window-size=1920,1080",
    pathToFileURL(htmlPath).toString(),
  ]);
  try {
    const wsUrl = await waitForPageWebSocket(port);
    const cdp = await CdpClient.connect(wsUrl);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await delay(900);
      const evalResult = await cdp.send<{
        result?: { value?: ProbeResult };
        exceptionDetails?: { exception?: { description?: string }; text?: string };
      }>("Runtime.evaluate", {
        expression: buildProbeExpression(OVERFLOW_TOLERANCE_PX),
        awaitPromise: true,
        returnByValue: true,
      });
      if (evalResult.exceptionDetails) {
        throw new Error(
          "probe failed: " +
            JSON.stringify(
              evalResult.exceptionDetails.exception?.description ??
                evalResult.exceptionDetails.text
            )
        );
      }
      const value = evalResult.result?.value;
      if (!value) throw new Error("probe returned no value");
      return value;
    } finally {
      cdp.close();
    }
  } finally {
    proc.kill();
    await waitForProcessExit(proc);
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

interface CellResult {
  cell: Cell;
  slideCount: number;
  frameCount: number;
  worstOverflowPx: number;
  pass: boolean;
  /** How many render passes the closed loop took (1 = predictive pass was enough). */
  passes: number;
  /** worstOverflowPx of the FIRST (predictive, pre-audit) pass — for before/after. */
  predictiveWorstPx: number;
  offenders: { frame: string; group: string; over: number; detail: string }[];
}

async function main(): Promise<void> {
  try {
    rmSync(OUT_DIR, { recursive: true, force: true });
  } catch {
    // A lingering headless handle may lock a stale child dir; tolerate it and
    // just overwrite the report files below.
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = findBrowser();
  if (!browser) {
    console.error(
      "No headless browser found (set CHROME_PATH). Geometric overflow check cannot run."
    );
    process.exit(2);
  }
  console.log(`Browser: ${browser}`);

  // Sanity-check the fixture list.
  const available = new Set(
    readdirSync(FIXTURE_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
  );
  const fixtures = FIXTURES.filter((f) => {
    if (!available.has(f)) {
      console.warn(`(skip) fixture not found: ${f}`);
      return false;
    }
    return true;
  });

  const cells: Cell[] = [];
  for (const fixture of fixtures)
    for (const base of BASES)
      for (const scale of SCALES)
        for (const theme of THEMES) cells.push({ fixture, base, scale, theme });

  console.log(
    `Matrix: ${fixtures.length} fixtures × ${BASES.length} base × ${SCALES.length} scale × ${THEMES.length} theme = ${cells.length} cells\n`
  );

  const results: CellResult[] = [];
  // Vary the base port per run so a lingering headless instance from a prior
  // aborted run on an old port is never mistaken for this run's target.
  let port = 9400 + (Date.now() % 180);
  for (const cell of cells) {
    const label = `${cell.fixture} @ ${cell.base}pt/${cell.scale}/${cell.theme}`;
    // Closed loop: per-logical budget shrink accumulated across passes.
    const budgetShrink: Record<number, number> = {};
    let predictiveWorst = -1;
    let last: {
      worst: number;
      frameCount: number;
      slideCount: number;
      offenders: CellResult["offenders"];
    } | null = null;
    let failedHard = false;
    let passesRun = 0;

    for (let pass = 0; pass <= AUDIT_MAX_PASSES; pass++) {
      passesRun = pass + 1;
      let rendered: { html: string; slideCount: number };
      try {
        rendered = renderCell(cell, pass === 0 ? undefined : budgetShrink);
      } catch (err) {
        console.log(`  RENDER-FAIL  ${label}: ${String(err)}`);
        results.push({
          cell, slideCount: 0, frameCount: 0, worstOverflowPx: -1, pass: false,
          passes: pass + 1, predictiveWorstPx: predictiveWorst,
          offenders: [{ frame: "?", group: "?", over: -1, detail: `render error: ${String(err)}` }],
        });
        failedHard = true;
        break;
      }
      const htmlPath = join(
        OUT_DIR,
        `${cell.fixture}__${cell.base}pt-${cell.scale}-${cell.theme}${pass > 0 ? `_p${pass}` : ""}.html`
      );
      writeFileSync(htmlPath, rendered.html);

      let probe: ProbeResult;
      try {
        probe = await inspectDeck(browser, htmlPath, port++);
      } catch (err) {
        console.log(`  PROBE-FAIL   ${label}: ${String(err)}`);
        results.push({
          cell, slideCount: rendered.slideCount, frameCount: 0, worstOverflowPx: -1, pass: false,
          passes: pass + 1, predictiveWorstPx: predictiveWorst,
          offenders: [{ frame: "?", group: "?", over: -1, detail: `probe error: ${String(err)}` }],
        });
        failedHard = true;
        break;
      }

      // Aggregate worst overflow + per-group map (shared with the live view),
      // and build harness-only offender details for the console log.
      const { worst, groupOverflow } = aggregateOverflow(
        probe,
        OVERFLOW_TOLERANCE_PX
      );
      const offenders: CellResult["offenders"] = [];
      for (const f of probe.frames) {
        const frameWorst = Math.max(f.worstOverflowPx, f.scrollOverflowPx);
        if (frameWorst > OVERFLOW_TOLERANCE_PX) {
          const detail =
            f.offenders.map((o) => `${o.tag}.${o.cls.split(" ")[0]}+${o.over}`).join(", ") ||
            `scroll+${f.scrollOverflowPx}`;
          offenders.push({ frame: f.frame, group: f.group, over: frameWorst, detail });
        }
      }
      if (pass === 0) predictiveWorst = worst;
      last = { worst, frameCount: probe.frameCount, slideCount: rendered.slideCount, offenders };

      if (worst <= OVERFLOW_TOLERANCE_PX) break; // converged
      if (pass >= AUDIT_MAX_PASSES) break; // out of passes — accept best

      // Feed the measured overflow back as a per-logical budget shrink (shared
      // accumulation logic with the live preview auditor).
      accumulateBudgetShrink(
        budgetShrink,
        groupOverflow,
        OVERFLOW_TOLERANCE_PX,
        AUDIT_SHRINK_MARGIN
      );
    }

    if (failedHard || !last) continue;
    const pass = last.worst <= OVERFLOW_TOLERANCE_PX;
    results.push({
      cell,
      slideCount: last.slideCount,
      frameCount: last.frameCount,
      worstOverflowPx: last.worst,
      pass,
      passes: passesRun,
      predictiveWorstPx: predictiveWorst,
      offenders: last.offenders,
    });
    const auditNote =
      predictiveWorst > OVERFLOW_TOLERANCE_PX
        ? `  (predictive ${predictiveWorst}px → audited ${last.worst}px)`
        : "";
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${label}  frames=${last.frameCount} worst=${last.worst}px${auditNote}${
        pass ? "" : "  → " + last.offenders.map((o) => `[g${o.group}/f${o.frame} ${o.detail}]`).join(" ")
      }`
    );
  }

  const failed = results.filter((r) => !r.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    browser,
    tolerancePx: OVERFLOW_TOLERANCE_PX,
    total: results.length,
    failed: failed.length,
    results,
  };
  writeFileSync(join(OUT_DIR, "_matrix.json"), JSON.stringify(report, null, 2));
  writeMatrixMarkdown(results);

  console.log(
    `\n${results.length - failed.length}/${results.length} cells PASS · ${failed.length} FAIL`
  );
  console.log(`Report: ${join(OUT_DIR, "_matrix.json")}`);
  if (failed.length > 0) process.exit(1);
}

function writeMatrixMarkdown(results: CellResult[]): void {
  const lines: string[] = [
    "# Overflow Matrix Report",
    "",
    "predictivePx = overflow on the first (open-loop) pass; worstPx = after the closed-loop audit.",
    "",
    "| fixture | base | scale | theme | frames | predictivePx | worstPx | passes | result |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    lines.push(
      `| ${r.cell.fixture} | ${r.cell.base} | ${r.cell.scale} | ${r.cell.theme} | ${r.frameCount} | ${r.predictiveWorstPx} | ${r.worstOverflowPx} | ${r.passes} | ${r.pass ? "PASS" : "**FAIL**"} |`
    );
  }
  writeFileSync(join(OUT_DIR, "_matrix.md"), lines.join("\n") + "\n");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
