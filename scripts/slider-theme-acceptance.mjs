import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const PLUGIN_ID = "achmage-slides-ultra";
const REQUIRED_APP_VERSION = "1.13.4";
const REQUIRED_CORE_ASAR = {
  bytes: 25_783_388,
  sha256: "51218495ad940a8515b202d380bde638be6570a198e121f7ca6d484a8a158917",
};
const CONTRAST_MINIMUM = 3;

const PINNED_THEMES = {
  Minimal: {
    commit: "974cf31e3c93e7de38555ba4c1c412ce6542fe04",
    cssSha256: "4b7e6f55d017465f69ec2a145c11a171cd308e6b7c3a0fba65314f6e2f83fe7b",
    version: "9.0.2",
  },
  AnuPpuccin: {
    commit: "82d207c646904e7af371ced499f682fbdfad1012",
    cssSha256: "e883c38f36706a4dab5b772111acca4e8aaf71f1abbff919eb70e2277bc26c24",
    version: "1.5.0",
  },
  Obsidianite: {
    commit: "35d3ba897806957e5b13edb950c6b25e5ce4f5c5",
    cssSha256: "10cbc03b190f2b585e8854d6d886dd3d178f55840a82b5980cc36c979d48dce5",
    version: "2.0.2",
  },
};

const CONFIGURATIONS = [
  { id: "default-light", theme: "", mode: "light" },
  { id: "default-dark", theme: "", mode: "dark" },
  { id: "minimal-light", theme: "Minimal", mode: "light" },
  { id: "minimal-dark", theme: "Minimal", mode: "dark" },
  { id: "anuppuccin-light", theme: "AnuPpuccin", mode: "light" },
  { id: "anuppuccin-dark", theme: "AnuPpuccin", mode: "dark" },
  { id: "obsidianite-dark", theme: "Obsidianite", mode: "dark" },
];

const CONTROLS = [
  {
    id: "settings-base-font",
    selector: ".achmage-setting-base-font-slider",
    accessibleName: "Base font size",
    surface: "settings",
    numberSelector: "input.achmage-base-value",
  },
  {
    id: "settings-wash-opacity",
    selector: ".achmage-setting-wash-opacity-slider",
    accessibleName: "Wash opacity",
    surface: "settings",
  },
  {
    id: "preview-base-font",
    selector: ".achmage-preview-font-size-slider",
    accessibleName: "Preview base font size",
    surface: "preview",
    numberSelector: "input.achmage-typo-value",
  },
];

const HELP = `
Candidate-oriented Obsidian slider/theme acceptance harness.

The Obsidian process must already be running with an isolated vault, isolated
profile, and remote debugging enabled. The harness never installs or edits a
theme. It rejects unpinned or repository-local fixtures before connecting.

Required:
  --vault <path>        Isolated vault containing the candidate plugin
  --profile <path>      Isolated Obsidian user-data directory
  --themes-root <path>  External directory containing pinned theme git clones

Optional:
  --cdp-url <url>       Default: http://127.0.0.1:9333
  --slides <path>       Vault-relative fixture, default: slides.md
  --output <path>       Default: build/slider-theme-acceptance
  --native-drag <mode>  auto (default), required, or off

Equivalent environment variables are ACHMAGE_ACCEPTANCE_VAULT,
ACHMAGE_ACCEPTANCE_PROFILE, ACHMAGE_ACCEPTANCE_THEMES, ACHMAGE_ACCEPTANCE_CDP,
ACHMAGE_ACCEPTANCE_SLIDES, and PLAYWRIGHT_CORE_PATH.
`;

function parseArgs(argv) {
  const values = {
    vault: process.env.ACHMAGE_ACCEPTANCE_VAULT,
    profile: process.env.ACHMAGE_ACCEPTANCE_PROFILE,
    themesRoot: process.env.ACHMAGE_ACCEPTANCE_THEMES,
    cdpUrl: process.env.ACHMAGE_ACCEPTANCE_CDP ?? "http://127.0.0.1:9333",
    slides: process.env.ACHMAGE_ACCEPTANCE_SLIDES ?? "slides.md",
    output: path.join(REPO_ROOT, "build", "slider-theme-acceptance"),
    nativeDrag: "auto",
  };
  const map = new Map([
    ["--vault", "vault"],
    ["--profile", "profile"],
    ["--themes-root", "themesRoot"],
    ["--cdp-url", "cdpUrl"],
    ["--slides", "slides"],
    ["--output", "output"],
    ["--native-drag", "nativeDrag"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP.trim());
      process.exit(0);
    }
    const key = map.get(arg);
    if (!key || index + 1 >= argv.length) {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    values[key] = argv[index + 1];
    index += 1;
  }
  for (const key of ["vault", "profile", "themesRoot"]) {
    if (!values[key]) throw new Error(`Missing required --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  }
  if (!["auto", "required", "off"].includes(values.nativeDrag)) {
    throw new Error("--native-drag must be auto, required, or off");
  }
  return {
    ...values,
    vault: path.resolve(values.vault),
    profile: path.resolve(values.profile),
    themesRoot: path.resolve(values.themesRoot),
    output: path.resolve(values.output),
  };
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireLockFile(filePath, metadata) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const create = () => {
    const descriptor = openSync(filePath, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify({ ...metadata, pid: process.pid, token, startedAt: new Date().toISOString() })}\n`);
    } finally {
      closeSync(descriptor);
    }
  };
  try {
    create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let existing;
    try {
      existing = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      throw new Error(`Acceptance lock exists with unreadable metadata: ${filePath}`);
    }
    if (isProcessAlive(existing.pid)) {
      throw new Error(`Another slider theme acceptance run owns ${filePath}: pid=${existing.pid}, cdp=${existing.cdpUrl ?? "unknown"}`);
    }
    unlinkSync(filePath);
    create();
  }
  return {
    filePath,
    release() {
      try {
        const current = JSON.parse(readFileSync(filePath, "utf8"));
        if (current.token === token) unlinkSync(filePath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    },
  };
}

function acquireAcceptanceLocks(options) {
  const canonicalProfile = path.resolve(options.profile).toLowerCase();
  const canonicalCdp = new URL(options.cdpUrl).href.toLowerCase();
  const specs = [
    {
      filePath: path.join(tmpdir(), `achmage-slider-theme-profile-${sha256Text(canonicalProfile).slice(0, 20)}.lock`),
      metadata: { resource: "profile", profile: options.profile, cdpUrl: options.cdpUrl },
    },
    {
      filePath: path.join(tmpdir(), `achmage-slider-theme-cdp-${sha256Text(canonicalCdp).slice(0, 20)}.lock`),
      metadata: { resource: "cdp", profile: options.profile, cdpUrl: options.cdpUrl },
    },
  ].sort((left, right) => left.filePath.localeCompare(right.filePath));
  const locks = [];
  try {
    for (const spec of specs) locks.push(acquireLockFile(spec.filePath, spec.metadata));
  } catch (error) {
    for (const lock of locks.reverse()) lock.release();
    throw error;
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const lock of locks.reverse()) lock.release();
  };
  process.once("exit", release);
  return {
    paths: locks.map((lock) => lock.filePath),
    release() {
      process.removeListener("exit", release);
      release();
    },
  };
}

function isSameOrInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requireDirectory(directory, label) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`${label} is not a directory: ${directory}`);
  }
}

