import { FONT_FACE_CSS } from "../themes/fontFace";
import { VideoFrameCompositor } from "../video/videoCompositor";
import {
  createVideoTimeline,
  sampleVideoTimeline,
  type VideoTimelineSampleV1,
} from "../video/videoTimeline";
import {
  VIDEO_ARTIFACT_SCHEMA_VERSION,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type VideoDeckArtifactFrameV1,
  type VideoDeckArtifactV1,
} from "../video/videoTypes";

const SHARED_CSS_SENTINEL = "asu-stress-shared-css-once";
const HEAP_LIMIT_BYTES = 68 * 1024 * 1024;
const EVENT_LOOP_STALL_LIMIT_MS = 1_000;
const CANCEL_SETTLE_LIMIT_MS = 1_000;
const CANVAS_BYTES = VIDEO_WIDTH * VIDEO_HEIGHT * 4;

// FONT_FACE_CSS is the same bundled Pretendard/JetBrains payload used by the
// renderer. The small rules below model the rest of a normal Marp theme while
// keeping the test independent of a particular user theme.
const STRESS_SHARED_CSS = `${FONT_FACE_CSS}
:root{--${SHARED_CSS_SENTINEL}:1;--asu-accent:#00b5ad;--asu-ink:#061a19}
svg{font-family:'Pretendard Variable',system-ui,sans-serif;background:#f7fbfb;color:#061a19}
.asu-frame-bg{fill:#f7fbfb}.asu-frame-band{fill:#00b5ad}.asu-frame-title{font-size:76px;font-weight:760;fill:#061a19}
.asu-frame-copy{font-size:34px;font-weight:450;fill:#183b3a}.asu-frame-code{font-family:'JetBrains Mono',monospace;font-size:25px;fill:#194f4c}
.asu-frame-rule{stroke:#00b5ad;stroke-width:5}.asu-frame-card{fill:#fff;stroke:#bee6e3;stroke-width:3}
@media(prefers-color-scheme:dark){svg{background:#071817;color:#eafffd}.asu-frame-bg{fill:#071817}.asu-frame-title{fill:#eafffd}.asu-frame-copy{fill:#c9eeeb}.asu-frame-card{fill:#0d2422;stroke:#246b66}}
`;

interface StressSampleEvidence {
  readonly label: string;
  readonly absoluteFrame: number;
  readonly kind: VideoTimelineSampleV1["kind"];
  readonly currentFrameIndex: number;
  readonly nextFrameIndex: number | null;
  readonly transitionAxis: "vertical" | "horizontal" | null;
  readonly retainedFrameIndices: readonly number[];
  readonly elapsedMs: number;
}

export interface VideoStressCaseEvidence {
  readonly frameCount: number;
  readonly artifactImmutable: boolean;
  readonly sharedCssBytes: number;
  readonly sharedCssSentinelCount: number;
  readonly sharedCssPropertyCount: number;
  readonly frameSvgSharedCssCount: number;
  readonly unexpectedArtifactArrayProperties: readonly string[];
  readonly suspiciousRasterArrayCount: number;
  readonly outputKind: "OffscreenCanvas";
  readonly outputIdentityStable: boolean;
  readonly maxRetainedDecodedFrames: number;
  readonly canvasBackingEstimateBytes: number;
  readonly canvasBackingLimitBytes: number;
  readonly maxEventLoopStallMs: number;
  readonly eventLoopStallLimitMs: number;
  readonly cancelObserved: boolean;
  readonly cancelErrorName: string;
  readonly cancelSettleMs: number;
  readonly cancelSettleLimitMs: number;
  readonly heapLimitBytes: number;
  readonly samples: readonly StressSampleEvidence[];
}

interface StressFixtureWindow {
  videoStressFixtureReady: boolean;
  videoStressFixtureError: string | null;
  runVideoStressCase: (frameCount: number) => Promise<VideoStressCaseEvidence>;
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Video stress acceptance: ${message}`);
}

function countOccurrences(value: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function frameSvg(index: number): string {
  const hue = (index * 37) % 360;
  const section = Math.floor(index / 2) + 1;
  const slide = (index % 2) + 1;
  const title = escapeXml(`Stress section ${section} · slide ${slide}`);
  const copy = escapeXml(`Physical frame ${index + 1} — 한글 · emoji ✓ · deterministic resource stress`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" viewBox="0 0 ${VIDEO_WIDTH} ${VIDEO_HEIGHT}"><rect class="asu-frame-bg" width="1920" height="1080"/><rect class="asu-frame-band" width="22" height="1080"/><rect class="asu-frame-card" x="128" y="132" width="1664" height="816" rx="32"/><circle cx="1660" cy="230" r="70" fill="hsl(${hue} 62% 54%)"/><path class="asu-frame-rule" d="M180 350H1740"/><text class="asu-frame-title" x="180" y="290">${title}</text><text class="asu-frame-copy" x="180" y="450">${copy}</text><text class="asu-frame-code" x="180" y="540">frame=${index}; section=${section}; slide=${slide};</text><g fill="none" stroke="hsl(${hue} 62% 42%)" stroke-width="10"><path d="M180 680C430 560 660 820 910 680S1390 560 1740 700"/></g></svg>`;
}

