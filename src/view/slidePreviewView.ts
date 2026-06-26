import { ItemView, WorkspaceLeaf, TFile, debounce } from "obsidian";
import type AchmageSlides from "../main";
import {
  TYPOGRAPHIC_SCALES,
  type TypographicScaleName,
} from "../settings";
import {
  AUDIT_MAX_PASSES,
  AUDIT_SHRINK_MARGIN,
  AUDIT_TOLERANCE_PX,
  auditedRenderOffscreen,
  runAuditLoop,
} from "../audit/auditLoop";

export const SLIDE_VIEW_TYPE = "achmage-slide-preview";

/** UX patch — fast path baseline for the toolbar TYPE Reset button. */
const TYPO_RESET_BASE_FONT_SIZE = 26;
const TYPO_RESET_SCALE: TypographicScaleName = "minorSecond";

interface IframeHotkeyMessage {
  __achmage: "hotkey";
  key: string;
  code: string;
  keyCode?: number;
  which?: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
}

export class SlidePreviewView extends ItemView {
  private plugin: AchmageSlides;
  private iframe: HTMLIFrameElement | null = null;
  private currentFile: TFile | null = null;
  private statusEl: HTMLElement | null = null;
  // PR3 hot-reload preservation — last-known navigation state inside the
  // iframe. Captured before each srcdoc swap and replayed via render() opts so
  // the user stays on the slide they were presenting when settings change.
  private lastViewedGroup = 0;
  private lastViewedFrame = 0;
  // PR3 follow-up — listener that bridges keydown events from the iframe
  // (which holds keyboard focus during slide presentation) back to Obsidian's
  // global keymap. Stored so onClose() can remove it.
  private hotkeyBridgeListener: ((e: MessageEvent) => void) | null = null;
  // PR3 follow-up (2026-05-19) — Type Quick Controls popover owns the
  // "Type NNpt" button label + computed sizes preview. When the user changes
  // base font size via hotkey (or any other path that doesn't go through
  // the popover), the label was stale until the user opened the popover.
  // installTypoQuickControl populates this with its renderLabels closure so
  // refresh() can re-sync the toolbar after settings changes.
  private updateTypoLabel: (() => void) | null = null;
  // v5.5 Phase 4 — monotonically increasing token; a newer render() invalidates
  // an in-flight closed-loop audit so stale passes abandon instead of fighting.
  private renderToken = 0;

