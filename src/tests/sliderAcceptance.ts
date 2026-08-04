import { AchmageSettingTab, type AchmageSettings } from "../settings";
import { DEFAULT_SETTINGS } from "../settingsDefaults";
import { SlidePreviewView } from "../view/slidePreviewView";

interface SliderAcceptanceResult {
  assertions: number;
  settingsSaves: number;
  previewSaves: number;
  selectors: string[];
}

declare global {
  interface Window {
    sliderAcceptanceFixture?: SliderAcceptanceResult;
    sliderAcceptanceFixtureError?: string;
  }
}

interface TestPlugin {
  settings: AchmageSettings;
  saveCount: number;
  persisted: AchmageSettings;
  app: {
    vault: {
      adapter: {
        getBasePath(): string;
      };
    };
  };
  manifest: { dir: string };
  saveSettings(): Promise<void>;
}

interface PreviewHarness {
  containerEl: HTMLElement;
  plugin: TestPlugin;
  updateTypoLabel: (() => void) | null;
  installTypoQuickControl(toolbar: HTMLElement, container: HTMLElement): void;
}

type ObsidianElement = HTMLElement & {
  empty(): void;
  addClass(...classes: string[]): void;
  removeClass(...classes: string[]): void;
  setCssStyles(styles: Partial<CSSStyleDeclaration>): void;
  createDiv(options?: string | { cls?: string; text?: string }): HTMLDivElement;
  createSpan(options?: string | { cls?: string; text?: string }): HTMLSpanElement;
  createEl<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    options?: {
      cls?: string;
      text?: string;
      type?: string;
      value?: string;
      attr?: Record<string, string>;
    }
  ): HTMLElementTagNameMap[K];
};

const SELECTORS = {
  settingsBase: ".achmage-setting-base-font-slider",
  settingsWash: ".achmage-setting-wash-opacity-slider",
  previewBase: ".achmage-preview-font-size-slider",
} as const;

let assertions = 0;

installObsidianDomHelpers();
(globalThis as typeof globalThis & { activeDocument: Document }).activeDocument = document;

void run().catch((error: unknown) => {
  window.sliderAcceptanceFixtureError =
    error instanceof Error ? error.stack ?? error.message : String(error);
});

async function run(): Promise<void> {
  const settingsPlugin = createPlugin({ baseFontSize: 28, tier3WashOpacity: 0.6 });
  const settingsRoot = mountSettings(settingsPlugin);
  const settingsBase = requireSlider(
    settingsRoot,
    SELECTORS.settingsBase,
    "Base font size",
    { min: "16", max: "40", step: "1", value: "28" }
  );
  const settingsWash = requireSlider(
    settingsRoot,
    SELECTORS.settingsWash,
    "Wash opacity",
    { min: "0", max: "1", step: "0.05", value: "0.6" }
  );

  await exerciseReleasedSlider(settingsBase, settingsPlugin, "baseFontSize", [16, 28, 40]);
  await exerciseReleasedSlider(settingsWash, settingsPlugin, "tier3WashOpacity", [0, 0.5, 1]);
  await exerciseArrowStep(settingsBase, settingsPlugin, "baseFontSize", 29, 30);
  await exerciseArrowStep(settingsWash, settingsPlugin, "tier3WashOpacity", 0.45, 0.5);

  const settingsNumber = requireElement<HTMLInputElement>(
    settingsRoot,
    "input.achmage-base-value[type=number]"
  );
  await commitNumber(settingsNumber, settingsBase, settingsPlugin, 99, 40);
  await commitNumber(settingsNumber, settingsBase, settingsPlugin, -1, 16);

  await setReleasedValue(settingsBase, 31);
  await setReleasedValue(settingsWash, 0.45);
  await settle();
  const restoredSettingsPlugin = createPlugin({}, settingsPlugin.persisted);
  const restoredSettingsRoot = mountSettings(restoredSettingsPlugin);
  equal(
    requireSlider(restoredSettingsRoot, SELECTORS.settingsBase, "Base font size").value,
    "31",
    "settings base value survives recreate"
  );
  equal(
    requireSlider(restoredSettingsRoot, SELECTORS.settingsWash, "Wash opacity").value,
    "0.45",
    "settings wash value survives recreate"
  );

  const previewPlugin = createPlugin({ baseFontSize: 28, typographicScale: "majorThird" });
  const previewRoot = mountPreview(previewPlugin);
  const previewBase = requireSlider(
    previewRoot,
    SELECTORS.previewBase,
    "Preview base font size",
    { min: "16", max: "40", step: "1", value: "28" }
  );

  await exerciseInstantSlider(previewBase, previewPlugin, "baseFontSize", [16, 28, 40]);
  await exerciseInstantArrowStep(previewBase, previewPlugin, 29, 30);

  const previewNumber = requireElement<HTMLInputElement>(
    previewRoot,
    "input.achmage-typo-value[type=number]"
  );
  await commitNumber(previewNumber, previewBase, previewPlugin, 99, 40);
  await commitNumber(previewNumber, previewBase, previewPlugin, -1, 16);

  const reset = requireElement<HTMLButtonElement>(previewRoot, "button.achmage-typo-reset");
  const savesBeforeReset = previewPlugin.saveCount;
  reset.click();
  await settle();
  equal(previewPlugin.saveCount, savesBeforeReset + 1, "preview Reset saves once");
  equal(previewPlugin.settings.baseFontSize, 26, "preview Reset restores base size");
  equal(previewPlugin.settings.typographicScale, "minorSecond", "preview Reset restores scale");
  equal(previewBase.value, "26", "preview Reset synchronizes slider");

  await setInstantValue(previewBase, 37);
  await settle();
  const restoredPreviewPlugin = createPlugin({}, previewPlugin.persisted);
  const restoredPreviewRoot = mountPreview(restoredPreviewPlugin);
  equal(
    requireSlider(
      restoredPreviewRoot,
      SELECTORS.previewBase,
      "Preview base font size"
    ).value,
    "37",
    "preview value survives recreate"
  );
  equal(
    requireElement<HTMLButtonElement>(restoredPreviewRoot, ".achmage-typo-btn").textContent,
    "Type 37pt",
    "preview toolbar label survives recreate"
  );

  window.sliderAcceptanceFixture = {
    assertions,
    settingsSaves: settingsPlugin.saveCount,
    previewSaves: previewPlugin.saveCount,
    selectors: Object.values(SELECTORS),
  };
}