function buildArtifact(frameCount: number): VideoDeckArtifactV1 {
  check(frameCount === 100 || frameCount === 500, "only the bounded 100/500-frame cases are allowed");
  const frames: VideoDeckArtifactFrameV1[] = [];
  for (let physicalIndex = 0; physicalIndex < frameCount; physicalIndex += 1) {
    frames.push(Object.freeze({
      physicalIndex,
      logicalIndex: Math.floor(physicalIndex / 2),
      frameIndex: physicalIndex % 2,
      frameCount: 2,
      title: `Stress section ${Math.floor(physicalIndex / 2) + 1}`,
      svg: frameSvg(physicalIndex),
      contentHash: physicalIndex.toString(16).padStart(64, "0"),
    }));
  }
  return Object.freeze({
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss: STRESS_SHARED_CSS,
    artifactHash: frameCount.toString(16).padStart(64, "0"),
    frames: Object.freeze(frames),
  });
}

function sampleSet(artifact: VideoDeckArtifactV1): readonly {
  readonly label: string;
  readonly sample: VideoTimelineSampleV1;
}[] {
  const plan = createVideoTimeline(artifact.frames, 0.5);
  const segmentFrames = plan.holdFrames + plan.transitionFrames;
  const middleFrameIndex = Math.floor(artifact.frames.length / 2);
  // Deliberately non-monotonic: this exercises cache eviction and proves the
  // compositor does O(1) random access rather than materializing a deck raster array.
  return Object.freeze([
    { label: "last-hold", sample: sampleVideoTimeline(plan, plan.totalFrames - 1) },
    { label: "first-hold", sample: sampleVideoTimeline(plan, 0) },
    {
      label: "middle-hold",
      sample: sampleVideoTimeline(plan, middleFrameIndex * segmentFrames),
    },
    {
      label: "vertical-transition",
      sample: sampleVideoTimeline(plan, plan.holdFrames),
    },
    {
      label: "horizontal-transition",
      sample: sampleVideoTimeline(plan, segmentFrames + plan.holdFrames),
    },
  ]);
}

function startEventLoopMonitor(intervalMs = 10): () => Promise<number> {
  let expected = performance.now() + intervalMs;
  let maxStallMs = 0;
  const timer = window.setInterval(() => {
    const now = performance.now();
    maxStallMs = Math.max(maxStallMs, Math.max(0, now - expected));
    expected = now + intervalMs;
  }, intervalMs);
  return async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs * 2));
    window.clearInterval(timer);
    return maxStallMs;
  };
}

function suspiciousRasterArrays(artifact: VideoDeckArtifactV1): readonly string[] {
  const suspicious: string[] = [];
  for (const [key, value] of Object.entries(artifact)) {
    if (Array.isArray(value) && key !== "frames") suspicious.push(`artifact.${key}`);
  }
  artifact.frames.forEach((frame, index) => {
    for (const [key, value] of Object.entries(frame)) {
      if (Array.isArray(value) || (/standalone|raster|bitmap|canvas|imageData/i.test(key) && value)) {
        suspicious.push(`artifact.frames[${index}].${key}`);
      }
    }
  });
  return Object.freeze(suspicious);
}

async function verifyCancellation(
  artifact: VideoDeckArtifactV1,
  activeDocument: Document
): Promise<{ readonly observed: boolean; readonly errorName: string; readonly settleMs: number }> {
  const controller = new AbortController();
  const compositor = new VideoFrameCompositor(artifact, {
    activeDocument,
    signal: controller.signal,
  });
  const plan = createVideoTimeline(artifact.frames, 0.5);
  const pending = compositor.render(sampleVideoTimeline(plan, plan.holdFrames));
  let abortedAt = 0;
  queueMicrotask(() => {
    abortedAt = performance.now();
    controller.abort();
  });
  let observed = false;
  let errorName = "none";
  try {
    await pending;
  } catch (error) {
    errorName = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "unknown";
    observed = errorName === "AbortError";
  } finally {
    compositor.dispose();
  }
  return {
    observed,
    errorName,
    settleMs: abortedAt === 0 ? Number.POSITIVE_INFINITY : performance.now() - abortedAt,
  };
}

