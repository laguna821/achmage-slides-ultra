import { SlidePreviewView } from "../view/slidePreviewView";

interface PreviewFixtureResult {
  initialTitle: string;
  activeTitle: string;
  renderCalls: number;
  vaultReads: number;
  status: string;
}

declare global {
  interface Window {
    navigationPreviewFixture?: PreviewFixtureResult;
    navigationPreviewFixtureError?: string;
  }
}

type ElementWithObsidianHelpers = HTMLElement & {
  empty(): void;
  addClass(...classes: string[]): void;
  createDiv(className?: string): HTMLDivElement;
  createEl<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    options?: {
      text?: string;
      cls?: string;
      attr?: Record<string, string>;
    }
  ): HTMLElementTagNameMap[K];
};

type PreviewHarnessView = {
  containerEl: HTMLElement;
  app: {
    workspace: {
      getActiveFile(): { basename: string; extension: string; path: string } | null;
      on(): object;
    };
    vault: {
      read(): Promise<string>;
      on(): object;
    };
  };
  plugin: {
    renderer: {
      render(): { html: string; slideCount: number };
    };
  };
  iframe: HTMLIFrameElement | null;
  currentFile: { basename: string; extension: string; path: string } | null;
  statusEl: HTMLElement | null;
  lastViewedGroup: number;
  lastViewedFrame: number;
  hotkeyBridgeListener: null;
  updateTypoLabel: null;
  renderToken: number;
  registerEvent(): void;
  installTypoQuickControl(): void;
  installHotkeyBridge(): void;
  onActiveFileChange(): void;
};

installObsidianElementHelpers();

void mountPreviewTitleFixture().catch((error: unknown) => {
  window.navigationPreviewFixtureError =
    error instanceof Error ? error.stack ?? error.message : String(error);
});

async function mountPreviewTitleFixture(): Promise<void> {
  const root = document.createElement("div") as ElementWithObsidianHelpers;
  root.append(document.createElement("div"), document.createElement("div"));
  document.body.appendChild(root);

  let activeFile: { basename: string; extension: string; path: string } | null = null;
  let renderCalls = 0;
  let vaultReads = 0;
  const view = Object.create(SlidePreviewView.prototype) as SlidePreviewView;
  const harness = view as unknown as PreviewHarnessView;
  harness.containerEl = root;
  harness.app = {
    workspace: {
      getActiveFile: () => activeFile,
      on: () => ({}),
    },
    vault: {
      read: async () => {
        vaultReads += 1;
        return "# Navigation fixture";
      },
      on: () => ({}),
    },
  };
  harness.plugin = {
    renderer: {
      render: () => {
        renderCalls += 1;
        return {
          html: "<!doctype html><html><body data-preview-rendered=\"true\"></body></html>",
          slideCount: 1,
        };
      },
    },
  };
  harness.iframe = null;
  harness.currentFile = null;
  harness.statusEl = null;
  harness.lastViewedGroup = 0;
  harness.lastViewedFrame = 0;
  harness.hotkeyBridgeListener = null;
  harness.updateTypoLabel = null;
  harness.renderToken = 0;
  harness.registerEvent = () => undefined;
  harness.installTypoQuickControl = () => undefined;
  harness.installHotkeyBridge = () => undefined;

  await view.onOpen();
  const initialTitle = getHarnessIframe(harness)?.title ?? "";

  activeFile = {
    basename: "Navigation fixture",
    extension: "md",
    path: "Navigation fixture.md",
  };
  harness.onActiveFileChange();
  await waitFor(() =>
    renderCalls > 0 &&
    vaultReads > 0 &&
    getHarnessStatus(harness)?.textContent === "1 slides"
  );

  window.navigationPreviewFixture = {
    initialTitle,
    activeTitle: getHarnessIframe(harness)?.title ?? "",
    renderCalls,
    vaultReads,
    status: getHarnessStatus(harness)?.textContent ?? "",
  };
}

function getHarnessIframe(harness: PreviewHarnessView): HTMLIFrameElement | null {
  return harness.iframe;
}

function getHarnessStatus(harness: PreviewHarnessView): HTMLElement | null {
  return harness.statusEl;
}

function installObsidianElementHelpers(): void {
  const prototype = HTMLElement.prototype as unknown as Partial<ElementWithObsidianHelpers>;
  prototype.empty = function empty(this: HTMLElement): void {
    this.replaceChildren();
  };
  prototype.addClass = function addClass(this: HTMLElement, ...classes: string[]): void {
    this.classList.add(...classes);
  };
  prototype.createDiv = function createDiv(
    this: HTMLElement,
    className?: string
  ): HTMLDivElement {
    const element = document.createElement("div");
    if (className) element.className = className;
    this.appendChild(element);
    return element;
  };
  prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tagName: K,
    options?: {
      text?: string;
      cls?: string;
      attr?: Record<string, string>;
    }
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);
    if (options?.text !== undefined) element.textContent = options.text;
    if (options?.cls) element.className = options.cls;
    for (const [name, value] of Object.entries(options?.attr ?? {})) {
      element.setAttribute(name, value);
    }
    this.appendChild(element);
    return element;
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for SlidePreviewView render path");
}

export {};
