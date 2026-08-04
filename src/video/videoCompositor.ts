import type {
  VideoDeckArtifactV1,
  VideoDeckArtifactFrameV1,
} from "./videoTypes";
import type { VideoTimelineSampleV1 } from "./videoTimeline";

const SVG_OPEN_RE = /<svg\b([^>]*)>/i;

export interface RasterizeStandaloneSvgOptionsV1 {
  readonly activeDocument: Document;
  readonly signal?: AbortSignal;
}

export interface VideoCompositorProgressV1 {
  readonly phase: "decoding-frame" | "compositing-frame";
  readonly frameIndex: number;
  readonly completed: number;
  readonly total: number;
}

export interface VideoFrameCompositorOptionsV1 {
  readonly activeDocument: Document;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: VideoCompositorProgressV1) => void;
}

/**
 * Serialize the already self-contained SVG without a Blob URL. The UTF-8 byte
 * conversion is chunked before btoa so multi-megabyte embedded font CSS does
 * not overflow the JavaScript argument stack.
 */
export function standaloneSvgToDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/** Inject the single shared stylesheet into one transient current/next SVG. */
export function buildStandaloneSvg(
  physicalSvg: string,
  sharedCss: string,
  width = 1920,
  height = 1080
): string {
  const match = SVG_OPEN_RE.exec(physicalSvg);
  if (!match || match.index !== physicalSvg.search(/\S/)) {
    throw new Error("Video export expected each physical frame to be a root SVG element.");
  }
  const style = `<style data-achmage-video-css="">${escapeXmlText(sharedCss)}</style>`;
  return `${physicalSvg.slice(0, match.index + match[0].length)}${style}${physicalSvg.slice(match.index + match[0].length)}`
    .replace(/<svg\b/, `<svg data-achmage-video-size="${width}x${height}"`);
}

/** Decode and paint one frame through the proven origin-clean data-URI path. */
export async function rasterizeStandaloneSvg(
  svg: string,
  options: RasterizeStandaloneSvgOptionsV1
): Promise<HTMLCanvasElement> {
  throwIfAborted(options.signal);
  const activeDocument = options.activeDocument;
  const activeWindow = activeDocument.win;
  const canvas = activeWindow.createEl("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Video export could not create a 2D canvas context.");

  const image = activeWindow.createEl("img");
  image.decoding = "sync";
  image.width = canvas.width;
  image.height = canvas.height;
  image.src = standaloneSvgToDataUri(svg);
  try {
    await waitForImageDecode(image, options.signal);
    throwIfAborted(options.signal);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // A tainted canvas throws here. Read one pixel rather than copying a full
    // 8 MiB ImageData merely to prove that the encoder can read the surface.
    context.getImageData(0, 0, 1, 1);
    return canvas;
  } catch (error) {
    releaseCanvas(canvas);
    if (isAbortError(error)) throw error;
    throw new Error(`Video export could not decode a standalone slide SVG. ${errorMessage(error)}`, {
      cause: error,
    });
  } finally {
    image.src = "";
  }
}

/**
 * Random-access compositor used by the streaming encoder. It retains at most
 * the source and destination bitmap canvases for the requested timeline
 * sample; it never builds an array of rasterized deck frames.
 */
export class VideoFrameCompositor {
  private readonly artifact: VideoDeckArtifactV1;
  private readonly options: VideoFrameCompositorOptionsV1;
  private readonly output: OffscreenCanvas;
  private readonly outputContext: OffscreenCanvasRenderingContext2D;
  private readonly decoded = new Map<number, HTMLCanvasElement>();
  private disposed = false;

