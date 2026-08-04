/**
 * Shared closed-loop overflow correction runner (v5.5 Phase 4/6).
 *
 * Drives the render → measure → shrink → re-render loop against a given iframe:
 *   • the LIVE preview iframe (SlidePreviewView), or
 *   • a detached OFFSCREEN iframe (export-to-HTML), so exported decks get the
 *     same zero-overflow guarantee as the preview.
 *
 * The loop is the orchestration only; the actual geometry measurement lives in
 * `overflowProbe` (identical for preview, export, and the acceptance harness).
 */

import type { RenderedDeck } from "../engine/slideRenderer";
import {
  accumulateBudgetShrink,
  aggregateOverflow,
  buildProbeExpression,
  type ProbeResult,
} from "./overflowProbe";

// Shared closed-loop tuning (single source for preview, export, harness mirror).
export const AUDIT_TOLERANCE_PX = 2;
export const AUDIT_MAX_PASSES = 4;
export const AUDIT_SHRINK_MARGIN = 28;

export interface AuditLoopOptions {
  /** Max render passes (pass 0 = predictive; 1..N = corrections). */
  maxPasses: number;
  /** Sub-pixel tolerance for "fits". */
  tolerancePx: number;
  /** Extra px added per shrink so the re-split clears the measured overflow. */
  shrinkMargin: number;
  /** Called after each await; return true to abandon (a newer render started). */
  isStale?: () => boolean;
  /** Layout-settle delay before measuring (ms). */
  settleMs?: number;
  /** Fallback timeout if the iframe 'load' event never fires (ms). */
  loadTimeoutMs?: number;
}

export interface AuditLoopResult {
  /** The final (corrected) deck. Its html is already loaded in the iframe. */
  deck: RenderedDeck;
  /** Worst overflow on the first predictive pass (−1 if never probed). */
  predictiveOverflowPx: number;
  /** Worst overflow on the last successfully probed render (-1 if unavailable). */
  finalOverflowPx: number;
  /** True only when the last probe was available and within tolerance. */
  converged: boolean;
  /** How many render passes ran (1 = predictive was enough). */
  passes: number;
}

/**
 * Run the closed loop. `render(budgetShrink)` produces a deck for the given
 * per-logical shrink (undefined on pass 0). Returns the converged deck; on the
 * final pass the iframe holds the corrected html.
 */
export async function runAuditLoop(
  iframe: HTMLIFrameElement,
  render: (budgetShrink: Record<number, number> | undefined) => RenderedDeck,
  options: AuditLoopOptions
): Promise<AuditLoopResult> {
  const {
    maxPasses,
    tolerancePx,
    shrinkMargin,
    isStale,
    settleMs = 64,
    loadTimeoutMs = 600,
  } = options;

  const budgetShrink: Record<number, number> = {};
  let deck = render(undefined);
  let predictiveOverflowPx = -1;
  let finalOverflowPx = -1;
  let converged = false;
  let passes = 1;

  for (let pass = 0; pass <= maxPasses; pass++) {
    passes = pass + 1;
    if (pass > 0) deck = render(budgetShrink);

    const probe = await loadDeckAndProbe(
      iframe,
      deck.html,
      true,
      tolerancePx,
      settleMs,
      loadTimeoutMs
    );
    if (isStale?.()) {
      return { deck, predictiveOverflowPx, finalOverflowPx, converged, passes };
    }
    if (!probe) break; // probe unavailable; html is still loaded for graceful fallback

    const { worst, groupOverflow } = aggregateOverflow(probe, tolerancePx);
    if (pass === 0) predictiveOverflowPx = worst;
    finalOverflowPx = worst;
    converged = worst <= tolerancePx;
    if (converged) break;
    // The final allowed render is measured but never feeds a correction that
    // cannot be rendered and verified.
    if (pass < maxPasses) {
      accumulateBudgetShrink(budgetShrink, groupOverflow, tolerancePx, shrinkMargin);
    }
  }

  return { deck, predictiveOverflowPx, finalOverflowPx, converged, passes };
}

/**
 * Set the iframe srcdoc, wait for load, and (when probing) measure the rendered
 * geometry via the shared probe. Returns the ProbeResult, or null when probing
 * is skipped by the caller or the iframe isn't accessible (graceful fallback
 * to predictive output). The probe reveals every stacked frame to measure it then
 * restores the original state, so the visible deck is unchanged afterward.
 */
export function loadDeckAndProbe(
  iframe: HTMLIFrameElement,
  html: string,
  shouldProbe: boolean,
  tolerancePx: number,
  settleMs: number,
  loadTimeoutMs: number
): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ProbeResult | null): void => {
      if (settled) return;
      settled = true;
      iframe.removeEventListener("load", onLoad);
      resolve(value);
    };
    const runProbe = (): void => {
      if (!shouldProbe) {
        finish(null);
        return;
      }
      window.setTimeout(() => {
        try {
          finish(evaluateOverflowProbe(iframe, tolerancePx));
        } catch {
          finish(null);
        }
      }, settleMs);
    };
    const onLoad = (): void => runProbe();
    iframe.addEventListener("load", onLoad);
    iframe.srcdoc = html;
    window.setTimeout(() => {
      if (!settled) runProbe();
    }, loadTimeoutMs);
  });
}

/** Shared, audited dynamic-code boundary for every loaded slide document. */
export function evaluateOverflowProbe(
  iframe: HTMLIFrameElement,
  tolerancePx: number
): ProbeResult | null {
  const win = iframe.contentWindow as unknown as {
    eval?: (code: string) => unknown;
  } | null;
  if (!win || typeof win.eval !== "function") return null;
  const result = win.eval(buildProbeExpression(tolerancePx)) as ProbeResult;
  return result && Array.isArray(result.frames) ? result : null;
}

/**
 * Render a deck with the closed loop applied via a DETACHED offscreen iframe —
 * for export-to-HTML, which has no live preview iframe. Returns the corrected
 * deck. Falls back to a single predictive render when there's no DOM (headless).
 */
export async function auditedRenderOffscreen(
  render: (budgetShrink: Record<number, number> | undefined) => RenderedDeck,
  options: AuditLoopOptions
): Promise<AuditLoopResult> {
  if (typeof activeDocument === "undefined") {
    return {
      deck: render(undefined),
      predictiveOverflowPx: -1,
      finalOverflowPx: -1,
      converged: false,
      passes: 1,
    };
  }
  const iframe = createEl("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setCssStyles({
    position: "fixed",
    left: "-99999px",
    top: "0",
    width: "1920px",
    height: "1080px",
    border: "0",
    visibility: "hidden",
    pointerEvents: "none",
  });
  activeDocument.body.appendChild(iframe);
  try {
    return await runAuditLoop(iframe, render, options);
  } finally {
    iframe.remove();
  }
}
