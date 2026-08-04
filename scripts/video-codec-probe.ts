import { createHash } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";

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

const WIDTH = 1920;
const HEIGHT = 1080;
const FRAME_RATE = 30;
const FRAME_COUNT = 60;
const DURATION_SECONDS = FRAME_COUNT / FRAME_RATE;
const BITRATE = 8_000_000;
const CODEC = "avc";
const FULL_CODEC_STRING = "avc1.640028";

type ProbeOptions = {
  outputPath: string;
};

type DecodedFrameEvidence = {
  label: string;
  rgbaSha256: string;
};

type SingleProbeResult = Record<string, unknown> & {
  decodedFrames: DecodedFrameEvidence[];
  output: {
    bytes: number;
    path: string;
    sha256: string;
    topLevelBoxOffsets: Record<string, number>;
  };
};

type ProbeError = {
  message: string;
  name: string;
  stack: string | null;
};

type ProbeEnvelope =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: ProbeError; outputRemoved: boolean };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function paintQualificationFrame(
  context: CanvasRenderingContext2D,
  frameIndex: number,
): void {
  context.fillStyle = "#102238";
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.fillStyle = "#e04444";
  context.fillRect(80, 80, 800, 400);
  context.fillStyle = "#34b66a";
  context.fillRect(1040, 80, 800, 400);
  context.fillStyle = "#3978d4";
  context.fillRect(80, 600, 1760, 400);

  const progress = frameIndex / (FRAME_COUNT - 1);
  context.fillStyle = "#f6d84a";
  context.fillRect(120 + progress * 1500, 500, 180, 80);
}

function readPixel(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
): number[] {
  return [...context.getImageData(x, y, 1, 1).data];
}

function assertPixelNear(
  actual: number[],
  expected: number[],
  label: string,
  tolerance = 45,
): void {
  assert(actual.length >= 4, `${label}: decoded pixel has no RGBA value`);
  for (let channel = 0; channel < 3; channel += 1) {
    assert(
      Math.abs(actual[channel] - expected[channel]) <= tolerance,
      `${label}: channel ${channel} expected ${expected[channel]} +/- ${tolerance}, got ${actual[channel]}`,
    );
  }
  assert(actual[3] >= 245, `${label}: decoded alpha must be opaque`);
}

function topLevelBoxOffsets(bytes: Uint8Array): Record<string, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets: Record<string, number> = {};
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    let size = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    if (!(type in offsets)) offsets[type] = offset;
    if (size === 1) {
      if (offset + 16 > bytes.byteLength) break;
      const largeSize = view.getBigUint64(offset + 8, false);
      assert(largeSize <= BigInt(Number.MAX_SAFE_INTEGER), `${type} box is too large`);
      size = Number(largeSize);
    } else if (size === 0) {
      size = bytes.byteLength - offset;
    }
    assert(size >= 8, `${type} box has invalid size ${size}`);
    offset += size;
  }
  return offsets;
}

async function decodeEvidence(
  sink: CanvasSink,
  timestamp: number,
  label: string,
): Promise<Record<string, unknown>> {
  const wrapped = await sink.getCanvas(timestamp);
  assert(wrapped, `${label}: decoder returned no frame`);
  const context = wrapped.canvas.getContext("2d", { willReadFrequently: true });
  assert(context, `${label}: decoded canvas has no 2D context`);
  const pixels = context.getImageData(0, 0, WIDTH, HEIGHT).data;

  const red = readPixel(context, 300, 260);
  const green = readPixel(context, 1300, 260);
  const blue = readPixel(context, 900, 800);
  assertPixelNear(red, [224, 68, 68, 255], `${label} red panel`);
  assertPixelNear(green, [52, 182, 106, 255], `${label} green panel`);
  assertPixelNear(blue, [57, 120, 212, 255], `${label} blue panel`);

  return {
    requestedTimestamp: timestamp,
    decodedTimestamp: wrapped.timestamp,
    decodedDuration: wrapped.duration,
    rgbaSha256: sha256(pixels),
    samples: { red, green, blue },
  };
}

