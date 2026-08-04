import {
  FileSystemAdapter,
  TFile,
  type App,
  type Vault,
} from "obsidian";
import {
  AUDIT_MAX_PASSES,
  AUDIT_SHRINK_MARGIN,
  AUDIT_TOLERANCE_PX,
} from "../audit/auditLoop";
import type { SlideRenderer } from "../engine/slideRenderer";
import { VideoExportModal } from "./videoExportModal";
import {
  createVideoTimeline,
  sampleVideoTimeline,
  validateVideoHoldSeconds,
} from "./videoTimeline";

export type VideoExportPhase =
  | "checking"
  | "preparing"
  | "assets"
  | "encoding"
  | "finalizing"
  | "verifying"
  | "completed"
  | "cancel";

export interface VideoExportStatus {
  readonly phase: VideoExportPhase;
  /** Monotonic job progress in the inclusive range 0..1. */
  readonly progress: number;
  readonly message: string;
  readonly frameCount?: number;
  readonly estimatedDurationSeconds?: number;
  readonly outputPath?: string;
  readonly error?: string;
  /** False only after the atomic publication point has begun. */
  readonly cancellable?: boolean;
}

export interface VideoExportResult {
  readonly outputPath: string;
  readonly frameCount: number;
  readonly durationSeconds: number;
}

export interface VideoExportServiceOptions {
  readonly app: App;
  /** Creates a renderer whose settings and resolved theme assets are snapshotted. */
  readonly createRenderer: () => SlideRenderer;
  /** Captured Obsidian document; injectable for deterministic acceptance tests. */
  readonly activeDocument?: Document;
}

interface ActiveVideoExportJob {
  readonly controller: AbortController;
  readonly modal: VideoExportModal;
  readonly sourcePath: string;
  commitStarted: boolean;
  status: VideoExportStatus;
}

interface VideoSourceSnapshot {
  readonly path: string;
  readonly basename: string;
  readonly markdown: string;
  readonly contentHash: string;
}

class VideoExportCleanupError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "VideoExportCleanupError";
  }
}

const PHASE_ORDER: readonly VideoExportPhase[] = [
  "checking",
  "preparing",
  "assets",
  "encoding",
  "verifying",
  "finalizing",
  "completed",
  "cancel",
];

/**
 * Plugin-owned singleton for all MP4 entry points. The command palette and
 * Preview toolbar never create independent jobs or partial-file owners.
 */
export class VideoExportService {
  private readonly app: App;
  private readonly vault: Vault;
  private readonly createRenderer: () => SlideRenderer;
  private readonly activeDocumentOverride?: Document;
  private modal: VideoExportModal | null = null;
  private activeJob: ActiveVideoExportJob | null = null;
  private disposed = false;

  constructor(options: VideoExportServiceOptions) {
    this.app = options.app;
    this.vault = options.app.vault;
    this.createRenderer = options.createRenderer;
    this.activeDocumentOverride = options.activeDocument;
  }

  /** Open one modal, or focus the existing modal/job on duplicate invocation. */
  open(file: TFile): void {
    if (this.disposed) return;
    if (this.activeJob) {
      // A duplicate entry point belongs to the existing single job, even if
      // its modal was briefly closed while cancellation was settling.
      this.modal = this.activeJob.modal;
      this.activeJob.modal.focusExisting();
      return;
    }
    if (this.modal) {
      if (this.modal.getSourcePath() === file.path) {
        this.modal.focusExisting();
        return;
      }
      const previous = this.modal;
      this.modal = null;
      previous.close();
    }
    this.modal = new VideoExportModal(this.app, this, file);
    this.modal.open();
  }