  constructor(artifact: VideoDeckArtifactV1, options: VideoFrameCompositorOptionsV1) {
    if (artifact.width !== 1920 || artifact.height !== 1080 || artifact.frames.length === 0) {
      throw new Error("Video compositor requires a non-empty 1920x1080 artifact.");
    }
    this.artifact = artifact;
    this.options = options;
    // CanvasSource performs a realm-local instanceof check. A canvas created
    // by an Obsidian pop-out document fails that check in the plugin's main
    // realm, whereas this module-realm OffscreenCanvas is accepted everywhere.
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("MP4 export requires OffscreenCanvas in this Obsidian/Electron runtime.");
    }
    this.output = new OffscreenCanvas(artifact.width, artifact.height);
    const context = this.output.getContext("2d", { alpha: false });
    if (!context) throw new Error("Video export could not create the output canvas.");
    this.outputContext = context;
  }

  async render(sample: VideoTimelineSampleV1): Promise<OffscreenCanvas> {
    this.assertUsable();
    throwIfAborted(this.options.signal);
    const required = sample.kind === "transition"
      ? new Set([sample.currentFrameIndex, sample.nextFrameIndex])
      : new Set([sample.currentFrameIndex]);
    this.evictExcept(required);

    const current = await this.getDecoded(sample.currentFrameIndex);
    throwIfAborted(this.options.signal);
    const context = this.outputContext;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.output.width, this.output.height);

    if (sample.kind === "hold") {
      context.drawImage(current, 0, 0);
    } else {
      const next = await this.getDecoded(sample.nextFrameIndex);
      throwIfAborted(this.options.signal);
      const progress = sample.progress;
      if (sample.axis === "vertical") {
        context.drawImage(current, 0, -progress * this.output.height);
        context.drawImage(next, 0, (1 - progress) * this.output.height);
      } else {
        context.drawImage(current, -progress * this.output.width, 0);
        context.drawImage(next, (1 - progress) * this.output.width, 0);
      }
    }

    // Keep the same origin-clean invariant after composition too.
    context.getImageData(0, 0, 1, 1);
    this.options.onProgress?.(Object.freeze({
      phase: "compositing-frame",
      frameIndex: sample.absoluteFrame,
      completed: sample.absoluteFrame + 1,
      total: sample.absoluteFrame + 1,
    }));
    return this.output;
  }

  /** Observable only for deterministic memory-budget acceptance. */
  getRetainedFrameIndices(): readonly number[] {
    return Object.freeze([...this.decoded.keys()].sort((a, b) => a - b));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const canvas of this.decoded.values()) releaseCanvas(canvas);
    this.decoded.clear();
    releaseCanvas(this.output);
  }

  private async getDecoded(frameIndex: number): Promise<HTMLCanvasElement> {
    const cached = this.decoded.get(frameIndex);
    if (cached) return cached;
    const frame = this.frameAt(frameIndex);
    const standaloneSvg = buildStandaloneSvg(
      frame.svg,
      this.artifact.sharedCss,
      this.artifact.width,
      this.artifact.height
    );
    const canvas = await rasterizeStandaloneSvg(standaloneSvg, {
      activeDocument: this.options.activeDocument,
      signal: this.options.signal,
    });
    try {
      this.assertUsable();
      throwIfAborted(this.options.signal);
    } catch (error) {
      releaseCanvas(canvas);
      throw error;
    }
    this.decoded.set(frameIndex, canvas);
    this.options.onProgress?.(Object.freeze({
      phase: "decoding-frame",
      frameIndex,
      completed: frameIndex + 1,
      total: this.artifact.frames.length,
    }));
    return canvas;
  }

  private frameAt(index: number): VideoDeckArtifactFrameV1 {
    if (!Number.isInteger(index) || index < 0 || index >= this.artifact.frames.length) {
      throw new RangeError(`Video compositor frame ${index} is outside the artifact.`);
    }
    return this.artifact.frames[index];
  }

  private evictExcept(required: ReadonlySet<number>): void {
    for (const [index, canvas] of this.decoded) {
      if (required.has(index)) continue;
      releaseCanvas(canvas);
      this.decoded.delete(index);
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("Video compositor has already been disposed.");
  }
}

async function waitForImageDecode(
  image: HTMLImageElement,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal);
  let abortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    abortListener = () => reject(new DOMException("Video export was cancelled.", "AbortError"));
    signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    await Promise.race([image.decode(), aborted]);
  } finally {
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }
}

function releaseCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  canvas.width = 1;
  canvas.height = 1;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Video export was cancelled.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
