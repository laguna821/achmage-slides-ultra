import type {
  BlockMeasurement,
  DebugMeasurementInfo,
  FrameMeasurement,
  GroupMeasurement,
  OverflowRisk,
  SlotMeasurement,
} from "../measurement/measurementTypes";
// PR1 majestic-eagle (2026-05-16): atlas grid types (Native1920V5GridSpanRect,
// Native1920V5PixelRect) removed along with the layout/native1920V5Canvas
// helpers. The remaining LayoutSlot / LayoutPlan / FrameSlot interfaces are
// orphaned dead code (no consumers after mass delete) but kept temporarily
// with `unknown` stubs so types.ts compiles. They can be pruned in a follow-up.
type Native1920V5GridSpanRect = unknown;
type Native1920V5PixelRect = unknown;

export type LayoutProfile = "cmds-core" | "gradient-md";
export type RenderProfile = "auto" | LayoutProfile;
export type VisualDetailLevel = "minimal" | "standard" | "ultra";
export type TitlePolicy =
  | "auto"
  | "hero"
  | "kicker"
  | "ambient"
  | "classic-top";
export type CardPolicy = "auto" | "none";
export type MediaKind = "image" | "youtube" | "external";
export type MediaRole =
  | "documentScreenshot"
  | "browserScreenshot"
  | "diagram"
  | "cinematicStill"
  | "generatedVisual"
  | "portraitImage"
  | "unknown";
export type MediaFit = "contain" | "cover-safe" | "cover";
export type MediaSourceClassification =
  | "local"
  | "remote"
  | "generatedVisual"
  | "cinematic"
  | "documentScreenshot"
  | "browserScreenshot"
  | "diagram"
  | "portrait"
  | "unknown";
export type MediaSequenceIntent =
  | "single"
  | "comparison"
  | "gallery"
  | "evidenceSequence";
export type AspectBucket =
  | "ultraPortrait"
  | "portrait"
  | "square"
  | "landscape"
  | "wide"
  | "documentWide"
  | "unknown";
export type FitAllowance = "containOnly" | "coverSafeAllowed" | "coverAllowed";
export type PolicyRejectReason =
  | "document-like-media-multiple"
  | "evidence-sequence-image-grid"
  | "media-and-callout-in-same-slot"
  | "multiple-media-leads-in-slot"
  | "multiple-image-groups-in-slot"
  | "portrait-in-horizontal-slot"
  | "document-media-cover"
  | "long-text-with-media"
  | "text-fallback-with-media"
  | "single-slot-height-budget-exceeded"
  | "code-html-not-source-safe"
  | "slot-payload-text-over-budget"
  | "slot-payload-callout-over-budget"
  | "slot-payload-list-over-budget"
  | "slot-payload-code-over-budget";
export interface PolicyRejectResult {
  rejected: boolean;
  reason?: PolicyRejectReason;
  severity: "hard" | "soft";
  recommendedAction: "split" | "reroute" | "downgradeFit" | "downgradePattern";
}
export interface SlotPayloadPolicyResult {
  passed: boolean;
  severity: "hard" | "soft";
  reason?: PolicyRejectReason;
  suggestedAction: "split" | "reroute" | "downgradePattern";
  slotName: string;
  slotRole?: SlotRole;
  groupIds: string[];
  usedHeight: number;
  maxHeight: number;
  usedRatio: number;
}
export interface MediaGeometry {
  naturalWidth?: number;
  naturalHeight?: number;
  aspect?: number;
  bucket: AspectBucket;
}
export interface ImageManifestEntry extends MediaGeometry {
  src: string;
  alt?: string;
  mediaRole: MediaRole;
  fitAllowance: FitAllowance;
  source: MediaSourceClassification;
}
export type LayoutAggressiveness = "safe" | "balanced" | "expressive";
export type DebugLayoutMode = "off" | "console" | "overlay";
export type CalloutMode = "auto" | "blockquote" | "card";
export type ImageGroupingMode = "single" | "caption" | "grid";
export type LayoutDensity = "compact" | "normal" | "airy";
export type SurfaceMode = "cards" | "direct";

