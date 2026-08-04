import assert from "node:assert/strict";
import { open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  VIDEO_AVC_CODEC,
  VIDEO_AVC_FULL_CODEC_STRING,
  VIDEO_KEYFRAME_INTERVAL_FRAMES,
  VIDEO_TARGET_BITRATE,
  encodeVideoToPartialFile,
  isVideoExportAbort,
  probeVideoEncoderCapability,
  validateVideoMp4,
  type VideoEncodeProgressV1,
} from "../video/videoEncoder";
import {
  VideoOutputCommitError,
  createVideoOutputTransaction,
  videoOutputCandidates,
  type VideoOutputFileOps,
} from "../video/videoOutputPath";

let assertions = 0;

function check(value: unknown, message: string): asserts value {
  assertions += 1;
  assert.ok(value, message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.equal(actual, expected, message);
}

async function rejects(
  action: () => Promise<unknown>,
  predicate: (error: unknown) => boolean,
  message: string
): Promise<void> {
  assertions += 1;
  await assert.rejects(action, predicate, message);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function createDefaultLikeOps(
  linkOverride?: VideoOutputFileOps["link"]
): Promise<VideoOutputFileOps> {
  const fileSystem = await import("node:fs/promises");
  return {
    async createExclusive(path): Promise<void> {
      const handle = await open(path, "wx");
      await handle.close();
    },
    stat,
    link: linkOverride ?? fileSystem.link,
    unlink,
  };
}

async function testOutputPaths(root: string): Promise<void> {
  const notePath = join(root, "긴 발표 자료 🎬.md");
  await writeFile(notePath, "# Deck\n");
  const candidates = videoOutputCandidates(notePath);
  equal(candidates.next().value, join(root, "긴 발표 자료 🎬.slides.mp4"), "first candidate");
  equal(candidates.next().value, join(root, "긴 발표 자료 🎬.slides-2.mp4"), "second candidate");
  equal(candidates.next().value, join(root, "긴 발표 자료 🎬.slides-3.mp4"), "third candidate");

  const dropboxLikePath = join(
    root,
    "Dropbox",
    "= Ach's Obsidian",
    "아주 긴 발표 자료 이름 ".repeat(5).trimEnd() + ".md"
  );
  const dropboxCandidate = videoOutputCandidates(dropboxLikePath).next().value;
  check(dropboxCandidate.includes(join("Dropbox", "= Ach's Obsidian")), "Dropbox-style path retained");
  check(dropboxCandidate.endsWith(".slides.mp4"), "long spaced CJK basename receives MP4 suffix");

  let readOnlyLinkAttempted = false;
  await rejects(
    () => createVideoOutputTransaction(notePath, {
      fileOps: {
        async createExclusive(): Promise<void> {
          throw Object.assign(new Error("read-only filesystem"), { code: "EACCES" });
        },
        stat,
        async link(): Promise<void> {
          readOnlyLinkAttempted = true;
        },
        unlink,
      },
    }),
    (error) => error instanceof Error && "code" in error && error.code === "EACCES",
    "read-only destination fails before a partial or final is published"
  );
  check(!readOnlyLinkAttempted, "read-only path never reaches publication");

  const first = await createVideoOutputTransaction(notePath);
  check(first.partialPath.startsWith(join(root, ".긴 발표 자료 🎬.slides-")), "same-dir partial");
  await writeFile(first.partialPath, "first-mp4");
  const firstFinal = await first.commit();
  equal(firstFinal, join(root, "긴 발표 자료 🎬.slides.mp4"), "first commit name");
  equal(await readFile(firstFinal, "utf8"), "first-mp4", "first commit bytes");
  check(!(await exists(first.partialPath)), "successful commit removes partial link");

  const second = await createVideoOutputTransaction(notePath);
  await writeFile(second.partialPath, "second-mp4");
  const secondFinal = await second.commit();
  equal(secondFinal, join(root, "긴 발표 자료 🎬.slides-2.mp4"), "collision suffix");
  equal(await readFile(firstFinal, "utf8"), "first-mp4", "existing final preserved");

  const concurrent = await Promise.all(
    ["three", "four", "five"].map(async (contents) => {
      const transaction = await createVideoOutputTransaction(notePath);
      await writeFile(transaction.partialPath, contents);
      return transaction;
    })
  );
  const concurrentFinals = await Promise.all(concurrent.map((transaction) => transaction.commit()));
  equal(new Set(concurrentFinals).size, 3, "concurrent commits allocate unique names");
  equal(concurrentFinals.sort()[0], join(root, "긴 발표 자료 🎬.slides-3.mp4"), "first concurrent suffix");

  const canceled = await createVideoOutputTransaction(notePath);
  await writeFile(canceled.partialPath, "cancel-me");
  await canceled.cleanup();
  check(!(await exists(canceled.partialPath)), "cancel cleanup removes partial");
  await canceled.cleanup();
  assertions += 1; // cleanup is idempotent

  const empty = await createVideoOutputTransaction(notePath);
  await rejects(
    () => empty.commit(),
    (error) => error instanceof VideoOutputCommitError && /empty/.test(error.message),
    "empty partial cannot be published"
  );
  await empty.cleanup();

  const unsupported = await createVideoOutputTransaction(notePath, {
    fileOps: await createDefaultLikeOps(async () => {
      throw Object.assign(new Error("hard links unavailable"), { code: "EXDEV" });
    }),
  });
  await writeFile(unsupported.partialPath, "unsupported");
  await rejects(
    () => unsupported.commit(),
    (error) =>
      error instanceof VideoOutputCommitError &&
      error.code === "EXDEV" &&
      /no overwrite-prone rename or copy fallback/.test(error.message),
    "unsupported hard link fails closed"
  );
  check(await exists(unsupported.partialPath), "failed publish leaves private partial for cleanup");
  await unsupported.cleanup();
  check(!(await exists(unsupported.partialPath)), "failed publish partial is cleanable");

  const actualOps = await createDefaultLikeOps();
  let failPrivateUnlinkOnce = true;
  const cleanupAfterPublish = await createVideoOutputTransaction(notePath, {
    fileOps: {
      ...actualOps,
      async unlink(path): Promise<void> {
        if (failPrivateUnlinkOnce) {
          failPrivateUnlinkOnce = false;
          throw Object.assign(new Error("temporary unlink failure"), { code: "EACCES" });
        }
        await actualOps.unlink(path);
      },
    },
  });
  await writeFile(cleanupAfterPublish.partialPath, "published-once");
  let publishedPath: string | null = null;
  await rejects(
    () => cleanupAfterPublish.commit(),
    (error) => {
      if (!(error instanceof VideoOutputCommitError) || !error.committedPath) return false;
      publishedPath = error.committedPath;
      return /was published/.test(error.message);
    },
    "post-publication partial cleanup failure reports committed final"
  );
  check(typeof publishedPath === "string" && await exists(publishedPath), "published final remains available");
  check(await exists(cleanupAfterPublish.partialPath), "failed private unlink leaves only partial link");
  await cleanupAfterPublish.cleanup();
  check(!(await exists(cleanupAfterPublish.partialPath)), "retry cleanup removes published partial link");
  check(typeof publishedPath === "string" && await exists(publishedPath), "cleanup never removes final link");

  await rejects(
    () => createVideoOutputTransaction("relative-note.md"),
    (error) => error instanceof TypeError && /absolute/.test(error.message),
    "relative note path rejected"
  );
}

async function testEncoder(root: string): Promise<void> {
  const capability = await probeVideoEncoderCapability();
  equal(capability.supported, true, "exact AVC capability supported by acceptance backend");
  equal(capability.codec, VIDEO_AVC_CODEC, "capability codec");
  equal(capability.fullCodecString, VIDEO_AVC_FULL_CODEC_STRING, "requested full codec string");
  equal(capability.bitrate, VIDEO_TARGET_BITRATE, "target bitrate");
  equal(VIDEO_KEYFRAME_INTERVAL_FRAMES, 60, "keyframe interval contract");

  const outputPath = join(root, ".encoder.partial.mp4");
  const progress: VideoEncodeProgressV1[] = [];
  const rendered: number[] = [];
  const canvas = { width: 1920, height: 1080 } as HTMLCanvasElement;
  const encoded = await encodeVideoToPartialFile({
    outputPath,
    canvas,
    totalFrames: 125,
    yieldEveryFrames: 1,
    async renderFrame(frameIndex, signal): Promise<void> {
      check(!signal?.aborted, `render frame ${frameIndex} is not aborted`);
      rendered.push(frameIndex);
    },
    onProgress(value): void {
      progress.push(value);
    },
  });
  equal(encoded.totalFrames, 125, "encoded frame count");
  equal(encoded.durationSeconds, 125 / 30, "encoded duration");
  check(encoded.bytes > 0, "partial has bytes");
  equal(rendered.length, 125, "render callback once per frame");
  equal(progress[0].ratio, 0, "progress begins at zero");
  equal(progress.at(-1)?.ratio, 1, "progress ends at one");
  for (let index = 1; index < progress.length; index += 1) {
    check(progress[index].ratio >= progress[index - 1].ratio, "progress monotonic");
  }

  const encodedContract = JSON.parse(await readFile(outputPath, "utf8")) as {
    config: Record<string, unknown>;
    format: Record<string, unknown>;
    track: Record<string, unknown>;
    frames: Array<{ timestamp: number; duration: number; keyFrame: boolean }>;
  };
  equal(encodedContract.config.codec, "avc", "CanvasSource codec");
  equal(encodedContract.config.fullCodecString, "avc1.640028", "CanvasSource full codec");
  equal(encodedContract.config.keyFrameInterval, 2, "two-second keyframe hint");
  equal(encodedContract.format.fastStart, "reserve", "reserved fast-start metadata");
  equal(encodedContract.track.frameRate, 30, "track frame rate");
  equal(encodedContract.track.maximumPacketCount, 125, "track maximum packet count");
  equal(encodedContract.frames.length, 125, "source add count");
  equal(encodedContract.frames[0].timestamp, 0, "first timestamp");
  equal(encodedContract.frames[124].timestamp, 124 / 30, "last timestamp");
  equal(encodedContract.frames[0].duration, 1 / 30, "frame duration");
  equal(encodedContract.frames[0].keyFrame, true, "first keyframe");
  equal(encodedContract.frames[59].keyFrame, false, "frame 59 delta");
  equal(encodedContract.frames[60].keyFrame, true, "frame 60 keyframe");
  equal(encodedContract.frames[120].keyFrame, true, "frame 120 keyframe");

  const validation = await validateVideoMp4({ path: outputPath, totalFrames: 125 });
  equal(validation.codec, "avc", "parsed AVC codec");
  // Chromium is allowed to raise requested avc1.640028 to 640032 at 1080p.
  equal(validation.codecParameterString, "avc1.640032", "compatible AVC level raise accepted");
  equal(validation.codedWidth, 1920, "parsed coded width");
  equal(validation.codedHeight, 1080, "parsed coded height");
  equal(validation.packetCount, 125, "parsed packet count");
  equal(validation.averagePacketRate, 30, "parsed frame rate");
  equal(validation.audioTrackCount, 0, "silent MP4 has zero audio tracks");
  assert.deepEqual(validation.keyPacketIndices, [0, 60, 120], "verified keyframe indices");
  assertions += 1;
  assert.deepEqual(validation.decodedFrames.map((frame) => frame.frameIndex), [0, 62, 124]);
  assertions += 1;
  validation.decodedFrames.forEach((frame) => equal(frame.rgbaSha256.length, 64, "decoded RGBA hash"));

  await rejects(
    () =>
      encodeVideoToPartialFile({
        outputPath: join(root, ".wrong-size.partial.mp4"),
        canvas: { width: 1280, height: 720 } as HTMLCanvasElement,
        totalFrames: 1,
        renderFrame: () => undefined,
      }),
    (error) => error instanceof RangeError && /1920x1080/.test(error.message),
    "wrong canvas size rejected"
  );

  const abortController = new AbortController();
  const abortPath = join(root, ".abort.partial.mp4");
  await rejects(
    () =>
      encodeVideoToPartialFile({
        outputPath: abortPath,
        canvas,
        totalFrames: 20,
        signal: abortController.signal,
        renderFrame(frameIndex): void {
          if (frameIndex === 3) abortController.abort();
        },
      }),
    isVideoExportAbort,
    "abort stops encoding"
  );
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "achmage-video-encoder-"));
  try {
    await testOutputPaths(root);
    await testEncoder(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log(`Video encoder acceptance PASS (${assertions} assertions)`);
}

await main();