function git(directory, args) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function verifyIsolatedInputs(options) {
  requireDirectory(options.vault, "Vault");
  requireDirectory(options.profile, "Profile");
  requireDirectory(options.themesRoot, "Theme source root");
  for (const [label, target] of [
    ["vault", options.vault],
    ["profile", options.profile],
    ["theme source root", options.themesRoot],
  ]) {
    if (isSameOrInside(target, REPO_ROOT) || isSameOrInside(REPO_ROOT, target)) {
      throw new Error(`Refusing repository-local or repository-parent ${label}: ${target}`);
    }
  }
  if (
    isSameOrInside(options.vault, options.profile) ||
    isSameOrInside(options.profile, options.vault)
  ) {
    throw new Error("Vault and profile must be distinct, non-nested directories");
  }
  const obsidianDir = path.join(options.vault, ".obsidian");
  requireDirectory(obsidianDir, "Vault .obsidian directory");
  const enabled = readJson(path.join(obsidianDir, "community-plugins.json"));
  if (!Array.isArray(enabled) || enabled.length !== 1 || enabled[0] !== PLUGIN_ID) {
    throw new Error(`Isolated vault must enable only ${PLUGIN_ID}`);
  }

  const coreAsar = path.join(options.profile, `obsidian-${REQUIRED_APP_VERSION}.asar`);
  if (!existsSync(coreAsar)) throw new Error(`Pinned Obsidian core asset missing: ${coreAsar}`);
  const coreEvidence = {
    path: coreAsar,
    bytes: statSync(coreAsar).size,
    sha256: sha256File(coreAsar),
  };
  if (
    coreEvidence.bytes !== REQUIRED_CORE_ASAR.bytes ||
    coreEvidence.sha256 !== REQUIRED_CORE_ASAR.sha256
  ) {
    throw new Error(`Obsidian ${REQUIRED_APP_VERSION} core asset does not match the frozen fixture`);
  }

  const themeEvidence = {};
  for (const [name, pinned] of Object.entries(PINNED_THEMES)) {
    const sourceDir = path.join(options.themesRoot, name);
    const sourceCss = path.join(sourceDir, "theme.css");
    const installedDir = path.join(obsidianDir, "themes", name);
    const installedCss = path.join(installedDir, "theme.css");
    requireDirectory(sourceDir, `${name} source clone`);
    requireDirectory(installedDir, `${name} installed theme`);
    const commit = git(sourceDir, ["rev-parse", "HEAD"]);
    const dirty = git(sourceDir, ["status", "--porcelain", "--untracked-files=no"]);
    const sourceHash = sha256File(sourceCss);
    const installedHash = sha256File(installedCss);
    const manifest = readJson(path.join(installedDir, "manifest.json"));
    if (commit !== pinned.commit) throw new Error(`${name} commit mismatch: ${commit}`);
    if (dirty) throw new Error(`${name} pinned source clone has tracked modifications`);
    if (sourceHash !== pinned.cssSha256 || installedHash !== pinned.cssSha256) {
      throw new Error(`${name} theme.css does not match pinned SHA-256`);
    }
    if (manifest.version !== pinned.version) {
      throw new Error(`${name} installed version ${manifest.version} != ${pinned.version}`);
    }
    themeEvidence[name] = {
      commit,
      version: manifest.version,
      sourceCssSha256: sourceHash,
      installedCssSha256: installedHash,
    };
  }

  const pluginDir = path.join(obsidianDir, "plugins", PLUGIN_ID);
  requireDirectory(pluginDir, "Installed candidate plugin");
  const candidateAssets = {};
  for (const name of ["main.js", "manifest.json", "styles.css"]) {
    const repositoryFile = path.join(REPO_ROOT, name);
    const installedFile = path.join(pluginDir, name);
    if (!existsSync(repositoryFile) || !existsSync(installedFile)) {
      throw new Error(`Candidate asset missing: ${name}`);
    }
    const repositoryHash = sha256File(repositoryFile);
    const installedHash = sha256File(installedFile);
    if (repositoryHash !== installedHash) {
      throw new Error(`Installed ${name} is not the exact repository candidate`);
    }
    candidateAssets[name] = {
      bytes: statSync(repositoryFile).size,
      sha256: repositoryHash,
    };
  }
  return { core: coreEvidence, themes: themeEvidence, candidateAssets };
}

