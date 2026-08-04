import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { chromium } from "playwright-core";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const outputDirectory = path.resolve(projectRoot, "build", "test", "video-stress");
const fixtureBundle = path.join(outputDirectory, "videoStressAcceptance.js");
const reportPath = path.join(outputDirectory, "report.json");
const heapLimitBytes = 68 * 1024 * 1024;
const eventLoopStallLimitMs = 1_000;
const cancelSettleLimitMs = 1_000;
const canvasBackingLimitBytes = 3 * 1920 * 1080 * 4;
const executablePath = [
  process.env.ACHMAGE_BROWSER,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((candidate) => candidate && existsSync(candidate));

if (!executablePath) {
  throw new Error("No Chromium browser found. Set ACHMAGE_BROWSER to Chrome or Edge.");
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  purpose: "P-007 AC-710 bounded random-access compositor resource stress",
  browser: null,
  limits: {
    preciseJsHeapDeltaBytes: heapLimitBytes,
    eventLoopMaxStallMs: eventLoopStallLimitMs,
    cancelSettleMs: cancelSettleLimitMs,
    canvasBackingEstimateBytes: canvasBackingLimitBytes,
    decodedFrameCacheCount: 2,
  },
  method: {
    cases: [100, 500],
    fullEncoding: false,
    randomAccessSamples: [
      "last-hold",
      "first-hold",
      "middle-hold",
      "vertical-transition",
      "horizontal-transition",
    ],
    heapMetric: "Chrome DevTools Protocol Runtime.getHeapUsage.usedSize",
    preciseMemoryFlag: "--enable-precise-memory-info",
  },
  cases: [],
  pass: false,
  error: null,
};

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: [path.join(projectRoot, "src", "tests", "videoStressAcceptance.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome138",
  outfile: fixtureBundle,
  logLevel: "silent",
});

const server = createServer((_request, response) => {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
  });
  response.end("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>");
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  await new Promise((resolve) => server.close(resolve));
  throw new Error("Video stress acceptance server did not bind to TCP.");
}

let browser;
try {
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--enable-precise-memory-info",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  report.browser = {
    executablePath,
    version: browser.version(),
  };

  for (const frameCount of report.method.cases) {
    const evidence = await runCase(browser, `http://127.0.0.1:${address.port}/`, frameCount);
    verifyCase(evidence);
    report.cases.push(evidence);
  }
  report.pass = true;
} catch (error) {
  report.error = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack ?? null }
    : { name: "UnknownError", message: String(error), stack: null };
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (!report.pass) {
  throw new Error(`Video stress acceptance failed: ${report.error?.message ?? "unknown failure"}`);
}

for (const evidence of report.cases) {
  console.log(
    [
      `${evidence.frameCount} frames`,
      `heap +${formatMiB(evidence.heap.peakDeltaBytes)}`,
      `stall ${evidence.fixture.maxEventLoopStallMs.toFixed(1)}ms`,
      `cancel ${evidence.fixture.cancelSettleMs.toFixed(1)}ms`,
      `decoded <=${evidence.fixture.maxRetainedDecodedFrames}`,
    ].join(" | ")
  );
}
console.log(`Video stress acceptance PASS: ${reportPath}`);