  async start(file: TFile, holdSeconds: number, modal: VideoExportModal): Promise<void> {
    if (this.disposed) return;
    if (this.activeJob) {
      this.activeJob.modal.focusExisting();
      return;
    }
    if (modal !== this.modal) return;

    const normalizedHold = validateVideoHoldSeconds(holdSeconds);
    const controller = new AbortController();
    const status: VideoExportStatus = {
      phase: "checking",
      progress: 0.01,
      message: "Checking MP4 support and source note...",
    };
    const job: ActiveVideoExportJob = {
      controller,
      modal,
      sourcePath: file.path,
      commitStarted: false,
      status,
    };
    this.activeJob = job;
    modal.setRunning(true);
    modal.updateStatus(status);

    try {
      const result = await this.execute(job, file, normalizedHold);
      this.publish(job, {
        phase: "completed",
        progress: 1,
        message: `MP4 exported: ${result.outputPath}`,
        frameCount: result.frameCount,
        estimatedDurationSeconds: result.durationSeconds,
        outputPath: result.outputPath,
      });
    } catch (error) {
      if (
        (isAbortError(error) || controller.signal.aborted) &&
        !(error instanceof VideoExportCleanupError)
      ) {
        this.publish(job, {
          phase: "cancel",
          progress: job.status.progress,
          message: "MP4 export cancelled. No final file was published.",
        });
      } else {
        const message = actionableErrorMessage(error);
        this.publish(job, {
          phase: job.status.phase,
          progress: job.status.progress,
          message: "MP4 export could not be completed.",
          error: message,
        });
      }
    } finally {
      if (this.activeJob === job) this.activeJob = null;
      modal.setRunning(false);
      if (this.disposed && this.modal === modal) {
        this.modal = null;
        modal.close();
      }
    }
  }

  cancel(): void {
    const job = this.activeJob;
    if (!job || job.controller.signal.aborted) return;
    if (job.commitStarted) {
      this.publish(job, {
        phase: "finalizing",
        progress: Math.max(job.status.progress, 0.99),
        message: "Publishing the verified MP4 atomically; this final step cannot be cancelled.",
        cancellable: false,
      });
      return;
    }
    this.publish(job, {
      phase: "cancel",
      progress: job.status.progress,
      message: "Cancelling MP4 export and cleaning the partial file...",
    });
    job.controller.abort();
  }

  handleModalClosed(modal: VideoExportModal): void {
    if (modal !== this.modal) return;
    this.modal = null;
    if (this.activeJob?.modal === modal) {
      this.cancel();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    if (!this.activeJob && this.modal) {
      const modal = this.modal;
      this.modal = null;
      modal.close();
    }
  }

  private async execute(
    job: ActiveVideoExportJob,
    file: TFile,
    holdSeconds: number
  ): Promise<VideoExportResult> {
    const { signal } = job.controller;
    const ownerDocument = this.activeDocumentOverride ?? job.modal.getOwnerDocument();
    throwIfAborted(signal);
    if (file.extension !== "md") {
      throw new Error("Choose a Markdown note before exporting an MP4.");
    }
    const adapter = this.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error(
        "MP4 export requires a local desktop vault with atomic filesystem support."
      );
    }
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error(
        "MP4 export requires OffscreenCanvas. Close Obsidian and install the current desktop installer over the existing application, then retry."
      );
    }

    // Keep Mediabunny and the capture pipeline dormant during ordinary plugin
    // load, Preview and HTML export. The production bundle remains one file,
    // while esbuild defers these module initializers until this explicit path.
    const [encoderModule, artifactModule, compositorModule, outputModule] =
      await Promise.all([
        import("./videoEncoder"),
        import("./videoArtifact"),
        import("./videoCompositor"),
        import("./videoOutputPath"),
      ]);
    const {
      encodeVideoToPartialFile,
      probeVideoEncoderCapability,
      validateVideoMp4,
    } = encoderModule;
    const { auditVideoDeckArtifact } = artifactModule;
    const { VideoFrameCompositor } = compositorModule;
    const { createVideoOutputTransaction } = outputModule;
    const { VideoOutputCommitError } = outputModule;