function resolvePlaywrightCore() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CORE_PATH) candidates.push(process.env.PLAYWRIGHT_CORE_PATH);
  candidates.push("playwright-core");
  candidates.push(
    "C:/Users/82109/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core",
  );
  const npmNpxRoot = path.join(
    process.env.LOCALAPPDATA ?? "",
    "npm-cache",
    "_npx",
  );
  if (existsSync(npmNpxRoot)) {
    for (const entry of readdirSync(npmNpxRoot)) {
      candidates.push(path.join(npmNpxRoot, entry, "node_modules", "playwright-core"));
    }
  }
  const failures = [];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const loaded = require(candidate);
      if (loaded?.chromium) return { chromium: loaded.chromium, resolvedFrom: candidate };
      failures.push(`${candidate}: chromium export missing`);
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(`Unable to resolve playwright-core:\n${failures.join("\n")}`);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findPageWithSelector(context, selector, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if (!page.isClosed() && (await page.locator(selector).count()) > 0) return page;
    }
    await delay(100);
  }
  throw new Error(`No page exposed ${selector} within ${timeoutMs}ms`);
}

async function ensureSurfaces(context, mainPage, options) {
  await mainPage.evaluate(async ({ pluginId, slides }) => {
    const enabled = Array.from(app.plugins.enabledPlugins ?? []);
    if (!enabled.includes(pluginId)) await app.plugins.enablePlugin(pluginId);
    const file = app.vault.getAbstractFileByPath(slides);
    if (!file) throw new Error(`Fixture not found in isolated vault: ${slides}`);
    await app.workspace.getLeaf(true).openFile(file);
    if (app.workspace.getLeavesOfType("achmage-slide-preview").length === 0) {
      await app.commands.executeCommandById(`${pluginId}:open-slide-preview`);
    }
    app.setting.open();
    app.setting.openTabById(pluginId);
  }, { pluginId: PLUGIN_ID, slides: options.slides });
  await delay(1_000);
  const settingsPage = await findPageWithSelector(
    context,
    ".achmage-settings-tab .achmage-setting-base-font-slider",
  );
  if (settingsPage === mainPage) {
    throw new Error("Settings must be open in a real isolated pop-out window for this matrix");
  }
  const previewPage = await findPageWithSelector(context, ".achmage-slide-container");
  const typoButton = previewPage.locator(".achmage-typo-btn");
  await typoButton.waitFor();
  if (!(await previewPage.locator(".achmage-typo-popover:visible").count())) {
    await typoButton.click();
  }
  await previewPage.locator(".achmage-preview-font-size-slider").waitFor();
  for (const control of CONTROLS) {
    const page = control.surface === "settings" ? settingsPage : previewPage;
    const locator = page.locator(control.selector);
    const count = await locator.count();
    if (count !== 1) throw new Error(`${control.selector} expected once, found ${count}`);
    const name = await locator.getAttribute("aria-label");
    if (name !== control.accessibleName) {
      throw new Error(`${control.selector} aria-label ${JSON.stringify(name)} != ${JSON.stringify(control.accessibleName)}`);
    }
  }
  return { previewPage, settingsPage };
}

async function verifyRuntime(mainPage, options) {
  const runtime = await mainPage.evaluate(() => {
    const versionMatch = document.title.match(
      /\bObsidian\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\s*$/,
    );
    return {
      appVersion: versionMatch?.[1] ?? null,
      appVersionSource: "document.title",
      documentTitle: document.title,
      vaultPath: app.vault.adapter.getBasePath?.() ?? null,
      enabledPlugins: Array.from(app.plugins.enabledPlugins ?? []).sort(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
    };
  });
  if (runtime.appVersion !== REQUIRED_APP_VERSION) {
    throw new Error(
      `Runtime Obsidian version ${runtime.appVersion} != ${REQUIRED_APP_VERSION} (title: ${JSON.stringify(runtime.documentTitle)})`,
    );
  }
  if (!runtime.vaultPath || path.resolve(runtime.vaultPath) !== options.vault) {
    throw new Error(`Connected runtime vault ${runtime.vaultPath} != ${options.vault}`);
  }
  const unexpected = runtime.enabledPlugins.filter((id) => id !== PLUGIN_ID);
  if (!runtime.enabledPlugins.includes(PLUGIN_ID) || unexpected.length > 0) {
    throw new Error(`Runtime community plugin isolation failed: ${runtime.enabledPlugins.join(", ")}`);
  }
  const activePortFile = path.join(options.profile, "DevToolsActivePort");
  if (existsSync(activePortFile)) {
    const expectedPort = new URL(options.cdpUrl).port || "80";
    const actualPort = readFileSync(activePortFile, "utf8").split(/\r?\n/, 1)[0];
    if (actualPort !== expectedPort) {
      throw new Error(`Profile DevToolsActivePort ${actualPort} != CDP port ${expectedPort}`);
    }
  } else {
    throw new Error(`Profile is not the active remote-debugging profile: ${activePortFile} missing`);
  }
  return runtime;
}

async function switchConfiguration(mainPage, pages, configuration) {
  await mainPage.evaluate(({ theme, mode }) => {
    app.changeTheme(mode === "dark" ? "obsidian" : "moonstone");
    app.customCss.setTheme(theme);
  }, configuration);
  const expectedClass = configuration.mode === "dark" ? "theme-dark" : "theme-light";
  for (const page of pages) {
    await page.waitForFunction((className) => document.body.classList.contains(className), expectedClass);
  }
  await mainPage.waitForFunction((theme) => app.customCss.theme === theme, configuration.theme);
  await delay(500);
}

function sanitizeFilePart(value) {
  return value.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-|-$/g, "");
}

