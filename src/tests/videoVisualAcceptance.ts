import type { Vault } from "obsidian";
import { loadDeckAndProbe } from "../audit/auditLoop";
import { aggregateOverflow } from "../audit/overflowProbe";
import {
  normalizeVideoDeckArtifact,
  type VideoArtifactProgressV1,
} from "../video/videoArtifact";
import { VideoFrameCompositor } from "../video/videoCompositor";
import {
  VIDEO_ARTIFACT_SCHEMA_VERSION,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type VideoDeckArtifactDraftV1,
  type VideoDeckArtifactV1,
} from "../video/videoTypes";
import { createVideoTimeline, sampleVideoTimeline } from "../video/videoTimeline";

const CHANNEL_DELTA_THRESHOLD = 10;
const MAX_DIFFERING_PIXEL_RATIO = 0.02;
const FINAL_OVERFLOW_TOLERANCE_PX = 2;
const SHARED_CSS_SENTINEL = "achmage-video-visual-shared-css-once";

type VisualCategory =
  | "background"
  | "callout"
  | "card"
  | "cjk"
  | "code"
  | "image"
  | "math";

interface VisualFixtureFrame {
  readonly id: string;
  readonly locale: "en" | "ko";
  readonly sourceIndex: number;
  readonly sourceLogicalIndex: number;
  readonly sourceFrameIndex: number;
  readonly title: string;
  readonly svg: string;
  readonly categories: readonly VisualCategory[];
  readonly imageCount: number;
}

interface VisualFixtureDeck {
  readonly locale: "en" | "ko";
  readonly sourceFile: string;
  readonly sourceFrameCount: number;
  readonly sharedCss: string;
  readonly availableCategories: Readonly<Record<VisualCategory, number>>;
  readonly frames: readonly VisualFixtureFrame[];
}

interface VisualFixtures {
  readonly width: 1920;
  readonly height: 1080;
  readonly decks: readonly VisualFixtureDeck[];
}

interface PreparedDeck {
  readonly fixture: VisualFixtureDeck;
  readonly artifact: VideoDeckArtifactV1;
  readonly compositor: VideoFrameCompositor;
  readonly timeline: ReturnType<typeof createVideoTimeline>;
  readonly progress: readonly VideoArtifactProgressV1[];
  readonly overflowWorstPx: number;
}

interface FrameComparison {
  readonly id: string;
  readonly locale: "en" | "ko";
  readonly sourceIndex: number;
  readonly title: string;
  readonly categories: readonly VisualCategory[];
  readonly differingPixels: number;
  readonly differingPixelRatio: number;
  readonly maximumChannelDelta: number;
  readonly representativePixelCount: number;
  readonly representativeDifferingPixels: number;
  readonly canonicalHtmlImageElements: number;
  readonly canonicalSvgImageElements: number;
  readonly canonicalCssBackgroundUrls: number;
  readonly canonicalDecodedImageReferences: number;
  readonly compositorHash: string;
  readonly compositorRepeatHash?: string;
}

interface CanonicalReadinessEvidence {
  readonly fontsReady: boolean;
  readonly imagesReady: boolean;
  readonly htmlImageElements: number;
  readonly svgImageElements: number;
  readonly cssBackgroundUrls: number;
  readonly decodedImageReferences: number;
}

