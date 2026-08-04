import assert from "node:assert/strict";
import { lstat, open, readFile, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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
  type VideoOutputTransaction,
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
    async openExclusive(path) {
      const handle = await open(path, "wx+");
      return {
        stat: () => handle.stat({ bigint: true }),
        write: async (buffer, offset, length, position) => {
          const result = await handle.write(buffer, offset, length, position);
          return { bytesWritten: result.bytesWritten };
        },
        read: async (buffer, offset, length, position) => {
          const result = await handle.read(buffer, offset, length, position);
          return { bytesRead: result.bytesRead };
        },
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    },
    lstat: path => lstat(path, { bigint: true }),
    link: linkOverride ?? fileSystem.link,
    unlink,
  };
}

async function writeTransaction(
  transaction: VideoOutputTransaction,
  contents: string,
  seal: boolean = true
): Promise<void> {
  await transaction.writeAt(new TextEncoder().encode(contents), 0);
  await transaction.sync();
  if (seal) {
    const beforeValidation = await transaction.captureContentSeal();
    await transaction.sealVerifiedContent(beforeValidation);
  }
}

async function readTransaction(transaction: VideoOutputTransaction): Promise<string> {
  const size = await transaction.getSize();
  return new TextDecoder().decode(await transaction.readRange(0, size));
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function createDeferred(): Deferred {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>(resolve => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(): void {
      resolvePromise?.();
    },
  };
}

async function testValidationSetupCancellation(): Promise<void> {
  for (const blockedPhase of ["sync", "identity", "size"] as const) {
    const entered = createDeferred();
    const release = createDeferred();
    const abort = new AbortController();
    const calls = { sync: 0, identity: 0, size: 0, read: 0 };
    const block = async (phase: typeof blockedPhase): Promise<void> => {
      if (blockedPhase !== phase) return;
      entered.resolve();
      await release.promise;
    };
    const output: VideoOutputTransaction = {
      partialPath: `C:\\validation-${blockedPhase}.partial.mp4`,
      writeAt: async () => undefined,
      async readRange(): Promise<Uint8Array> {
        calls.read += 1;
        return new Uint8Array([1]);
      },
      async getSize(): Promise<number> {
        calls.size += 1;
        await block("size");
        return 1;
      },
      async sync(): Promise<void> {
        calls.sync += 1;
        await block("sync");
      },
      async assertIdentity(): Promise<void> {
        calls.identity += 1;
        await block("identity");
      },
      async captureContentSeal(): Promise<never> {
        throw new Error("validation must abort before content hashing");
      },
      async sealVerifiedContent(): Promise<never> {
        throw new Error("validation must abort before content sealing");
      },
      commit: async () => "unreachable.mp4",
      cleanup: async () => undefined,
    };

    const validation = validateVideoMp4({
      output,
      totalFrames: 1,
      signal: abort.signal,
    });
    await entered.promise;
    abort.abort();
    release.resolve();
    await rejects(
      () => validation,
      isVideoExportAbort,
      `abort during validation ${blockedPhase} setup stops before Mediabunny parsing`
    );
    equal(calls.sync, 1, `${blockedPhase} setup performs one sync at most`);
    equal(
      calls.identity,
      blockedPhase === "sync" ? 0 : 1,
      `${blockedPhase} abort does not enter a later identity check`
    );
    equal(
      calls.size,
      blockedPhase === "size" ? 1 : 0,
      `${blockedPhase} abort does not enter a later size read`
    );
    equal(calls.read, 0, `${blockedPhase} abort never starts MP4 parsing reads`);
  }
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
        async openExclusive(): Promise<never> {
          throw Object.assign(new Error("read-only filesystem"), { code: "EACCES" });
        },
        async lstat(): Promise<never> {
          throw new Error("unreachable");
        },
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
  check(first.partialPath.startsWith(join(root, ".achmage-video-")), "same-dir private partial");
  await writeTransaction(first, "first-mp4");
  const firstFinal = await first.commit();
  equal(firstFinal, join(root, "긴 발표 자료 🎬.slides.mp4"), "first commit name");
  equal(await readFile(firstFinal, "utf8"), "first-mp4", "first commit bytes");
  check(!(await exists(first.partialPath)), "successful commit removes partial link");

  const nearLimitStem = "l".repeat(244);
  const nearLimitNotePath = join(root, `${nearLimitStem}.md`);
  await writeFile(nearLimitNotePath, "# Near component limit\n");
  const nearLimit = await createVideoOutputTransaction(nearLimitNotePath, {
    randomId: () => "component-safe",
  });
  equal(
    basename(nearLimit.partialPath),
    ".achmage-video-component-safe.partial.mp4",
    "private partial does not repeat a near-limit note stem"
  );
  check(basename(nearLimit.partialPath).length <= 255, "private partial fits one filename component");
  await writeTransaction(nearLimit, "near-limit-mp4");
  const nearLimitFinal = await nearLimit.commit();
  equal(
    nearLimitFinal,
    join(root, `${nearLimitStem}.slides.mp4`),
    "255-character final basename remains publishable"
  );
  equal(await readFile(nearLimitFinal, "utf8"), "near-limit-mp4", "near-limit final bytes");

  const nearLimitCollision = await createVideoOutputTransaction(nearLimitNotePath, {
    randomId: () => "component-safe-second",
  });
  await writeTransaction(nearLimitCollision, "near-limit-second-mp4");
  const nearLimitSecondFinal = await nearLimitCollision.commit();
  const nearLimitCandidates = videoOutputCandidates(nearLimitNotePath);
  nearLimitCandidates.next();
  equal(
    nearLimitSecondFinal,
    nearLimitCandidates.next().value,
    "near-limit collision uses the deterministic bounded second candidate"
  );
  check(basename(nearLimitSecondFinal).endsWith(".slides-2.mp4"), "bounded collision suffix retained");
  check(basename(nearLimitSecondFinal).length <= 255, "bounded collision fits UTF-16 component limit");
  check(
    new TextEncoder().encode(basename(nearLimitSecondFinal)).byteLength <= 255,
    "bounded collision fits UTF-8 component limit"
  );
  equal(
    await readFile(nearLimitSecondFinal, "utf8"),
    "near-limit-second-mp4",
    "near-limit collision bytes"
  );

  const second = await createVideoOutputTransaction(notePath);
  await writeTransaction(second, "second-mp4");
  const secondFinal = await second.commit();
  equal(secondFinal, join(root, "긴 발표 자료 🎬.slides-2.mp4"), "collision suffix");
  equal(await readFile(firstFinal, "utf8"), "first-mp4", "existing final preserved");

  const concurrent = await Promise.all(
    ["three", "four", "five"].map(async (contents) => {
      const transaction = await createVideoOutputTransaction(notePath);
      await writeTransaction(transaction, contents);
      return transaction;
    })
  );
  const concurrentFinals = await Promise.all(concurrent.map((transaction) => transaction.commit()));
  equal(new Set(concurrentFinals).size, 3, "concurrent commits allocate unique names");
  equal(concurrentFinals.sort()[0], join(root, "긴 발표 자료 🎬.slides-3.mp4"), "first concurrent suffix");

  const canceled = await createVideoOutputTransaction(notePath);
  await writeTransaction(canceled, "cancel-me");
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

  const unsupportedNotePath = join(root, "unsupported-link.md");
  await writeFile(unsupportedNotePath, "# Unsupported link\n");
  const unsupported = await createVideoOutputTransaction(unsupportedNotePath, {
    fileOps: await createDefaultLikeOps(async () => {
      throw Object.assign(new Error("hard links unavailable"), { code: "EXDEV" });
    }),
  });
  await writeTransaction(unsupported, "unsupported");
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
  const statFailurePath = join(root, ".achmage-video-stat-failure.partial.mp4");
  await rejects(
    () => createVideoOutputTransaction(join(root, "stat-failure.md"), {
      randomId: () => "stat-failure",
      fileOps: {
        ...actualOps,
        async openExclusive(path) {
          const handle = await actualOps.openExclusive(path);
          return {
            ...handle,
            async stat(): Promise<never> {
              throw Object.assign(new Error("initial stat unavailable"), { code: "EIO" });
            },
          };
        },
      },
    }),
    (error) =>
      error instanceof VideoOutputCommitError &&
      error.partialPath === statFailurePath &&
      /inspect that exact path/i.test(error.message),
    "initial partial stat failure reports the exact untouched path"
  );
  check(await exists(statFailurePath), "unowned initial-stat failure path remains for explicit inspection");
  await unlink(statFailurePath);

  const postLinkNotePath = join(root, "post-link-error.md");
  await writeFile(postLinkNotePath, "# Post-link error\n");
  const postLinkError = await createVideoOutputTransaction(postLinkNotePath, {
    fileOps: {
      ...actualOps,
      async link(existingPath, newPath): Promise<void> {
        await actualOps.link(existingPath, newPath);
        throw Object.assign(new Error("provider reported failure after link"), { code: "EIO" });
      },
    },
  });
  await writeTransaction(postLinkError, "post-link-original");
  const postLinkCandidate = join(root, "post-link-error.slides.mp4");
  await rejects(
    () => postLinkError.commit(),
    (error) =>
      error instanceof VideoOutputCommitError &&
      error.candidatePath === postLinkCandidate &&
      /was removed/.test(error.message),
    "post-syscall link error records and removes the unverified original candidate"
  );
  check(!(await exists(postLinkCandidate)), "post-syscall error leaves no unreported candidate");
  await postLinkError.cleanup();
  check(!(await exists(postLinkError.partialPath)), "post-syscall error partial remains cleanable");

  const swapAtLinkNotePath = join(root, "swap-at-link.md");
  const swapSentinelPath = join(root, "swap-at-link-sentinel.txt");
  await writeFile(swapAtLinkNotePath, "# Swap at link\n");
  await writeFile(swapSentinelPath, "sentinel-link-bytes");
  const swapAtLink = await createVideoOutputTransaction(swapAtLinkNotePath, {
    fileOps: {
      ...actualOps,
      async link(existingPath, newPath): Promise<void> {
        await actualOps.unlink(existingPath);
        await actualOps.link(swapSentinelPath, existingPath);
        await actualOps.link(existingPath, newPath);
      },
    },
  });
  await writeTransaction(swapAtLink, "retained-original-bytes");
  let unverifiedSwapCandidate: string | null = null;
  await rejects(
    () => swapAtLink.commit(),
    (error) => {
      if (!(error instanceof VideoOutputCommitError) || !error.candidatePath) return false;
      unverifiedSwapCandidate = error.candidatePath;
      return /unverified MP4 candidate remains/.test(error.message);
    },
    "inode swap at link is never reported as a verified publication"
  );
  check(
    typeof unverifiedSwapCandidate === "string" && await exists(unverifiedSwapCandidate),
    "unverified swapped candidate path is explicitly reported"
  );
  equal(await readFile(swapSentinelPath, "utf8"), "sentinel-link-bytes", "swap sentinel bytes preserved");
  await rejects(
    () => swapAtLink.cleanup(),
    (error) =>
      error instanceof VideoOutputCommitError &&
      error.candidatePath === unverifiedSwapCandidate,
    "cleanup refuses to unlink the unknown candidate inode"
  );
  if (unverifiedSwapCandidate) await unlink(unverifiedSwapCandidate);
  await unlink(swapAtLink.partialPath);
  equal(await readFile(swapSentinelPath, "utf8"), "sentinel-link-bytes", "explicit test cleanup preserves sentinel");

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
  await writeTransaction(cleanupAfterPublish, "published-once");
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

  const shortWriteOps: VideoOutputFileOps = {
    ...actualOps,
    async openExclusive(path) {
      const handle = await actualOps.openExclusive(path);
      return {
        ...handle,
        write: (buffer, offset, length, position) =>
          handle.write(buffer, offset, Math.min(length, 3), position),
      };
    },
  };
  const shortWrite = await createVideoOutputTransaction(notePath, {
    fileOps: shortWriteOps,
  });
  await writeTransaction(shortWrite, "abcdefgh");
  await shortWrite.writeAt(new TextEncoder().encode("XYZ"), 2);
  equal(await readTransaction(shortWrite), "abXYZfgh", "short positional writes preserve random-access bytes");
  await shortWrite.cleanup();

  const swapped = await createVideoOutputTransaction(notePath);
  const sentinelPath = join(root, "sentinel.txt");
  await writeFile(sentinelPath, "sentinel-unchanged");
  await unlink(swapped.partialPath);
  let usedSymlink = true;
  try {
    await symlink(sentinelPath, swapped.partialPath, "file");
  } catch (error) {
    const code: unknown = error && typeof error === "object"
      ? (error as { readonly code?: unknown }).code
      : undefined;
    if (code !== "EPERM") {
      throw error;
    }
    usedSymlink = false;
    await writeFile(swapped.partialPath, "replacement-unchanged");
  }
  await writeTransaction(swapped, "retained-handle-bytes", false);
  equal(
    await readFile(sentinelPath, "utf8"),
    "sentinel-unchanged",
    "retained handle never writes through a swapped symlink"
  );
  if (!usedSymlink) {
    equal(
      await readFile(swapped.partialPath, "utf8"),
      "replacement-unchanged",
      "retained handle never writes a replacement inode"
    );
  }
  await rejects(
    () => swapped.commit(),
    (error) =>
      error instanceof VideoOutputCommitError &&
      /(replaced|no longer names)/.test(error.message),
    "symlink or inode-swapped partial fails closed"
  );
  await rejects(
    () => swapped.cleanup(),
    (error) =>
      error instanceof VideoOutputCommitError &&
      /(replaced|no longer names)/.test(error.message),
    "cleanup leaves a replacement directory entry untouched"
  );
  check(await exists(swapped.partialPath), "replacement path remains for explicit owner cleanup");
  await unlink(swapped.partialPath);

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

  const notePath = join(root, "encoder.md");
  await writeFile(notePath, "# Encoder acceptance\n");
  const output = await createVideoOutputTransaction(notePath);
  const progress: VideoEncodeProgressV1[] = [];
  const rendered: number[] = [];
  const canvas = { width: 1920, height: 1080 } as HTMLCanvasElement;
  const encoded = await encodeVideoToPartialFile({
    output,
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

  const encodedContract = JSON.parse(await readTransaction(output)) as {
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

  const validation = await validateVideoMp4({ output, totalFrames: 125 });
  equal(validation.codec, "avc", "parsed AVC codec");
  // Chromium is allowed to raise requested avc1.640028 to 640032 at 1080p.
  equal(validation.codecParameterString, "avc1.640032", "compatible AVC level raise accepted");
  equal(validation.codedWidth, 1920, "parsed coded width");
  equal(validation.codedHeight, 1080, "parsed coded height");
  equal(validation.packetCount, 125, "parsed packet count");
  equal(validation.averagePacketRate, 30, "parsed frame rate");
  equal(validation.audioTrackCount, 0, "silent MP4 has zero audio tracks");
  equal(validation.fileSha256.length, 64, "validated full-file SHA-256 seal");
  assert.deepEqual(validation.keyPacketIndices, [0, 60, 120], "verified keyframe indices");
  assertions += 1;
  assert.deepEqual(validation.decodedFrames.map((frame) => frame.frameIndex), [0, 62, 124]);
  assertions += 1;
  validation.decodedFrames.forEach((frame) => equal(frame.rgbaSha256.length, 64, "decoded RGBA hash"));

  const inPlaceMutation = await open(output.partialPath, "r+");
  try {
    const firstByte = new Uint8Array(1);
    await inPlaceMutation.read(firstByte, 0, 1, 0);
    firstByte[0] ^= 0xff;
    await inPlaceMutation.write(firstByte, 0, 1, 0);
    await inPlaceMutation.sync();
  } finally {
    await inPlaceMutation.close();
  }
  const mutatedCandidate = videoOutputCandidates(notePath).next().value;
  await rejects(
    () => output.commit(),
    (error) =>
      error instanceof VideoOutputCommitError &&
      /could not be verified and was removed/i.test(error.message),
    "same-inode same-length mutation after validation is not published"
  );
  check(!(await exists(mutatedCandidate)), "content-seal mismatch removes the linked candidate");
  check(await exists(output.partialPath), "content-seal mismatch preserves the reported private partial");
  await output.cleanup();

  const wrongSizeOutput = await createVideoOutputTransaction(notePath);
  await rejects(
    () =>
      encodeVideoToPartialFile({
        output: wrongSizeOutput,
        canvas: { width: 1280, height: 720 } as HTMLCanvasElement,
        totalFrames: 1,
        renderFrame: () => undefined,
      }),
    (error) => error instanceof RangeError && /1920x1080/.test(error.message),
    "wrong canvas size rejected"
  );
  await wrongSizeOutput.cleanup();

  const abortController = new AbortController();
  const abortOutput = await createVideoOutputTransaction(notePath);
  await rejects(
    () =>
      encodeVideoToPartialFile({
        output: abortOutput,
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
  await abortOutput.cleanup();
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "achmage-video-encoder-"));
  try {
    await testOutputPaths(root);
    await testEncoder(root);
    await testValidationSetupCancellation();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log(`Video encoder acceptance PASS (${assertions} assertions)`);
}

await main();
