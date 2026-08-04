import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";

const PARTIAL_CREATE_ATTEMPTS = 20;
const FINAL_CANDIDATE_LIMIT = 10_000;
const MAX_FILENAME_COMPONENT = 255;
const OUTPUT_STEM_HASH_HEX = 12;
const CONTENT_HASH_CHUNK_BYTES = 1024 * 1024;

export interface FileStatLike {
  readonly size: bigint;
  readonly dev: bigint;
  readonly ino: bigint;
  readonly nlink: bigint;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface VideoPartialFileHandle {
  stat(): Promise<FileStatLike>;
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): Promise<{ readonly bytesWritten: number }>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): Promise<{ readonly bytesRead: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface VideoOutputFileOps {
  openExclusive(path: string): Promise<VideoPartialFileHandle>;
  lstat(path: string): Promise<FileStatLike>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

function adaptNodeHandle(handle: FileHandle): VideoPartialFileHandle {
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
}

const defaultFileOps: VideoOutputFileOps = {
  async openExclusive(path): Promise<VideoPartialFileHandle> {
    return adaptNodeHandle(await open(path, "wx+"));
  },
  lstat: path => lstat(path, { bigint: true }),
  link,
  unlink,
};

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

export interface VideoOutputTransaction {
  /** Unique same-directory path whose original `wx+` handle remains owned here. */
  readonly partialPath: string;
  /** Positional write used by Mediabunny StreamTarget; never reopens the path. */
  writeAt(data: Uint8Array, position: number): Promise<void>;
  /** Positional read used by Mediabunny CustomSource; never reopens the path. */
  readRange(start: number, end: number): Promise<Uint8Array>;
  /** Current retained-handle size, as a safe JavaScript number. */
  getSize(): Promise<number>;
  /** Flushes retained-handle data without closing it. */
  sync(): Promise<void>;
  /** Verifies retained handle and current partial directory entry still match. */
  assertIdentity(requireNonempty?: boolean): Promise<void>;
  /** Captures a full-file SHA-256+size snapshot through the retained handle. */
  captureContentSeal(signal?: AbortSignal): Promise<VideoOutputContentSeal>;
  /** Rehashes after validation and stores the exact bytes commit is allowed to publish. */
  sealVerifiedContent(
    expected: VideoOutputContentSeal,
    signal?: AbortSignal
  ): Promise<VideoOutputContentSeal>;
  /** Atomically publishes the verified inode at the first free collision-safe name. */
  commit(): Promise<string>;
  /** Closes the retained handle and removes only an identity-matching private partial. */
  cleanup(): Promise<void>;
}

export interface VideoOutputContentSeal {
  readonly bytes: number;
  readonly sha256: string;
}

export class VideoOutputCommitError extends Error {
  readonly code: string | null;
  readonly partialPath: string;
  readonly candidatePath: string | null;
  /** Set only when publication succeeded but private-partial cleanup failed. */
  readonly committedPath: string | null;

  constructor(
    message: string,
    options: {
      code?: string | null;
      partialPath: string;
      candidatePath?: string | null;
      committedPath?: string | null;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "VideoOutputCommitError";
    this.code = options.code ?? null;
    this.partialPath = options.partialPath;
    this.candidatePath = options.candidatePath ?? null;
    this.committedPath = options.committedPath ?? null;
  }
}

export interface CreateVideoOutputTransactionOptions {
  /** Test seam. Product callers use the default retained Node `wx+` handle. */
  readonly fileOps?: VideoOutputFileOps;
  /** Test seam for deterministic partial names. */
  readonly randomId?: () => string;
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function outputAbortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new DOMException("MP4 export was canceled.", "AbortError");
}

function throwIfOutputAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw outputAbortError(signal);
}

function contentSealsEqual(
  left: VideoOutputContentSeal,
  right: VideoOutputContentSeal
): boolean {
  return left.bytes === right.bytes && left.sha256 === right.sha256;
}

function outputStem(noteAbsolutePath: string): { directory: string; stem: string } {
  if (!isAbsolute(noteAbsolutePath)) {
    throw new TypeError("Video output requires an absolute note path.");
  }

  const directory = dirname(noteAbsolutePath);
  const noteName = basename(noteAbsolutePath);
  const extension = extname(noteName);
  const stem = extension ? noteName.slice(0, -extension.length) : noteName;
  if (!stem) throw new TypeError("Video output requires a note filename.");
  return { directory, stem };
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fitsFilenameComponent(value: string): boolean {
  return value.length <= MAX_FILENAME_COMPONENT &&
    utf8ByteLength(value) <= MAX_FILENAME_COMPONENT;
}

function truncateStemToComponentBudget(
  stem: string,
  maxCodeUnits: number,
  maxUtf8Bytes: number
): string {
  let result = "";
  let bytes = 0;
  for (const character of stem) {
    const characterBytes = utf8ByteLength(character);
    if (
      result.length + character.length > maxCodeUnits ||
      bytes + characterBytes > maxUtf8Bytes
    ) {
      break;
    }
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function boundedVideoOutputFilename(stem: string, suffix: number): string {
  const tail = suffix === 1 ? ".slides.mp4" : `.slides-${suffix}.mp4`;
  const preferred = `${stem}${tail}`;
  if (fitsFilenameComponent(preferred)) return preferred;

  const digest = createHash("sha256").update(stem).digest("hex").slice(0, OUTPUT_STEM_HASH_HEX);
  const marker = `-${digest}`;
  const reservedCodeUnits = marker.length + tail.length;
  const reservedBytes = utf8ByteLength(marker) + utf8ByteLength(tail);
  const boundedStem = truncateStemToComponentBudget(
    stem,
    MAX_FILENAME_COMPONENT - reservedCodeUnits,
    MAX_FILENAME_COMPONENT - reservedBytes
  );
  if (!boundedStem) {
    throw new Error("The note filename leaves no safe component space for MP4 output.");
  }
  const filename = `${boundedStem}${marker}${tail}`;
  if (!fitsFilenameComponent(filename)) {
    throw new Error("Could not bound the MP4 output filename to one filesystem component.");
  }
  return filename;
}

/**
 * Yields `note.slides.mp4`, `note.slides-2.mp4`, ... in the note directory.
 * Availability is decided by atomic hard-link creation, not exists-then-rename.
 */
export function* videoOutputCandidates(
  noteAbsolutePath: string
): Generator<string, never, undefined> {
  const { directory, stem } = outputStem(noteAbsolutePath);
  for (let suffix = 1; ; suffix += 1) {
    const filename = boundedVideoOutputFilename(stem, suffix);
    yield join(directory, filename);
  }
}

async function createUniquePartial(
  noteAbsolutePath: string,
  fileOps: VideoOutputFileOps,
  randomId: () => string
): Promise<{
  readonly partialPath: string;
  readonly handle: VideoPartialFileHandle;
  readonly identity: FileIdentity;
}> {
  const { directory } = outputStem(noteAbsolutePath);
  for (let attempt = 0; attempt < PARTIAL_CREATE_ATTEMPTS; attempt += 1) {
    const partialPath = join(directory, `.achmage-video-${randomId()}.partial.mp4`);
    let handle: VideoPartialFileHandle | null = null;
    try {
      handle = await fileOps.openExclusive(partialPath);
      const created = await handle.stat();
      if (!created.isFile() || created.isSymbolicLink()) {
        throw new Error("Exclusive MP4 partial is not a regular file.");
      }
      return {
        partialPath,
        handle,
        identity: { dev: created.dev, ino: created.ino },
      };
    } catch (error) {
      if (handle) {
        let reportedCause = error;
        try {
          await handle.close();
        } catch (closeError) {
          reportedCause = new AggregateError(
            [error, closeError],
            "The allocated MP4 partial could not be verified or closed cleanly."
          );
        }
        throw new VideoOutputCommitError(
          `ASU allocated the private MP4 partial ${partialPath}, but could not verify its initial file identity. It was left untouched because safe ownership could not be established. Fully close Obsidian, inspect that exact path, and remove it only if it is the failed ASU partial.`,
          {
            code: errorCode(error),
            partialPath,
            cause: reportedCause,
          }
        );
      }
      if (errorCode(error) === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique same-directory MP4 partial file.");
}

function sameIdentity(stat: FileStatLike, identity: FileIdentity): boolean {
  return stat.dev === identity.dev && stat.ino === identity.ino;
}

function safeFileSize(stat: FileStatLike): number {
  if (stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("MP4 partial size is outside JavaScript's safe integer range.");
  }
  return Number(stat.size);
}

export async function createVideoOutputTransaction(
  noteAbsolutePath: string,
  options: CreateVideoOutputTransactionOptions = {}
): Promise<VideoOutputTransaction> {
  const fileOps = options.fileOps ?? defaultFileOps;
  const randomId = options.randomId ?? randomUUID;
  const { partialPath, handle, identity } = await createUniquePartial(
    noteAbsolutePath,
    fileOps,
    randomId
  );
  let state: "open" | "linked" | "failed" | "published" | "committed" | "cleaned" = "open";
  let handleOpen = true;
  let committedPath: string | null = null;
  let linkedCandidatePath: string | null = null;
  let verifiedContentSeal: VideoOutputContentSeal | null = null;

  const closeHandle = async (): Promise<void> => {
    if (!handleOpen) return;
    await handle.close();
    handleOpen = false;
  };

  const readHandleStat = async (requireNonempty: boolean): Promise<FileStatLike> => {
    if (!handleOpen) {
      throw new VideoOutputCommitError("The MP4 partial handle is already closed.", {
        partialPath,
        committedPath,
      });
    }
    const value = await handle.stat();
    if (
      !value.isFile() ||
      value.isSymbolicLink() ||
      !sameIdentity(value, identity) ||
      (requireNonempty && value.size <= 0n)
    ) {
      throw new VideoOutputCommitError(
        requireNonempty
          ? "Refusing to publish an empty, replaced, or non-file MP4 partial."
          : "The retained MP4 partial handle changed identity.",
        { partialPath, committedPath }
      );
    }
    return value;
  };

  const readPathStat = async (
    path: string,
    candidatePath: string | null = null
  ): Promise<FileStatLike> => {
    const value = await fileOps.lstat(path).catch((error: unknown) => {
      throw new VideoOutputCommitError("The MP4 partial path is unavailable or was replaced.", {
        code: errorCode(error),
        partialPath,
        candidatePath,
        committedPath,
        cause: error,
      });
    });
    if (!value.isFile() || value.isSymbolicLink() || !sameIdentity(value, identity)) {
      throw new VideoOutputCommitError(
        "The MP4 partial path no longer names its original regular file; no replacement path was touched.",
        { partialPath, candidatePath, committedPath }
      );
    }
    return value;
  };

  const captureRetainedContentSeal = async (
    signal?: AbortSignal
  ): Promise<VideoOutputContentSeal> => {
    throwIfOutputAborted(signal);
    const before = await readHandleStat(true);
    await readPathStat(partialPath);
    const size = safeFileSize(before);
    const hash = createHash("sha256");
    const buffer = new Uint8Array(Math.min(CONTENT_HASH_CHUNK_BYTES, size));
    let position = 0;
    while (position < size) {
      throwIfOutputAborted(signal);
      const length = Math.min(buffer.byteLength, size - position);
      let offset = 0;
      while (offset < length) {
        const result = await handle.read(buffer, offset, length - offset, position + offset);
        if (result.bytesRead <= 0) {
          throw new VideoOutputCommitError(
            "Unexpected end of MP4 partial while computing its content seal.",
            { partialPath, committedPath }
          );
        }
        offset += result.bytesRead;
      }
      hash.update(buffer.subarray(0, length));
      position += length;
    }
    throwIfOutputAborted(signal);
    const after = await readHandleStat(true);
    await readPathStat(partialPath);
    if (safeFileSize(after) !== size) {
      throw new VideoOutputCommitError(
        "The MP4 partial changed size while computing its content seal.",
        { partialPath, committedPath }
      );
    }
    return Object.freeze({ bytes: size, sha256: hash.digest("hex") });
  };

  const removeUnverifiedCandidate = async (): Promise<void> => {
    const candidatePath = linkedCandidatePath;
    if (!candidatePath) return;
    let value: FileStatLike;
    try {
      value = await fileOps.lstat(candidatePath);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        linkedCandidatePath = null;
        return;
      }
      throw new VideoOutputCommitError(
        `An unverified MP4 candidate may remain at ${candidatePath}; its identity could not be inspected, so it was not removed.`,
        {
          code: errorCode(error),
          partialPath,
          candidatePath,
          cause: error,
        }
      );
    }
    if (!value.isFile() || value.isSymbolicLink() || !sameIdentity(value, identity)) {
      throw new VideoOutputCommitError(
        `An unverified MP4 candidate remains at ${candidatePath}. It no longer has the retained partial identity, so ASU left it untouched; inspect that path before removing it. The private partial path was ${partialPath}.`,
        { partialPath, candidatePath }
      );
    }
    await fileOps.unlink(candidatePath).catch((error: unknown) => {
      throw new VideoOutputCommitError(
        `The unverified MP4 candidate at ${candidatePath} has the retained partial identity but could not be removed.`,
        {
          code: errorCode(error),
          partialPath,
          candidatePath,
          cause: error,
        }
      );
    });
    linkedCandidatePath = null;
  };

  const failAfterLink = async (
    candidatePath: string,
    cause: unknown
  ): Promise<never> => {
    state = "failed";
    await removeUnverifiedCandidate();
    throw new VideoOutputCommitError(
      `The MP4 hard link at ${candidatePath} could not be verified and was removed; no final video was published.`,
      {
        code: errorCode(cause),
        partialPath,
        candidatePath,
        cause,
      }
    );
  };

  const transaction: VideoOutputTransaction = {
    partialPath,
    async writeAt(data, position): Promise<void> {
      if (state !== "open" || !handleOpen) {
        throw new Error("The MP4 output transaction is not writable.");
      }
      if (!Number.isSafeInteger(position) || position < 0) {
        throw new RangeError("MP4 positional write requires a non-negative safe offset.");
      }
      verifiedContentSeal = null;
      let offset = 0;
      while (offset < data.byteLength) {
        const result = await handle.write(
          data,
          offset,
          data.byteLength - offset,
          position + offset
        );
        if (result.bytesWritten <= 0) {
          throw new Error("MP4 positional write made no progress.");
        }
        offset += result.bytesWritten;
      }
    },
    async readRange(start, end): Promise<Uint8Array> {
      if (!handleOpen) throw new Error("The MP4 partial handle is closed.");
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end <= start
      ) {
        throw new RangeError("MP4 positional read requires a valid non-empty range.");
      }
      const data = new Uint8Array(end - start);
      let offset = 0;
      while (offset < data.byteLength) {
        const result = await handle.read(
          data,
          offset,
          data.byteLength - offset,
          start + offset
        );
        if (result.bytesRead <= 0) {
          throw new Error("Unexpected end of MP4 partial during validation.");
        }
        offset += result.bytesRead;
      }
      return data;
    },
    async getSize(): Promise<number> {
      return safeFileSize(await readHandleStat(false));
    },
    async sync(): Promise<void> {
      if (!handleOpen) throw new Error("The MP4 partial handle is closed.");
      await handle.sync();
    },
    async assertIdentity(requireNonempty = false): Promise<void> {
      await readHandleStat(requireNonempty);
      await readPathStat(partialPath);
    },
    async captureContentSeal(signal): Promise<VideoOutputContentSeal> {
      if (state !== "open") {
        throw new VideoOutputCommitError(
          "The MP4 content seal can only be captured before publication.",
          { partialPath, committedPath }
        );
      }
      return captureRetainedContentSeal(signal);
    },
    async sealVerifiedContent(expected, signal): Promise<VideoOutputContentSeal> {
      if (state !== "open") {
        throw new VideoOutputCommitError(
          "The MP4 content can only be sealed before publication.",
          { partialPath, committedPath }
        );
      }
      const actual = await captureRetainedContentSeal(signal);
      if (!contentSealsEqual(actual, expected)) {
        throw new VideoOutputCommitError(
          "The MP4 bytes changed while container validation was running; no video was published.",
          { partialPath, committedPath }
        );
      }
      verifiedContentSeal = actual;
      return actual;
    },
    async commit(): Promise<string> {
      if (state !== "open") {
        throw new VideoOutputCommitError("This MP4 output transaction is no longer open.", {
          partialPath,
          committedPath,
        });
      }

      await handle.sync();
      const handleStat = await readHandleStat(true);
      const pathStat = await readPathStat(partialPath);
      if (handleStat.nlink !== pathStat.nlink || handleStat.nlink !== 1n) {
        throw new VideoOutputCommitError(
          "The MP4 partial acquired an unexpected hard link before publication.",
          { partialPath }
        );
      }
      if (!verifiedContentSeal || verifiedContentSeal.bytes !== safeFileSize(handleStat)) {
        throw new VideoOutputCommitError(
          "Refusing to publish an MP4 without a matching post-validation content seal.",
          { partialPath }
        );
      }

      const candidates = videoOutputCandidates(noteAbsolutePath);
      for (let attempt = 0; attempt < FINAL_CANDIDATE_LIMIT; attempt += 1) {
        const candidatePath = candidates.next().value;
        await readPathStat(partialPath, candidatePath);
        try {
          await fileOps.link(partialPath, candidatePath);
          state = "linked";
          linkedCandidatePath = candidatePath;
        } catch (error) {
          const code = errorCode(error);
          if (code === "EEXIST") continue;
          state = "failed";
          // A wrapper/provider can report an error after the directory entry
          // was created. Probe it so a post-syscall failure never leaves an
          // unreported candidate behind.
          try {
            const candidateStat = await fileOps.lstat(candidatePath);
            if (
              candidateStat.isFile() &&
              !candidateStat.isSymbolicLink() &&
              sameIdentity(candidateStat, identity)
            ) {
              state = "linked";
              linkedCandidatePath = candidatePath;
              return await failAfterLink(candidatePath, error);
            }
            throw new VideoOutputCommitError(
              `Hard-link publication failed and an unknown entry now exists at ${candidatePath}; ASU did not remove or report it as a verified video.`,
              { code, partialPath, candidatePath, cause: error }
            );
          } catch (probeError) {
            if (probeError instanceof VideoOutputCommitError) throw probeError;
            if (errorCode(probeError) !== "ENOENT") {
              throw new VideoOutputCommitError(
                `Hard-link publication failed and ASU could not verify whether ${candidatePath} was created. Inspect that path before retrying.`,
                {
                  code: errorCode(probeError) ?? code,
                  partialPath,
                  candidatePath,
                  cause: probeError,
                }
              );
            }
          }
          throw new VideoOutputCommitError(
            "Could not safely publish the MP4. This filesystem must support same-directory hard links; no overwrite-prone rename or copy fallback was used.",
            {
              code,
              partialPath,
              candidatePath,
              cause: error,
            }
          );
        }

        try {
          const candidateStat = await readPathStat(candidatePath, candidatePath);
          const afterLink = await readHandleStat(true);
          if (candidateStat.nlink < 2n || afterLink.nlink < 2n) {
            throw new VideoOutputCommitError(
              "The linked MP4 candidate did not retain the verified partial identity.",
              { partialPath, candidatePath }
            );
          }
          const linkedContentSeal = await captureRetainedContentSeal();
          if (!contentSealsEqual(linkedContentSeal, verifiedContentSeal)) {
            throw new VideoOutputCommitError(
              "The MP4 bytes changed after validation and before publication.",
              { partialPath, candidatePath }
            );
          }
        } catch (error) {
          return await failAfterLink(candidatePath, error);
        }

        state = "published";
        linkedCandidatePath = null;
        committedPath = candidatePath;
        try {
          await closeHandle();
        } catch (error) {
          throw new VideoOutputCommitError(
            "The MP4 was published, but its retained partial handle could not be closed.",
            {
              code: errorCode(error),
              partialPath,
              candidatePath,
              committedPath: candidatePath,
              cause: error,
            }
          );
        }

        try {
          await readPathStat(partialPath, candidatePath);
          await fileOps.unlink(partialPath);
          state = "committed";
          return candidatePath;
        } catch (error) {
          if (error instanceof VideoOutputCommitError) throw error;
          throw new VideoOutputCommitError(
            "The MP4 was published, but its private partial hard link could not be removed.",
            {
              code: errorCode(error),
              partialPath,
              candidatePath,
              committedPath: candidatePath,
              cause: error,
            }
          );
        }
      }

      throw new VideoOutputCommitError(
        `Could not find a free MP4 filename after ${FINAL_CANDIDATE_LIMIT} atomic attempts.`,
        { partialPath }
      );
    },
    async cleanup(): Promise<void> {
      if (state === "committed" || state === "cleaned") return;
      await closeHandle();

      await removeUnverifiedCandidate();

      let value: FileStatLike;
      try {
        value = await fileOps.lstat(partialPath);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          state = "cleaned";
          return;
        }
        throw error;
      }
      if (!value.isFile() || value.isSymbolicLink() || !sameIdentity(value, identity)) {
        throw new VideoOutputCommitError(
          "The private MP4 partial path was replaced, so cleanup left that unknown path untouched.",
          { partialPath, committedPath }
        );
      }
      await fileOps.unlink(partialPath);
      state = state === "published" ? "committed" : "cleaned";
    },
  };

  return transaction;
}