interface VideoVisualReport {
  readonly passed: boolean;
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly threshold: {
    readonly channelDelta: number;
    readonly maximumDifferingPixelRatio: number;
    readonly basis: string;
  };
  readonly sourceFiles: readonly {
    readonly locale: "en" | "ko";
    readonly file: string;
    readonly sourceFrames: number;
    readonly selectedFrames: number;
  }[];
  readonly categoryCoverage: Readonly<Record<VisualCategory, {
    readonly available: number;
    readonly selected: number;
  }>>;
  readonly sharedCss: {
    readonly artifacts: number;
    readonly sentinelOccurrences: number;
    readonly storedOncePerArtifact: boolean;
  };
  readonly artifactInputNormalization: {
    readonly method: string;
    readonly reason: string;
    readonly sourceFramesMissingXhtmlNamespace: number;
    readonly normalizedFramesWithXhtmlNamespace: number;
    readonly sourceHtmlVoidElements: number;
    readonly normalizedSelfClosingVoidElements: number;
    readonly verified: boolean;
  };
  readonly readiness: {
    readonly normalizedFrames: number;
    readonly validatedFrames: number;
    readonly selectedImages: number;
    readonly canonicalFontsReady: boolean;
    readonly canonicalImagesReady: boolean;
    readonly canonicalHtmlImageElements: number;
    readonly canonicalSvgImageElements: number;
    readonly canonicalCssBackgroundUrls: number;
    readonly canonicalDecodedImageReferences: number;
    readonly missingAndCorruptAssetGate: string;
  };
  readonly overflow: {
    readonly tolerancePx: number;
    readonly worstPx: number;
    readonly measuredFrames: number;
  };
  readonly compositorRepeatHashes: {
    readonly scope: string;
    readonly samples: readonly {
      readonly id: string;
      readonly firstCompositorHash: string;
      readonly repeatCompositorHash: string;
    }[];
  };
  readonly worstDifferingPixelRatio: number;
  readonly worstFrameId: string;
  readonly frames: readonly FrameComparison[];
}

declare global {
  interface Window {
    __VIDEO_VISUAL_FIXTURES__?: VisualFixtures;
    __VIDEO_VISUAL_PREPARE__?: () => Promise<{
      readonly selectedFrames: number;
      readonly overflowWorstPx: number;
    }>;
    __VIDEO_VISUAL_COMPARE__?: (
      frameId: string,
      canonicalPngDataUrl: string,
      readiness: CanonicalReadinessEvidence
    ) => Promise<FrameComparison>;
    __VIDEO_VISUAL_FINISH__?: () => Promise<VideoVisualReport>;
  }
}

let preparedDecks: readonly PreparedDeck[] = [];
let comparisons: FrameComparison[] = [];
let canonicalFontsReady = true;
let canonicalImagesReady = true;

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

window.__VIDEO_VISUAL_PREPARE__ = async () => {
  const fixtures = window.__VIDEO_VISUAL_FIXTURES__;
  check(fixtures, "Video visual fixtures were not injected by the Playwright runner.");
  check(fixtures.width === VIDEO_WIDTH && fixtures.height === VIDEO_HEIGHT, "Visual fixture dimensions drifted.");
  check(fixtures.decks.length === 2, "Visual acceptance requires the English and Korean committed decks.");
  check(fixtures.decks.reduce((sum, deck) => sum + deck.frames.length, 0) >= 24, "Visual corpus requires at least 24 physical slides.");

  const nextPrepared: PreparedDeck[] = [];
  try {
    for (const fixture of fixtures.decks) {
      check(fixture.frames.length >= 12, `${fixture.locale} visual corpus requires at least 12 slides.`);
      check(
        fixture.frames.every((frame, index) => index === 0 || frame.sourceIndex > fixture.frames[index - 1].sourceIndex),
        `${fixture.locale} selected frame order must follow the committed deck.`
      );

      const draft = buildDraft(fixture);
      const progress: VideoArtifactProgressV1[] = [];
      let artifact: VideoDeckArtifactV1;
      try {
        artifact = await normalizeVideoDeckArtifact(draft, {
          vault: emptyVault(),
          activeDocument: document,
          onProgress: (entry) => progress.push(entry),
        });
      } catch (error) {
        const validated = progress.filter((entry) => entry.phase === "validating-assets").length;
        throw new Error(`${fixture.locale} committed visual deck normalization failed after ${validated}/${fixture.frames.length} readiness frames. ${errorMessage(error)}`, {
          cause: error,
        });
      }
      check(artifact.frames.length === fixture.frames.length, `${fixture.locale} normalized frame count drifted.`);
      check(
        artifact.frames.every((frame, index) => frame.physicalIndex === index),
        `${fixture.locale} normalized physical order drifted.`
      );
      check(
        artifact.frames.every((frame, index) => frame.title === fixture.frames[index].title),
        `${fixture.locale} normalized title order drifted.`
      );
      check(
        fixture.frames.every((frame) => !hasXhtmlNamespace(frame.svg)),
        `${fixture.locale} committed raw HTML no longer exercises implicit foreignObject namespaces.`
      );
      check(
        artifact.frames.every((frame) => hasXhtmlNamespace(frame.svg)),
        `${fixture.locale} normalized standalone SVG did not materialize the XHTML namespace.`
      );
      const sourceVoidElements = fixture.frames.reduce((sum, frame) => sum + countHtmlVoidElements(frame.svg), 0);
      const normalizedVoidElements = artifact.frames.reduce(
        (sum, frame) => sum + countSelfClosingHtmlVoidElements(frame.svg),
        0
      );
      check(sourceVoidElements > 0, `${fixture.locale} corpus did not exercise raw HTML void elements.`);
      check(
        normalizedVoidElements === sourceVoidElements,
        `${fixture.locale} normalized ${normalizedVoidElements}/${sourceVoidElements} HTML void elements for XML.`
      );
      check(
        progress.filter((entry) => entry.phase === "validating-assets").length === fixture.frames.length,
        `${fixture.locale} did not finish readiness validation for every frame.`
      );
      const sentinelOccurrences = countOccurrences(
        [artifact.sharedCss, ...artifact.frames.map((frame) => frame.svg)].join("\n"),
        SHARED_CSS_SENTINEL
      );
      check(sentinelOccurrences === 1, `${fixture.locale} shared CSS was not stored exactly once.`);

      const overflowWorstPx = await measureFinalOverflow(artifact);
      check(
        overflowWorstPx <= FINAL_OVERFLOW_TOLERANCE_PX,
        `${fixture.locale} normalized visual corpus overflowed by ${overflowWorstPx}px.`
      );
      const compositor = new VideoFrameCompositor(artifact, { activeDocument: document });
      nextPrepared.push({
        fixture,
        artifact,
        compositor,
        timeline: createVideoTimeline(artifact.frames, 0.5),
        progress,
        overflowWorstPx,
      });
    }
  } catch (error) {
    nextPrepared.forEach((entry) => entry.compositor.dispose());
    throw error;
  }
  preparedDecks = Object.freeze(nextPrepared);
  comparisons = [];
  canonicalFontsReady = true;
  canonicalImagesReady = true;
  return {
    selectedFrames: preparedDecks.reduce((sum, entry) => sum + entry.artifact.frames.length, 0),
    overflowWorstPx: Math.max(...preparedDecks.map((entry) => entry.overflowWorstPx)),
  };
};