async function runVideoStressCase(frameCount: number): Promise<VideoStressCaseEvidence> {
  check(typeof OffscreenCanvas !== "undefined", "OffscreenCanvas is required");
  const artifact = buildArtifact(frameCount);
  const sharedCssBytes = new TextEncoder().encode(artifact.sharedCss).byteLength;
  const sharedCssSentinelCount = countOccurrences(artifact.sharedCss, SHARED_CSS_SENTINEL);
  const frameSvgSharedCssCount = artifact.frames.reduce(
    (count, frame) => count + countOccurrences(frame.svg, SHARED_CSS_SENTINEL),
    0
  );
  const sharedCssPropertyCount = Object.prototype.hasOwnProperty.call(artifact, "sharedCss") ? 1 : 0;
  const unexpectedArtifactArrayProperties = Object.entries(artifact)
    .filter(([key, value]) => Array.isArray(value) && key !== "frames")
    .map(([key]) => key);
  const suspiciousArrays = suspiciousRasterArrays(artifact);

  check(Object.isFrozen(artifact), "artifact must be frozen");
  check(Object.isFrozen(artifact.frames), "artifact frame list must be frozen");
  check(artifact.frames.every(Object.isFrozen), "every artifact frame must be frozen");
  check(sharedCssBytes >= 500_000, "stress CSS must approximate the actual embedded renderer CSS");
  check(sharedCssSentinelCount === 1, "shared CSS sentinel must exist exactly once");
  check(sharedCssPropertyCount === 1, "artifact must own exactly one sharedCss property");
  check(frameSvgSharedCssCount === 0, "physical frame SVGs must not duplicate shared CSS");
  check(unexpectedArtifactArrayProperties.length === 0, "artifact must not own a second resource array");
  check(suspiciousArrays.length === 0, "artifact must not contain a standalone/raster/canvas array");

  const stopEventLoopMonitor = startEventLoopMonitor();
  const samples: StressSampleEvidence[] = [];
  const compositor = new VideoFrameCompositor(artifact, { activeDocument: document });
  let output: OffscreenCanvas | null = null;
  let outputIdentityStable = true;
  let maxRetainedDecodedFrames = 0;
  try {
    for (const entry of sampleSet(artifact)) {
      const startedAt = performance.now();
      const rendered = await compositor.render(entry.sample);
      const elapsedMs = performance.now() - startedAt;
      check(rendered instanceof OffscreenCanvas, `${entry.label} must return module-realm OffscreenCanvas`);
      if (output) outputIdentityStable = outputIdentityStable && rendered === output;
      else output = rendered;
      const retainedFrameIndices = compositor.getRetainedFrameIndices();
      maxRetainedDecodedFrames = Math.max(maxRetainedDecodedFrames, retainedFrameIndices.length);
      check(retainedFrameIndices.length <= 2, `${entry.label} retained more than current/next decoded frames`);
      samples.push(Object.freeze({
        label: entry.label,
        absoluteFrame: entry.sample.absoluteFrame,
        kind: entry.sample.kind,
        currentFrameIndex: entry.sample.currentFrameIndex,
        nextFrameIndex: entry.sample.kind === "transition" ? entry.sample.nextFrameIndex : null,
        transitionAxis: entry.sample.kind === "transition" ? entry.sample.axis : null,
        retainedFrameIndices,
        elapsedMs,
      }));
    }
  } finally {
    compositor.dispose();
  }

  const cancellation = await verifyCancellation(artifact, document);
  const maxEventLoopStallMs = await stopEventLoopMonitor();
  const canvasBackingEstimateBytes = (1 + maxRetainedDecodedFrames) * CANVAS_BYTES;
  const canvasBackingLimitBytes = 3 * CANVAS_BYTES;
  check(output !== null, "random-access sample set must render output");
  check(outputIdentityStable, "compositor must reuse one module-realm output canvas");
  check(maxRetainedDecodedFrames <= 2, "decoded cache exceeds two frames");
  check(canvasBackingEstimateBytes <= canvasBackingLimitBytes, "canvas backing estimate exceeds three 1080p canvases");
  check(maxEventLoopStallMs <= EVENT_LOOP_STALL_LIMIT_MS, "event-loop stall exceeds one second");
  check(cancellation.observed, "AbortSignal did not cancel an in-flight render");
  check(cancellation.settleMs <= CANCEL_SETTLE_LIMIT_MS, "cancel did not settle within one second");

  return Object.freeze({
    frameCount,
    artifactImmutable: true,
    sharedCssBytes,
    sharedCssSentinelCount,
    sharedCssPropertyCount,
    frameSvgSharedCssCount,
    unexpectedArtifactArrayProperties: Object.freeze(unexpectedArtifactArrayProperties),
    suspiciousRasterArrayCount: suspiciousArrays.length,
    outputKind: "OffscreenCanvas",
    outputIdentityStable,
    maxRetainedDecodedFrames,
    canvasBackingEstimateBytes,
    canvasBackingLimitBytes,
    maxEventLoopStallMs,
    eventLoopStallLimitMs: EVENT_LOOP_STALL_LIMIT_MS,
    cancelObserved: cancellation.observed,
    cancelErrorName: cancellation.errorName,
    cancelSettleMs: cancellation.settleMs,
    cancelSettleLimitMs: CANCEL_SETTLE_LIMIT_MS,
    heapLimitBytes: HEAP_LIMIT_BYTES,
    samples: Object.freeze(samples),
  });
}

const activeWindow = window;
(activeWindow as unknown as { createEl: (tagName: string) => HTMLElement }).createEl =
  (tagName: string) => document.createElement(tagName);
Object.defineProperty(document, "win", {
  configurable: true,
  value: activeWindow,
});

const fixtureWindow = window as unknown as StressFixtureWindow;
fixtureWindow.videoStressFixtureError = null;
fixtureWindow.runVideoStressCase = runVideoStressCase;
fixtureWindow.videoStressFixtureReady = true;