async function screenshotAround(page, locator, filePath, padding = 14) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No bounding box for ${filePath}`);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const clip = {
    x: Math.max(0, box.x - padding),
    y: Math.max(0, box.y - padding),
    width: 0,
    height: 0,
  };
  clip.width = Math.min(viewport.width, box.x + box.width + padding) - clip.x;
  clip.height = Math.min(viewport.height, box.y + box.height + padding) - clip.y;
  const bytes = await page.screenshot({ path: filePath, clip });
  return { box, clip, bytes: bytes.toString("base64") };
}

async function movePointerToNeutral(page) {
  await page.mouse.move(2, 2);
  await delay(50);
}

async function forcePseudoState(context, page, selector, pseudoClass, callback) {
  const session = await context.newCDPSession(page);
  let nodeId = null;
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const documentNode = await session.send("DOM.getDocument", { depth: 0 });
    const selected = await session.send("DOM.querySelector", {
      nodeId: documentNode.root.nodeId,
      selector,
    });
    if (!selected.nodeId) throw new Error(`CDP could not locate ${selector}`);
    nodeId = selected.nodeId;
    await session.send("CSS.forcePseudoState", {
      nodeId,
      forcedPseudoClasses: [pseudoClass],
    });
    const observed = await page.locator(selector).evaluate((element, expected) => element.matches(`:${expected}`), pseudoClass);
    return { value: await callback(), observed };
  } finally {
    try {
      if (nodeId) {
        await session.send("CSS.forcePseudoState", {
          nodeId,
          forcedPseudoClasses: [],
        });
      }
    } finally {
      await session.detach();
    }
  }
}

async function imageContrastEvidence(page, idleCapture, focusCapture, numeric) {
  return page.evaluate(async ({ idleCapture: idle, focusCapture: focus, numeric: values, minimum }) => {
    const decode = async (base64) => {
      const response = await fetch(`data:image/png;base64,${base64}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
    };
    const idleImage = await decode(idle.bytes);
    const focusImage = await decode(focus.bytes);
    const scaleX = idleImage.width / idle.clip.width;
    const scaleY = idleImage.height / idle.clip.height;
    const element = {
      x: Math.round((idle.box.x - idle.clip.x) * scaleX),
      y: Math.round((idle.box.y - idle.clip.y) * scaleY),
      width: Math.round(idle.box.width * scaleX),
      height: Math.round(idle.box.height * scaleY),
    };
    const pixel = (image, x, y) => {
      const clampedX = Math.max(0, Math.min(image.width - 1, x));
      const clampedY = Math.max(0, Math.min(image.height - 1, y));
      const offset = (clampedY * image.width + clampedX) * 4;
      return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
    };
    const key = (color) => color.map((channel) => Math.min(255, Math.round(channel / 8) * 8)).join(",");
    const fromKey = (value) => value.split(",").map(Number);
    const luminance = (color) => {
      const linear = color.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const contrast = (left, right) => {
      const a = luminance(left);
      const b = luminance(right);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const dominant = (colors, excluded = []) => {
      const counts = new Map();
      for (const color of colors) {
        if (excluded.some((entry) => contrast(color, entry) < 1.08)) continue;
        const colorKey = key(color);
        counts.set(colorKey, (counts.get(colorKey) ?? 0) + 1);
      }
      const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return winner ? {
        color: fromKey(winner[0]),
        pixels: winner[1],
        sampledPixels: colors.length,
        share: colors.length > 0 ? winner[1] / colors.length : 0,
      } : null;
    };

    const outside = [];
    for (let y = 0; y < idleImage.height; y += 1) {
      for (let x = 0; x < idleImage.width; x += 1) {
        if (x < element.x - 2 || x >= element.x + element.width + 2 || y < element.y - 2 || y >= element.y + element.height + 2) {
          outside.push(pixel(idleImage, x, y));
        }
      }
    }
    const surface = dominant(outside)?.color ?? pixel(idleImage, 0, 0);
    const ratio = values.max === values.min ? 0.5 : (values.value - values.min) / (values.max - values.min);
    const thumbX = element.x + Math.round(element.width * Math.max(0.05, Math.min(0.95, ratio)));
    const centerY = element.y + Math.round(element.height / 2);
    const trackPixels = [];
    const thumbCorePixels = [];
    const thumbBoundaryPixels = [];
    const thumbRadius = Math.max(8, Math.round(element.height * 0.65));
    const thumbCoreRadius = Math.max(2, Math.round(thumbRadius * 0.35));
    for (let y = centerY - Math.max(2, Math.round(element.height * 0.18)); y <= centerY + Math.max(2, Math.round(element.height * 0.18)); y += 1) {
      for (let x = element.x; x < element.x + element.width; x += 1) {
        if (Math.abs(x - thumbX) > thumbRadius) trackPixels.push(pixel(idleImage, x, y));
      }
    }
    for (let y = centerY - thumbRadius - 2; y <= centerY + thumbRadius + 2; y += 1) {
      for (let x = thumbX - thumbRadius - 2; x <= thumbX + thumbRadius + 2; x += 1) {
        const distance = Math.hypot(x - thumbX, y - centerY);
        if (distance <= thumbCoreRadius) thumbCorePixels.push(pixel(idleImage, x, y));
        if (distance >= thumbRadius * 0.55 && distance <= thumbRadius * 1.15) {
          thumbBoundaryPixels.push(pixel(idleImage, x, y));
        }
      }
    }
    const trackCandidate = dominant(trackPixels, [surface]);
    const track = trackCandidate?.color ?? surface;
    const thumbCandidate = dominant(thumbCorePixels);
    const thumb = thumbCandidate?.color ?? surface;
    const boundaryDifferentPixels = thumbCandidate
      ? thumbBoundaryPixels.filter((color) => contrast(color, thumbCandidate.color) >= 1.1).length
      : 0;
    const thumbBoundsInsideImage =
      thumbX - thumbRadius >= 0 &&
      thumbX + thumbRadius < idleImage.width &&
      centerY - thumbRadius >= 0 &&
      centerY + thumbRadius < idleImage.height;
    const trackEvidenceCertain = Boolean(
      trackCandidate &&
      trackCandidate.pixels >= Math.max(6, Math.round(element.width * 0.1)) &&
      trackCandidate.share >= 0.05
    );
    const thumbEvidenceCertain = Boolean(
      thumbCandidate &&
      thumbBoundsInsideImage &&
      thumbCandidate.sampledPixels >= 9 &&
      thumbCandidate.share >= 0.45 &&
      boundaryDifferentPixels >= Math.max(4, Math.round(thumbBoundaryPixels.length * 0.03))
    );
    const focusPairs = [];
    const comparableWidth = Math.min(idleImage.width, focusImage.width);
    const comparableHeight = Math.min(idleImage.height, focusImage.height);
    for (let y = 0; y < comparableHeight; y += 1) {
      for (let x = 0; x < comparableWidth; x += 1) {
        const before = pixel(idleImage, x, y);
        const after = pixel(focusImage, x, y);
        if (Math.max(...after.map((value, index) => Math.abs(value - before[index]))) >= 12) {
          focusPairs.push({ after, before, ratio: contrast(after, before) });
        }
      }
    }
    focusPairs.sort((a, b) => b.ratio - a.ratio);
    const focusIndex = Math.min(focusPairs.length - 1, Math.floor(focusPairs.length * 0.1));
    const focusPair = focusPairs[Math.max(0, focusIndex)] ?? { after: surface, before: surface, ratio: 1 };
    const ratios = {
      trackVsSurface: contrast(track, surface),
      thumbVsTrack: contrast(thumb, track),
      focusVsAdjacent: focusPair.ratio,
    };
    const evidence = {
      track: {
        certain: trackEvidenceCertain,
        candidate: trackCandidate,
      },
      thumb: {
        certain: thumbEvidenceCertain,
        method: "expected-value center core with visible boundary geometry",
        candidate: thumbCandidate,
        coreRadius: thumbCoreRadius,
        expectedCenter: { x: thumbX, y: centerY },
        boundsInsideImage: thumbBoundsInsideImage,
        boundaryPixels: thumbBoundaryPixels.length,
        boundaryDifferentPixels,
      },
      focus: {
        certain: focusPairs.length >= 4,
        changedPixels: focusPairs.length,
      },
    };
    const uncertainties = Object.entries(evidence)
      .filter(([, entry]) => !entry.certain)
      .map(([name]) => name);
    return {
      algorithm: "PNG track sampling, expected-value thumb center/geometry, and upper-decile focus delta",
      colors: { surface, track, thumb, focus: focusPair.after, focusAdjacent: focusPair.before },
      ratios,
      evidence,
      uncertainties,
      passes: {
        trackVsSurface: trackEvidenceCertain && ratios.trackVsSurface >= minimum,
        thumbVsTrack: thumbEvidenceCertain && ratios.thumbVsTrack >= minimum,
        focusVsAdjacent: evidence.focus.certain && ratios.focusVsAdjacent >= minimum,
      },
      focusChangedPixels: focusPairs.length,
    };
  }, { idleCapture, focusCapture, numeric, minimum: CONTRAST_MINIMUM });
}

