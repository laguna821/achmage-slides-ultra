// Single source of truth for split-related budgets and per-layout-kind policy.
// M1 (Overflow 강화). Migrated from scattered constants in:
//  - splitLayoutPlan.ts (468/478/504/430/340/364/330/480)
//  - scoreLayoutCandidates.ts:candidateSlotHeights (468/504/478/520/540)
//  - buildLayoutPlan.ts:splitStrategyFor
//
// PR-A: contents below mirror current behavior so that callers can be migrated
// without functional change. PR-B+ may evolve recap/semanticWeight/strategy.
// All numeric fallbacks here MUST stay in sync with typography.ts:96-103
// (createSlotBudgets) which is the dynamic, typography-aware source.

import type {
  BlockType,
  InternalLayoutKind,
  SemanticGroup,
  SlotRegion,
  SplitStrategy,
} from "./types";

export type RecapMode = "never" | "onContinued";

export interface LayoutSplitPolicy {
  primary: SplitStrategy;
  recap: RecapMode;
  semanticWeight: Partial<Record<BlockType, number>>;
}

// Static fallback heights per slot region. Mirror typography.ts:96-103.
// Used when slot.measurement is unavailable (e.g. legacy / unmeasured paths).
export const SLOT_FALLBACK_HEIGHT: Record<SlotRegion, number> = {
  hero: 520,
  center: 478,
  left: 468,
  right: 468,
  full: 504,
  bottomLeft: 72,
  caption: 78,
  meta: 38,
};

// Historical fallback for unmeasured non-left/right slots in splitLayoutPlan.
// Equals SLOT_FRAME_WEIGHT(4.8) * 100 = 480 (preserved verbatim from PR-A).
export const SPLIT_SLOT_DEFAULT_BUDGET = 480;

// Aggregate budget for the dense layout — does not correspond to any single
// region, used by score/measure paths only.
export const DENSE_AGGREGATE_BUDGET = 540;

// Frame budget per split strategy (height a single packed frame may consume).
export const STRATEGY_BUDGET: Record<SplitStrategy, number> = {
  byItem: 340,
  byRow: 364,
  byLine: 504,
  byParagraph: 260,
  bySentence: 260,
  byClause: 330,
  bySemanticChunk: 340,
  withRecap: 0,
  byGroup: 480,
  never: Number.POSITIVE_INFINITY,
};

// cloneGroup overflow risk threshold (was bare 430 in splitLayoutPlan.ts:318).
export const OVERFLOW_RISK_THRESHOLD = 430;

// Per-layout-kind policy. Migrated from buildLayoutPlan.ts:548 splitStrategyFor()
// in PR-A; PR-B opts in recap for sequential layouts where a continued frame
// benefits from a one-line reminder of the parent label.
export const SPLIT_POLICY: Record<InternalLayoutKind, LayoutSplitPolicy> = {
  cover:           { primary: "byGroup", recap: "never",        semanticWeight: {} },
  statement:       { primary: "byGroup", recap: "never",        semanticWeight: {} },
  textPanel:       { primary: "byGroup", recap: "never",        semanticWeight: {} },
  listPanel:       { primary: "byItem",  recap: "onContinued",  semanticWeight: {} },
  stepsPanel:      { primary: "byItem",  recap: "onContinued",  semanticWeight: {} },
  taskPanel:       { primary: "byItem",  recap: "onContinued",  semanticWeight: {} },
  codeSplit:       { primary: "byLine",  recap: "never",        semanticWeight: {} },
  codeFull:        { primary: "byLine",  recap: "never",        semanticWeight: {} },
  tablePanel:      { primary: "byRow",   recap: "never",        semanticWeight: {} },
  metricsPanel:    { primary: "byGroup", recap: "never",        semanticWeight: {} },
  comparisonPanel: { primary: "byRow",   recap: "never",        semanticWeight: {} },
  comparisonGrid:  { primary: "byRow",   recap: "never",        semanticWeight: {} },
  keyValuePanel:   { primary: "byItem",  recap: "onContinued",  semanticWeight: {} },
  quotePanel:      { primary: "byGroup", recap: "onContinued",  semanticWeight: {} },
  imagePanel:      { primary: "byGroup", recap: "never",        semanticWeight: {} },
  videoPanel:      { primary: "byGroup", recap: "never",        semanticWeight: {} },
  referencePanel:  { primary: "byGroup", recap: "never",        semanticWeight: {} },
  calloutPanel:    { primary: "byGroup", recap: "never",        semanticWeight: {} },
  mixedGrid:       { primary: "byGroup", recap: "never",        semanticWeight: {} },
  dense:           { primary: "byGroup", recap: "never",        semanticWeight: {} },
};

export function getSplitPolicy(
  kind: InternalLayoutKind,
  _group?: SemanticGroup
): LayoutSplitPolicy {
  return SPLIT_POLICY[kind] ?? SPLIT_POLICY.dense;
}

export function slotFallbackHeight(region: SlotRegion): number {
  return SLOT_FALLBACK_HEIGHT[region] ?? SPLIT_SLOT_DEFAULT_BUDGET;
}

export function strategyBudget(strategy: SplitStrategy): number {
  return STRATEGY_BUDGET[strategy] ?? SPLIT_SLOT_DEFAULT_BUDGET;
}

// fits-thresholds for cloneGroup. Mirrors splitLayoutPlan.ts:319-323.
export const FIT_THRESHOLDS: Pick<Record<SlotRegion, number>, "center" | "left" | "right" | "full"> = {
  center: SLOT_FALLBACK_HEIGHT.center,
  left: SLOT_FALLBACK_HEIGHT.left,
  right: SLOT_FALLBACK_HEIGHT.right,
  full: SLOT_FALLBACK_HEIGHT.full,
};
