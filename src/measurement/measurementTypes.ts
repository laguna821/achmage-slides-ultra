import type {
  LayoutProfile,
  SemanticGroupKind,
  SlotRegion,
  SurfaceMode,
  WrapperKind,
} from "../semantic/types";

export type MeasurementEngineName = "pretext";
export type OverflowRisk = "none" | "low" | "medium" | "high";
export type LanguageProfile = "ko" | "en" | "mixed" | "cjk" | "code";
export type MeasurementDensity = "light" | "normal" | "dense" | "overflow";
export type InlineMode = "plain" | "rich";

export interface TypographyContext {
  engine: MeasurementEngineName;
  layoutProfile: LayoutProfile;
  surfaceMode: SurfaceMode;
  baseFontSize: number;
  typographicRatio: number;
  fonts: {
    body: string;
    heading: string;
    title: string;
    code: string;
    small: string;
    table: string;
    caption: string;
    meta: string;
  };
  lineHeights: {
    body: number;
    heading: number;
    title: number;
    code: number;
    small: number;
    table: number;
    caption: number;
    meta: number;
  };
  spacing: {
    groupGap: number;
    blockGap: number;
    listItemGap: number;
    cardPadding: number;
    directPadding: number;
    chrome: number;
  };
}

export interface SlotBudget {
  region: SlotRegion;
  width: number;
  height: number;
  titleReserve: number;
  footerReserve: number;
  wrapper: WrapperKind;
}

export type SlotBudgetMap = Partial<Record<SlotRegion, SlotBudget>>;

export interface TextMeasurement {
  engine: MeasurementEngineName;
  text: string;
  language: LanguageProfile;
  wordBreak: "normal" | "keep-all";
  whiteSpace: "normal" | "pre-wrap";
  font: string;
  maxWidth: number;
  lineHeight: number;
  lineCount: number;
  maxLineWidth: number;
  height: number;
  naturalWidth: number;
  isOverflow: boolean;
  density: MeasurementDensity;
  warnings: string[];
  inlineMode: InlineMode;
  cacheHit?: boolean;
  cacheKey?: string;
}

export interface MeasurementSplitUnit {
  index: number;
  text: string;
  rawLines?: string[];
  height: number;
  lineCount: number;
}

export interface CodeSnippetMeasurement {
  originalLineCount: number;
  visibleLineCount: number;
  headLineCount: number;
  tailLineCount: number;
  omittedLineCount: number;
  lineHeight: number;
  height: number;
  availableLineCount?: number;
}

export interface TableRowMeasurement {
  rowIndex: number;
  cells: TextMeasurement[];
  height: number;
  isHeader: boolean;
}

export interface BlockMeasurement {
  engine: MeasurementEngineName;
  blockId: string;
  kind: string;
  language: LanguageProfile;
  width: number;
  height: number;
  contentHeight: number;
  chromeHeight: number;
  totalHeight: number;
  lineCount: number;
  overflowRisk: OverflowRisk;
  density: MeasurementDensity;
  fitsInCenterSlot: boolean;
  fitsInLeftSlot: boolean;
  fitsInRightSlot: boolean;
  fitsInFullSlot: boolean;
  preferredSlot: SlotRegion;
  text?: TextMeasurement;
  splitUnits?: MeasurementSplitUnit[];
  codeSnippet?: CodeSnippetMeasurement;
  tableRows?: TableRowMeasurement[];
  debug?: Record<string, unknown>;
}

export interface GroupMeasurement {
  engine: MeasurementEngineName;
  groupId: string;
  kind: SemanticGroupKind;
  width: number;
  height: number;
  totalHeight: number;
  blockHeight: number;
  chromeHeight: number;
  contentHeight: number;
  lineCount: number;
  splitUnits?: MeasurementSplitUnit[];
  overflowRisk: OverflowRisk;
  splitNeeded: boolean;
  keepTogether: boolean;
  fits: {
    center: boolean;
    left: boolean;
    right: boolean;
    full: boolean;
  };
  fitsInSlot: Partial<Record<SlotRegion, boolean>>;
}

export interface SlotMeasurement {
  engine: MeasurementEngineName;
  slotName: string;
  region: SlotRegion;
  maxWidth: number;
  maxHeight: number;
  usedHeight: number;
  remainingHeight: number;
  overflow: boolean;
  overflowRisk: OverflowRisk;
  groupMeasurements: GroupMeasurement[];
}

export interface FrameMeasurement {
  engine: MeasurementEngineName;
  frameHeight: number;
  budgetHeight: number;
  overflow: boolean;
  overflowRisk: OverflowRisk;
  slots: SlotMeasurement[];
}

export interface DebugMeasurementInfo {
  engine: MeasurementEngineName;
  cache?: MeasurementCacheStats;
  groups: {
    id: string;
    kind: SemanticGroupKind;
    height: number;
    risk: OverflowRisk;
  }[];
  slots: {
    name: string;
    region: SlotRegion;
    usedHeight: number;
    maxHeight: number;
    overflow: boolean;
  }[];
}

export interface MeasurementCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxEntries: number;
}

export interface SourceStripMeasurement {
  mode: "full" | "host" | "domain";
  items: { text: string; kind: "link" | "tag" }[];
  measurement: TextMeasurement;
  overflowRisk: OverflowRisk;
}