async function numericState(locator) {
  return locator.evaluate((element) => ({
    value: Number(element.value),
    min: Number(element.min),
    max: Number(element.max),
    step: Number(element.step || 1),
  }));
}

async function restoreValue(locator, value) {
  await locator.evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await delay(100);
}

async function pointerTarget(page, locator, value) {
  const box = await locator.boundingBox();
  const numeric = await numericState(locator);
  const ratio = numeric.max === numeric.min ? 0.5 : (value - numeric.min) / (numeric.max - numeric.min);
  const x = box.x + Math.max(5, Math.min(box.width - 5, box.width * ratio));
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await delay(100);
  return Number(await locator.inputValue());
}

function forceParentWin32LeftUp() {
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class AchmageParentPointerRelease { [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f,uint dx,uint dy,uint data,System.UIntPtr extra); }'; [AchmageParentPointerRelease]::mouse_event(0x0004,0,0,0,[System.UIntPtr]::Zero)",
    ], { timeout: 2_000, windowsHide: true, stdio: "ignore" });
    return { attempted: true, succeeded: true, error: null };
  } catch (error) {
    return { attempted: true, succeeded: false, error: error.message };
  }
}

async function runNativePointerDrag(page, locator, mode) {
  if (mode === "off") return { attempted: false, requiredPass: null, reason: "disabled" };
  if (process.platform !== "win32") {
    if (mode === "required") throw new Error("Native pointer drag is required but only implemented on Windows");
    return { attempted: false, requiredPass: null, reason: `unsupported platform ${process.platform}` };
  }
  let child = null;
  let completion = null;
  let childClosed = false;
  let stdout = "";
  let stderr = "";
  let downMarker = false;
  let activeObserved = false;
  let before = null;
  let after = null;
  let outcome = { exitCode: null, timedOut: false, spawnError: null };
  let operationError = null;
  let coordinates = null;
  let parentLeftUp = { attempted: false, succeeded: false, error: "not attempted" };
  try {
    await page.bringToFront();
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error("Native pointer target has no bounding box");
    const geometry = await page.evaluate(() => ({ screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight, devicePixelRatio }));
    const borderX = Math.max(0, (geometry.outerWidth - geometry.innerWidth) / 2);
    const titleY = Math.max(0, geometry.outerHeight - geometry.innerHeight - borderX);
    const scale = geometry.devicePixelRatio;
    const startX = Math.round((geometry.screenX + borderX + box.x + box.width * 0.25) * scale);
    const endX = Math.round((geometry.screenX + borderX + box.x + box.width * 0.75) * scale);
    const targetY = Math.round((geometry.screenY + titleY + box.y + box.height / 2) * scale);
    coordinates = { startX, endX, targetY, scale };
    before = await locator.inputValue();
    const script = [
      "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class AchmageNativePointer { [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x,int y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f,uint dx,uint dy,uint data,System.UIntPtr extra); }'",
      "$sx=[int]$env:ACHMAGE_NATIVE_START_X; $sy=[int]$env:ACHMAGE_NATIVE_START_Y; $ex=[int]$env:ACHMAGE_NATIVE_END_X; $ey=[int]$env:ACHMAGE_NATIVE_END_Y",
      "try { [AchmageNativePointer]::SetCursorPos($sx,$sy)|Out-Null; [AchmageNativePointer]::mouse_event(0x0002,0,0,0,[System.UIntPtr]::Zero); [Console]::Out.WriteLine('DOWN'); [Console]::Out.Flush(); Start-Sleep -Milliseconds 700; [AchmageNativePointer]::SetCursorPos($ex,$ey)|Out-Null; Start-Sleep -Milliseconds 300 } finally { [AchmageNativePointer]::mouse_event(0x0004,0,0,0,[System.UIntPtr]::Zero) }",
    ].join("; ");
    child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, ACHMAGE_NATIVE_START_X: String(startX), ACHMAGE_NATIVE_START_Y: String(targetY), ACHMAGE_NATIVE_END_X: String(endX), ACHMAGE_NATIVE_END_Y: String(targetY) },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let resolveDown;
    const downSignal = new Promise((resolve) => { resolveDown = resolve; });
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); if (/(^|\r?\n)DOWN(\r?\n|$)/.test(stdout)) resolveDown(true); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    completion = new Promise((resolve) => {
      const finish = (value) => { if (!childClosed) { childClosed = true; resolve(value); } };
      child.once("error", (error) => finish({ exitCode: null, spawnError: error.message }));
      child.once("close", (exitCode) => finish({ exitCode, spawnError: null }));
    });
    downMarker = await Promise.race([downSignal, completion.then(() => false), delay(5_000).then(() => false)]);
    if (!downMarker) throw new Error("Native pointer DOWN marker was not received");
    const activeDeadline = Date.now() + 900;
    while (!activeObserved && Date.now() < activeDeadline) {
      activeObserved = await locator.evaluate((element) => element.matches(":active"));
      if (!activeObserved) await delay(25);
    }
    const completed = await Promise.race([completion.then((value) => ({ done: true, value })), delay(5_000).then(() => ({ done: false }))]);
    if (!completed.done) { outcome.timedOut = true; throw new Error("Native pointer child timed out"); }
    outcome = { ...outcome, ...completed.value };
    after = await locator.inputValue();
  } catch (error) {
    operationError = error.message;
  } finally {
    try {
      if (child && !childClosed) {
        child.kill();
        if (completion) await Promise.race([completion, delay(1_000)]);
      }
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      child?.unref();
    } finally {
      parentLeftUp = forceParentWin32LeftUp();
    }
  }
  if (!parentLeftUp.succeeded) {
    throw new Error(`Parent-side Win32 LEFTUP failed: ${JSON.stringify(parentLeftUp)}`);
  }
  if (after === null) {
    try { after = await locator.inputValue(); } catch { after = null; }
  }
  const requiredSemantics = {
    downMarker,
    activeObserved,
    childExitedCleanly: childClosed && outcome.exitCode === 0,
    valueChanged: before !== null && after !== null && before !== after,
    parentLeftUpSucceeded: parentLeftUp.succeeded,
    noOperationError: operationError === null,
  };
  const requiredPass = Object.values(requiredSemantics).every(Boolean);
  const result = { attempted: true, available: requiredPass, requiredPass, requiredSemantics, before, after, operationError, outcome, parentLeftUp, stdout: stdout.trim(), stderr: stderr.trim(), coordinates };
  if (mode === "required" && !requiredPass) throw new Error(`Required OS-level pointer drag failed: ${JSON.stringify(result)}`);
  return result;
}