window.__VIDEO_VISUAL_COMPARE__ = async (
  frameId,
  canonicalPngDataUrl,
  readiness
) => {
  check(preparedDecks.length > 0, "Visual acceptance was not prepared.");
  check(!comparisons.some((entry) => entry.id === frameId), `Frame ${frameId} was compared twice.`);
  const located = locateFrame(frameId);
  canonicalFontsReady &&= readiness.fontsReady;
  canonicalImagesReady &&= readiness.imagesReady;
  check(readiness.fontsReady, `Canonical fonts were not ready for ${frameId}.`);
  check(readiness.imagesReady, `Canonical image resources were not ready for ${frameId}.`);
  check(
    readiness.decodedImageReferences ===
      readiness.htmlImageElements + readiness.svgImageElements + readiness.cssBackgroundUrls,
    `Canonical image readiness inventory was incomplete for ${frameId}.`
  );

  const absoluteFrame = located.localIndex * (
    located.deck.timeline.holdFrames + located.deck.timeline.transitionFrames
  );
  const sample = sampleVideoTimeline(located.deck.timeline, absoluteFrame);
  check(sample.kind === "hold", `${frameId} did not resolve to a static hold sample.`);
  const output = await located.deck.compositor.render(sample);
  const canonical = await decodePng(canonicalPngDataUrl);
  try {
    const result = await compareFullFrame(canonical, output);
    check(
      result.differingPixelRatio <= MAX_DIFFERING_PIXEL_RATIO,
      `${frameId} differs at ${(result.differingPixelRatio * 100).toFixed(4)}% of pixels (maximum 2%).`
    );

    const compositorHash = await hashCanvas(output);
    const repeatRequired = isRepeatRepresentative(frameId);
    let compositorRepeatHash: string | undefined;
    if (repeatRequired) {
      const repeated = await located.deck.compositor.render(sample);
      compositorRepeatHash = await hashCanvas(repeated);
      check(
        compositorRepeatHash === compositorHash,
        `${frameId} compositor RGBA output changed on repeat render.`
      );
    }

    const frame = located.deck.fixture.frames[located.localIndex];
    const comparison: FrameComparison = Object.freeze({
      id: frame.id,
      locale: frame.locale,
      sourceIndex: frame.sourceIndex,
      title: frame.title,
      categories: frame.categories,
      ...result,
      canonicalHtmlImageElements: readiness.htmlImageElements,
      canonicalSvgImageElements: readiness.svgImageElements,
      canonicalCssBackgroundUrls: readiness.cssBackgroundUrls,
      canonicalDecodedImageReferences: readiness.decodedImageReferences,
      compositorHash,
      ...(compositorRepeatHash ? { compositorRepeatHash } : {}),
    });
    comparisons.push(comparison);
    return comparison;
  } finally {
    canonical.width = 1;
    canonical.height = 1;
  }
};