export type ContentGroup =
  | "intro"
  | "section-list"
  | "quote"
  | "callout"
  | "media"
  | "code"
  | "table"
  | "standalone";

export type BlockType =
  | "heading"
  | "paragraph"
  | "list"
  | "taskList"
  | "blockquote"
  | "code"
  | "table"
  | "image"
  | "embed"
  | "link"
  | "math"
  | "callout"
  | "hr";

export type BlockRole =
  | "title"
  | "lead"
  | "body"
  | "label"
  | "evidence"
  | "example"
  | "code"
  | "data"
  | "quote"
  | "caption"
  | "source"
  | "action"
  | "warning"
  | "definition"
  | "reference";

export type ListKind =
  | "bullets"
  | "steps"
  | "checklist"
  | "definition"
  | "prosCons"
  | "timeline"
  | "referenceList"
  | "denseList";

export type ListStructure =
  | "flat"
  | "nestedTree"
  | "definition"
  | "timeline"
  | "checklist";

export type TableKind =
  | "data"
  | "comparison"
  | "kpi"
  | "rubric"
  | "schedule"
  | "matrix"
  | "largeData";

export type ParagraphKind =
  | "lead"
  | "body"
  | "label"
  | "preImageCue"
  | "caption"
  | "source"
  | "summary"
  | "question"
  | "definition";

export type QuoteKind = "plain" | "withSource" | "pullQuote";
export type CalloutKind =
  | "note"
  | "info"
  | "important"
  | "tip"
  | "success"
  | "warning"
  | "danger"
  | "error"
  | "bug"
  | "quote"
  | "cite"
  | "question"
  | "faq"
  | "todo"
  | "hint"
  | "check"
  | "done"
  | "attention"
  | "fail"
  | "missing"
  | "abstract"
  | "summary"
  | "tldr"
  | "example";

export type SemanticDensity = "light" | "normal" | "dense" | "overflow";
export type SemanticGroupKind =
  | "lead"
  | "bodyCopy"
  | "labelList"
  | "steps"
  | "checklist"
  | "quote"
  | "quoteWithSource"
  | "codeExample"
  | "codeWithExplanation"
  | "dataTable"
  | "kpiTable"
  | "comparisonTable"
  | "imageWithCaption"
  | "video"
  | "linkCluster"
  | "callout"
  | "definition"
  | "mixedEvidence";

export type SplitStrategy =
  | "byItem"
  | "byRow"
  | "byLine"
  | "byParagraph"
  | "bySentence"
  | "byClause"
  | "bySemanticChunk"
  | "withRecap"
  | "byGroup"
  | "never";

export type InternalLayoutKind =
  | "cover"
  | "statement"
  | "textPanel"
  | "listPanel"
  | "stepsPanel"
  | "taskPanel"
  | "codeSplit"
  | "codeFull"
  | "tablePanel"
  | "metricsPanel"
  | "comparisonPanel"
  | "comparisonGrid"
  | "keyValuePanel"
  | "quotePanel"
  | "imagePanel"
  | "videoPanel"
  | "referencePanel"
  | "calloutPanel"
  | "mixedGrid"
  | "dense";

export type TitleMode =
  | "hero"
  | "kicker"
  | "ambient"
  | "classicTop"
  | "hidden";

export type SlotRegion =
  | "hero"
  | "center"
  | "left"
  | "right"
  | "full"
  | "bottomLeft"
  | "caption"
  | "meta";

export type WrapperKind =
  | "none"
  | "terminalCard"
  | "glassCard"
  | "codeCard"
  | "tableCard"
  | "imageCard"
  | "quoteCard"
  | "calloutCard"
  | "kpiGrid"
  | "stepper"
  | "sourceStrip";