async function exerciseControl(context, page, control, screenshotDir, prefix, nativeDragMode) {
  const locator = page.locator(control.selector);
  await locator.scrollIntoViewIfNeeded();
  const initial = await numericState(locator);
  const middle = initial.min + Math.round((initial.max - initial.min) / initial.step / 2) * initial.step;
  await restoreValue(locator, middle);
  await locator.evaluate((element) => element.blur());

  const stateCaptures = {};
  await movePointerToNeutral(page);
  stateCaptures.idle = await screenshotAround(page, locator, path.join(screenshotDir, `${prefix}-idle.png`));
  await locator.hover();
  stateCaptures.hover = await screenshotAround(page, locator, path.join(screenshotDir, `${prefix}-hover.png`));
  await movePointerToNeutral(page);
  await locator.focus();
  stateCaptures.focus = await screenshotAround(page, locator, path.join(screenshotDir, `${prefix}-focus.png`));
  await locator.evaluate((element) => element.blur());
  const forcedActive = await forcePseudoState(context, page, control.selector, "active", () =>
    screenshotAround(page, locator, path.join(screenshotDir, `${prefix}-forced-active.png`))
  );
  stateCaptures.forcedActive = forcedActive.value;
  const syntheticActiveObserved = forcedActive.observed;

  const keyboardBefore = await locator.inputValue();
  const forwardKey = Number(keyboardBefore) >= initial.max ? "ArrowLeft" : "ArrowRight";
  const reverseKey = forwardKey === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
  await locator.press(forwardKey);
  const keyboardAfter = await locator.inputValue();
  await locator.press(reverseKey);
  const keyboardRestored = await locator.inputValue();

  const pointerValues = {};
  for (const [name, value] of [["min", initial.min], ["mid", middle], ["max", initial.max]]) {
    pointerValues[name] = await pointerTarget(page, locator, value);
  }
  await restoreValue(locator, middle);
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  let pointerActiveObserved = false;
  try {
    await delay(150);
    pointerActiveObserved = await locator.evaluate((element) => element.matches(":active"));
    stateCaptures.pointerActive = await screenshotAround(page, locator, path.join(screenshotDir, `${prefix}-pointer-active.png`));
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 5 });
  } finally {
    try {
      await page.mouse.up();
    } catch (error) {
      const emergencyRelease = process.platform === "win32"
        ? forceParentWin32LeftUp()
        : { attempted: false, succeeded: false, error: "Win32 fallback unavailable" };
      throw new Error(`Synthetic pointer release failed (${error.message}); emergency=${JSON.stringify(emergencyRelease)}`);
    }
  }
  const pointerDragChanged = Number(await locator.inputValue()) !== middle;

  await restoreValue(locator, middle);
  const nativePointer = await runNativePointerDrag(page, locator, nativeDragMode);
  await restoreValue(locator, middle);
  const numberValue = control.numberSelector
    ? await locator.evaluate((element, selector) => {
      const owner = element.closest(".setting-item-control, .achmage-typo-row") ?? element.parentElement;
      const input = owner?.querySelector(selector);
      return input instanceof HTMLInputElement ? input.value : null;
    }, control.numberSelector)
    : null;
  const clipping = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const parent = element.parentElement?.getBoundingClientRect() ?? rect;
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      parent: { x: parent.x, y: parent.y, width: parent.width, height: parent.height },
      viewport: { width: innerWidth, height: innerHeight },
      clippedByParent: rect.left < parent.left - 0.5 || rect.right > parent.right + 0.5 || rect.top < parent.top - 0.5 || rect.bottom > parent.bottom + 0.5,
      clippedByViewport: rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight,
    };
  });
  const contrast = await imageContrastEvidence(page, stateCaptures.idle, stateCaptures.focus, {
    ...initial,
    value: middle,
  });
  await restoreValue(locator, initial.value);

  const tolerance = Math.max(initial.step, (initial.max - initial.min) * 0.08);
  const pointerPass =
    Math.abs(pointerValues.min - initial.min) <= tolerance &&
    Math.abs(pointerValues.mid - middle) <= tolerance &&
    Math.abs(pointerValues.max - initial.max) <= tolerance;
  const pass =
    Object.values(contrast.passes).every(Boolean) &&
    keyboardAfter !== keyboardBefore &&
    keyboardRestored === keyboardBefore &&
    pointerPass &&
    pointerDragChanged &&
    syntheticActiveObserved &&
    (control.surface !== "preview" || pointerActiveObserved) &&
    !clipping.clippedByParent &&
    !clipping.clippedByViewport &&
    (!control.numberSelector || Number(numberValue) === middle) &&
    (nativeDragMode === "off" || nativePointer.requiredPass === true);
  return {
    id: control.id,
    selector: control.selector,
    accessibleName: control.accessibleName,
    initial,
    middle,
    contrast,
    keyboard: {
      before: keyboardBefore,
      forwardKey,
      after: keyboardAfter,
      reverseKey,
      restored: keyboardRestored,
      pass: keyboardAfter !== keyboardBefore && keyboardRestored === keyboardBefore,
    },
    pointer: {
      values: pointerValues,
      tolerance,
      roundTripPass: pointerPass,
      activeObserved: pointerActiveObserved,
      activeRequired: control.surface === "preview",
      dragChanged: pointerDragChanged,
    },
    syntheticActive: { observed: syntheticActiveObserved, pass: syntheticActiveObserved },
    nativePointer,
    numberInput: control.numberSelector ? { selector: control.numberSelector, value: numberValue, synced: Number(numberValue) === middle } : null,
    clipping,
    screenshots: Object.fromEntries(Object.entries(stateCaptures).map(([state, capture]) => [
      state,
      path.basename(path.join(screenshotDir, `${prefix}-${state.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}.png`)),
    ])),
    pass,
  };
}