    const capability = await probeVideoEncoderCapability(signal);
    if (!capability.supported) {
      throw new Error(
        "H.264 MP4 encoding is not supported by this Obsidian/Electron installation. Fully close Obsidian, install the latest desktop installer over the existing application (there is no separate Electron updater), then retry."
      );
    }
    throwIfAborted(signal);
    const snapshot = await this.captureSource(file, signal);
    const renderer = this.createRenderer();

    this.publish(job, {
      phase: "assets",
      progress: 0.05,
      message: "Embedding assets before the slide audit...",
    });
    let maximumAssetProgress = 0;
    const audit = await auditVideoDeckArtifact(
      (budgetShrink) => {
        const deck = renderer.render(snapshot.markdown, this.vault, {
          budgetShrink,
          title: snapshot.basename,
          captureVideoArtifact: true,
        });
        const draft = deck.videoArtifactDraft;
        if (!draft) {
          throw new Error("The renderer did not produce a video artifact. Retry the export.");
        }
        return draft;
      },
      {
        maxPasses: AUDIT_MAX_PASSES,
        shrinkMargin: AUDIT_SHRINK_MARGIN,
        vault: this.vault,
        activeDocument: ownerDocument,
        sourcePath: snapshot.path,
        signal,
        onProgress: (assetProgress) => {
          const ratio = assetProgress.total > 0
            ? assetProgress.completed / assetProgress.total
            : 1;
          maximumAssetProgress = Math.max(maximumAssetProgress, Math.min(1, ratio));
          this.publish(job, {
            phase: "assets",
            progress: 0.05 + maximumAssetProgress * 0.25,
            message: assetProgress.phase === "hashing"
              ? "Hashing the audited slide artifact..."
              : `Validating assets (${assetProgress.completed}/${assetProgress.total})...`,
          });
        },
      }
    );
    throwIfAborted(signal);
    if (!audit.converged || audit.finalOverflowPx > AUDIT_TOLERANCE_PX) {
      throw new Error(
        "The final slide audit did not converge within 2 px. Fix the overflowing slide and retry."
      );
    }
    const artifact = audit.artifact;
    throwIfAborted(signal);

    const timeline = createVideoTimeline(artifact.frames, holdSeconds);
    this.publish(job, {
      phase: "encoding",
      progress: 0.3,
      message: "Encoding silent H.264 video...",
      frameCount: artifact.frames.length,
      estimatedDurationSeconds: timeline.durationSeconds,
    });

