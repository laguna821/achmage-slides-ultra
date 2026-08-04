import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

class Cdp {
  static async connect(url) {
    const cdp = new Cdp(url);
    await cdp.ready;
    return cdp;
  }

  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

const projectRoot = path.resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "asu-slider-acceptance-"));
const fixtureBundle = path.join(tempDir, "sliderAcceptance.js");
const fixturePage = path.join(tempDir, "sliderAcceptance.html");
const chromePath = [
  process.env.ACHMAGE_BROWSER,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((candidate) => candidate && existsSync(candidate));

if (!chromePath) {
  throw new Error("No Chromium browser found. Set ACHMAGE_BROWSER to Chrome or Edge.");
}

const obsidianRuntimeStub = () => ({
  name: "obsidian-slider-runtime-stub",
  setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({
      path: "obsidian-slider-runtime-stub",
      namespace: "obsidian-slider-runtime-stub",
    }));
    builder.onLoad({ filter: /.*/, namespace: "obsidian-slider-runtime-stub" }, () => ({
      contents: String.raw`
        export class App {}
        export class Notice { constructor(message) { this.message = message; } }
        export class WorkspaceLeaf {}
        export class TFile {}
        export const debounce = (callback) => callback;

        export class PluginSettingTab {
          constructor(app, plugin) {
            this.app = app;
            this.plugin = plugin;
            this.containerEl = document.createElement("div");
          }
        }

        export class ItemView {
          constructor(leaf) {
            this.leaf = leaf;
            this.app = leaf?.app ?? {};
            this.containerEl = document.createElement("div");
            this.containerEl.append(document.createElement("div"), document.createElement("div"));
          }
          registerEvent() {}
        }

        export class SliderComponent {
          constructor(containerEl) {
            this.sliderEl = document.createElement("input");
            this.sliderEl.type = "range";
            this.instant = false;
            this.changeCallback = null;
            containerEl.appendChild(this.sliderEl);
            this.sliderEl.addEventListener("input", () => {
              if (this.instant) this.emit();
            });
            this.sliderEl.addEventListener("change", () => {
              if (!this.instant) this.emit();
            });
          }
          emit() {
            if (this.changeCallback) void this.changeCallback(this.getValue());
          }
          setDisabled(disabled) { this.sliderEl.disabled = disabled; return this; }
          setInstant(instant) { this.instant = instant; return this; }
          setLimits(min, max, step) {
            if (min === null) this.sliderEl.removeAttribute("min"); else this.sliderEl.min = String(min);
            if (max === null) this.sliderEl.removeAttribute("max"); else this.sliderEl.max = String(max);
            this.sliderEl.step = String(step);
            return this;
          }
          getValue() { return Number(this.sliderEl.value); }
          setValue(value) {
            const next = String(value);
            if (this.sliderEl.value === next) return this;
            this.sliderEl.value = next;
            if (this.changeCallback) void this.changeCallback(this.getValue());
            return this;
          }
          setDynamicTooltip() { return this; }
          showTooltip() { return this; }
          onChange(callback) { this.changeCallback = callback; return this; }
        }

        class DropdownComponent {
          constructor(containerEl) {
            this.selectEl = document.createElement("select");
            containerEl.appendChild(this.selectEl);
          }
          addOption(value, label) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            this.selectEl.appendChild(option);
            return this;
          }
          setValue(value) { this.selectEl.value = value; return this; }
          onChange(callback) {
            this.selectEl.addEventListener("change", () => void callback(this.selectEl.value));
            return this;
          }
        }

        class TextComponent {
          constructor(containerEl) {
            this.inputEl = document.createElement("input");
            this.inputEl.type = "text";
            containerEl.appendChild(this.inputEl);
          }
          setPlaceholder(value) { this.inputEl.placeholder = value; return this; }
          setValue(value) { this.inputEl.value = value; return this; }
          onChange(callback) {
            this.inputEl.addEventListener("change", () => void callback(this.inputEl.value));
            return this;
          }
        }

        class ToggleComponent {
          constructor(containerEl) {
            this.toggleEl = document.createElement("input");
            this.toggleEl.type = "checkbox";
            containerEl.appendChild(this.toggleEl);
          }
          setValue(value) { this.toggleEl.checked = value; return this; }
          onChange(callback) {
            this.toggleEl.addEventListener("change", () => void callback(this.toggleEl.checked));
            return this;
          }
        }

        class ButtonComponent {
          constructor(containerEl) {
            this.buttonEl = document.createElement("button");
            containerEl.appendChild(this.buttonEl);
          }
          setButtonText(value) { this.buttonEl.textContent = value; return this; }
          setTooltip(value) { this.buttonEl.title = value; return this; }
          onClick(callback) {
            this.buttonEl.addEventListener("click", () => void callback());
            return this;
          }
        }

        export class Setting {
          constructor(containerEl) {
            this.settingEl = document.createElement("div");
            this.settingEl.className = "setting-item";
            this.infoEl = document.createElement("div");
            this.infoEl.className = "setting-item-info";
            this.nameEl = document.createElement("div");
            this.nameEl.className = "setting-item-name";
            this.descEl = document.createElement("div");
            this.descEl.className = "setting-item-description";
            this.controlEl = document.createElement("div");
            this.controlEl.className = "setting-item-control";
            this.infoEl.append(this.nameEl, this.descEl);
            this.settingEl.append(this.infoEl, this.controlEl);
            containerEl.appendChild(this.settingEl);
          }
          setName(value) { this.nameEl.textContent = value; this.settingEl.dataset.settingName = value; return this; }
          setDesc(value) { this.descEl.textContent = String(value); return this; }
          setHeading() { this.settingEl.classList.add("setting-item-heading"); return this; }
          addSlider(callback) { callback(new SliderComponent(this.controlEl)); return this; }
          addDropdown(callback) { callback(new DropdownComponent(this.controlEl)); return this; }
          addText(callback) { callback(new TextComponent(this.controlEl)); return this; }
          addToggle(callback) { callback(new ToggleComponent(this.controlEl)); return this; }
          addButton(callback) { callback(new ButtonComponent(this.controlEl)); return this; }
        }
      `,
      loader: "js",
    }));
  },
});