async function reopenPreview(mainPage, context, expectedValue) {
  await mainPage.evaluate(async ({ pluginId }) => {
    app.workspace.detachLeavesOfType("achmage-slide-preview");
    await app.commands.executeCommandById(`${pluginId}:open-slide-preview`);
  }, { pluginId: PLUGIN_ID });
  const previewPage = await findPageWithSelector(context, ".achmage-slide-container");
  await previewPage.locator(".achmage-typo-btn").click();
  await previewPage.locator(".achmage-preview-font-size-slider").waitFor();
  const value = await previewPage.locator(".achmage-preview-font-size-slider").inputValue();
  return { previewPage, value, expectedValue, pass: Number(value) === expectedValue };
}

function serializableCaptureOmitter(_key, value) {
  if (_key === "bytes") return undefined;
  return value;
}

async function closeBrowserBounded(browser, timeoutMs = 10_000) {
  const settleWithin = async (promise, limitMs) => {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ completed: false }), limitMs);
    });
    const result = await Promise.race([
      promise.then((value) => ({ completed: true, value })),
      timeout,
    ]);
    clearTimeout(timer);
    return result;
  };
  const closePromise = browser.close({ reason: "Achmage slider theme acceptance complete" })
    .then(() => ({ ok: true, error: null }))
    .catch((error) => ({ ok: false, error }));
  const graceful = await settleWithin(closePromise, timeoutMs);
  if (graceful.completed) {
    if (!graceful.value.ok) throw graceful.value.error;
    return { pass: true, mode: "browser-close", timedOut: false, closePromiseSettled: true };
  }

  // Playwright exposes no public disconnect for connectOverCDP. Closing the
  // client connection is the bounded fallback that releases local handles
  // without discarding an otherwise complete matrix report.
  if (!browser._connection || typeof browser._connection.close !== "function") {
    throw new Error(`Timed out closing isolated Obsidian browser after ${timeoutMs}ms; client connection unavailable`);
  }
  browser._connection.close("Timed out closing isolated Obsidian CDP browser");
  const fallback = await settleWithin(closePromise, 1_000);
  return {
    pass: true,
    mode: "client-disconnect-fallback",
    timedOut: true,
    closePromiseSettled: fallback.completed,
    closeError: fallback.completed && !fallback.value.ok ? fallback.value.error.message : null,
  };
}

