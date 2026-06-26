// PR1 majestic-eagle (2026-05-16): trimmed to constants only after atlas mass delete.
// Original file contained atlas grid helpers (native1920V5GridRect, resolveNative1920V5Footprint,
// native1920V5SlotStyleVars, etc.) all tied to the deleted atlas slot template system. The
// surviving 1920 v5 pipeline (v3 old 4-stage greedy pack via overflowSplitter + pretextMeasurer)
// only consumes the stage/content-frame dimensions, so we keep just those two constants.

export const NATIVE_1920_V5_STAGE = {
  width: 1920,
  height: 1080,
} as const;

export const NATIVE_1920_V5_CONTENT_FRAME = {
  x: 60,
  y: 72,
  width: 1800,
  height: 936,
  right: 1860,
  bottom: 1008,
} as const;