function createPlugin(
  overrides: Partial<AchmageSettings> = {},
  restored?: AchmageSettings
): TestPlugin {
  const initial = restored ? cloneSettings(restored) : cloneSettings(DEFAULT_SETTINGS);
  Object.assign(initial, overrides);
  const plugin: TestPlugin = {
    settings: initial,
    saveCount: 0,
    persisted: cloneSettings(initial),
    app: {
      vault: {
        adapter: {
          getBasePath: () => "C:\\slider-acceptance-vault",
        },
      },
    },
    manifest: { dir: "slider-acceptance-plugin" },
    async saveSettings(): Promise<void> {
      plugin.saveCount += 1;
      plugin.persisted = cloneSettings(plugin.settings);
    },
  };
  return plugin;
}

function cloneSettings(settings: AchmageSettings): AchmageSettings {
  return {
    ...settings,
    headingDivider: [...settings.headingDivider],
    tier3BgOverrides: { ...settings.tier3BgOverrides },
  };
}

function mountSettings(plugin: TestPlugin): HTMLElement {
  const tab = new AchmageSettingTab(plugin.app as never, plugin as never);
  document.body.appendChild(tab.containerEl);
  tab.display();
  return tab.containerEl;
}

function mountPreview(plugin: TestPlugin): HTMLElement {
  const root = document.createElement("div") as ObsidianElement;
  const toolbar = root.createDiv("achmage-toolbar");
  const container = root.createDiv("achmage-slide-container");
  document.body.appendChild(root);
  const preview = Object.create(SlidePreviewView.prototype) as unknown as PreviewHarness;
  preview.containerEl = root;
  preview.plugin = plugin;
  preview.updateTypoLabel = null;
  preview.installTypoQuickControl(toolbar, container);
  return root;
}

function requireSlider(
  root: ParentNode,
  selector: string,
  accessibleName: string,
  expected?: Partial<Pick<HTMLInputElement, "min" | "max" | "step" | "value">>
): HTMLInputElement {
  const slider = requireElement<HTMLInputElement>(root, `${selector}[type=range]`);
  equal(root.querySelectorAll(`${selector}[type=range]`).length, 1, `${selector} is unique`);
  equal(slider.getAttribute("aria-label"), accessibleName, `${selector} accessible name`);
  for (const [key, value] of Object.entries(expected ?? {})) {
    equal(slider[key as keyof typeof expected], value, `${selector} ${key}`);
  }
  return slider;
}

async function exerciseReleasedSlider(
  slider: HTMLInputElement,
  plugin: TestPlugin,
  key: "baseFontSize" | "tier3WashOpacity",
  values: number[]
): Promise<void> {
  for (const value of values) {
    const savesBefore = plugin.saveCount;
    await setReleasedValue(slider, value);
    await settle();
    equal(plugin.settings[key], value, `${key} accepts ${value}`);
    equal(plugin.saveCount, savesBefore + 1, `${key} drag/release saves exactly once`);
  }
}