async function runSingleProbe(options: ProbeOptions): Promise<SingleProbeResult> {
  assert(typeof options.outputPath === "string" && options.outputPath.length > 0, "outputPath is required");
  const outputPath = options.outputPath.replaceAll("\\", "/");
  await rm(outputPath, { force: true });

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  assert(context, "Encoder canvas has no 2D context");

  const quality = new Quality({ bitrate: BITRATE, bitrateMode: "variable" });
  const encodingOptions = {
    width: WIDTH,
    height: HEIGHT,
    quality,
    fullCodecString: FULL_CODEC_STRING,
    hardwareAcceleration: "no-preference" as const,
    latencyMode: "quality" as const,
  };
  const capability = await canEncodeVideo(CODEC, encodingOptions);
  assert(capability, `${FULL_CODEC_STRING} encoding is not supported by this Obsidian renderer`);

  const source = new CanvasSource(canvas, {
    codec: CODEC,
    quality,
    fullCodecString: FULL_CODEC_STRING,
    keyFrameInterval: 2,
    sizeChangeBehavior: "deny",
    hardwareAcceleration: "no-preference",
    latencyMode: "quality",
  });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "reserve" }),
    target: new FilePathTarget(outputPath),
  });
  output.addVideoTrack(source, {
    frameRate: FRAME_RATE,
    maximumPacketCount: FRAME_COUNT,
  });

  const encodeStartedAt = performance.now();
  try {
    await output.start();
    for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
      paintQualificationFrame(context, frameIndex);
      await source.add(frameIndex / FRAME_RATE, 1 / FRAME_RATE, {
        keyFrame: frameIndex % 60 === 0,
      });
    }
    await output.finalize();
  } catch (error) {
    if (output.state === "started" || output.state === "finalizing") {
      await output.cancel().catch(() => undefined);
    }
    throw error;
  }
  const encodeMilliseconds = performance.now() - encodeStartedAt;

  const bytes = new Uint8Array(await readFile(outputPath));
  const fileStats = await stat(outputPath);
  assert(bytes.byteLength > 0 && fileStats.size === bytes.byteLength, "MP4 output is empty or truncated");
  const boxes = topLevelBoxOffsets(bytes);
  assert(Number.isInteger(boxes.ftyp), "MP4 has no top-level ftyp box");
  assert(Number.isInteger(boxes.moov), "MP4 has no top-level moov box");
  assert(Number.isInteger(boxes.mdat), "MP4 has no top-level mdat box");
  assert(boxes.moov < boxes.mdat, "MP4 fast-start gate failed: moov must precede mdat");

  const input = new Input({ formats: [MP4], source: new FilePathSource(outputPath) });
  try {
    assert(await input.canRead(), "Mediabunny cannot read its finalized MP4");
    assert((await input.getFormat()) === MP4, "Finalized file is not detected as MP4");
    const videoTracks = await input.getVideoTracks();
    const audioTracks = await input.getAudioTracks();
    assert(videoTracks.length === 1, `Expected one video track, got ${videoTracks.length}`);
    assert(audioTracks.length === 0, `Expected no audio tracks, got ${audioTracks.length}`);
    const videoTrack = videoTracks[0];
    const codec = await videoTrack.getCodec();
    const codecParameterString = await videoTrack.getCodecParameterString();
    const codedWidth = await videoTrack.getCodedWidth();
    const codedHeight = await videoTrack.getCodedHeight();
    const duration = await videoTrack.computeDuration();
    const packetStats = await videoTrack.computePacketStats();
    const decoderConfig = await videoTrack.getDecoderConfig();
    const canDecode = await videoTrack.canDecode();

    assert(codec === CODEC, `Expected AVC codec, got ${String(codec)}`);
    assert(codecParameterString?.startsWith("avc1."), `Expected avc1 codec string, got ${String(codecParameterString)}`);
    assert(codedWidth === WIDTH && codedHeight === HEIGHT, `Expected ${WIDTH}x${HEIGHT}, got ${codedWidth}x${codedHeight}`);
    assert(Math.abs(duration - DURATION_SECONDS) <= 1 / FRAME_RATE, `Expected 2-second duration, got ${duration}`);
    assert(packetStats.packetCount === FRAME_COUNT, `Expected ${FRAME_COUNT} packets, got ${packetStats.packetCount}`);
    assert(Math.abs(packetStats.averagePacketRate - FRAME_RATE) <= 0.01, `Expected 30fps, got ${packetStats.averagePacketRate}`);
    assert(canDecode, "The Obsidian renderer reports that the resulting AVC track is not decodable");
    assert(decoderConfig, "The AVC track has no decoder configuration");

    const packetSink = new EncodedPacketSink(videoTrack);
    let keyPacketCount = 0;
    let packetCount = 0;
    for await (const packet of packetSink.packets(undefined, undefined, { verifyKeyPackets: true })) {
      packetCount += 1;
      if (packet.type === "key") keyPacketCount += 1;
    }
    assert(packetCount === FRAME_COUNT, `Packet iterator expected ${FRAME_COUNT}, got ${packetCount}`);
    assert(keyPacketCount >= 1, "Encoded MP4 has no verified key packet");

    const canvasSink = new CanvasSink(videoTrack, {
      width: WIDTH,
      height: HEIGHT,
      fit: "fill",
      poolSize: 1,
    });
    const decodedFrames = [];
    for (const [timestamp, label] of [
      [0, "first"],
      [1, "middle"],
      [(FRAME_COUNT - 1) / FRAME_RATE, "last"],
    ] as const) {
      decodedFrames.push({ label, ...(await decodeEvidence(canvasSink, timestamp, label)) });
    }

    return {
      schemaVersion: 1,
      encoding: {
        codec: CODEC,
        fullCodecString: FULL_CODEC_STRING,
        width: WIDTH,
        height: HEIGHT,
        frameRate: FRAME_RATE,
        frameCount: FRAME_COUNT,
        durationSeconds: DURATION_SECONDS,
        bitrate: BITRATE,
        bitrateMode: "variable",
        keyFrameIntervalFrames: 60,
        fastStart: "reserve",
        capability,
        encodeMilliseconds,
      },
      output: {
        path: outputPath,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        topLevelBoxOffsets: boxes,
      },
      parsed: {
        format: "mp4",
        codec,
        codecParameterString,
        codedWidth,
        codedHeight,
        durationSeconds: duration,
        packetStats,
        keyPacketCount,
        audioTrackCount: audioTracks.length,
        decoderConfig,
        canDecode,
      },
      decodedFrames,
    };
  } finally {
    input.dispose();
  }
}

