import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { chromium } from "playwright-core";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const PROBE_ENTRY = path.join(SCRIPT_DIR, "video-codec-probe.ts");
const MEDIABUNNY_VERSION = "1.52.3";
const MEDIABUNNY_INTEGRITY =
  "sha512-rMGwH5fykDCSA55LG9aWkE433wwHrycq3J5mRf+djBnHBZzmJGvIwg6Qfcfr4rRkzkmrdmewxQozLkOM1H1C6Q==";
const DEFAULT_APP_VERSION = "1.13.4";

const HELP = `
Runs the fail-closed Achmage H.264 qualification in a real, isolated Obsidian
Electron renderer. The probe encodes, finalizes, parses, and decodes a silent
1920x1080, 30fps, two-second AVC MP4 and preserves JSON/hash evidence.

Required:
  --executable <path>          Obsidian executable to launch
  --expected-electron <ver>   Exact Electron version expected in the renderer

Optional:
  --expected-app-version <v>  Obsidian API/app package version (default: 1.13.4)
  --core-asar <path>          Seed an app package into the isolated profile
  --core-asar-sha256 <hash>   Required SHA-256 for --core-asar
  --installer-url <url>       Pinned installer source recorded in the report
  --installer-sha256 <hash>   Verified installer digest recorded in the report
  --output <path>             Evidence root (default: build/video-codec-qualification)
  --cdp-port <port>           Fixed loopback CDP port (default: ephemeral)
  --timeout-ms <ms>           Startup/probe timeout (default: 120000)
  --keep-fixture              Keep the isolated profile and vault for diagnosis
`;

function parseArgs(argv) {
  const values = {
    appVersion: DEFAULT_APP_VERSION,
    executable: null,
    expectedElectron: null,
    coreAsar: null,
    coreAsarSha256: null,
    installerUrl: null,
    installerSha256: null,
    output: path.join(REPO_ROOT, "build", "video-codec-qualification"),
    cdpPort: null,
    timeoutMs: 120_000,
    keepFixture: false,
  };
  const fields = new Map([
    ["--executable", "executable"],
    ["--expected-electron", "expectedElectron"],
    ["--expected-app-version", "appVersion"],
    ["--core-asar", "coreAsar"],
    ["--core-asar-sha256", "coreAsarSha256"],
    ["--installer-url", "installerUrl"],
    ["--installer-sha256", "installerSha256"],
    ["--output", "output"],
    ["--cdp-port", "cdpPort"],
    ["--timeout-ms", "timeoutMs"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      console.log(HELP.trim());
      process.exit(0);
    }
    if (argument === "--keep-fixture") {
      values.keepFixture = true;
      continue;
    }
    const key = fields.get(argument);
    if (!key || index + 1 >= argv.length) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
    values[key] = argv[index + 1];
    index += 1;
  }
  if (!values.executable) throw new Error("Missing required --executable");
  if (!values.expectedElectron) throw new Error("Missing required --expected-electron");
  values.executable = path.resolve(values.executable);
  values.output = path.resolve(values.output);
  values.coreAsar = values.coreAsar ? path.resolve(values.coreAsar) : null;
  values.timeoutMs = Number(values.timeoutMs);
  values.cdpPort = values.cdpPort === null ? null : Number(values.cdpPort);
  if (!Number.isInteger(values.timeoutMs) || values.timeoutMs < 30_000) {
    throw new Error("--timeout-ms must be an integer of at least 30000");
  }
  if (values.cdpPort !== null && (!Number.isInteger(values.cdpPort) || values.cdpPort < 1024 || values.cdpPort > 65535)) {
    throw new Error("--cdp-port must be an integer from 1024 to 65535");
  }
  if (!existsSync(values.executable) || !statSync(values.executable).isFile()) {
    throw new Error(`Obsidian executable does not exist: ${values.executable}`);
  }
  if (values.coreAsar && !values.coreAsarSha256) {
    throw new Error("--core-asar-sha256 is required with --core-asar");
  }
  if (values.coreAsarSha256 && !/^[a-f0-9]{64}$/i.test(values.coreAsarSha256)) {
    throw new Error("--core-asar-sha256 must be a 64-character hexadecimal SHA-256");
  }
  if (values.installerSha256 && !/^[a-f0-9]{64}$/i.test(values.installerSha256)) {
    throw new Error("--installer-sha256 must be a 64-character hexadecimal SHA-256");
  }
  return values;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256Bytes(readFileSync(filePath));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function verifyDependencyIdentity() {
  const packageJson = readJson(path.join(REPO_ROOT, "package.json"));
  const packageLock = readJson(path.join(REPO_ROOT, "package-lock.json"));
  const lockEntry = packageLock.packages?.["node_modules/mediabunny"];
  if (packageJson.dependencies?.mediabunny !== MEDIABUNNY_VERSION) {
    throw new Error(`package.json must pin mediabunny exactly to ${MEDIABUNNY_VERSION}`);
  }
  if (lockEntry?.version !== MEDIABUNNY_VERSION || lockEntry?.integrity !== MEDIABUNNY_INTEGRITY) {
    throw new Error("package-lock.json does not contain the approved Mediabunny identity");
  }
  return {
    name: "mediabunny",
    version: lockEntry.version,
    integrity: lockEntry.integrity,
    license: "MPL-2.0",
  };
}

function createRunDirectory(outputRoot) {
  mkdirSync(outputRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDirectory = path.join(outputRoot, `${stamp}-${process.platform}-${process.pid}`);
  mkdirSync(runDirectory, { recursive: false });
  return runDirectory;
}

function prepareFixture(options) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "achmage-video-codec-"));
  const profile = path.join(fixtureRoot, "profile");
  const vault = path.join(fixtureRoot, "vault");
  const obsidianConfig = path.join(vault, ".obsidian");
  mkdirSync(profile, { recursive: true });
  mkdirSync(obsidianConfig, { recursive: true });
  writeFileSync(path.join(vault, "qualification.md"), "# Achmage video codec qualification\n", "utf8");
  writeFileSync(path.join(obsidianConfig, "community-plugins.json"), "[]\n", "utf8");
  writeFileSync(path.join(obsidianConfig, "core-plugins.json"), "[]\n", "utf8");
  writeFileSync(path.join(obsidianConfig, "app.json"), "{\"showReleaseNotes\":false}\n", "utf8");
  writeFileSync(
    path.join(profile, "obsidian.json"),
    `${JSON.stringify({
      vaults: {
        qualification: { path: vault, ts: Date.now(), open: true },
      },
      frame: "hidden",
    })}\n`,
    "utf8",
  );

  let seededCore = null;
  if (options.coreAsar) {
    if (!existsSync(options.coreAsar) || !statSync(options.coreAsar).isFile()) {
      throw new Error(`Core app package does not exist: ${options.coreAsar}`);
    }
    const actualHash = sha256File(options.coreAsar);
    if (actualHash.toLowerCase() !== options.coreAsarSha256.toLowerCase()) {
      throw new Error(`Core app package SHA-256 mismatch: ${actualHash}`);
    }
    const destination = path.join(profile, `obsidian-${options.appVersion}.asar`);
    copyFileSync(options.coreAsar, destination);
    seededCore = {
      source: options.coreAsar,
      destination,
      bytes: statSync(destination).size,
      sha256: actualHash,
    };
  }
  return { fixtureRoot, profile, vault, seededCore };
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not allocate a loopback CDP port"));
        else resolve(port);
      });
    });
  });
}