async function runCase(browserInstance, fixtureUrl, frameCount) {
  const page = await browserInstance.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(90_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  await session.send("HeapProfiler.enable");

  try {
    await page.goto(`${fixtureUrl}?frames=${frameCount}`, { waitUntil: "load" });
    await page.addScriptTag({ path: fixtureBundle });
    await page.waitForFunction(() => {
      const fixture = window;
      return fixture.videoStressFixtureReady === true || Boolean(fixture.videoStressFixtureError);
    });
    const fixtureError = await page.evaluate(() => window.videoStressFixtureError ?? null);
    if (fixtureError) throw new Error(fixtureError);

    await collectGarbage(session, page);
    const baseline = await heapSnapshot(session);
    let peak = baseline.usedSize;
    let heapSamples = 1;
    let settled = false;
    let fixture = null;
    let executionError = null;
    const wallStartedAt = performance.now();
    const execution = page
      .evaluate((count) => window.runVideoStressCase(count), frameCount)
      .then((value) => {
        fixture = value;
      }, (error) => {
        executionError = error;
      })
      .finally(() => {
        settled = true;
      });

    while (!settled) {
      const sample = await heapSnapshot(session);
      peak = Math.max(peak, sample.usedSize);
      heapSamples += 1;
      if (!settled) await delay(10);
    }
    await execution;
    if (executionError) throw executionError;
    assert.ok(fixture, `${frameCount}: browser fixture returned no evidence`);

    const returned = await heapSnapshot(session);
    peak = Math.max(peak, returned.usedSize);
    heapSamples += 1;
    await collectGarbage(session, page);
    const steady = await heapSnapshot(session);
    heapSamples += 1;
    const peakDeltaBytes = Math.max(0, peak - baseline.usedSize);
    const steadyDeltaBytes = steady.usedSize - baseline.usedSize;

    return {
      frameCount,
      wallElapsedMs: performance.now() - wallStartedAt,
      fixture,
      heap: {
        baselineUsedBytes: baseline.usedSize,
        peakUsedBytes: peak,
        peakDeltaBytes,
        steadyUsedBytes: steady.usedSize,
        steadyDeltaBytes,
        sampleCount: heapSamples,
        totalHeapBytesAtBaseline: baseline.totalSize,
        totalHeapBytesAtSteady: steady.totalSize,
      },
      pageErrors,
    };
  } finally {
    await session.detach();
    await page.close();
  }
}

async function heapSnapshot(session) {
  const usage = await session.send("Runtime.getHeapUsage");
  return {
    usedSize: usage.usedSize,
    totalSize: usage.totalSize,
  };
}

async function collectGarbage(session, page) {
  await session.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(25);
  await session.send("HeapProfiler.collectGarbage");
}

function verifyCase(evidence) {
  const label = `${evidence.frameCount}-frame`;
  const fixture = evidence.fixture;
  assert.equal(fixture.frameCount, evidence.frameCount, `${label}: case identity`);
  assert.equal(fixture.artifactImmutable, true, `${label}: immutable artifact`);
  assert.ok(fixture.sharedCssBytes >= 500_000, `${label}: representative shared CSS`);
  assert.equal(fixture.sharedCssSentinelCount, 1, `${label}: shared CSS sentinel count`);
  assert.equal(fixture.sharedCssPropertyCount, 1, `${label}: shared CSS property count`);
  assert.equal(fixture.frameSvgSharedCssCount, 0, `${label}: no per-frame shared CSS copy`);
  assert.deepEqual(fixture.unexpectedArtifactArrayProperties, [], `${label}: no extra artifact array`);
  assert.equal(fixture.suspiciousRasterArrayCount, 0, `${label}: no raster/standalone array`);
  assert.equal(fixture.outputKind, "OffscreenCanvas", `${label}: module-realm output kind`);
  assert.equal(fixture.outputIdentityStable, true, `${label}: stable output identity`);
  assert.ok(fixture.maxRetainedDecodedFrames <= 2, `${label}: decoded cache bound`);
  assert.ok(
    fixture.canvasBackingEstimateBytes <= canvasBackingLimitBytes,
    `${label}: three-canvas backing bound`
  );
  assert.ok(
    fixture.maxEventLoopStallMs <= eventLoopStallLimitMs,
    `${label}: event-loop stall bound`
  );
  assert.equal(fixture.cancelObserved, true, `${label}: in-flight AbortSignal cancellation`);
  assert.equal(fixture.cancelErrorName, "AbortError", `${label}: cancellation error contract`);
  assert.ok(fixture.cancelSettleMs <= cancelSettleLimitMs, `${label}: cancel settle bound`);
  assert.ok(evidence.heap.peakDeltaBytes <= heapLimitBytes, `${label}: precise JS heap delta bound`);
  assert.deepEqual(
    fixture.samples.map((sample) => sample.label),
    report.method.randomAccessSamples,
    `${label}: bounded random-access sample inventory`
  );
  assert.deepEqual(
    fixture.samples.filter((sample) => sample.kind === "transition").map((sample) => sample.transitionAxis),
    ["vertical", "horizontal"],
    `${label}: transition resource paths`
  );
  assert.equal(evidence.pageErrors.length, 0, `${label}: uncaught browser errors`);
}

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
