import { Modal, TFile, type App } from "obsidian";
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_HOLD_DEFAULT_SECONDS,
  VIDEO_HOLD_MAX_SECONDS,
  VIDEO_HOLD_MIN_SECONDS,
  VIDEO_HOLD_STEP_SECONDS,
  VIDEO_WIDTH,
} from "./videoTypes";
import { validateVideoHoldSeconds } from "./videoTimeline";
import type {
  VideoExportService,
  VideoExportStatus,
} from "./videoExportService";

const MP4_FORMAT_NAME = "MP4";

const PHASE_LABELS: Record<VideoExportStatus["phase"], string> = {
  checking: "Checking",
  preparing: "Preparing slides",
  assets: "Preparing assets",
  encoding: "Encoding",
  finalizing: "Finalizing",
  verifying: "Verifying",
  completed: "Completed",
  cancel: "Cancelling",
};

/** One non-persistent options/progress surface shared by both product entry points. */
export class VideoExportModal extends Modal {
  private readonly service: VideoExportService;
  private readonly file: TFile;
  private holdInput: HTMLInputElement | null = null;
  private exportButton: HTMLButtonElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private progressEl: HTMLProgressElement | null = null;
  private statusEl: HTMLElement | null = null;
  private estimateEl: HTMLElement | null = null;
  private validationEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private running = false;
  private status: VideoExportStatus | null = null;
  private lastProgress = 0;

  constructor(app: App, service: VideoExportService, file: TFile) {
    super(app);
    this.service = service;
    this.file = file;
  }

  onOpen(): void {
    this.setTitle(`Export current note as ${MP4_FORMAT_NAME}`);
    this.modalEl.addClass("achmage-video-modal");
    this.modalEl.tabIndex = -1;
    this.contentEl.empty();

    const form = this.contentEl.createEl("form", {
      cls: "achmage-video-form",
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const holdSeconds = this.readValidHoldSeconds();
      if (holdSeconds === null || this.running) return;
      void this.service.start(this.file, holdSeconds, this);
    });

    form.createEl("p", {
      cls: "achmage-video-source",
      text: this.file.path,
      attr: { title: this.file.path },
    });

    const facts = form.createEl("ul", {
      cls: "achmage-video-facts",
      attr: { id: "achmage-video-fixed-facts" },
    });
    for (const fact of [
      `${VIDEO_WIDTH} × ${VIDEO_HEIGHT}`,
      `${VIDEO_FPS} fps`,
      "Silent H.264 MP4",
      "Smart motion · vertical within sections, horizontal between sections",
    ]) {
      facts.createEl("li", { text: fact });
    }

    const options = form.createDiv("achmage-video-options");
    const holdId = "achmage-video-hold-seconds";
    options.createEl("label", {
      text: "Seconds per slide",
      attr: { for: holdId },
    });
    this.holdInput = options.createEl("input", {
      cls: "achmage-video-hold",
      attr: {
        id: holdId,
        type: "number",
        min: String(VIDEO_HOLD_MIN_SECONDS),
        max: String(VIDEO_HOLD_MAX_SECONDS),
        step: String(VIDEO_HOLD_STEP_SECONDS),
        value: String(VIDEO_HOLD_DEFAULT_SECONDS),
        inputmode: "decimal",
        "aria-describedby": "achmage-video-fixed-facts achmage-video-estimate achmage-video-validation",
      },
    });
    options.createSpan({ text: "seconds" });
    this.holdInput.addEventListener("input", () => this.validateInput());

    this.estimateEl = form.createEl("p", {
      cls: "achmage-video-estimate",
      text: "Estimated duration: calculated after the physical slides are prepared.",
      attr: { id: "achmage-video-estimate" },
    });
    this.validationEl = form.createEl("p", {
      cls: "achmage-video-validation",
      attr: { id: "achmage-video-validation" },
    });

    const progressRegion = form.createDiv("achmage-video-progress-region");
    this.progressEl = progressRegion.createEl("progress", {
      cls: "achmage-video-progress",
      attr: {
        max: "1",
        value: "0",
        "aria-label": `${MP4_FORMAT_NAME} export progress`,
      },
    });
    this.statusEl = progressRegion.createDiv({
      cls: "achmage-video-status",
      attr: {
        role: "status",
        "aria-live": "polite",
        "aria-atomic": "true",
      },
    });
    this.errorEl = progressRegion.createDiv({
      cls: "achmage-video-error",
      attr: { role: "alert" },
    });

    const actions = form.createDiv("achmage-video-actions");
    this.cancelButton = actions.createEl("button", {
      text: "Cancel",
      attr: { type: "button" },
    });
    this.cancelButton.addEventListener("click", () => {
      if (this.running) this.service.cancel();
      else this.close();
    });
    this.exportButton = actions.createEl("button", {
      cls: "mod-cta",
      text: `Export ${MP4_FORMAT_NAME}`,
      attr: { type: "submit" },
    });

    this.validateInput();
    this.renderState();
    queueMicrotask(() => this.focusExisting());
  }