function boundedLogCollector(stream, maximumBytes = 256_000) {
  let value = "";
  stream?.on("data", (chunk) => {
    value += chunk.toString();
    if (value.length > maximumBytes) value = value.slice(-maximumBytes);
  });
  return () => value;
}

function launchObsidian(options, fixture, cdpPort) {
  const arguments_ = [
    `--user-data-dir=${fixture.profile}`,
    `--remote-debugging-port=${cdpPort}`,
    `--remote-allow-origins=http://127.0.0.1:${cdpPort}`,
    "--window-position=-32000,-32000",
    "--window-size=800,600",
  ];
  const child = spawn(options.executable, arguments_, {
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout = boundedLogCollector(child.stdout);
  const stderr = boundedLogCollector(child.stderr);
  let exit = null;
  child.once("exit", (code, signal) => {
    exit = { code, signal };
  });
  return { child, stdout, stderr, getExit: () => exit, arguments: arguments_ };
}

async function waitForCdp(cdpUrl, launch, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${cdpUrl}/json/version`);
      if (response.ok) return await response.json();
      lastError = new Error(`CDP returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    const exit = launch.getExit();
    if (exit && exit.code !== 0) {
      throw new Error(`Obsidian exited before CDP became ready: ${JSON.stringify(exit)}\n${launch.stderr()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${cdpUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function buildProbeBundle() {
  const result = await build({
    entryPoints: [PROBE_ENTRY],
    bundle: true,
    charset: "utf8",
    format: "iife",
    logLevel: "silent",
    minify: true,
    platform: "node",
    target: "node22",
    write: false,
  });
  const output = result.outputFiles?.[0];
  if (!output) throw new Error("esbuild did not emit the codec probe bundle");
  return {
    text: output.text,
    bytes: output.contents.byteLength,
    sha256: sha256Bytes(output.contents),
  };
}

async function findObsidianPage(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if (!page.isClosed() && page.url().startsWith("app://obsidian.md")) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The CDP endpoint did not expose an app://obsidian.md page");
}

async function readRuntime(page) {
  return page.evaluate(() => {
    return {
      appReady: Boolean(globalThis.app?.workspace && globalThis.app?.vault),
      appVersionCandidates: {
        appApiVersion: globalThis.app?.apiVersion ?? null,
        appVersion: globalThis.app?.version ?? null,
        globalApiVersion: globalThis.obsidian?.apiVersion ?? null,
      },
      nodeRequireAvailable: typeof globalThis.require === "function",
      processVersions: { ...globalThis.process?.versions },
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      pageUrl: location.href,
    };
  });
}

function assertRuntime(runtime, options, fixture) {
  if (!runtime.appReady) throw new Error("Obsidian app/vault globals are not ready");
  if (runtime.processVersions?.electron !== options.expectedElectron) {
    throw new Error(`Expected Electron ${options.expectedElectron}, got ${runtime.processVersions?.electron}`);
  }
  const observedVersions = Object.values(runtime.appVersionCandidates).filter(Boolean);
  if (observedVersions.length > 0 && !observedVersions.includes(options.appVersion)) {
    throw new Error(`Observed Obsidian version candidates do not include ${options.appVersion}: ${observedVersions.join(", ")}`);
  }
  const releaseAssetPattern = new RegExp(
    `^https://github\\.com/obsidianmd/obsidian-releases/releases/download/v${options.appVersion.replaceAll(".", "\\.")}/Obsidian-${options.appVersion.replaceAll(".", "\\.")}\\.(?:exe|dmg)$`,
  );
  const hasPinnedReleaseIdentity =
    Boolean(options.installerSha256) &&
    Boolean(options.installerUrl) &&
    releaseAssetPattern.test(options.installerUrl);
  if (!fixture.seededCore && !hasPinnedReleaseIdentity) {
    throw new Error(
      "App-package identity is unproven: provide a hash-verified --core-asar or the pinned official installer URL/SHA-256",
    );
  }
}

async function closeBrowserBounded(browser, timeoutMs = 10_000) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const closed = await Promise.race([
    browser.close({ reason: "Achmage video codec qualification complete" }).then(() => true),
    timeout,
  ]).catch(() => false);
  clearTimeout(timer);
  if (!closed && browser._connection && typeof browser._connection.close === "function") {
    browser._connection.close("Achmage codec qualification bounded disconnect");
  }
  return { closed };
}

function isAlive(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateProcessTree(child) {
  if (!isAlive(child)) return { attempted: false, method: null };
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return { attempted: true, method: "taskkill-tree" };
    } catch (error) {
      return { attempted: true, method: "taskkill-tree", error: error.message };
    }
  }
  try {
    child.kill("SIGTERM");
    return { attempted: true, method: "sigterm" };
  } catch (error) {
    return { attempted: true, method: "sigterm", error: error.message };
  }
}

function serializeError(error) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    name: normalized.name,
    message: normalized.message,
    stack: normalized.stack ?? null,
  };
}

