import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

import {
  CanvasSink,
  CanvasSource,
  EncodedPacketSink,
  FilePathSource,
  FilePathTarget,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeVideo,
} from "mediabunny";

import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "./videoTypes";

export const VIDEO_AVC_CODEC = "avc" as const;
export const VIDEO_AVC_FULL_CODEC_STRING = "avc1.640028" as const;
export const VIDEO_TARGET_BITRATE = 8_000_000 as const;
export const VIDEO_KEYFRAME_INTERVAL_FRAMES = 60 as const;

const VIDEO_FRAME_DURATION = 1 / VIDEO_FPS;
const DEFAULT_YIELD_EVERY_FRAMES = 2;

export interface VideoEncoderCapabilityV1 {
  readonly supported: boolean;
  readonly codec: typeof VIDEO_AVC_CODEC;
  readonly fullCodecString: typeof VIDEO_AVC_FULL_CODEC_STRING;
  readonly width: typeof VIDEO_WIDTH;
  readonly height: typeof VIDEO_HEIGHT;
  readonly fps: typeof VIDEO_FPS;
  readonly bitrate: typeof VIDEO_TARGET_BITRATE;
}

export interface VideoEncodeProgressV1 {
  readonly phase: "encoding";
  readonly completedFrames: number;
  readonly totalFrames: number;
  readonly ratio: number;
}

export interface VideoEncodeToPartialFileOptions {
  readonly outputPath: string;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly totalFrames: number;
  readonly renderFrame: (
    frameIndex: number,
    signal: AbortSignal | undefined
  ) => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: VideoEncodeProgressV1) => void;
  /** A macrotask yield supplements the awaited encoder/writer backpressure. */
  readonly yieldEveryFrames?: number;
}

export interface VideoEncodeResultV1 {
  readonly outputPath: string;
  readonly totalFrames: number;
  readonly durationSeconds: number;
  readonly elapsedMilliseconds: number;
  readonly bytes: number;
}

export interface VideoDecodedFrameEvidenceV1 {
  readonly frameIndex: number;
  readonly requestedTimestamp: number;
  readonly decodedTimestamp: number;
  readonly decodedDuration: number;
  readonly rgbaSha256: string;
}

export interface VideoMp4ValidationV1 {
  readonly path: string;
  readonly bytes: number;
  readonly codec: typeof VIDEO_AVC_CODEC;
  /** The encoder may raise the AVC level while preserving the requested High profile. */
  readonly codecParameterString: string;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly rotation: number;
  readonly durationSeconds: number;
  readonly packetCount: number;
  readonly averagePacketRate: number;
  readonly averageBitrate: number;
  readonly keyPacketIndices: readonly number[];
  readonly audioTrackCount: 0;
  readonly canDecode: true;
  readonly decodedFrames: readonly VideoDecodedFrameEvidenceV1[];
}

export interface ValidateVideoMp4Options {
  readonly path: string;
  readonly totalFrames: number;
  readonly signal?: AbortSignal;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function abortError(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error) return reason;
  return new DOMException("MP4 export was canceled.", "AbortError");
}

