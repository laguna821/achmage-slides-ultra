import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, "build", "test", "video-encoder-acceptance");
const outfile = join(outdir, "video-encoder-acceptance.mjs");
const stub = join(outdir, "mediabunny-stub.mjs");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await writeFile(
  stub,
  String.raw`
export const MP4 = Object.freeze({ name: "MP4" });

export class Quality {
  constructor(options) { this.options = options; }
}

export async function canEncodeVideo(codec, options) {
  if (codec !== "avc") throw new Error("unexpected capability codec");
  if (options.width !== 1920 || options.height !== 1080) throw new Error("unexpected capability size");
  if (options.fullCodecString !== "avc1.640028") throw new Error("unexpected capability string");
  if (options.quality.options.bitrate !== 8000000) throw new Error("unexpected capability bitrate");
  if (options.quality.options.bitrateMode !== "variable") throw new Error("unexpected bitrate mode");
  if (options.latencyMode !== "quality") throw new Error("unexpected latency mode");
  return true;
}

export class CanvasSource {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = { ...config, quality: config.quality.options };
    this.frames = [];
  }
  async add(timestamp, duration, options) {
    await Promise.resolve();
    this.frames.push({ timestamp, duration, keyFrame: options?.keyFrame === true });
  }
}

export class StreamTarget {
  constructor(writable, options) {
    if (options?.chunked !== true) throw new Error("StreamTarget must be chunked");
    this.writable = writable;
  }
}

export class CustomSource {
  constructor(options) { this.options = options; }
}

export class Mp4OutputFormat {
  constructor(options) { this.options = options; }
}

export class Output {
  constructor(options) {
    this.format = options.format;
    this.target = options.target;
    this.state = "pending";
  }
  addVideoTrack(source, metadata) {
    this.source = source;
    this.metadata = metadata;
  }
  async start() { this.state = "started"; }
  async cancel() { this.state = "canceled"; }
  async finalize() {
    this.state = "finalizing";
    const bytes = new TextEncoder().encode(JSON.stringify({
      config: this.source.config,
      format: this.format.options,
      track: this.metadata,
      frames: this.source.frames,
    }));
    const writer = this.target.writable.getWriter();
    await writer.write({ type: "write", data: bytes, position: 0 });
    await writer.close();
    this.state = "finalized";
  }
}

class FakeTrack {
  constructor(record) { this.record = record; }
  async getCodec() { return "avc"; }
  async getCodecParameterString() { return "avc1.640032"; }
  async getCodedWidth() { return 1920; }
  async getCodedHeight() { return 1080; }
  async getDisplayWidth() { return 1920; }
  async getDisplayHeight() { return 1080; }
  async getRotation() { return 0; }
  async computeDuration() { return this.record.frames.length / 30; }
  async computePacketStats() {
    return { packetCount: this.record.frames.length, averagePacketRate: 30, averageBitrate: 8000000 };
  }
  async getDecoderConfig() { return { codec: "avc1.640032", codedWidth: 1920, codedHeight: 1080 }; }
  async canDecode() { return true; }
}

export class Input {
  constructor(options) {
    this.source = options.source;
    this.disposed = false;
  }
  async load() {
    if (!this.record) {
      const size = await this.source.options.getSize();
      const bytes = await this.source.options.read(0, size);
      this.record = JSON.parse(new TextDecoder().decode(bytes));
    }
  }
  async canRead() { await this.load(); return true; }
  async getFormat() { return MP4; }
  async getVideoTracks() { await this.load(); return [new FakeTrack(this.record)]; }
  async getAudioTracks() { return []; }
  dispose() { this.disposed = true; }
}

export class EncodedPacketSink {
  constructor(track) { this.track = track; }
  async *packets() {
    for (let index = 0; index < this.track.record.frames.length; index += 1) {
      yield { type: index % 60 === 0 ? "key" : "delta" };
    }
  }
}

const pixels = new Uint8ClampedArray(1920 * 1080 * 4);
for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;

export class CanvasSink {
  constructor(track) { this.track = track; }
  async getCanvas(timestamp) {
    const frameIndex = Math.min(this.track.record.frames.length - 1, Math.floor(timestamp * 30 + 1e-6));
    pixels[0] = frameIndex % 256;
    return {
      canvas: {
        width: 1920,
        height: 1080,
        getContext() {
          return { getImageData() { return { data: pixels }; } };
        },
      },
      timestamp: frameIndex / 30,
      duration: 1 / 30,
    };
  }
}
`,
  "utf8"
);

await build({
  entryPoints: [join(root, "src", "tests", "videoEncoderAcceptance.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile,
  sourcemap: "inline",
  plugins: [
    {
      name: "mediabunny-stub",
      setup(bundle) {
        bundle.onResolve({ filter: /^mediabunny$/ }, () => ({ path: stub }));
      },
    },
  ],
});

const result = spawnSync(process.execPath, [outfile], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