export type SlideLayoutKind =
  | "cover"
  | "statement"
  | "text-panel"
  | "list-panel"
  | "steps-panel"
  | "task-panel"
  | "code-split"
  | "code-full"
  | "table-panel"
  | "metrics-panel"
  | "comparison-panel"
  | "comparison-grid"
  | "key-value-panel"
  | "quote-panel"
  | "image-panel"
  | "video-panel"
  | "reference-panel"
  | "callout-panel"
  | "mixed-grid"
  | "dense"
  | "plain";

export type LayoutOverride = "auto" | "classic-flow" | SlideLayoutKind;

export type MessageRole =
  | "section-opening"
  | "evidence"
  | "comparison-evidence"
  | "interpretation"
  | "question-list"
  | "argument"
  | "callout-thesis"
  | "definition"
  | "quote-evidence"
  | "code-demo"
  | "table-evidence"
  | "source-reference"
  | "continuation";

export type SlotRole =
  | "title"
  | "dominant-image"
  | "image-a"
  | "image-b"
  | "image-grid"
  | "support-image"
  | "dominant-video"
  | "video"
  | "table"
  | "code"
  | "quote"
  | "callout"
  | "list"
  | "list-a"
  | "list-b"
  | "list-c"
  | "body"
  | "support"
  | "caption"
  | "source-strip"
  | "debug-overlay"
  | "hero"
  | "mixed";

export type SlotDominance = "solo" | "dominant" | "balanced" | "support";
export type SlotCapPolicy = "legacy-max-cap" | "support-max-cap" | "none";
export type TypographyPressure = "P0" | "P1" | "P2" | "P3" | "P4";
export type MarkdownObjectFamily =
  | "media"
  | "video"
  | "code"
  | "table"
  | "callout"
  | "quote/cite"
  | "list"
  | "body-copy"
  | "heading/label"
  | "math"
  | "source/link"
  | "embed";
export type SemanticCoupling = "bound" | "related" | "loose";
export type CompositionMode =
  | "single-object"
  | "coupled-pair"
  | "mixed-candidate"
  | "split-required";
export interface CompositionSignature {
  objectFamilies: MarkdownObjectFamily[];
  objectCount: number;
  dominantFamily: MarkdownObjectFamily | "none";
  supportFamilies: MarkdownObjectFamily[];
  semanticCoupling: SemanticCoupling;
  compositionMode: CompositionMode;
  mixedCompositionPass: boolean;
  splitReason?: string;
}
export type VisualDominantObjectKind =
  | "image"
  | "image-pair"
  | "image-grid"
  | "video"
  | "media"
  | "text"
  | "reference"
  | "table"
  | "code"
  | "quote"
  | "callout"
  | "list"
  | "body-copy"
  | "mixed"
  | "none";

export interface VisualOccupancySignature {
  dominantKind: string;
  desiredDominantCoverage: number;
  minimumDominantCoverage: number;
  maximumSupportCoverage: number;
  allowedFootprints: string[];
  forbiddenContainers: string[];
  preferDirectSlot: boolean;
  splitIfCoverageBelowMinimum: boolean;
}

export interface LayoutCandidateScore {
  fitScore: number;
  overflowPenalty: number;
  dominantCoverageScore: number;
  supportLegibilityScore: number;
  mixedCompositionScore: number;
  semanticCouplingScore: number;
  overflowRiskScore: number;
  splitPreferenceScore: number;
  slotFillScore: number;
  messageIntegrityScore: number;
  typographyPressureFitScore: number;
  centerBoxPenalty: number;
  legacyCapPenalty: number;
  nestedGridPenalty: number;
  tooManyObjectsPenalty: number;
  finalScore: number;
}

export interface ParsedBlock {
  id?: string;
  sourceNodeId?: string;
  type: BlockType;
  raw: string;
  lines: string[];
  text: string;
  startLine?: number;
  endLine?: number;
  level?: number;
  codeLanguage?: string;
  itemCount?: number;
  lineCount?: number;
  originalLineCount?: number;
  omittedLineCount?: number;
  charCount: number;
  wordCount: number;
  hasStrong: boolean;
  hasCodeInline: boolean;
  hasInlineCode?: boolean;
  hasLinks: boolean;
  hasTags?: boolean;
  tags?: string[];
  links?: LinkReference[];
  tableRows?: number;
  tableCols?: number;
  numericColumnCount?: number;
  imageCount?: number;
  caption?: string;
  url?: string;
  alt?: string;
  mediaKind?: MediaKind;
  calloutType?: string;
  calloutTitle?: string;
  embedKind?: "note";
  embedTarget?: string;
  estimatedVisualWeight: number;
}