export function isVideoExportAbort(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

function validateTotalFrames(totalFrames: number): void {
  if (!Number.isInteger(totalFrames) || totalFrames < 1) {
    throw new RangeError("Video totalFrames must be a positive integer.");
  }
}

function createEncodingQuality(): Quality {
  return new Quality({ bitrate: VIDEO_TARGET_BITRATE, bitrateMode: "variable" });
}

function encodingOptions(quality: Quality) {
  return {
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    quality,
    fullCodecString: VIDEO_AVC_FULL_CODEC_STRING,
    hardwareAcceleration: "no-preference" as const,
    latencyMode: "quality" as const,
  };
}

/** Performs the exact capability check used by the production encoder. */
export async function probeVideoEncoderCapability(
  signal?: AbortSignal
): Promise<VideoEncoderCapabilityV1> {
  throwIfAborted(signal);
  const supported = await canEncodeVideo(VIDEO_AVC_CODEC, encodingOptions(createEncodingQuality()));
  throwIfAborted(signal);
  return {
    supported,
    codec: VIDEO_AVC_CODEC,
    fullCodecString: VIDEO_AVC_FULL_CODEC_STRING,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    fps: VIDEO_FPS,
    bitrate: VIDEO_TARGET_BITRATE,
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

async function cancelOutput(output: Output): Promise<void> {
  if (output.state === "started" || output.state === "finalizing") {
    await output.cancel().catch(() => undefined);
  }
}

/**
 * Encodes an already-composited 1920x1080 canvas into a private partial file.
 * The caller owns filename publication and must validate before committing it.
 */
export async function encodeVideoToPartialFile(
  options: VideoEncodeToPartialFileOptions
): Promise<VideoEncodeResultV1> {
  validateTotalFrames(options.totalFrames);
  if (options.canvas.width !== VIDEO_WIDTH || options.canvas.height !== VIDEO_HEIGHT) {
    throw new RangeError(`Encoder canvas must be exactly ${VIDEO_WIDTH}x${VIDEO_HEIGHT}.`);
  }
  const yieldEveryFrames = options.yieldEveryFrames ?? DEFAULT_YIELD_EVERY_FRAMES;
  if (!Number.isInteger(yieldEveryFrames) || yieldEveryFrames < 1) {
    throw new RangeError("yieldEveryFrames must be a positive integer.");
  }
  throwIfAborted(options.signal);

  const capability = await probeVideoEncoderCapability(options.signal);
  if (!capability.supported) {
    throw new Error(
      `${VIDEO_AVC_FULL_CODEC_STRING} encoding is not supported by this Obsidian/Electron renderer.`
    );
  }

  const quality = createEncodingQuality();
  const source = new CanvasSource(options.canvas, {
    codec: VIDEO_AVC_CODEC,
    quality,
    fullCodecString: VIDEO_AVC_FULL_CODEC_STRING,
    keyFrameInterval: VIDEO_KEYFRAME_INTERVAL_FRAMES / VIDEO_FPS,
    sizeChangeBehavior: "deny",
    hardwareAcceleration: "no-preference",
    latencyMode: "quality",
  });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "reserve" }),
    target: new FilePathTarget(options.outputPath),
  });
  output.addVideoTrack(source, {
    frameRate: VIDEO_FPS,
    maximumPacketCount: options.totalFrames,
  });

  const startedAt = performance.now();
  const abortListener = () => {
    void cancelOutput(output);
  };
  options.signal?.addEventListener("abort", abortListener, { once: true });
  options.onProgress?.({
    phase: "encoding",
    completedFrames: 0,
    totalFrames: options.totalFrames,
    ratio: 0,
  });

  try {
    await output.start();
    for (let frameIndex = 0; frameIndex < options.totalFrames; frameIndex += 1) {
      throwIfAborted(options.signal);
      await options.renderFrame(frameIndex, options.signal);
      throwIfAborted(options.signal);
      await source.add(frameIndex / VIDEO_FPS, VIDEO_FRAME_DURATION, {
        keyFrame: frameIndex % VIDEO_KEYFRAME_INTERVAL_FRAMES === 0,
      });
      throwIfAborted(options.signal);

      const completedFrames = frameIndex + 1;
      options.onProgress?.({
        phase: "encoding",
        completedFrames,
        totalFrames: options.totalFrames,
        ratio: completedFrames / options.totalFrames,
      });
      if (
        completedFrames < options.totalFrames &&
        completedFrames % yieldEveryFrames === 0
      ) {
        await yieldToEventLoop();
      }
    }
    throwIfAborted(options.signal);
    await output.finalize();
    throwIfAborted(options.signal);
  } catch (error) {
    await cancelOutput(output);
    if (options.signal?.aborted) throw abortError(options.signal);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortListener);
  }

  const file = await stat(options.outputPath);
  assert(file.isFile() && file.size > 0, "Mediabunny produced an empty or non-file MP4 partial.");
  return {
    outputPath: options.outputPath,
    totalFrames: options.totalFrames,
    durationSeconds: options.totalFrames / VIDEO_FPS,
    elapsedMilliseconds: performance.now() - startedAt,
    bytes: file.size,
  };
}

function decodedFrameIndices(totalFrames: number): readonly number[] {
  return [...new Set([0, Math.floor((totalFrames - 1) / 2), totalFrames - 1])];
}

function hashDecodedCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): string {
  const context = "style" in canvas
    ? canvas.getContext("2d", { willReadFrequently: true })
    : canvas.getContext("2d", { willReadFrequently: true });
  assert(context, "Decoded MP4 frame has no 2D context.");
  const pixels = context.getImageData(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT).data;
  return createHash("sha256").update(pixels).digest("hex");
}