window.__VIDEO_VISUAL_FINISH__ = async () => {
  check(preparedDecks.length > 0, "Visual acceptance was not prepared.");
  const fixtures = window.__VIDEO_VISUAL_FIXTURES__;
  check(fixtures, "Visual fixtures disappeared before report generation.");
  const expectedCount = fixtures.decks.reduce((sum, deck) => sum + deck.frames.length, 0);
  check(comparisons.length === expectedCount, `Compared ${comparisons.length}/${expectedCount} visual frames.`);

  const categoryCoverage = buildCategoryCoverage(fixtures);
  for (const category of categoryNames()) {
    if (categoryCoverage[category].available > 0) {
      check(categoryCoverage[category].selected > 0, `Available ${category} content was absent from the selected corpus.`);
    }
  }
  check(categoryCoverage.cjk.selected >= 12, "The corpus does not contain enough Korean/CJK slides.");
  check(categoryCoverage.code.selected > 0, "The corpus must exercise code rendering.");
  check(categoryCoverage.callout.selected > 0, "The corpus must exercise callout rendering.");
  check(categoryCoverage.card.selected > 0, "The corpus must exercise card rendering.");
  check(categoryCoverage.image.selected > 0, "The corpus must exercise image rendering.");
  check(categoryCoverage.background.selected > 0, "The corpus must exercise image/background rendering.");

  const compositorRepeatHashSamples = comparisons
    .filter((entry): entry is FrameComparison & { readonly compositorRepeatHash: string } =>
      Boolean(entry.compositorRepeatHash)
    )
    .map((entry) => ({
      id: entry.id,
      firstCompositorHash: entry.compositorHash,
      repeatCompositorHash: entry.compositorRepeatHash,
    }));
  check(
    compositorRepeatHashSamples.length === 3,
    "Repeat compositor hashing must cover first, middle, and last corpus frames."
  );

  const worstFrame = comparisons.reduce((worst, entry) =>
    entry.differingPixelRatio > worst.differingPixelRatio ? entry : worst
  );
  const normalizedFrames = preparedDecks.reduce((sum, entry) => sum + entry.artifact.frames.length, 0);
  const validatedFrames = preparedDecks.reduce((sum, entry) =>
    sum + entry.progress.filter((progress) => progress.phase === "validating-assets").length,
  0);
  const selectedImages = fixtures.decks.reduce((deckSum, deck) =>
    deckSum + deck.frames.reduce((frameSum, frame) => frameSum + frame.imageCount, 0),
  0);
  const canonicalHtmlImageElements = comparisons.reduce(
    (sum, entry) => sum + entry.canonicalHtmlImageElements,
    0
  );
  const canonicalSvgImageElements = comparisons.reduce(
    (sum, entry) => sum + entry.canonicalSvgImageElements,
    0
  );
  const canonicalCssBackgroundUrls = comparisons.reduce(
    (sum, entry) => sum + entry.canonicalCssBackgroundUrls,
    0
  );
  const canonicalDecodedImageReferences = comparisons.reduce(
    (sum, entry) => sum + entry.canonicalDecodedImageReferences,
    0
  );
  const overflowWorst = Math.max(...preparedDecks.map((entry) => entry.overflowWorstPx));
  const sourceFramesMissingXhtmlNamespace = fixtures.decks.reduce((sum, deck) =>
    sum + deck.frames.filter((frame) => !hasXhtmlNamespace(frame.svg)).length,
  0);
  const normalizedFramesWithXhtmlNamespace = preparedDecks.reduce((sum, entry) =>
    sum + entry.artifact.frames.filter((frame) => hasXhtmlNamespace(frame.svg)).length,
  0);
  const sourceHtmlVoidElements = fixtures.decks.reduce((deckSum, deck) =>
    deckSum + deck.frames.reduce((frameSum, frame) => frameSum + countHtmlVoidElements(frame.svg), 0),
  0);
  const normalizedSelfClosingVoidElements = preparedDecks.reduce((deckSum, entry) =>
    deckSum + entry.artifact.frames.reduce(
      (frameSum, frame) => frameSum + countSelfClosingHtmlVoidElements(frame.svg),
      0
    ),
  0);
  const sentinelOccurrences = preparedDecks.reduce((sum, entry) =>
    sum + countOccurrences(
      [entry.artifact.sharedCss, ...entry.artifact.frames.map((frame) => frame.svg)].join("\n"),
      SHARED_CSS_SENTINEL
    ),
  0);

  check(canonicalFontsReady, "At least one canonical frame was captured before fonts were ready.");
  check(canonicalImagesReady, "At least one canonical frame was captured before images were ready.");
  check(
    canonicalDecodedImageReferences ===
      canonicalHtmlImageElements + canonicalSvgImageElements + canonicalCssBackgroundUrls,
    "Canonical image readiness totals were incomplete."
  );
  check(validatedFrames === normalizedFrames, "Normalized readiness coverage was incomplete.");
  check(sentinelOccurrences === preparedDecks.length, "Shared CSS storage count drifted across artifacts.");

  const report: VideoVisualReport = Object.freeze({
    passed: true,
    dimensions: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
    threshold: {
      channelDelta: CHANNEL_DELTA_THRESHOLD,
      maximumDifferingPixelRatio: MAX_DIFFERING_PIXEL_RATIO,
      basis: "R-005 bounded SVG/canvas spike observed 0%, 1.1065%, and 0.0942%; this gate allows at most 2% of pixels with any RGB channel delta greater than 10.",
    },
    sourceFiles: fixtures.decks.map((deck) => ({
      locale: deck.locale,
      file: deck.sourceFile,
      sourceFrames: deck.sourceFrameCount,
      selectedFrames: deck.frames.length,
    })),
    categoryCoverage,
    sharedCss: {
      artifacts: preparedDecks.length,
      sentinelOccurrences,
      storedOncePerArtifact: true,
    },
    artifactInputNormalization: {
      method: "normalizeVideoDeckArtifact / normalizePhysicalSvgRoot over raw committed HTML svg.outerHTML",
      reason: "Committed HTML relies on the browser's implicit foreignObject namespace; standalone SVG must materialize xmlns=http://www.w3.org/1999/xhtml before decode.",
      sourceFramesMissingXhtmlNamespace,
      normalizedFramesWithXhtmlNamespace,
      sourceHtmlVoidElements,
      normalizedSelfClosingVoidElements,
      verified: sourceFramesMissingXhtmlNamespace === normalizedFramesWithXhtmlNamespace &&
        normalizedFramesWithXhtmlNamespace === normalizedFrames &&
        sourceHtmlVoidElements === normalizedSelfClosingVoidElements,
    },
    readiness: {
      normalizedFrames,
      validatedFrames,
      selectedImages,
      canonicalFontsReady: true,
      canonicalImagesReady: true,
      canonicalHtmlImageElements,
      canonicalSvgImageElements,
      canonicalCssBackgroundUrls,
      canonicalDecodedImageReferences,
      missingAndCorruptAssetGate: "src/tests/videoArtifactAcceptance.ts (missing/corrupt/nested-resource hard failures)",
    },
    overflow: {
      tolerancePx: FINAL_OVERFLOW_TOLERANCE_PX,
      worstPx: overflowWorst,
      measuredFrames: normalizedFrames,
    },
    compositorRepeatHashes: {
      scope: "Pre-encoder VideoFrameCompositor RGBA hashes only; this does not claim MP4/codec AC-707.",
      samples: compositorRepeatHashSamples,
    },
    worstDifferingPixelRatio: worstFrame.differingPixelRatio,
    worstFrameId: worstFrame.id,
    frames: Object.freeze(comparisons.slice()),
  });

  preparedDecks.forEach((entry) => entry.compositor.dispose());
  preparedDecks = [];
  return report;
};

