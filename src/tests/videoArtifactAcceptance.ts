import {
  normalizeVideoDeckArtifact,
  rewriteMarpRootSelectors,
  type VideoArtifactProgressV1,
  type VideoResolvedResourceV1,
} from "../video/videoArtifact";
import { VideoFrameCompositor, standaloneSvgToDataUri } from "../video/videoCompositor";
import {
  VIDEO_ARTIFACT_SCHEMA_VERSION,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type VideoDeckArtifactDraftV1,
} from "../video/videoTypes";
import { createVideoTimeline, sampleVideoTimeline } from "../video/videoTimeline";
import type { Vault } from "obsidian";

declare global {
  interface Window {
    __VIDEO_ARTIFACT_ACCEPTANCE__?: {
      readonly passed: boolean;
      readonly assertions: number;
      readonly error?: string;
    };
  }
}

let assertions = 0;

function check(value: unknown, message: string): asserts value {
  assertions += 1;
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
}

function svgBytes(color: string): Uint8Array {
  return new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="${color}"/></svg>`
  );
}

function physicalSvg(color: string, extra = ""): string {
  return `<svg data-marpit-svg="" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="${color}"/>${extra}</svg>`;
}

function makeDraft(): VideoDeckArtifactDraftV1 {
  const topology = [
    { logicalIndex: 0, frameIndex: 0, frameCount: 2, color: "#ff0000" },
    { logicalIndex: 0, frameIndex: 1, frameCount: 2, color: "#0000ff" },
    { logicalIndex: 1, frameIndex: 0, frameCount: 1, color: "#00ff00" },
  ] as const;
  return {
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss:
      "div.marpit > svg > rect{shape-rendering:crispEdges}.asu-css-once-sentinel{background-image:url('https://assets.test/background.svg')}",
    frames: topology.map((entry, physicalIndex) => ({
      physicalIndex,
      logicalIndex: entry.logicalIndex,
      frameIndex: entry.frameIndex,
      frameCount: entry.frameCount,
      title: `Frame ${physicalIndex + 1}`,
      svg: physicalSvg(
        entry.color,
        physicalIndex === 0
          ? '<image href="app://vault/local.svg" width="1" height="1" opacity="0"/>'
          : ""
      ),
    })),
  };
}

async function run(): Promise<void> {
  equal(rewriteMarpRootSelectors("div.marpit>svg, div.marpit > svg{x:1}"), "svg, svg{x:1}", "root selector rewrite");
  check(standaloneSvgToDataUri("<svg>한😀</svg>").startsWith("data:image/svg+xml;base64,"), "UTF-8 SVG data URI");

  const localFile = { path: "assets/local.svg" };
  const localBytes = svgBytes("#ffffff");
  const vault = {
    getFiles: () => [localFile],
    getResourcePath: () => "app://vault/local.svg?cache=1",
    readBinary: async () => localBytes.buffer.slice(0),
  } as unknown as Vault;
  const progress: VideoArtifactProgressV1[] = [];
  const remote = svgBytes("#101010");
  const artifact = await normalizeVideoDeckArtifact(makeDraft(), {
    vault,
    activeDocument: document,
    sourcePath: "notes/deck.md",
    onProgress: (value) => progress.push(value),
    resolveResource: async (request): Promise<VideoResolvedResourceV1> => {
      if (request.url === "app://vault/local.svg") return { bytes: localBytes, mimeType: "image/svg+xml" };
      if (request.url === "https://assets.test/background.svg") {
        return { bytes: remote, mimeType: "image/svg+xml" };
      }
      throw new Error(`Unexpected test asset ${request.url}`);
    },
  });

  equal(artifact.frames.length, 3, "physical frame count");
  check(Object.isFrozen(artifact), "artifact frozen");
  check(Object.isFrozen(artifact.frames), "artifact frame list frozen");
  check(artifact.frames.every((frame) => Object.isFrozen(frame)), "artifact frames frozen");
  check(/^[a-f0-9]{64}$/.test(artifact.artifactHash), "artifact SHA-256");
  check(artifact.frames.every((frame) => /^[a-f0-9]{64}$/.test(frame.contentHash)), "frame SHA-256");
  check(!artifact.sharedCss.includes("div.marpit"), "Marp wrapper selector removed");
  check(!/https?:|app:|blob:/i.test(artifact.sharedCss), "shared CSS resources embedded");
  check(
    artifact.frames.every((frame) => !/app:\/\/vault|https:\/\/assets\.test|blob:/i.test(frame.svg)),
    "frame resources embedded"
  );
  check(artifact.frames.every((frame) => /width="1920"/.test(frame.svg)), "explicit frame width");
  check(artifact.frames.every((frame) => /height="1080"/.test(frame.svg)), "explicit frame height");
  equal(
    [artifact.sharedCss, ...artifact.frames.map((frame) => frame.svg)].join("").split("asu-css-once-sentinel").length - 1,
    1,
    "shared CSS sentinel stored exactly once in final artifact"
  );
  equal(progress.filter((item) => item.phase === "normalizing-assets").length, 2, "resource deduplication");
  equal(progress.filter((item) => item.phase === "validating-assets").length, 3, "every frame readiness checked");
  equal(progress.filter((item) => item.phase === "hashing").length, 3, "every frame hashed");
  check(
    progress.every((item, index) => index === 0 || item.completed >= progress[index - 1].completed),
    "artifact progress is monotonic"
  );
  equal(progress.at(-1)?.completed, progress.at(-1)?.total, "artifact progress reaches completion");

  const blobUrl = URL.createObjectURL(
    new Blob([Uint8Array.from(svgBytes("#222222")).buffer], { type: "image/svg+xml" })
  );
  const inlineUrl =
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%228%22%20height%3D%228%22%3E%3Crect%20width%3D%228%22%20height%3D%228%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E";
  const defaultDraft: VideoDeckArtifactDraftV1 = {
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss: ".remote{background-image:url('https://default.test/remote.svg')}",
    frames: [{
      physicalIndex: 0,
      logicalIndex: 0,
      frameIndex: 0,
      frameCount: 1,
      title: "Default resolver",
      svg: physicalSvg(
        "#333333",
        `<image href="app://vault/local.svg" width="1" height="1"/><image href="assets/local.svg" width="1" height="1"/><image href="${blobUrl}" width="1" height="1"/><image href="${inlineUrl}" width="1" height="1"/>`
      ),
    }],
  };
  try {
    const defaultArtifact = await normalizeVideoDeckArtifact(defaultDraft, {
      vault,
      activeDocument: document,
    });
    check(!defaultArtifact.sharedCss.includes("https://default.test"), "default requestUrl asset embedded");
    check(!defaultArtifact.frames[0].svg.includes("app://vault"), "default app resource embedded from vault");
    check(!defaultArtifact.frames[0].svg.includes("assets/local.svg"), "default vault-relative resource embedded");
    check(!defaultArtifact.frames[0].svg.includes(blobUrl), "default blob resource embedded");
    check(!defaultArtifact.frames[0].svg.includes("data:image/svg+xml,%3C"), "data URI canonicalized");
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  const repeated = await normalizeVideoDeckArtifact(makeDraft(), {
    vault,
    activeDocument: document,
    resolveResource: async (request) => request.url.startsWith("app:")
      ? { bytes: localBytes, mimeType: "image/svg+xml" }
      : { bytes: remote, mimeType: "image/svg+xml" },
  });
  equal(repeated.artifactHash, artifact.artifactHash, "artifact normalization deterministic");

  const compositor = new VideoFrameCompositor(artifact, { activeDocument: document });
  const timeline = createVideoTimeline(artifact.frames, 0.5);
  const first = await compositor.render(sampleVideoTimeline(timeline, 0));
  assertPixel(first, 960, 540, [255, 0, 0], "hold frame is red");
  equal(compositor.getRetainedFrameIndices().join(","), "0", "hold retains one source bitmap");

  const firstTransitionMid = timeline.holdFrames + 4;
  const vertical = await compositor.render(sampleVideoTimeline(timeline, firstTransitionMid));
  assertPixel(vertical, 100, 100, [255, 0, 0], "vertical transition current half");
  assertPixel(vertical, 100, 900, [0, 0, 255], "vertical transition next half");
  equal(compositor.getRetainedFrameIndices().join(","), "0,1", "transition retains exactly two bitmaps");

  const secondSegment = timeline.holdFrames + timeline.transitionFrames;
  const horizontal = await compositor.render(
    sampleVideoTimeline(timeline, secondSegment + timeline.holdFrames + 4)
  );
  assertPixel(horizontal, 100, 100, [0, 0, 255], "horizontal transition current half");
  assertPixel(horizontal, 1800, 100, [0, 255, 0], "horizontal transition next half");
  equal(compositor.getRetainedFrameIndices().join(","), "1,2", "bitmap cache evicts prior source");
  compositor.dispose();
  equal(compositor.getRetainedFrameIndices().length, 0, "dispose releases bitmap cache");

  const aborted = new AbortController();
  aborted.abort();
  let abortName = "";
  try {
    await normalizeVideoDeckArtifact(makeDraft(), {
      vault,
      activeDocument: document,
      signal: aborted.signal,
      resolveResource: async () => ({ bytes: remote, mimeType: "image/svg+xml" }),
    });
  } catch (error) {
    abortName = error instanceof DOMException ? error.name : "";
  }
  equal(abortName, "AbortError", "normalization observes AbortSignal");

  const missingDraft: VideoDeckArtifactDraftV1 = {
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss: "",
    frames: [{
      physicalIndex: 0,
      logicalIndex: 0,
      frameIndex: 0,
      frameCount: 1,
      title: "Missing",
      svg: physicalSvg("#ffffff", '<image href="missing.png"/>'),
    }],
  };
  let missingMessage = "";
  try {
    await normalizeVideoDeckArtifact(missingDraft, { vault, activeDocument: document });
  } catch (error) {
    missingMessage = error instanceof Error ? error.message : String(error);
  }
  check(/slide 1.*missing\.png.*not found/i.test(missingMessage), "missing asset is an actionable hard failure");
}

function assertPixel(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  expected: readonly [number, number, number],
  message: string
): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Acceptance canvas context unavailable.");
  const actual = [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
  assertions += 1;
  if (actual.some((value, index) => Math.abs(value - expected[index]) > 2)) {
    throw new Error(`${message}: ${actual.join(",")} !== ${expected.join(",")}`);
  }
}

void run().then(
  () => {
    window.__VIDEO_ARTIFACT_ACCEPTANCE__ = { passed: true, assertions };
  },
  (error: unknown) => {
    window.__VIDEO_ARTIFACT_ACCEPTANCE__ = {
      passed: false,
      assertions,
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
    };
  }
);