let chrome;
let cdp;
try {
  await build({
    entryPoints: [path.join(projectRoot, "src", "tests", "sliderAcceptance.ts")],
    outfile: fixtureBundle,
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    logLevel: "silent",
    plugins: [obsidianRuntimeStub()],
  });
  await writeFile(
    fixturePage,
    `<!doctype html><html><body><script src="${pathToFileURL(fixtureBundle).href}"></script></body></html>`,
    "utf8"
  );
  assert.ok((await readFile(fixtureBundle, "utf8")).includes("sliderAcceptanceFixture"));

  const debugPort = await getFreePort();
  const chromeUserData = path.join(tempDir, "chrome-profile");
  chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeUserData}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
  ], { stdio: "ignore" });

  await waitForChrome(debugPort);
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
    method: "PUT",
  }).then((response) => response.json());
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: pathToFileURL(fixturePage).href });
  const outcome = await waitForOutcome(cdp);
  if (outcome.error) throw new Error(`Slider acceptance fixture failed:\n${outcome.error}`);
  assert.ok(outcome.result, "fixture result missing");
  assert.ok(outcome.result.assertions >= 60, `expected >=60 assertions, got ${outcome.result.assertions}`);
  assert.deepEqual(outcome.result.selectors, [
    ".achmage-setting-base-font-slider",
    ".achmage-setting-wash-opacity-slider",
    ".achmage-preview-font-size-slider",
  ]);
  console.log(
    `Slider acceptance: PASS (${outcome.result.assertions} fixture assertions, ` +
    `${outcome.result.settingsSaves} settings saves, ${outcome.result.previewSaves} preview saves)`
  );
} finally {
  cdp?.close();
  chrome?.kill();
  await removeTempDir(tempDir);
}

async function waitForOutcome(cdp) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await cdp.send("Runtime.evaluate", {
      expression: `({
        result: window.sliderAcceptanceFixture ?? null,
        error: window.sliderAcceptanceFixtureError ?? null,
      })`,
      returnByValue: true,
    });
    const value = response.result.value;
    if (value?.result || value?.error) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for slider acceptance fixture");
}

async function waitForChrome(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome has not opened its remote-debugging socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Chromium remote debugging");
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate Chromium debug port"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function removeTempDir(directory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
      return;
    } catch (error) {
      if (error?.code !== "EBUSY" && error?.code !== "EPERM") throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  console.warn(`Slider acceptance cleanup deferred: ${directory}`);
}