    const compositor = new VideoFrameCompositor(artifact, {
      activeDocument: ownerDocument,
      signal,
    });
    let transaction: import("./videoOutputPath").VideoOutputTransaction | null = null;
    let committed = false;
    let operationError: Error | null = null;
    let result: VideoExportResult | null = null;
    try {
      transaction = await createVideoOutputTransaction(
        adapter.getFullPath(snapshot.path)
      );
      const canvas = await compositor.render(sampleVideoTimeline(timeline, 0));
      await encodeVideoToPartialFile({
        output: transaction,
        canvas,
        totalFrames: timeline.totalFrames,
        signal,
        renderFrame: async (frameIndex, renderSignal) => {
          throwIfAborted(renderSignal);
          const rendered = await compositor.render(
            sampleVideoTimeline(timeline, frameIndex)
          );
          if (rendered !== canvas) {
            throw new Error("The video compositor replaced its streaming canvas.");
          }
        },
        onProgress: (encodeProgress) => {
          const isFinalFrame =
            encodeProgress.completedFrames === encodeProgress.totalFrames;
          this.publish(job, {
            phase: "encoding",
            progress: isFinalFrame ? 0.93 : 0.3 + encodeProgress.ratio * 0.6,
            message: isFinalFrame
              ? "Finalizing the MP4 container..."
              : `Encoding frame ${encodeProgress.completedFrames}/${encodeProgress.totalFrames}...`,
            frameCount: artifact.frames.length,
            estimatedDurationSeconds: timeline.durationSeconds,
          });
        },
      });
      throwIfAborted(signal);

      this.publish(job, {
        phase: "verifying",
        progress: 0.96,
        message: "Verifying MP4 metadata and source note...",
        frameCount: artifact.frames.length,
        estimatedDurationSeconds: timeline.durationSeconds,
      });
      await validateVideoMp4({
        output: transaction,
        totalFrames: timeline.totalFrames,
        signal,
      });
      await this.assertSourceUnchanged(snapshot, signal);
      throwIfAborted(signal);
      job.commitStarted = true;
      this.publish(job, {
        phase: "finalizing",
        progress: 0.99,
        message: "Publishing the verified MP4 atomically...",
        frameCount: artifact.frames.length,
        estimatedDurationSeconds: timeline.durationSeconds,
        cancellable: false,
      });
      let outputPath: string;
      try {
        outputPath = await transaction.commit();
        committed = true;
      } catch (error) {
        if (!(error instanceof VideoOutputCommitError) || !error.committedPath) {
          throw error;
        }
        // Publication already crossed its atomic point. Retry only private
        // partial cleanup, never remove or overwrite the verified final link.
        outputPath = error.committedPath;
        try {
          await transaction.cleanup();
          committed = true;
        } catch (cleanupError) {
          committed = true;
          throw new Error(
            `The verified MP4 was published at ${outputPath}, but its private partial ${error.partialPath} could not be removed. Remove only that .partial.mp4 file after closing Obsidian. ${actionableErrorMessage(cleanupError)}`,
            { cause: error }
          );
        }
      }
      result = {
        outputPath,
        frameCount: artifact.frames.length,
        durationSeconds: timeline.durationSeconds,
      };
    } catch (error) {
      operationError = toError(error);
    } finally {
      compositor.dispose();
    }
    if (transaction && !committed) {
      try {
        await transaction.cleanup();
      } catch (cleanupError) {
        operationError = operationError
          ? new VideoExportCleanupError(
              `${actionableErrorMessage(operationError)} Private partial cleanup also failed: ${actionableErrorMessage(cleanupError)}`,
              operationError
            )
          : toError(cleanupError);
      }
    }
    if (operationError) throw operationError;
    if (!result) {
      throw new Error("MP4 export ended without a result or an actionable error.");
    }
    return result;
  }

  private async captureSource(file: TFile, signal: AbortSignal): Promise<VideoSourceSnapshot> {
    const path = file.path;
    const basename = file.basename;
    const markdown = await this.vault.read(file);
    throwIfAborted(signal);
    return {
      path,
      basename,
      markdown,
      contentHash: await sha256(markdown),
    };
  }

  private async assertSourceUnchanged(
    snapshot: VideoSourceSnapshot,
    signal: AbortSignal
  ): Promise<void> {
    throwIfAborted(signal);
    const current = this.vault.getAbstractFileByPath(snapshot.path);
    if (!(current instanceof TFile)) {
      throw new Error(
        "The source note was moved or deleted during export. No MP4 was published."
      );
    }
    const currentMarkdown = await this.vault.read(current);
    throwIfAborted(signal);
    if ((await sha256(currentMarkdown)) !== snapshot.contentHash) {
      throw new Error(
        "The source note changed during export. No MP4 was published; retry from the updated note."
      );
    }
  }

  private publish(job: ActiveVideoExportJob, next: VideoExportStatus): void {
    if (this.activeJob !== job) return;
    if (job.status.phase === "cancel" && next.phase !== "cancel") return;
    const currentPhase = PHASE_ORDER.indexOf(job.status.phase);
    const nextPhase = PHASE_ORDER.indexOf(next.phase);
    const phase = nextPhase >= currentPhase ? next.phase : job.status.phase;
    const status: VideoExportStatus = {
      ...next,
      phase,
      progress: Math.max(job.status.progress, clampProgress(next.progress)),
    };
    job.status = status;
    job.modal.updateStatus(status);
  }
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Video export was cancelled.", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function actionableErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unexpected video export failure. Check the source note and retry.";
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