export interface LinkReference {
  label: string;
  url: string;
  host?: string;
  internal?: boolean;
}

export interface LinkFootnote extends LinkReference {
  index: number;
  slideId: string;
}

export interface SemanticBlock extends ParsedBlock {
  id: string;
  role: BlockRole;
  density: SemanticDensity;
  confidence: number;
  sentenceCount?: number;
  avgSentenceLength?: number;
  listKind?: ListKind;
  tableKind?: TableKind;
  paragraphKind?: ParagraphKind;
  quoteKind?: QuoteKind;
  calloutKind?: CalloutKind;
  numericDensity?: number;
  linkDensity?: number;
  emphasisDensity?: number;
  keepTogether?: boolean;
  relationHint?: string;
  measurement?: BlockMeasurement;
}

export interface SemanticGroup {
  id: string;
  kind: SemanticGroupKind;
  blocks: SemanticBlock[];
  title?: string;
  label?: string;
  caption?: string;
  leadBeforeMedia?: string;
  relation?: "leadForNextImage";
  mediaRole?: MediaRole;
  mediaFit?: MediaFit;
  mediaGeometry?: MediaGeometry;
  source?: string;
  density: SemanticDensity;
  visualWeight: number;
  keepTogether: boolean;
  splittable: boolean;
  splitStrategy?: SplitStrategy;
  confidence: number;
  measurement?: GroupMeasurement;
  isRecap?: boolean;
}

export interface MessageFrame {
  id: string;
  sourceSectionId: string;
  role: MessageRole;
  blocks: SemanticBlock[];
  groups: SemanticGroup[];
  dominantBlockIds: string[];
  supportBlockIds: string[];
  continuationOf?: string;
  preferredSplitAfter?: string[];
  semanticPriority: number;
}

export interface SemanticSlide {
  title: string;
  content: string;
  blocks: ParsedBlock[];
}

export interface RenderOptions {
  themeId: string;
  layoutProfile: LayoutProfile;
  visualDetailLevel: VisualDetailLevel;
  titlePolicy: TitlePolicy;
  cardPolicy: CardPolicy;
  layout: LayoutOverride;
  autoLayout: boolean;
  autoKpiCards: boolean;
  autoLinkFootnotes: boolean;
  layoutAggressiveness?: LayoutAggressiveness;
  debugLayout?: DebugLayoutMode;
  calloutMode?: CalloutMode;
  imageGrouping?: ImageGroupingMode;
  surfaceMode?: SurfaceMode;
  density?: LayoutDensity;
  atlasPattern?: string;
  slideLocalOverrides?: string[];
}

export interface SlidePlan {
  logicalIndex: number;
  title: string;
  blocks: ParsedBlock[];
  layoutKind: SlideLayoutKind;
  layoutProfile: LayoutProfile;
  titlePolicy: TitlePolicy;
  classNames: string[];
  options: RenderOptions;
}

export interface LayoutDecision {
  kind: InternalLayoutKind;
  score: number;
  confidence: number;
  reasons: string[];
  risks: string[];
  measurement?: {
    fitScore: number;
    overflowRisk: OverflowRisk;
    predictedHeight: number;
    budgetHeight: number;
  };
}

export interface SplitPolicy {
  strategy: SplitStrategy;
  keepTogether: string[];
}

