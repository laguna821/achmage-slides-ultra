import type { App } from "obsidian";
import { TFile } from "obsidian";
import { VideoExportModal } from "../video/videoExportModal";
import {
  VideoExportService,
  type VideoExportStatus,
} from "../video/videoExportService";
import type { SlideRenderer } from "../engine/slideRenderer";

declare global {
  interface Window {
    __VIDEO_EXPORT_ACCEPTANCE__?: {
      readonly passed: boolean;
      readonly assertions: number;
      readonly error?: string;
    };
  }
}

interface TestJob {
  readonly controller: AbortController;
  readonly modal: VideoExportModal;
  readonly sourcePath: string;
  status: VideoExportStatus;
}

interface ServiceInternals {
  modal: VideoExportModal | null;
  activeJob: TestJob | null;
  publish(job: TestJob, status: VideoExportStatus): void;
}

let assertions = 0;

function check(value: unknown, message: string): asserts value {
  assertions += 1;
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  if (actual !== expected) {
    throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
  }
}

function makeFile(path: string): TFile {
  const name = path.split("/").at(-1) ?? path;
  const extension = name.includes(".") ? name.split(".").at(-1) ?? "" : "";
  const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
  return Object.assign(new TFile(), {
    path,
    name,
    extension,
    basename,
  });
}

function getModal(): HTMLElement {
  const modal = document.querySelector<HTMLElement>(".achmage-video-modal");
  check(modal, "video modal is present");
  return modal;
}

function getInput(modal: HTMLElement): HTMLInputElement {
  const input = modal.querySelector<HTMLInputElement>(".achmage-video-hold");
  check(input, "hold input is present");
  return input;
}

function getExportButton(modal: HTMLElement): HTMLButtonElement {
  const button = Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find((item) =>
    item.textContent?.includes("Export MP4")
  );
  check(button, "export button is present");
  return button;
}

async function flushModalFocus(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function run(): Promise<void> {
  const app = { vault: {} } as App;
  const service = new VideoExportService({
    app,
    activeDocument: document,
    createRenderer: () => ({}) as SlideRenderer,
  });
  const internals = service as unknown as ServiceInternals;
  const fileA = makeFile("notes/Deck A.md");
  const fileB = makeFile("notes/Deck B.md");

  service.open(fileA);
  await flushModalFocus();
  let modalEl = getModal();
  equal(document.querySelectorAll(".achmage-video-modal").length, 1, "one modal only");
  check(modalEl.textContent?.includes("notes/Deck A.md"), "modal identifies source note");
  check(modalEl.textContent?.includes("1920 × 1080"), "fixed resolution disclosed");
  check(modalEl.textContent?.includes("30 fps"), "fixed frame rate disclosed");
  check(modalEl.textContent?.includes("Silent H.264 MP4"), "silent codec disclosed");
  check(modalEl.querySelector('[role="status"][aria-live="polite"]'), "polite live status");

  const input = getInput(modalEl);
  equal(input.min, "0.5", "hold minimum");
  equal(input.max, "60", "hold maximum");
  equal(input.step, "0.1", "hold step");
  equal(input.value, "3", "hold default");
  equal(document.activeElement, input, "initial focus enters the numeric option");

  const exportButton = getExportButton(modalEl);
  input.value = "0.55";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  check(exportButton.disabled, "off-step hold disables export");
  equal(input.getAttribute("aria-invalid"), "true", "invalid input is exposed to AX");
  input.value = "0.5";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  check(!exportButton.disabled, "minimum valid hold enables export");
  equal(input.getAttribute("aria-invalid"), "false", "valid input clears AX error");

  service.open(fileB);
  await flushModalFocus();
  equal(document.querySelectorAll(".achmage-video-modal").length, 1, "duplicate entry reuses modal");
  check(getModal().textContent?.includes("notes/Deck A.md"), "duplicate cannot replace source snapshot");

  const activeModal = internals.modal;
  check(activeModal, "service owns the open modal");
  const cancelController = new AbortController();
  const cancellingJob: TestJob = {
    controller: cancelController,
    modal: activeModal,
    sourcePath: fileA.path,
    status: { phase: "encoding", progress: 0.4, message: "Encoding" },
  };
  internals.activeJob = cancellingJob;
  activeModal.setRunning(true);
  activeModal.close();
  check(cancelController.signal.aborted, "closing a running modal cancels its job");
  equal(internals.modal, null, "closed running modal is not retained as a future source");

  service.open(fileB);
  await flushModalFocus();
  check(getModal().textContent?.includes("notes/Deck A.md"), "duplicate during cancellation stays with active job");
  equal(internals.modal, activeModal, "active job modal remains the single owner");
  internals.activeJob = null;
  activeModal.close();
  equal(internals.modal, null, "settled cancellation releases modal ownership");

  service.open(fileB);
  await flushModalFocus();
  modalEl = getModal();
  check(modalEl.textContent?.includes("notes/Deck B.md"), "next invocation uses the new note");
  const nextModal = internals.modal;
  check(nextModal, "service owns replacement modal");

  const progressController = new AbortController();
  const progressJob: TestJob = {
    controller: progressController,
    modal: nextModal,
    sourcePath: fileB.path,
    status: { phase: "encoding", progress: 0.6, message: "Encoding" },
  };
  internals.activeJob = progressJob;
  nextModal.setRunning(true);
  internals.publish(progressJob, {
    phase: "assets",
    progress: 0.2,
    message: "Late asset callback",
  });
  const progress = modalEl.querySelector<HTMLProgressElement>("progress");
  check(progress, "native progress element is present");
  equal(progress.value, 0.6, "progress cannot move backwards");
  check(modalEl.textContent?.includes("Encoding"), "phase cannot move backwards");
  internals.publish(progressJob, {
    phase: "finalizing",
    progress: 0.93,
    message: "Finalizing",
  });
  equal(progress.value, 0.93, "later progress is accepted");
  check(modalEl.textContent?.includes("Finalizing"), "later phase is announced");

  internals.activeJob = null;
  nextModal.setRunning(false);
  nextModal.close();
  service.dispose();
  equal(document.querySelectorAll(".achmage-video-modal").length, 0, "modal cleanup");
}

void run().then(
  () => {
    window.__VIDEO_EXPORT_ACCEPTANCE__ = { passed: true, assertions };
  },
  (error: unknown) => {
    window.__VIDEO_EXPORT_ACCEPTANCE__ = {
      passed: false,
      assertions,
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
    };
  }
);