async function safeRemoveFixture(fixtureRoot) {
  const canonicalRoot = path.resolve(fixtureRoot);
  const canonicalTemp = path.resolve(tmpdir());
  const relative = path.relative(canonicalTemp, canonicalRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(canonicalRoot).startsWith("achmage-video-codec-")) {
    throw new Error(`Refusing to remove non-fixture path: ${fixtureRoot}`);
  }
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(canonicalRoot, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error(`Could not remove fixture path: ${fixtureRoot}`);
}

async function removeFileWithRetries(filePath) {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(filePath, { force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error(`Could not remove file: ${filePath}`);
}

async function runQualification(options) {
  const dependency = verifyDependencyIdentity();
  const runDirectory = createRunDirectory(options.output);
  const reportPath = path.join(runDirectory, "report.json");
  const mp4Path = path.join(runDirectory, "qualification.mp4");
  const repeatMp4Path = path.join(runDirectory, "qualification.repeat.mp4");
  const fixture = prepareFixture(options);
  const cdpPort = options.cdpPort ?? (await findFreePort());
  const cdpUrl = `http://127.0.0.1:${cdpPort}`;
  const probeBundle = await buildProbeBundle();
  const executable = {
    path: options.executable,
    bytes: statSync(options.executable).size,
    sha256: sha256File(options.executable),
  };
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    pass: false,
    expected: {
      appVersion: options.appVersion,
      electron: options.expectedElectron,
      installerUrl: options.installerUrl,
      installerSha256: options.installerSha256,
    },
    dependency,
    executable,
    fixture: {
      isolated: true,
      root: fixture.fixtureRoot,
      profile: fixture.profile,
      vault: fixture.vault,
      seededCore: fixture.seededCore,
      kept: options.keepFixture,
    },
    cdp: { url: cdpUrl, version: null },
    probeBundle: { entry: PROBE_ENTRY, bytes: probeBundle.bytes, sha256: probeBundle.sha256 },
    runtime: null,
    qualification: null,
    teardown: null,
    error: null,
  };
  let browser = null;
  let launch = null;
  try {
    launch = launchObsidian(options, fixture, cdpPort);
    report.cdp.version = await waitForCdp(cdpUrl, launch, options.timeoutMs);
    browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0];
    if (!context) throw new Error("CDP endpoint has no browser context");
    const page = await findObsidianPage(context, options.timeoutMs);
    await page.waitForFunction(() => Boolean(globalThis.app?.workspace && globalThis.app?.vault), null, {
      timeout: options.timeoutMs,
    });
    report.runtime = await readRuntime(page);
    assertRuntime(report.runtime, options, fixture);

    await page.evaluate((bundle) => (0, eval)(bundle), probeBundle.text);
    const result = await page.evaluate(
      async ({ outputPath, timeoutMs }) => {
        const probe = globalThis.__achmageRunVideoCodecQualification;
        if (typeof probe !== "function") throw new Error("Codec probe bundle did not install its entry point");
        let timer;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(
            () => resolve({ ok: false, error: { name: "TimeoutError", message: `Probe exceeded ${timeoutMs}ms`, stack: null }, outputRemoved: false }),
            timeoutMs,
          );
        });
        const outcome = await Promise.race([probe({ outputPath }), timeout]);
        clearTimeout(timer);
        return outcome;
      },
      { outputPath: mp4Path.replaceAll("\\", "/"), timeoutMs: options.timeoutMs },
    );
    report.qualification = result;
    if (!result?.ok) {
      throw new Error(`Renderer codec probe failed: ${result?.error?.message ?? "unknown error"}`);
    }
    if (!existsSync(mp4Path)) throw new Error("Codec probe reported success without an MP4 artifact");
    const nodeHash = sha256File(mp4Path);
    if (nodeHash !== result.result.output.sha256) {
      throw new Error(`Node/renderer MP4 hash mismatch: ${nodeHash} != ${result.result.output.sha256}`);
    }
    if (!existsSync(repeatMp4Path)) {
      throw new Error("Codec probe reported success without its repeat MP4 artifact");
    }
    const repeatNodeHash = sha256File(repeatMp4Path);
    if (repeatNodeHash !== result.result.repeatability?.secondOutput?.sha256) {
      throw new Error(
        `Node/renderer repeat MP4 hash mismatch: ${repeatNodeHash} != ${String(result.result.repeatability?.secondOutput?.sha256)}`,
      );
    }
    if (result.result.repeatability?.decodedRgba?.allMatch !== true) {
      throw new Error("Repeated first/middle/last decoded RGBA hashes did not all match");
    }
    report.pass = true;
  } catch (error) {
    report.error = serializeError(error);
  } finally {
    let browserTeardown = null;
    if (browser) browserTeardown = await closeBrowserBounded(browser);
    const processTeardown = terminateProcessTree(launch?.child);
    if (launch) {
      writeFileSync(path.join(runDirectory, "obsidian-stdout.log"), launch.stdout(), "utf8");
      writeFileSync(path.join(runDirectory, "obsidian-stderr.log"), launch.stderr(), "utf8");
    }
    let fixtureRemoved = false;
    if (!options.keepFixture) {
      try {
        await safeRemoveFixture(fixture.fixtureRoot);
        fixtureRemoved = true;
      } catch (error) {
        report.pass = false;
        report.error ??= serializeError(error);
      }
    }
    if (!report.pass) {
      for (const failedOutputPath of [mp4Path, repeatMp4Path]) {
        if (existsSync(failedOutputPath)) {
          try {
            await removeFileWithRetries(failedOutputPath);
          } catch (error) {
            report.error ??= serializeError(error);
          }
        }
      }
    }
    report.teardown = {
      browser: browserTeardown,
      process: processTeardown,
      launchExit: launch?.getExit() ?? null,
      failedOutputAbsent: report.pass
        ? null
        : !existsSync(mp4Path) && !existsSync(repeatMp4Path),
      fixtureRemoved,
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({
    pass: report.pass,
    report: reportPath,
    mp4: report.pass ? mp4Path : null,
    repeatMp4: report.pass ? repeatMp4Path : null,
  }, null, 2));
  if (!report.pass) {
    throw new Error(`Video codec qualification failed; see ${reportPath}: ${report.error?.message ?? "unknown error"}`);
  }
  return { reportPath, mp4Path };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await runQualification(options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