async function exerciseInstantSlider(
  slider: HTMLInputElement,
  plugin: TestPlugin,
  key: "baseFontSize",
  values: number[]
): Promise<void> {
  for (const value of values) {
    const savesBefore = plugin.saveCount;
    await setInstantValue(slider, value);
    await settle();
    equal(plugin.settings[key], value, `${key} instant drag accepts ${value}`);
    equal(plugin.saveCount, savesBefore + 1, `${key} instant drag saves exactly once`);
  }
}

async function exerciseArrowStep(
  slider: HTMLInputElement,
  plugin: TestPlugin,
  key: "baseFontSize" | "tier3WashOpacity",
  from: number,
  expected: number
): Promise<void> {
  slider.value = String(from);
  slider.stepUp();
  slider.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  equal(plugin.settings[key], expected, `${key} ArrowRight step`);
}

async function exerciseInstantArrowStep(
  slider: HTMLInputElement,
  plugin: TestPlugin,
  from: number,
  expected: number
): Promise<void> {
  const savesBefore = plugin.saveCount;
  slider.value = String(from);
  slider.stepUp();
  slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  slider.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  equal(plugin.settings.baseFontSize, expected, "preview ArrowRight step");
  equal(plugin.saveCount, savesBefore + 1, "preview ArrowRight saves exactly once");
}

async function commitNumber(
  input: HTMLInputElement,
  slider: HTMLInputElement,
  plugin: TestPlugin,
  typed: number,
  expected: number
): Promise<void> {
  const savesBefore = plugin.saveCount;
  input.value = String(typed);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  equal(plugin.settings.baseFontSize, expected, `number ${typed} clamps to ${expected}`);
  equal(input.value, String(expected), `number ${typed} display clamps`);
  equal(slider.value, String(expected), `number ${typed} synchronizes slider`);
  equal(plugin.saveCount, savesBefore + 1, `number ${typed} saves exactly once`);
}

async function setReleasedValue(slider: HTMLInputElement, value: number): Promise<void> {
  slider.value = String(value);
  slider.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  slider.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  slider.dispatchEvent(new Event("change", { bubbles: true }));
}

async function setInstantValue(slider: HTMLInputElement, value: number): Promise<void> {
  slider.value = String(value);
  slider.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  slider.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  slider.dispatchEvent(new Event("change", { bubbles: true }));
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  assertions += 1;
  return element as T;
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
  assertions += 1;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function installObsidianDomHelpers(): void {
  const prototype = HTMLElement.prototype as unknown as Partial<ObsidianElement>;
  prototype.empty = function empty(this: HTMLElement): void {
    this.replaceChildren();
  };
  prototype.addClass = function addClass(this: HTMLElement, ...classes: string[]): void {
    this.classList.add(...classes);
  };
  prototype.removeClass = function removeClass(this: HTMLElement, ...classes: string[]): void {
    this.classList.remove(...classes);
  };
  prototype.setCssStyles = function setCssStyles(
    this: HTMLElement,
    styles: Partial<CSSStyleDeclaration>
  ): void {
    Object.assign(this.style, styles);
  };
  prototype.createDiv = function createDiv(
    this: HTMLElement,
    options?: string | { cls?: string; text?: string }
  ): HTMLDivElement {
    return appendElement(this, "div", normalizeOptions(options));
  };
  prototype.createSpan = function createSpan(
    this: HTMLElement,
    options?: string | { cls?: string; text?: string }
  ): HTMLSpanElement {
    return appendElement(this, "span", normalizeOptions(options));
  };
  prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tagName: K,
    options?: {
      cls?: string;
      text?: string;
      type?: string;
      value?: string;
      attr?: Record<string, string>;
    }
  ): HTMLElementTagNameMap[K] {
    return appendElement(this, tagName, options);
  };
  (globalThis as unknown as {
    createEl: <K extends keyof HTMLElementTagNameMap>(
      tagName: K,
      options?: { cls?: string; text?: string; type?: string; value?: string }
    ) => HTMLElementTagNameMap[K];
  }).createEl = <K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    options?: { cls?: string; text?: string; type?: string; value?: string }
  ): HTMLElementTagNameMap[K] => appendElement(document.body, tagName, options, false);
}

function normalizeOptions(
  options?: string | { cls?: string; text?: string }
): { cls?: string; text?: string } | undefined {
  return typeof options === "string" ? { cls: options } : options;
}

function appendElement<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tagName: K,
  options?: {
    cls?: string;
    text?: string;
    type?: string;
    value?: string;
    attr?: Record<string, string>;
  },
  append = true
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (options?.cls) element.className = options.cls;
  if (options?.text !== undefined) element.textContent = options.text;
  if (options?.type !== undefined) element.setAttribute("type", options.type);
  if (options?.value !== undefined) element.setAttribute("value", options.value);
  for (const [name, value] of Object.entries(options?.attr ?? {})) {
    element.setAttribute(name, value);
  }
  if (append) parent.appendChild(element);
  return element;
}

export {};
