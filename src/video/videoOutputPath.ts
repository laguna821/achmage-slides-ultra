import { randomUUID } from "node:crypto";
import { link, open, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";

const PARTIAL_CREATE_ATTEMPTS = 20;
const FINAL_CANDIDATE_LIMIT = 10_000;

interface FileStatLike {
  readonly size: number;
  isFile(): boolean;
}

export interface VideoOutputFileOps {
  createExclusive(path: string): Promise<void>;
  stat(path: string): Promise<FileStatLike>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const defaultFileOps: VideoOutputFileOps = {
  async createExclusive(path): Promise<void> {
    const handle = await open(path, "wx");
    await handle.close();
  },
  stat,
  link,
  unlink,
};

export interface VideoOutputTransaction {
  /** Unique, same-directory file passed to Mediabunny's FilePathTarget. */
  readonly partialPath: string;
  /**
   * Atomically publishes the partial at the first free collision-safe name.
   * The partial is removed only after the hard link succeeds.
   */
  commit(): Promise<string>;
  /** Removes only the private partial. Existing or committed finals are never removed. */
  cleanup(): Promise<void>;
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
  /** Test seam. Product callers must use the default atomic Node filesystem operations. */
  readonly fileOps?: VideoOutputFileOps;
  /** Test seam for deterministic partial names. */
  readonly randomId?: () => string;
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
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

/**
 * Yields `note.slides.mp4`, `note.slides-2.mp4`, ... in the note directory.
 * Availability is intentionally decided by the atomic hard-link operation,
 * never by a race-prone exists-then-rename sequence.
 */
export function* videoOutputCandidates(
  noteAbsolutePath: string
): Generator<string, never, undefined> {
  const { directory, stem } = outputStem(noteAbsolutePath);
  for (let suffix = 1; ; suffix += 1) {
    const filename = suffix === 1 ? `${stem}.slides.mp4` : `${stem}.slides-${suffix}.mp4`;
    yield join(directory, filename);
  }
}

async function createUniquePartial(
  noteAbsolutePath: string,
  fileOps: VideoOutputFileOps,
  randomId: () => string
): Promise<string> {
  const { directory, stem } = outputStem(noteAbsolutePath);
  for (let attempt = 0; attempt < PARTIAL_CREATE_ATTEMPTS; attempt += 1) {
    const partialPath = join(directory, `.${stem}.slides-${randomId()}.partial.mp4`);
    try {
      await fileOps.createExclusive(partialPath);
      return partialPath;
    } catch (error) {
      if (errorCode(error) === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique same-directory MP4 partial file.");
}

export async function createVideoOutputTransaction(
  noteAbsolutePath: string,
  options: CreateVideoOutputTransactionOptions = {}
): Promise<VideoOutputTransaction> {
  const fileOps = options.fileOps ?? defaultFileOps;
  const randomId = options.randomId ?? randomUUID;
  const partialPath = await createUniquePartial(noteAbsolutePath, fileOps, randomId);
  let state: "open" | "published" | "committed" | "cleaned" = "open";

  return {
    partialPath,
    async commit(): Promise<string> {
      if (state !== "open") {
        throw new VideoOutputCommitError("This MP4 output transaction is no longer open.", {
          partialPath,
        });
      }

      const partialStat = await fileOps.stat(partialPath).catch((error: unknown) => {
        throw new VideoOutputCommitError("The encoded MP4 partial is unavailable.", {
          code: errorCode(error),
          partialPath,
          cause: error,
        });
      });
      if (!partialStat.isFile() || partialStat.size <= 0) {
        throw new VideoOutputCommitError("Refusing to publish an empty or non-file MP4 partial.", {
          partialPath,
        });
      }

      const candidates = videoOutputCandidates(noteAbsolutePath);
      for (let attempt = 0; attempt < FINAL_CANDIDATE_LIMIT; attempt += 1) {
        const candidatePath = candidates.next().value;
        try {
          await fileOps.link(partialPath, candidatePath);
        } catch (error) {
          const code = errorCode(error);
          if (code === "EEXIST") continue;
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

        state = "published";

        try {
          await fileOps.unlink(partialPath);
          state = "committed";
          return candidatePath;
        } catch (error) {
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
      try {
        await fileOps.unlink(partialPath);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
      state = "cleaned";
    },
  };
}