  constructor(leaf: WorkspaceLeaf, plugin: AchmageSlides) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SLIDE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.currentFile
      ? `Slides: ${this.currentFile.basename}`
      : "Achmage Slides";
  }

  getIcon(): string {
    return "presentation";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("achmage-slide-container");

    // Create toolbar
    const toolbar = container.createDiv("achmage-toolbar");

    const refreshBtn = toolbar.createEl("button", { text: "Refresh" });
    refreshBtn.addEventListener("click", () => this.renderCurrentFile());

    const exportBtn = toolbar.createEl("button", { text: "Export HTML" });
    exportBtn.addEventListener("click", () => this.exportHTML());

    // UX patch — quick typography control (TYPE NNpt button + popover with
    // BASE slider, SCALE dropdown, RESET). Persists to settings via
    // plugin.saveSettings(), which already triggers an iframe re-render.
    this.installTypoQuickControl(toolbar, container);

    this.statusEl = toolbar.createEl("span", {
      cls: "achmage-status",
      text: "",
    });

    // Create iframe for slide rendering (style isolation)
    this.iframe = container.createEl("iframe", {
      cls: "achmage-slide-iframe",
    });
    this.iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    );

    // Listen for active file changes
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.onActiveFileChange();
      })
    );

    // Listen for file modifications (debounced)
    this.registerEvent(
      this.app.vault.on(
        "modify",
        debounce(
          (file: TFile) => {
            if (file === this.currentFile) {
              this.renderCurrentFile();
            }
          },
          500,
          true
        )
      )
    );

    // PR3 follow-up — install the iframe→parent hotkey bridge so user-bound
    // Obsidian hotkeys (e.g. base font size +/-) fire while the slide
    // preview iframe holds focus. The iframe posts keydown metadata for any
    // key it didn't handle internally; we match it against Obsidian's
    // registered commands and execute the matching one.
    this.installHotkeyBridge();

    // Initial render
    this.onActiveFileChange();
  }

  async onClose(): Promise<void> {
    if (this.hotkeyBridgeListener) {
      window.removeEventListener("message", this.hotkeyBridgeListener);
      this.hotkeyBridgeListener = null;
    }
  }

  /**
   * PR3 follow-up — bridge iframe keydown events to Obsidian's command
   * system. The slide preview iframe captures all keystrokes when focused
   * (its sandboxed document is a separate keyboard scope), so Obsidian's
   * global hotkey watcher never sees them. This listener accepts postMessage
   * notifications from the iframe IIFE and:
   *   1. Looks for an Obsidian command whose hotkey matches the key combo.
   *      If found, calls `app.commands.executeCommandById` directly — this
   *      sidesteps the `isTrusted` synthetic-event quirk entirely.
   *   2. As a defensive fallback, re-dispatches a synthetic KeyboardEvent on
   *      the main document for any other listeners (Obsidian core, other
   *      plugins) that may want to handle the event.
   */
  private installHotkeyBridge(): void {
    if (this.hotkeyBridgeListener) return;
    const listener = (event: MessageEvent): void => {
      const data = event.data as IframeHotkeyMessage | null;
      if (!data || data.__achmage !== "hotkey") return;
      if (event.source !== this.iframe?.contentWindow) return;

      // 1) Try direct command lookup via Obsidian's hotkey API.
      const commandId = this.findCommandByHotkey(data);
      if (commandId) {
        const commands = (this.app as unknown as {
          commands: { executeCommandById: (id: string) => boolean };
        }).commands;
        try {
          commands.executeCommandById(commandId);
        } catch {
          // swallow — the synthetic-event fallback below may still fire
        }
        return;
      }

      // 2) Fallback — re-dispatch a synthetic KeyboardEvent on the main
      // document so other plugins / core handlers get a chance.
      try {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: data.key,
            code: data.code,
            ctrlKey: data.ctrlKey,
            altKey: data.altKey,
            shiftKey: data.shiftKey,
            metaKey: data.metaKey,
            bubbles: true,
            cancelable: true,
          })
        );
      } catch {
        // ignore
      }
    };
    window.addEventListener("message", listener);
    this.hotkeyBridgeListener = listener;
  }

  /**
   * Walk Obsidian's command registry + hotkey manager to find a command
   * whose bound key combo matches the iframe-forwarded keydown. Returns the
   * command id or null. Uses internal API (`app.commands.commands`,
   * `app.hotkeyManager.customKeys`) which is conventionally stable in
   * Obsidian plugin code but undocumented.
   */
  private findCommandByHotkey(data: IframeHotkeyMessage): string | null {
    const appAny = this.app as unknown as {
      commands?: {
        commands?: Record<
          string,
          {
            hotkeys?: { key: string; modifiers?: string[] }[];
          }
        >;
      };
      hotkeyManager?: {
        customKeys?: Record<string, { key: string; modifiers?: string[] }[]>;
      };
    };
    const customKeys = appAny.hotkeyManager?.customKeys ?? {};
    // User-customized bindings take precedence over command defaults.
    for (const [cmdId, hotkeys] of Object.entries(customKeys)) {
      for (const hk of hotkeys ?? []) {
        if (this.hotkeyMatches(hk, data)) return cmdId;
      }
    }
    const cmds = appAny.commands?.commands ?? {};
    for (const [cmdId, cmd] of Object.entries(cmds)) {
      // Skip commands the user explicitly customized — handled above.
      if (cmdId in customKeys) continue;
      for (const hk of cmd.hotkeys ?? []) {
        if (this.hotkeyMatches(hk, data)) return cmdId;
      }
    }
    return null;
  }

  private hotkeyMatches(
    hk: { key: string; modifiers?: string[] },
    data: IframeHotkeyMessage
  ): boolean {
    // Obsidian stores keys with single uppercase letter for alpha (e.g. "A"),
    // and uses "Mod" as a cross-platform alias for Ctrl/Meta. Normalize both
    // sides before comparing.
    const wantKey = (hk.key ?? "").toLowerCase();
    const gotKey = (data.key ?? "").toLowerCase();
    if (wantKey !== gotKey) return false;
    const mods = (hk.modifiers ?? []).map((m) => m.toLowerCase());
    const hasCtrl = mods.includes("ctrl");
    const hasAlt = mods.includes("alt");
    const hasShift = mods.includes("shift");
    const hasMeta = mods.includes("meta");
    const hasMod = mods.includes("mod"); // cross-platform Ctrl on Win/Linux, Meta on macOS
    const ctrlOrMod = hasCtrl || hasMod;
    const metaOrMod = hasMeta || hasMod;
    // "Mod" matches either Ctrl OR Meta — accept whichever the OS sent.
    if (hasMod) {
      if (!(data.ctrlKey || data.metaKey)) return false;
    } else {
      if (ctrlOrMod !== data.ctrlKey) return false;
      if (metaOrMod !== data.metaKey) return false;
    }
    if (hasAlt !== data.altKey) return false;
    if (hasShift !== data.shiftKey) return false;
    return true;
  }

  /**
   * Re-render the currently displayed file. Called by the plugin after
   * settings change so the active view picks up the new typography/theme
   * without requiring the user to click "Refresh" or modify the file.
   *
   * PR3 follow-up — also re-syncs the Type Quick Controls toolbar label
   * (e.g. "Type 28pt") whose state lives in installTypoQuickControl's
   * closure. Without this the label was stale after a hotkey-driven
   * baseFontSize change until the user opened the popover.
   */
  refresh(): void {
    if (this.updateTypoLabel) this.updateTypoLabel();
    if (this.currentFile) {
      void this.renderCurrentFile();
    }
  }

  private onActiveFileChange(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.extension === "md") {
      this.currentFile = activeFile;
      this.renderCurrentFile();
    }
  }

  private async renderCurrentFile(): Promise<void> {
    if (!this.currentFile || !this.iframe) return;

    try {
      this.setStatus("Rendering...");

      // PR3 — capture the iframe's current navigation state before we swap
      // srcdoc, so we can restore the same slide after re-render. The IIFE
      // exposes the indices via Object.defineProperty getters (see
      // slideRenderer's buildPresentationHTML INIT block). Sandbox is
      // allow-scripts + allow-same-origin so contentWindow access works for
      // srcdoc; the try/catch is defensive in case a future tightening of the
      // sandbox attribute makes the access throw.
      try {
        const win = this.iframe.contentWindow as unknown as {
          achmageGroupIndex?: number;
          achmageFrameIndex?: number;
        } | null;
        if (win && typeof win.achmageGroupIndex === "number") {
          this.lastViewedGroup = win.achmageGroupIndex;
          this.lastViewedFrame =
            typeof win.achmageFrameIndex === "number"
              ? win.achmageFrameIndex
              : 0;
        }
      } catch {
        // Cross-origin or detached — fall back to last-known values.
      }

      const iframe = this.iframe;
      // v5.7 — basename을 await 전에 로컬로 캡처(closure 안에서 this.currentFile
      // narrowing이 풀리는 것을 피함, markdown 캡처와 동일 패턴).
      const title = this.currentFile.basename;
      const markdown = await this.app.vault.read(this.currentFile);

      // v5.5 Phase 4 — closed-loop overflow correction on the live iframe.
      // Render predictively, measure the real rendered geometry, and if any
      // frame overflows feed a per-logical budget shrink back and re-render
      // until it fits. Most decks converge on pass 0 (no re-render). The shared
      // runAuditLoop is identical to the export path (offscreen) and the
      // acceptance harness.
      const token = ++this.renderToken;
      const { deck, predictiveOverflowPx } = await runAuditLoop(
        iframe,
        (budgetShrink) =>
          this.plugin.renderer.render(markdown, this.app.vault, {
            restoreGroup: this.lastViewedGroup,
            restoreFrame: this.lastViewedFrame,
            budgetShrink,
            title,
          }),
        {
          maxPasses: AUDIT_MAX_PASSES,
          tolerancePx: AUDIT_TOLERANCE_PX,
          shrinkMargin: AUDIT_SHRINK_MARGIN,
          isStale: () => token !== this.renderToken,
        }
      );
      if (token !== this.renderToken) return;

      this.setStatus(
        predictiveOverflowPx > AUDIT_TOLERANCE_PX
          ? `${deck.slideCount} slides · overflow auto-fixed`
          : `${deck.slideCount} slides`
      );
    } catch (error) {
      console.error("Achmage Slides render error:", error);
      this.setStatus(`Error: ${error}`);
    }
  }

  private async exportHTML(): Promise<void> {
    if (!this.currentFile) return;

    try {
      // v5.7 — basename을 await 전에 로컬로 캡처(closure narrowing 회피).
      const title = this.currentFile.basename;
      const markdown = await this.app.vault.read(this.currentFile);
      // v5.5 Phase 6 — run the same closed loop via a detached offscreen iframe
      // so the exported HTML is overflow-free, matching the live preview.
      const { deck } = await auditedRenderOffscreen(
        (budgetShrink) =>
          this.plugin.renderer.render(markdown, this.app.vault, { budgetShrink, title }),
        {
          maxPasses: AUDIT_MAX_PASSES,
          tolerancePx: AUDIT_TOLERANCE_PX,
          shrinkMargin: AUDIT_SHRINK_MARGIN,
        }
      );

      const exportPath = this.currentFile.path.replace(/\.md$/, ".slides.html");

      // v7.0/v8.0 — 원격(https) 배경 + 본문 <img>를 data URI로 임베드해 자체완결 HTML로 내보낸다.
      const html = await this.plugin.embedRemoteAssets(deck.html);
      await this.app.vault.adapter.write(exportPath, html);
      this.setStatus(`Exported: ${exportPath}`);
    } catch (error) {
      console.error("Achmage Slides export error:", error);
      this.setStatus(`Export error: ${error}`);
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) {
      this.statusEl.textContent = text;
    }
  }

  private installTypoQuickControl(
    toolbar: HTMLElement,
    container: HTMLElement
  ): void {
    const typoBtn = toolbar.createEl("button", {
      cls: "achmage-typo-btn",
    });

    const popover = toolbar.createDiv("achmage-typo-popover");
    popover.style.display = "none";

    // ── BASE row ──
    const baseRow = popover.createDiv("achmage-typo-row");
    baseRow.createEl("label", {
      cls: "achmage-typo-label",
      text: "Base",
    });
    const baseSlider = baseRow.createEl("input", { type: "range" });
    baseSlider.min = "16";
    baseSlider.max = "40";
    baseSlider.step = "1";
    baseSlider.value = String(this.plugin.settings.baseFontSize);
    // Editable number input — click to type, Enter or blur to commit.
    const baseValue = baseRow.createEl("input", { cls: "achmage-typo-value" });
    baseValue.type = "number";
    baseValue.min = "16";
    baseValue.max = "40";
    baseValue.step = "1";
    baseValue.title = "Click to type a value (16–40)";
    baseRow.createEl("span", { cls: "achmage-typo-unit", text: "pt" });

    // ── SCALE row ──
    const scaleRow = popover.createDiv("achmage-typo-row");
    scaleRow.createEl("label", {
      cls: "achmage-typo-label",
      text: "Scale",
    });
    const scaleSelect = scaleRow.createEl("select", {
      cls: "achmage-typo-select",
    });
    for (const [key, info] of Object.entries(TYPOGRAPHIC_SCALES)) {
      const opt = scaleSelect.createEl("option", {
        value: key,
        text: info.label,
      });
      if (key === this.plugin.settings.typographicScale) opt.selected = true;
    }

    // ── computed display ──
    const computedEl = popover.createDiv("achmage-typo-computed");

    // ── reset row ──
    const resetBtn = popover.createEl("button", {
      cls: "achmage-typo-reset",
      text: `Reset → ${TYPO_RESET_BASE_FONT_SIZE}pt · Minor Second`,
    });

    const renderLabels = () => {
      const s = this.plugin.settings;
      const ratio = TYPOGRAPHIC_SCALES[s.typographicScale].ratio;
      typoBtn.textContent = `Type ${s.baseFontSize}pt`;
      // Only sync the input value when it isn't being edited so we don't
      // clobber the user's keystrokes mid-typing.
      if (document.activeElement !== baseValue) {
        baseValue.value = String(s.baseFontSize);
      }
      // Also sync the slider position so the popover reflects the current
      // value next time it's opened. Mirrors openPopover's sync logic but
      // also handles the case where the popover is already open while the
      // user presses a hotkey.
      if (document.activeElement !== baseSlider) {
        baseSlider.value = String(s.baseFontSize);
      }
      if (document.activeElement !== scaleSelect) {
        scaleSelect.value = s.typographicScale;
      }
      const h3 = Math.round(s.baseFontSize * ratio);
      const h2 = Math.round(s.baseFontSize * Math.pow(ratio, 2));
      const h1 = Math.round(s.baseFontSize * Math.pow(ratio, 3));
      computedEl.textContent =
        `H1 ${h1}px · H2 ${h2}px · H3 ${h3}px · Body ${s.baseFontSize}px (×${ratio.toFixed(3)})`;
    };
    renderLabels();
    // PR3 follow-up — expose to refresh() so external setting changes
    // (e.g. hotkey-driven baseFontSize updates) re-sync the toolbar.
    this.updateTypoLabel = renderLabels;

    baseSlider.addEventListener("input", async () => {
      const v = parseInt(baseSlider.value, 10);
      if (!Number.isFinite(v)) return;
      this.plugin.settings.baseFontSize = v;
      renderLabels();
      await this.plugin.saveSettings();
    });

    const commitBaseInput = async () => {
      const raw = parseInt(baseValue.value, 10);
      const fallback = this.plugin.settings.baseFontSize;
      const clamped = Math.max(
        16,
        Math.min(40, Number.isFinite(raw) ? raw : fallback)
      );
      baseValue.value = String(clamped);
      if (this.plugin.settings.baseFontSize !== clamped) {
        this.plugin.settings.baseFontSize = clamped;
        baseSlider.value = String(clamped);
        renderLabels();
        await this.plugin.saveSettings();
      }
    };

    baseValue.addEventListener("change", commitBaseInput);
    baseValue.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        baseValue.blur();
      }
    });

    scaleSelect.addEventListener("change", async () => {
      this.plugin.settings.typographicScale =
        scaleSelect.value as TypographicScaleName;
      renderLabels();
      await this.plugin.saveSettings();
    });

    resetBtn.addEventListener("click", async () => {
      this.plugin.settings.baseFontSize = TYPO_RESET_BASE_FONT_SIZE;
      this.plugin.settings.typographicScale = TYPO_RESET_SCALE;
      baseSlider.value = String(TYPO_RESET_BASE_FONT_SIZE);
      scaleSelect.value = TYPO_RESET_SCALE;
      renderLabels();
      await this.plugin.saveSettings();
    });

    const closePopover = () => {
      popover.style.display = "none";
      typoBtn.removeClass("is-open");
    };
    const openPopover = () => {
      // Sync controls with current settings in case a different surface
      // (settings panel) edited them while the popover was closed.
      baseSlider.value = String(this.plugin.settings.baseFontSize);
      scaleSelect.value = this.plugin.settings.typographicScale;
      renderLabels();
      popover.style.display = "flex";
      typoBtn.addClass("is-open");
    };

    typoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (popover.style.display === "none") openPopover();
      else closePopover();
    });

    popover.addEventListener("click", (e) => e.stopPropagation());

    container.addEventListener("click", () => {
      if (popover.style.display !== "none") closePopover();
    });

    this.containerEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && popover.style.display !== "none") {
        closePopover();
      }
    });
  }
}
