import { build } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outdir = path.join(root, "build", "test", "video-export-acceptance");
const outfile = path.join(outdir, "video-export-acceptance.js");
const executablePath = [
  process.env.ACHMAGE_BROWSER,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((candidate) => candidate && existsSync(candidate));

if (!executablePath) throw new Error("No Chromium browser found. Set ACHMAGE_BROWSER.");

const mainSource = readFileSync(path.join(root, "src", "main.ts"), "utf8");
const previewSource = readFileSync(
  path.join(root, "src", "view", "slidePreviewView.ts"),
  "utf8"
);
if (!mainSource.includes('id: "export-mp4"')) {
  throw new Error("The exact export-mp4 command id is missing.");
}
if (!mainSource.includes("Export current note as ${MP4_FORMAT_NAME}")) {
  throw new Error("The MP4 command name is missing.");
}
if (!previewSource.includes("this.plugin.openVideoExport(file)")) {
  throw new Error("The Preview MP4 entry point is not wired to the shared service.");
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "tests", "videoExportAcceptance.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome138",
  external: ["node:*"],
  outfile,
  plugins: [{
    name: "obsidian-video-export-stub",
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian-video-export-stub",
        namespace: "obsidian-video-export-stub",
      }));
      builder.onLoad({ filter: /.*/, namespace: "obsidian-video-export-stub" }, () => ({
        loader: "js",
        contents: `
          export class TFile {}
          export class FileSystemAdapter {}
          export class Modal {
            constructor(app) {
              this.app = app;
              this.modalEl = document.createElement('div');
              this.contentEl = document.createElement('div');
              this.modalEl.append(this.contentEl);
            }
            setTitle(value) {
              let title = this.modalEl.querySelector('.modal-title');
              if (!title) {
                title = document.createElement('h2');
                title.className = 'modal-title';
                this.modalEl.prepend(title);
              }
              title.textContent = value;
            }
            open() {
              if (!this.modalEl.isConnected) document.body.append(this.modalEl);
              this.onOpen?.();
            }
            close() {
              if (!this.modalEl.isConnected) return;
              this.modalEl.remove();
              this.onClose?.();
            }
          }
          export const normalizePath = (value) => value.replace(/\\\\/g, '/').replace(/^\\.\\//, '');
          export const requestUrl = async () => { throw new Error('requestUrl is not used by this UI acceptance'); };
        `,
      }));
    },
  }],
});

const browser = await chromium.launch({ executablePath, headless: true });
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><html><body></body></html>");
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Acceptance server did not bind.");
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.evaluate(() => {
    const applyOptions = (element, options = {}) => {
      if (options.cls) element.className = options.cls;
      if (options.text !== undefined) element.textContent = options.text;
      for (const [name, value] of Object.entries(options.attr ?? {})) {
        element.setAttribute(name, String(value));
      }
      return element;
    };
    HTMLElement.prototype.createEl = function (tag, options) {
      const child = applyOptions(document.createElement(tag), options);
      this.append(child);
      return child;
    };
    HTMLElement.prototype.createDiv = function (options) {
      const normalized = typeof options === 'string' ? { cls: options } : options;
      return this.createEl('div', normalized);
    };
    HTMLElement.prototype.createSpan = function (options) {
      return this.createEl('span', options);
    };
    HTMLElement.prototype.empty = function () { this.replaceChildren(); };
    HTMLElement.prototype.addClass = function (...values) { this.classList.add(...values); };
    HTMLElement.prototype.toggleClass = function (value, force) {
      this.classList.toggle(value, force);
    };
    Object.defineProperty(Document.prototype, "win", {
      configurable: true,
      get() { return this.defaultView; },
    });
    window.createEl = (tag) => document.createElement(tag);
    window.sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  });
  await page.addScriptTag({ path: outfile });
  await page.waitForFunction(() => Boolean(window.__VIDEO_EXPORT_ACCEPTANCE__), null, {
    timeout: 30_000,
  });
  const result = await page.evaluate(() => window.__VIDEO_EXPORT_ACCEPTANCE__);
  if (!result?.passed) throw new Error(result?.error ?? "Video export acceptance failed.");
  console.log(`Video export UI/service acceptance PASS (${result.assertions} assertions)`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