export interface LayoutSlot {
  name: string;
  region: SlotRegion;
  grid: Native1920V5GridSpanRect;
  pixel: Native1920V5PixelRect;
  groups: SemanticGroup[];
  wrapper: WrapperKind;
  role?: SlotRole;
  dominance?: SlotDominance;
  visualOccupancy?: {
    dominantKind: string;
    desiredDominantCoverage: number;
    minimumDominantCoverage: number;
    maximumSupportCoverage: number;
    allowedFootprints: string[];
    forbiddenContainers: string[];
    preferDirectSlot: boolean;
    splitIfCoverageBelowMinimum: boolean;
  };
  composition?: CompositionSignature;
  fillsSlot?: boolean;
  allowedCaps?: SlotCapPolicy[];
  maxWidth?: number;
  priority: number;
  measurement?: SlotMeasurement;
}

export interface LayoutPlan {
  kind: InternalLayoutKind;
  masterPattern?: MasterAtlasPatternSummaryLike;
  themeProfile: LayoutProfile;
  titleMode: TitleMode;
  density: LayoutDensity;
  confidence: number;
  slots: LayoutSlot[];
  splitPolicy: SplitPolicy;
  debug: {
    decisions: LayoutDecision[];
    selectedReason: string;
    risks: string[];
    measurements?: DebugMeasurementInfo;
    /** V5 PR-B2a — Shadow Resolver parallel computation result (Q-O Full JSON inline). */
    shadowTrace?: ShadowTraceLike;
    /** V5 Stage-1 master atlas resolver result. */
    atlasTrace?: MasterAtlasTraceLike;
    mediaSequenceIntent?: MediaSequenceIntent;
    policyRejectReason?: PolicyRejectReason;
    policyRejectAction?: PolicyRejectResult["recommendedAction"];
  };
}

export interface FrameSlot {
  name: string;
  region: SlotRegion;
  grid: Native1920V5GridSpanRect;
  pixel: Native1920V5PixelRect;
  wrapper: WrapperKind;
  groups: SemanticGroup[];
  role?: SlotRole;
  dominance?: SlotDominance;
  visualOccupancy?: VisualOccupancySignature;
  composition?: CompositionSignature;
  fillsSlot?: boolean;
  allowedCaps?: SlotCapPolicy[];
  priority: number;
  measurement?: SlotMeasurement;
}

export interface FramePlan {
  index: number;
  total: number;
  title: string;
  continued: boolean;
  layoutKind: InternalLayoutKind;
  titleMode: TitleMode;
  slots: FrameSlot[];
  debug: LayoutDebugInfo;
  measurement?: FrameMeasurement;
}

export interface LayoutDebugInfo {
  slideIndex: number;
  selectedLayout: InternalLayoutKind;
  confidence: number;
  candidates: LayoutDecision[];
  semanticGroups: {
    kind: SemanticGroupKind;
    density: SemanticDensity;
    blocks: string[];
    height?: number;
    risk?: OverflowRisk;
  }[];
  risks: string[];
  measurements?: DebugMeasurementInfo;
  frameMeasurement?: FrameMeasurement;
  /** V5 PR-B2a — Shadow Resolver parallel computation result (propagated from LayoutPlan.debug.shadowTrace). */
  shadowTrace?: ShadowTraceLike;
  /** V5 Stage-1 master atlas resolver result (propagated from LayoutPlan.debug.atlasTrace). */
  atlasTrace?: MasterAtlasTraceLike;
  mediaSequenceIntent?: MediaSequenceIntent;
  policyRejectReason?: PolicyRejectReason;
  policyRejectAction?: PolicyRejectResult["recommendedAction"];
  messageFrameId?: string;
  messageRole?: MessageRole;
  dominantBlockIds?: string[];
}

/**
 * V5 PR-B2a — Structural shape of ShadowTrace. Defined here (not imported from resolver.ts)
 * to avoid types.ts depending on a higher-layer module. Real shape lives in resolver.ts.
 */