function buildDraft(fixture: VisualFixtureDeck): VideoDeckArtifactDraftV1 {
  const sharedCss = `${fixture.sharedCss}\n.${SHARED_CSS_SENTINEL}{--achmage-video-visual-acceptance:1}`;
  return {
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss,
    // Each selected physical frame is an independent logical group. This keeps
    // the committed source order while avoiding synthetic gaps when the bounded
    // corpus selects only some members of a multi-frame source group.
    frames: fixture.frames.map((frame, physicalIndex) => ({
      physicalIndex,
      logicalIndex: physicalIndex,
      frameIndex: 0,
      frameCount: 1,
      title: frame.title,
      svg: frame.svg,
    })),
  };
}

function emptyVault(): Vault {
  return {
    getFiles: () => [],
    getResourcePath: () => "",
  } as unknown as Vault;
}

async function measureFinalOverflow(artifact: VideoDeckArtifactV1): Promise<number> {
  const iframe = document.win.createEl("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = [
    "position:fixed",
    "left:-99999px",
    "top:0",
    `width:${VIDEO_WIDTH}px`,
    `height:${VIDEO_HEIGHT}px`,
    "border:0",
    "opacity:0",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(iframe);
  try {
    const probe = await loadDeckAndProbe(
      iframe,
      buildProbeHtml(artifact),
      true,
      FINAL_OVERFLOW_TOLERANCE_PX,
      64,
      600
    );
    check(probe, "Visual acceptance final overflow probe was unavailable.");
    check(probe.frames.length === artifact.frames.length, "Visual overflow probe frame count drifted.");
    return aggregateOverflow(probe, FINAL_OVERFLOW_TOLERANCE_PX).worst;
  } finally {
    iframe.remove();
  }
}

function buildProbeHtml(artifact: VideoDeckArtifactV1): string {
  const body = artifact.frames.map((frame) =>
    `<div class="achmage-logical-group" data-group="${frame.logicalIndex}" style="display:block"><div class="achmage-frame-stack"><div class="marpit achmage-frame" data-frame="0">${frame.svg}</div></div></div>`
  ).join("");
  const safeCss = artifact.sharedCss.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${safeCss}</style><style>html,body{margin:0;padding:0;width:${VIDEO_WIDTH}px;background:#000}.achmage-frame{width:${VIDEO_WIDTH}px;height:${VIDEO_HEIGHT}px}.achmage-frame>svg{display:block;width:${VIDEO_WIDTH}px;height:${VIDEO_HEIGHT}px}</style></head><body>${body}</body></html>`;
}

function locateFrame(frameId: string): { readonly deck: PreparedDeck; readonly localIndex: number } {
  for (const deck of preparedDecks) {
    const localIndex = deck.fixture.frames.findIndex((frame) => frame.id === frameId);
    if (localIndex >= 0) return { deck, localIndex };
  }
  throw new Error(`Unknown canonical frame ${frameId}.`);
}

function isRepeatRepresentative(frameId: string): boolean {
  const allIds = preparedDecks.flatMap((entry) => entry.fixture.frames.map((frame) => frame.id));
  const representatives = new Set([
    allIds[0],
    allIds[Math.floor(allIds.length / 2)],
    allIds[allIds.length - 1],
  ]);
  return representatives.has(frameId);
}

async function decodePng(dataUrl: string): Promise<HTMLCanvasElement> {
  check(/^data:image\/png;base64,/i.test(dataUrl), "Canonical comparison input was not a PNG data URL.");
  const image = document.win.createEl("img");
  image.decoding = "sync";
  image.src = dataUrl;
  await image.decode();
  check(image.naturalWidth === VIDEO_WIDTH && image.naturalHeight === VIDEO_HEIGHT, "Canonical PNG dimensions drifted.");
  const canvas = document.win.createEl("canvas");
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  check(context, "Canonical PNG comparison canvas was unavailable.");
  context.drawImage(image, 0, 0);
  image.src = "";
  return canvas;
}

async function compareFullFrame(
  canonical: HTMLCanvasElement,
  compositor: OffscreenCanvas
): Promise<Omit<
  FrameComparison,
  | "id"
  | "locale"
  | "sourceIndex"
  | "title"
  | "categories"
  | "canonicalHtmlImageElements"
  | "canonicalSvgImageElements"
  | "canonicalCssBackgroundUrls"
  | "canonicalDecodedImageReferences"
  | "compositorHash"
  | "compositorRepeatHash"
>> {
  const canonicalContext = canonical.getContext("2d");
  const compositorContext = compositor.getContext("2d");
  check(canonicalContext && compositorContext, "Visual comparison canvas context was unavailable.");
  const expected = canonicalContext.getImageData(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT).data;
  const actual = compositorContext.getImageData(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT).data;
  let differingPixels = 0;
  let maximumChannelDelta = 0;
  for (let offset = 0; offset < actual.length; offset += 4) {
    const red = Math.abs(actual[offset] - expected[offset]);
    const green = Math.abs(actual[offset + 1] - expected[offset + 1]);
    const blue = Math.abs(actual[offset + 2] - expected[offset + 2]);
    const pixelDelta = Math.max(red, green, blue);
    if (pixelDelta > maximumChannelDelta) maximumChannelDelta = pixelDelta;
    if (pixelDelta > CHANNEL_DELTA_THRESHOLD) differingPixels += 1;
  }

  const representativeCoordinates = [
    [96, 54], [480, 54], [960, 54], [1440, 54], [1824, 54],
    [96, 270], [480, 270], [960, 270], [1440, 270], [1824, 270],
    [96, 540], [480, 540], [960, 540], [1440, 540], [1824, 540],
    [96, 810], [480, 810], [960, 810], [1440, 810], [1824, 810],
    [96, 1026], [480, 1026], [960, 1026], [1440, 1026], [1824, 1026],
  ] as const;
  let representativeDifferingPixels = 0;
  for (const [x, y] of representativeCoordinates) {
    const offset = (y * VIDEO_WIDTH + x) * 4;
    if (Math.max(
      Math.abs(actual[offset] - expected[offset]),
      Math.abs(actual[offset + 1] - expected[offset + 1]),
      Math.abs(actual[offset + 2] - expected[offset + 2])
    ) > CHANNEL_DELTA_THRESHOLD) {
      representativeDifferingPixels += 1;
    }
  }

  return {
    differingPixels,
    differingPixelRatio: differingPixels / (VIDEO_WIDTH * VIDEO_HEIGHT),
    maximumChannelDelta,
    representativePixelCount: representativeCoordinates.length,
    representativeDifferingPixels,
  };
}

async function hashCanvas(canvas: OffscreenCanvas): Promise<string> {
  const context = canvas.getContext("2d");
  check(context, "Compositor hash canvas context was unavailable.");
  const bytes = context.getImageData(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT).data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function buildCategoryCoverage(fixtures: VisualFixtures): Readonly<Record<VisualCategory, {
  readonly available: number;
  readonly selected: number;
}>> {
  const result = {} as Record<VisualCategory, { available: number; selected: number }>;
  for (const category of categoryNames()) {
    result[category] = {
      available: fixtures.decks.reduce((sum, deck) => sum + deck.availableCategories[category], 0),
      selected: fixtures.decks.reduce((deckSum, deck) =>
        deckSum + deck.frames.filter((frame) => frame.categories.includes(category)).length,
      0),
    };
  }
  return Object.freeze(result);
}

function categoryNames(): readonly VisualCategory[] {
  return ["background", "callout", "card", "cjk", "code", "image", "math"];
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function hasXhtmlNamespace(value: string): boolean {
  return /xmlns=["']http:\/\/www\.w3\.org\/1999\/xhtml["']/i.test(value);
}

function countHtmlVoidElements(value: string): number {
  return [...value.matchAll(/<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b[^>]*>/gi)]
    .filter((match) => !/\/\s*>$/.test(match[0]))
    .length;
}

function countSelfClosingHtmlVoidElements(value: string): number {
  return [...value.matchAll(/<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b[^>]*\/\s*>/gi)]
    .length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
