import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outdir = path.join(root, "build", "test", "video-artifact-acceptance");
const outfile = path.join(outdir, "video-artifact-acceptance.js");
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
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "tests", "videoArtifactAcceptance.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome138",
  outfile,
  plugins: [{
    name: "obsidian-video-artifact-stub",
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian-video-artifact-stub",
        namespace: "obsidian-video-artifact-stub",
      }));
      builder.onLoad({ filter: /.*/, namespace: "obsidian-video-artifact-stub" }, () => ({
        loader: "js",
        contents: [
          "export const normalizePath = (value) => value.replace(/\\\\/g, '/').replace(/^\\.\\//, '');",
          "export const requestUrl = async ({url}) => { const bytes = new TextEncoder().encode('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><rect width=\"8\" height=\"8\" fill=\"black\"/></svg>'); if (url === 'https://default.test/remote.svg') return {status: 200, arrayBuffer: bytes.buffer, headers: {'content-type': 'image/svg+xml'}}; if (url === 'https://default.test/404.svg') return {status: 404, arrayBuffer: bytes.buffer, headers: {'content-type': 'image/svg+xml'}}; if (url === 'https://default.test/declared-too-large.svg') return {status: 200, arrayBuffer: bytes.buffer, headers: {'content-type': 'image/svg+xml', 'content-length': String(25 * 1024 * 1024)}}; throw new Error('Unexpected requestUrl ' + url); };",
        ].join("\n"),
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
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Acceptance server did not bind.");
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.evaluate(() => {
    Object.defineProperty(Document.prototype, "win", {
      configurable: true,
      get() { return this.defaultView; },
    });
    window.createEl = (tag) => document.createElement(tag);
    window.sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  });
  await page.addScriptTag({ path: outfile });
  await page.waitForFunction(() => Boolean(window.__VIDEO_ARTIFACT_ACCEPTANCE__), null, {
    timeout: 60_000,
  });
  const result = await page.evaluate(() => window.__VIDEO_ARTIFACT_ACCEPTANCE__);
  if (!result?.passed) throw new Error(result?.error ?? "Video artifact acceptance failed.");
  console.log(`Video artifact/compositor acceptance PASS (${result.assertions} assertions)`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