  onClose(): void {
    this.holdInput = null;
    this.exportButton = null;
    this.cancelButton = null;
    this.progressEl = null;
    this.statusEl = null;
    this.estimateEl = null;
    this.validationEl = null;
    this.errorEl = null;
    this.contentEl.empty();
    this.service.handleModalClosed(this);
  }

  focusExisting(): void {
    if (!this.modalEl.isConnected) {
      this.open();
      return;
    }
    const target = this.running ? this.cancelButton : this.holdInput;
    (target ?? this.modalEl).focus({ preventScroll: true });
  }

  getOwnerDocument(): Document {
    return this.contentEl.ownerDocument;
  }

  setRunning(running: boolean): void {
    if (running && !this.running) {
      this.lastProgress = 0;
      this.status = null;
    }
    this.running = running;
    this.renderState();
  }

  updateStatus(status: VideoExportStatus): void {
    this.lastProgress = Math.max(this.lastProgress, status.progress);
    this.status = { ...status, progress: this.lastProgress };
    this.renderState();
  }

  private readValidHoldSeconds(): number | null {
    if (!this.holdInput) return null;
    try {
      return validateVideoHoldSeconds(this.holdInput.valueAsNumber);
    } catch {
      return null;
    }
  }

  private validateInput(): void {
    const valid = this.readValidHoldSeconds() !== null;
    if (this.holdInput) this.holdInput.setAttribute("aria-invalid", valid ? "false" : "true");
    if (this.validationEl) {
      this.validationEl.textContent = valid
        ? `Allowed range: ${VIDEO_HOLD_MIN_SECONDS.toFixed(1)}–${VIDEO_HOLD_MAX_SECONDS.toFixed(1)} seconds in ${VIDEO_HOLD_STEP_SECONDS.toFixed(1)}-second steps.`
        : `Enter ${VIDEO_HOLD_MIN_SECONDS.toFixed(1)}–${VIDEO_HOLD_MAX_SECONDS.toFixed(1)} seconds in ${VIDEO_HOLD_STEP_SECONDS.toFixed(1)}-second steps.`;
    }
    if (this.exportButton) this.exportButton.disabled = this.running || !valid;
  }

  private renderState(): void {
    const status = this.status;
    if (this.holdInput) this.holdInput.disabled = this.running;
    this.validateInput();
    if (this.cancelButton) {
      const finalPublication = this.running && status?.cancellable === false;
      this.cancelButton.textContent = finalPublication
        ? "Publishing…"
        : this.running
          ? "Cancel"
          : "Close";
      this.cancelButton.disabled =
        this.running && (status?.phase === "cancel" || finalPublication);
    }
    if (this.progressEl) {
      this.progressEl.value = status?.progress ?? 0;
      this.progressEl.setAttribute(
        "aria-valuetext",
        status
          ? `${PHASE_LABELS[status.phase]}, ${Math.round(status.progress * 100)} percent`
          : "Ready to export"
      );
    }
    if (this.statusEl) {
      this.statusEl.textContent = status
        ? `${PHASE_LABELS[status.phase]} · ${status.message}`
        : "Ready to export locally. No audio track will be created.";
    }
    if (this.errorEl) {
      this.errorEl.textContent = status?.error ?? "";
      this.errorEl.toggleClass("is-visible", Boolean(status?.error));
    }
    if (this.estimateEl) {
      this.estimateEl.textContent = status?.estimatedDurationSeconds !== undefined
        ? `Estimated duration: ${formatDuration(status.estimatedDurationSeconds)} · ${status.frameCount ?? 0} physical slides.`
        : "Estimated duration: calculated after the physical slides are prepared.";
    }
  }
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  if (rounded < 60) return `${rounded.toFixed(1)} seconds`;
  const minutes = Math.floor(rounded / 60);
  const remainder = Math.round((rounded - minutes * 60) * 10) / 10;
  return `${minutes} min ${remainder.toFixed(1)} sec`;
}
