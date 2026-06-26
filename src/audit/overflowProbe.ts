/**
 * Shared geometric overflow probe (v5.5 Phase 4).
 *
 * `buildProbeExpression(tol)` returns a self-contained JS IIFE string that runs
 * INSIDE a rendered deck (headless Chromium in the acceptance harness, or the
 * live preview iframe in Obsidian). It reveals every stacked overflow frame and
 * reports, per physical frame, how far any block element's real rendered
 * geometry exceeds the slide's content box. The host (harness or view) feeds the
 * measured overflow back to the engine as a per-logical `budgetShrink` and
 * re-renders until nothing overflows — the closed loop that makes zero-overflow
 * hold regardless of the predictor's accuracy or the active font/scale.
 *
 * Both the acceptance harness and SlidePreviewView import this so they measure
 * identically (measurement parity between test and production).
 */

export interface FrameProbe {
  group: string;
  frame: string;
  /** Max px any block's bottom exceeds the frame's bottom budget. */
  worstOverflowPx: number;
  /** section.scrollHeight − section.clientHeight (clamped ≥ 0). */
  scrollOverflowPx: number;
  offenders: { tag: string; cls: string; over: number }[];
}

export interface ProbeResult {
  frameCount: number;
  frames: FrameProbe[];
}

/** Build the in-page probe IIFE. `tol` is the px tolerance for sub-pixel noise. */
export function buildProbeExpression(tol: number): string {
  return `(() => {
    const TOL = ${tol};
    const groups = [...document.querySelectorAll('.achmage-logical-group')];
    // Reveal every stacked frame so all geometry is laid out.
    const saved = groups.map((g) => ({
      g,
      d: g.style.display,
      t: g.querySelector('.achmage-frame-stack')?.style.transform || ''
    }));
    for (const g of groups) {
      g.style.display = 'block';
      const s = g.querySelector('.achmage-frame-stack');
      if (s) s.style.transform = 'translateY(0)';
    }
    const sections = [...document.querySelectorAll('.achmage-frame section.asu-native-1920-v5')];
    const blockSel = 'h1,h2,h3,h4,p,ul,ol,pre,table,blockquote,img,.asu-content,.card,.asu-callout';
    const frames = [];
    for (const sec of sections) {
      const secRect = sec.getBoundingClientRect();
      if (secRect.width === 0 || secRect.height === 0) continue;
      const cs = getComputedStyle(sec);
      const padB = parseFloat(cs.paddingBottom) || 0;
      const contentBottom = secRect.bottom - padB;
      const botLine = sec.querySelector('.asu-frame-line-bottom');
      const budgetBottom = botLine ? botLine.getBoundingClientRect().top : contentBottom;
      let worst = 0;
      const offenders = [];
      for (const el of sec.querySelectorAll(blockSel)) {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        // Skip elements intentionally clipped by an overflow:hidden surface.
        const clip = el.closest('.table-wrap, .asu-code-card, .image-card, .asu-image-card');
        if (clip && clip !== el && getComputedStyle(clip).overflow !== 'visible') continue;
        const over = r.bottom - budgetBottom;
        if (over > worst) worst = over;
        if (over > TOL) offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || ''),
          over: Math.round(over)
        });
      }
      const scrollOver = sec.scrollHeight - sec.clientHeight;
      frames.push({
        group: sec.closest('.achmage-logical-group')?.dataset.group ?? '?',
        frame: sec.closest('.achmage-frame')?.dataset.frame ?? '?',
        worstOverflowPx: Math.round(Math.max(0, worst)),
        scrollOverflowPx: Math.round(Math.max(0, scrollOver)),
        offenders: offenders.slice(0, 5)
      });
    }
    for (const s of saved) {
      s.g.style.display = s.d;
      const st = s.g.querySelector('.achmage-frame-stack');
      if (st) st.style.transform = s.t;
    }
    return { frameCount: sections.length, frames };
  })()`;
}

/**
 * Reduce a probe result to the worst overflow overall and per logical group.
 * Used by both hosts to decide convergence and to build the next budget shrink.
 */
export function aggregateOverflow(
  probe: ProbeResult,
  tol: number
): { worst: number; groupOverflow: Map<number, number> } {
  let worst = 0;
  const groupOverflow = new Map<number, number>();
  for (const f of probe.frames) {
    const frameWorst = Math.max(f.worstOverflowPx, f.scrollOverflowPx);
    if (frameWorst > worst) worst = frameWorst;
    const g = parseInt(f.group, 10);
    if (Number.isFinite(g)) {
      groupOverflow.set(g, Math.max(groupOverflow.get(g) ?? 0, frameWorst));
    }
  }
  return { worst, groupOverflow };
}

/**
 * Accumulate the next per-logical budget shrink from a measured overflow. We
 * shrink EVERY measured group by the worst overflow (not just the offending
 * one): the deck's `data-group` index and the engine's logical-order index can
 * differ by a title-slide offset, so shrinking all groups guarantees the
 * offending slide is covered. Title / slack slides absorb the extra harmlessly.
 */
export function accumulateBudgetShrink(
  budgetShrink: Record<number, number>,
  groupOverflow: Map<number, number>,
  tol: number,
  margin: number
): void {
  const worstGroupOverflow = Math.max(0, ...groupOverflow.values());
  if (worstGroupOverflow <= tol) return;
  for (const g of groupOverflow.keys()) {
    budgetShrink[g] = (budgetShrink[g] ?? 0) + worstGroupOverflow + margin;
  }
}