async function runAcceptance(options, acceptanceLocks) {
  const frozenInputs = verifyIsolatedInputs(options);
  const { chromium, resolvedFrom } = resolvePlaywrightCore();
  const gitSha = git(REPO_ROOT, ["rev-parse", "HEAD"]);
  const dirtyPaths = git(REPO_ROOT, ["status", "--short"]);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${gitSha.slice(0, 12)}`;
  const runDir = path.join(options.output, runId);
  const screenshotDir = path.join(runDir, "screenshots");
  const reportPath = path.join(runDir, "report.json");
  mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.connectOverCDP(options.cdpUrl);
  let report;
  let acceptanceError = null;
  let teardownError = null;
  let reportWriteError = null;
  const persistReport = () => {
    if (!report) return;
    try {
      writeFileSync(reportPath, `${JSON.stringify(report, serializableCaptureOmitter, 2)}\n`);
    } catch (error) {
      reportWriteError ??= error;
    }
  };
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("CDP endpoint has no browser context");
    const mainPage = context.pages().find((page) => page.url().startsWith("app://"));
    if (!mainPage) throw new Error("Obsidian app page not found at CDP endpoint");
    const runtime = await verifyRuntime(mainPage, options);
    let surfaces = await ensureSurfaces(context, mainPage, options);
    report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      candidate: { gitSha, dirtyPaths: dirtyPaths ? dirtyPaths.split(/\r?\n/) : [], assets: frozenInputs.candidateAssets },
      isolation: {
        vault: options.vault,
        profile: options.profile,
        themesRoot: options.themesRoot,
        cdpUrl: options.cdpUrl,
        fixture: options.slides,
        nativeDrag: options.nativeDrag,
        exclusiveLocks: acceptanceLocks.paths,
      },
      playwrightCore: resolvedFrom,
      runtime,
      frozenCore: frozenInputs.core,
      pinnedThemes: frozenInputs.themes,
      contrastMinimum: CONTRAST_MINIMUM,
      configurations: [],
    };

    for (const configuration of CONFIGURATIONS) {
      await switchConfiguration(mainPage, [surfaces.previewPage, surfaces.settingsPage], configuration);
      const entry = {
        ...configuration,
        settingsPopout: surfaces.settingsPage !== mainPage,
        controls: [],
      };
      for (const control of CONTROLS) {
        const page = control.surface === "settings" ? surfaces.settingsPage : surfaces.previewPage;
        const prefix = `${sanitizeFilePart(configuration.id)}-${sanitizeFilePart(control.id)}`;
        entry.controls.push(await exerciseControl(
          context,
          page,
          control,
          screenshotDir,
          prefix,
          options.nativeDrag,
        ));
      }
      const expectedPreviewValue = entry.controls.find((control) => control.id === "preview-base-font").initial.value;
      const reopened = await reopenPreview(mainPage, context, expectedPreviewValue);
      surfaces = { ...surfaces, previewPage: reopened.previewPage };
      entry.previewReopen = { value: reopened.value, pass: reopened.pass };
      entry.pass = entry.settingsPopout && entry.previewReopen.pass && entry.controls.every((control) => control.pass);
      report.configurations.push(entry);
    }
    report.summary = {
      configurations: report.configurations.length,
      controls: report.configurations.reduce((sum, entry) => sum + entry.controls.length, 0),
      screenshots: readdirSync(screenshotDir).filter((name) => name.endsWith(".png")).length,
      failures: report.configurations.flatMap((entry) => [
        ...(entry.pass ? [] : [{ configuration: entry.id, kind: "configuration" }]),
        ...entry.controls.filter((control) => !control.pass).map((control) => ({ configuration: entry.id, control: control.id, kind: "control" })),
      ]),
    };
    report.pass = report.summary.failures.length === 0;
  } catch (error) {
    acceptanceError = error;
    if (report) {
      report.error = error instanceof Error ? error.stack : String(error);
      report.pass = false;
    }
  } finally {
    if (report) {
      report.teardown = { status: "pending", pass: null };
      persistReport();
    }
    try {
      const teardown = await closeBrowserBounded(browser);
      if (report) {
        report.teardown = { status: "complete", ...teardown };
        persistReport();
      }
    } catch (error) {
      teardownError = error;
      if (report) {
        report.teardown = {
          status: "failed",
          pass: false,
          error: error instanceof Error ? error.stack : String(error),
        };
        report.pass = false;
        if (report.summary) report.summary.failures.push({ kind: "teardown" });
        persistReport();
      }
    }
  }

  if (acceptanceError) throw acceptanceError;
  if (teardownError) throw teardownError;
  if (reportWriteError) throw reportWriteError;
  console.log(JSON.stringify({ report: reportPath, ...report.summary, pass: report.pass }, null, 2));
  if (!report.pass) process.exitCode = 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const acceptanceLocks = acquireAcceptanceLocks(options);
  try {
    await runAcceptance(options, acceptanceLocks);
  } finally {
    acceptanceLocks.release();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