export interface ShadowTraceLike {
  legacy: {
    kind: InternalLayoutKind;
    score: number;
    confidence: number;
    reasons: string[];
  };
  shadow: {
    kind: InternalLayoutKind;
    score: number;
    confidence: number;
    selectorHits: { id: InternalLayoutKind; hit: boolean; specificity: number }[];
    top3: { kind: InternalLayoutKind; score: number }[];
  };
  match: boolean;
  overflowRisk: "low" | "medium" | "high";
  groups: string[];
  rankMode: "legacyParity" | "semantic";
  bypassOverflow: boolean;
  manualOverride: boolean;
}

export interface MasterAtlasPatternSummaryLike {
  id: string;
  slug: string;
  family: string;
  legacyKind: InternalLayoutKind;
  cluster: string;
  contentSituation: string;
  topologyName: string;
  slotTemplate: string;
  titleTreatment?: string;
  dominantFirst?: boolean;
  safeAreaBudget?: string;
  splitUnit?: string;
}

export interface MasterAtlasMeasurementLike {
  overflow: boolean;
  overflowRisk: OverflowRisk;
  fitScore: number;
  splitValid?: boolean;
  splitReason?: string;
  predictedHeight?: number;
  budgetHeight?: number;
}

export interface MasterAtlasCandidateTraceLike extends MasterAtlasPatternSummaryLike {
  contentHit: boolean;
  dominantHit: boolean;
  densityHit: boolean;
  rankScore: number;
  measurement?: MasterAtlasMeasurementLike;
  policyRejectReason?: PolicyRejectReason;
  policyRejectAction?: PolicyRejectResult["recommendedAction"];
}

export interface MasterAtlasTraceLike {
  selected: MasterAtlasPatternSummaryLike;
  action: "render" | "split" | "fallback";
  dominant: {
    kind: string;
    groupIndex: number;
    estimatedAreaRank: number;
    estimatedHeight: number;
    estimatedWidthNeed: string;
    dominanceRatio: string;
    narrowSlotRisk: "low" | "medium" | "high";
    blockCount?: number;
    imageCount?: number;
    listItemCount?: number;
    codeLineCount?: number;
    tableRowCount?: number;
    estimatedTextLines?: number;
    needsWideSlot?: boolean;
    needsTallSlot?: boolean;
    needsFullFrame?: boolean;
    canShareSlide?: boolean;
  };
  density: {
    stance: string;
    bodyTokens: number;
    listItems: number;
    maxListDepth: number;
    tableRows: number;
    tableCols: number;
    codeLines: number;
    hasCJK: boolean;
    hasMixedLanguage: boolean;
    splitCandidates: SplitStrategy[];
  };
  typographyPressure?: {
    pressure: TypographyPressure;
    baseFontSize: number;
    typographicRatio: number;
    wrapRisk: "low" | "medium" | "high" | "critical";
  };
  composition?: CompositionSignature;
  visualOccupancy?: VisualOccupancySignature;
  mediaSequenceIntent?: MediaSequenceIntent;
  mediaCount?: number;
  documentLikeMediaCount?: number;
  policyRejectReason?: PolicyRejectReason;
  policyRejectAction?: PolicyRejectResult["recommendedAction"];
  splitPolicy: {
    primary: SplitStrategy;
    continuation: string;
  };
  fallbackDepth: number;
  candidates: MasterAtlasCandidateTraceLike[];
  rejected: MasterAtlasCandidateTraceLike[];
}

export interface ColorTokens {
  base0: string;
  base1: string;
  base2: string;
  base3?: string;
  text: string;
  textSoft: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  accentDim: string;
  toneA?: string;
  toneB?: string;
  toneC?: string;
}

export interface ElementPolicy {
  strongStyle: "lime" | "gradient" | "navy";
  titleDefault: "kicker" | "ambient" | "rule";
  cardStyle: "terminal" | "glass" | "light";
  metadataStyle: "command" | "quiet" | "mono";
}

export interface ThemeProfile {
  id: string;
  displayName: string;
  layoutProfile: LayoutProfile;
  typographyProfile: "cmds-compact" | "gradient-minor-second" | "hallym";
  paletteMode: "mono-gradient" | "two-tone-gradient" | "light";
  colorTokens: ColorTokens;
  elementPolicy: ElementPolicy;
}