/** Parses and decodes the private MP4 before the output transaction publishes it. */
export async function validateVideoMp4(
  options: ValidateVideoMp4Options
): Promise<VideoMp4ValidationV1> {
  validateTotalFrames(options.totalFrames);
  throwIfAborted(options.signal);
  const file = await stat(options.path);
  assert(file.isFile() && file.size > 0, "Encoded MP4 is empty or unavailable.");

  const input = new Input({ formats: [MP4], source: new FilePathSource(options.path) });
  const abortListener = () => input.dispose();
  options.signal?.addEventListener("abort", abortListener, { once: true });
  try {
    assert(await input.canRead(), "Mediabunny cannot read the finalized MP4.");
    throwIfAborted(options.signal);
    assert((await input.getFormat()) === MP4, "Finalized output is not an MP4 container.");

    const videoTracks = await input.getVideoTracks();
    const audioTracks = await input.getAudioTracks();
    assert(videoTracks.length === 1, `Expected one video track, got ${videoTracks.length}.`);
    assert(audioTracks.length === 0, `Expected no audio tracks, got ${audioTracks.length}.`);
    const track = videoTracks[0];

    const [
      codec,
      codecParameterString,
      codedWidth,
      codedHeight,
      displayWidth,
      displayHeight,
      rotation,
      durationSeconds,
      packetStats,
      decoderConfig,
      canDecode,
    ] = await Promise.all([
      track.getCodec(),
      track.getCodecParameterString(),
      track.getCodedWidth(),
      track.getCodedHeight(),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.getRotation(),
      track.computeDuration(),
      track.computePacketStats(),
      track.getDecoderConfig(),
      track.canDecode(),
    ]);
    throwIfAborted(options.signal);

    assert(codec === VIDEO_AVC_CODEC, `Expected AVC codec, got ${String(codec)}.`);
    // Chromium may raise the requested level (28 -> 32 at 1080p) while
    // retaining the requested AVC High profile. Level raising is compatible.
    assert(
      typeof codecParameterString === "string" && codecParameterString.startsWith("avc1.64"),
      `Expected an avc1 High-profile codec string, got ${String(codecParameterString)}.`
    );
    assert(
      codedWidth === VIDEO_WIDTH && codedHeight === VIDEO_HEIGHT,
      `Expected coded ${VIDEO_WIDTH}x${VIDEO_HEIGHT}, got ${codedWidth}x${codedHeight}.`
    );
    assert(
      displayWidth === VIDEO_WIDTH && displayHeight === VIDEO_HEIGHT,
      `Expected display ${VIDEO_WIDTH}x${VIDEO_HEIGHT}, got ${displayWidth}x${displayHeight}.`
    );
    assert(rotation === 0, `Expected unrotated video, got ${rotation} degrees.`);
    const expectedDuration = options.totalFrames / VIDEO_FPS;
    assert(
      Math.abs(durationSeconds - expectedDuration) <= VIDEO_FRAME_DURATION + 1e-6,
      `Expected ${expectedDuration}s duration, got ${durationSeconds}s.`
    );
    assert(
      packetStats.packetCount === options.totalFrames,
      `Expected ${options.totalFrames} video packets, got ${packetStats.packetCount}.`
    );
    assert(
      Math.abs(packetStats.averagePacketRate - VIDEO_FPS) <= 0.05,
      `Expected ${VIDEO_FPS}fps, got ${packetStats.averagePacketRate}fps.`
    );
    assert(decoderConfig, "The AVC track has no decoder configuration.");
    assert(canDecode, "The current Obsidian/Electron renderer cannot decode the produced AVC track.");

    const packetSink = new EncodedPacketSink(track);
    const keyPacketIndices: number[] = [];
    let packetIndex = 0;
    for await (const packet of packetSink.packets(undefined, undefined, {
      verifyKeyPackets: true,
    })) {
      throwIfAborted(options.signal);
      if (packet.type === "key") keyPacketIndices.push(packetIndex);
      packetIndex += 1;
    }
    assert(packetIndex === options.totalFrames, "Packet iterator count differs from MP4 metadata.");
    assert(keyPacketIndices[0] === 0, "The first encoded video packet must be a key packet.");
    for (let index = 1; index < keyPacketIndices.length; index += 1) {
      assert(
        keyPacketIndices[index] - keyPacketIndices[index - 1] <=
          VIDEO_KEYFRAME_INTERVAL_FRAMES,
        "Encoded keyframe interval exceeded 60 frames."
      );
    }
    assert(
      options.totalFrames - keyPacketIndices[keyPacketIndices.length - 1] <=
        VIDEO_KEYFRAME_INTERVAL_FRAMES,
      "The final keyframe interval exceeded 60 frames."
    );

    const canvasSink = new CanvasSink(track, {
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      fit: "fill",
      poolSize: 1,
    });
    const decodedFrames: VideoDecodedFrameEvidenceV1[] = [];
    for (const frameIndex of decodedFrameIndices(options.totalFrames)) {
      throwIfAborted(options.signal);
      const requestedTimestamp = frameIndex / VIDEO_FPS;
      const decoded = await canvasSink.getCanvas(requestedTimestamp);
      throwIfAborted(options.signal);
      assert(decoded, `Decoder returned no frame for video frame ${frameIndex}.`);
      assert(
        decoded.canvas.width === VIDEO_WIDTH && decoded.canvas.height === VIDEO_HEIGHT,
        `Decoded frame ${frameIndex} has unexpected dimensions.`
      );
      decodedFrames.push({
        frameIndex,
        requestedTimestamp,
        decodedTimestamp: decoded.timestamp,
        decodedDuration: decoded.duration,
        rgbaSha256: hashDecodedCanvas(decoded.canvas),
      });
    }

    return {
      path: options.path,
      bytes: file.size,
      codec,
      codecParameterString,
      codedWidth,
      codedHeight,
      displayWidth,
      displayHeight,
      rotation,
      durationSeconds,
      packetCount: packetStats.packetCount,
      averagePacketRate: packetStats.averagePacketRate,
      averageBitrate: packetStats.averageBitrate,
      keyPacketIndices: Object.freeze(keyPacketIndices.slice()),
      audioTrackCount: 0,
      canDecode: true,
      decodedFrames: Object.freeze(decodedFrames.slice()),
    };
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortListener);
    if (!input.disposed) input.dispose();
  }
}