function repeatOutputPath(outputPath: string): string {
  return /\.mp4$/iu.test(outputPath)
    ? outputPath.replace(/\.mp4$/iu, ".repeat.mp4")
    : `${outputPath}.repeat.mp4`;
}

async function runProbe(options: ProbeOptions): Promise<Record<string, unknown>> {
  const first = await runSingleProbe(options);
  const second = await runSingleProbe({
    outputPath: repeatOutputPath(options.outputPath),
  });
  const secondFrames = new Map(second.decodedFrames.map((frame) => [frame.label, frame]));
  const decodedFrames = first.decodedFrames.map((firstFrame) => {
    const secondFrame = secondFrames.get(firstFrame.label);
    assert(secondFrame, `Repeat run has no ${firstFrame.label} decoded frame`);
    const exactMatch = firstFrame.rgbaSha256 === secondFrame.rgbaSha256;
    assert(exactMatch, `${firstFrame.label}: repeated decoded RGBA hash changed`);
    return {
      label: firstFrame.label,
      firstRgbaSha256: firstFrame.rgbaSha256,
      secondRgbaSha256: secondFrame.rgbaSha256,
      exactMatch,
    };
  });
  assert(decodedFrames.length === 3, `Expected three repeated decode samples, got ${decodedFrames.length}`);

  return {
    ...first,
    schemaVersion: 2,
    repeatability: {
      runs: 2,
      bitstream: {
        firstBytes: first.output.bytes,
        firstSha256: first.output.sha256,
        secondBytes: second.output.bytes,
        secondSha256: second.output.sha256,
        identical: first.output.sha256 === second.output.sha256,
        exactMatchRequired: false,
      },
      decodedRgba: {
        sampleLabels: ["first", "middle", "last"],
        exactMatchRequired: true,
        allMatch: decodedFrames.every((frame) => frame.exactMatch),
        frames: decodedFrames,
      },
      secondOutput: second.output,
    },
  };
}

async function qualification(options: ProbeOptions): Promise<ProbeEnvelope> {
  try {
    return { ok: true, result: await runProbe(options) };
  } catch (error) {
    let outputRemoved = false;
    try {
      await Promise.all([
        rm(options.outputPath, { force: true }),
        rm(repeatOutputPath(options.outputPath), { force: true }),
      ]);
      outputRemoved = true;
    } catch {
      outputRemoved = false;
    }
    const normalized = error instanceof Error ? error : new Error(String(error));
    return {
      ok: false,
      error: {
        name: normalized.name,
        message: normalized.message,
        stack: normalized.stack ?? null,
      },
      outputRemoved,
    };
  }
}

Object.defineProperty(globalThis, "__achmageRunVideoCodecQualification", {
  configurable: true,
  enumerable: false,
  value: qualification,
  writable: false,
});
