import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const buildDir = path.join(projectRoot, "build", "navigation-acceptance");
const fixtureBundle = path.join(buildDir, "navigationAcceptance.cjs");
const previewFixtureBundle = path.join(buildDir, "navigationPreviewAcceptance.js");
const fixtureConfigPath = path.join(
  projectRoot,
  "src",
  "tests",
  "fixtures",
  "navigation-sections.json"
);
const fixtureConfig = JSON.parse(await readFile(fixtureConfigPath, "utf8"));
const topologies = fixtureConfig.topologies;
const richTopology = fixtureConfig.rich;
const longTopology = fixtureConfig.long;
const expectedDemoTopology = [
  1, 1, 3, 1, 1, 2, 2, 2, 2, 2,
  1, 1, 1, 1, 1, 1, 1, 1, 2, 1,
  1, 1, 2, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 2, 1, 1,
];
const exportedDemos = [
  {
    label: "English demo export",
    sourcePath: path.join(projectRoot, "examples", "demo-en.md"),
    exportPath: path.join(
      projectRoot,
      "examples",
      "Achmage Slides Ultra Demo (English).slides.html"
    ),
    title: "Achmage Slides Ultra Demo (English)",
    marker: "Read the two-level navigator first",
    imageAlt: "Demo image",
    topology: expectedDemoTopology,
  },
  {
    label: "Korean demo export",
    sourcePath: path.join(projectRoot, "examples", "demo-ko.md"),
    exportPath: path.join(
      projectRoot,
      "examples",
      "Achmage Slides Ultra 사용법 데모.slides.html"
    ),
    title: "Achmage Slides Ultra 사용법 데모",
    marker: "먼저 2단계 내비게이션을 읽어 보세요",
    imageAlt: "데모 이미지",
    topology: expectedDemoTopology,
  },
];
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
  throw new Error("No Chromium browser found. Set ACHMAGE_BROWSER to a Chrome or Edge executable.");
}

await mkdir(buildDir, { recursive: true });
const obsidianRuntimeStub = () => ({
  name: "obsidian-runtime-stub",
  setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({
      path: "obsidian-runtime-stub",
      namespace: "obsidian-runtime-stub",
    }));
    builder.onLoad({ filter: /.*/, namespace: "obsidian-runtime-stub" }, () => ({
      contents: [
        "export class PluginSettingTab {}",
        "export class App {}",
        "export class Notice {}",
        "export class Setting {}",
        "export class ItemView {}",
        "export class WorkspaceLeaf {}",
        "export class TFile {}",
        "export const debounce = (callback) => callback;",
      ].join("\n"),
      loader: "js",
    }));
  },
});
await build({
  entryPoints: [path.join(projectRoot, "src", "tests", "navigationAcceptance.ts")],
  outfile: fixtureBundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
  plugins: [obsidianRuntimeStub()],
});
await build({
  entryPoints: [path.join(projectRoot, "src", "tests", "navigationPreviewAcceptance.ts")],
  outfile: previewFixtureBundle,
  bundle: true,
  platform: "browser",
  format: "iife",
  logLevel: "silent",
  plugins: [obsidianRuntimeStub()],
});

const require = createRequire(import.meta.url);
const { buildNavigationFixture } = require(fixtureBundle);
const chromeUserData = await mkdtemp(path.join(os.tmpdir(), "asu-navigation-chrome-"));
const debugPort = await getFreePort();
const chrome = spawn(chromePath, [
  "--headless=new",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${chromeUserData}`,
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
], { stdio: "ignore" });

let cdp;
try {
  await waitForChrome(debugPort);
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
    method: "PUT",
  }).then((response) => response.json());
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Accessibility.enable");
  await cdp.send("Page.bringToFront");

  let assertions = 0;
  for (const topology of topologies) {
    const fileName = `topology-${topology.join("-")}.html`;
    const fixturePath = path.join(buildDir, fileName);
    await writeFile(fixturePath, buildNavigationFixture(topology), "utf8");
    await cdp.send("Page.navigate", { url: pathToFileURL(fixturePath).href });
    await waitForReady(cdp);

    const expectedOrder = topology.flatMap((frames, group) =>
      Array.from({ length: frames }, (_, frame) => [group, frame])
    );
    assert.deepEqual(await state(cdp), [0, 0], `initial ${topology}`);
    assertions++;

    for (let index = 1; index < expectedOrder.length; index++) {
      await key(cdp, "ArrowRight");
      assert.deepEqual(await state(cdp), expectedOrder[index], `forward ${topology} #${index}`);
      assertions++;
    }
    await key(cdp, "ArrowRight");
    assert.deepEqual(await state(cdp), expectedOrder.at(-1), `forward endpoint ${topology}`);
    assertions++;

    for (let index = expectedOrder.length - 2; index >= 0; index--) {
      await key(cdp, "ArrowLeft");
      assert.deepEqual(await state(cdp), expectedOrder[index], `reverse ${topology} #${index}`);
      assertions++;
    }
    await key(cdp, "ArrowLeft");
    assert.deepEqual(await state(cdp), [0, 0], `reverse endpoint ${topology}`);
    assertions++;

    await key(cdp, "End");
    assert.deepEqual(await state(cdp), expectedOrder.at(-1), `End ${topology}`);
    assert.deepEqual(await evaluate(cdp, `({
      next: document.getElementById('btn-next').disabled,
      nextSection: document.getElementById('btn-next-section').disabled,
    })`), { next: true, nextSection: true }, `end disabled ${topology}`);
    await key(cdp, "Home");
    assert.deepEqual(await state(cdp), [0, 0], `Home ${topology}`);
    assert.deepEqual(await evaluate(cdp, `({
      previous: document.getElementById('btn-prev').disabled,
      previousSection: document.getElementById('btn-prev-section').disabled,
    })`), { previous: true, previousSection: true }, `start disabled ${topology}`);
    assertions += 4;

    if (expectedOrder.length > 2) {
      const middle = Math.floor(expectedOrder.length / 2);
      for (let index = 0; index < middle; index++) await key(cdp, "ArrowRight");
      assert.deepEqual(await state(cdp), expectedOrder[middle], `interior ${topology}`);
      await key(cdp, "End");
      assert.deepEqual(await state(cdp), expectedOrder.at(-1), `End from interior ${topology}`);
      await key(cdp, "Home");
      for (let index = 0; index < middle; index++) await key(cdp, "ArrowRight");
      await key(cdp, "Home");
      assert.deepEqual(await state(cdp), [0, 0], `Home from interior ${topology}`);
      assertions += 3;
    }

    await key(cdp, "Home");
    for (let group = 1; group < topology.length; group++) {
      await evaluate(cdp, `document.getElementById('btn-next-section').click()`);
      assert.deepEqual(await state(cdp), [group, 0], `next section ${topology} -> ${group}`);
      assertions++;
    }
    await evaluate(cdp, `document.getElementById('btn-next-section').click()`);
    assert.deepEqual(await state(cdp), [Math.max(0, topology.length - 1), 0], `next section endpoint ${topology}`);
    assertions++;
    for (let group = topology.length - 2; group >= 0; group--) {
      await evaluate(cdp, `document.getElementById('btn-prev-section').click()`);
      assert.deepEqual(await state(cdp), [group, 0], `previous section ${topology} -> ${group}`);
      assertions++;
    }
    await evaluate(cdp, `document.getElementById('btn-prev-section').click()`);
    assert.deepEqual(await state(cdp), [0, 0], `previous section endpoint ${topology}`);
    assertions++;

    const exposure = await evaluate(cdp, `(() => {
      const frames = [...document.querySelectorAll('.achmage-frame')];
      return {
        current: frames.filter((frame) => frame.getAttribute('aria-hidden') === 'false').length,
        visibleHasInert: frames.some((frame) => frame.getAttribute('aria-hidden') === 'false' && frame.hasAttribute('inert')),
        hiddenWithoutInert: frames.some((frame) => frame.getAttribute('aria-hidden') === 'true' && !frame.hasAttribute('inert')),
      };
    })()`);
    assert.deepEqual(exposure, { current: 1, visibleHasInert: false, hiddenWithoutInert: false });
    assertions++;

    assert.deepEqual(
      await axFrameControlNames(cdp),
      ["Frame 1-1 control"],
      `AX current frame ${topology}`
    );
    assertions++;

    await focusTabSentinel(cdp);
    await physicalKey(cdp, "Tab", "Tab", 9);
    assert.equal(await activeDescriptor(cdp), "frame:1-1", `Tab current frame ${topology}`);
    assertions++;
  }

  // Rich topology exercises route UI, sections, dots, AX, focus and event ownership.
  const richPath = path.join(buildDir, `topology-${richTopology.join("-")}.html`);
  await cdp.send("Page.navigate", { url: pathToFileURL(richPath).href });
  await waitForReady(cdp);

  for (const nextKey of ["ArrowRight", "ArrowDown", "PageDown", " ", "n"]) {
    await key(cdp, "Home");
    await key(cdp, nextKey);
    assert.deepEqual(await state(cdp), [1, 0], `next key ${JSON.stringify(nextKey)}`);
    await goToState(cdp, richTopology, 1, 0);
    await key(cdp, nextKey);
    assert.deepEqual(await state(cdp), [1, 1], `next key internal ${JSON.stringify(nextKey)}`);
    await goToState(cdp, richTopology, 1, 2);
    await key(cdp, nextKey);
    assert.deepEqual(await state(cdp), [2, 0], `next key second boundary ${JSON.stringify(nextKey)}`);
    assertions += 3;
  }
  for (const previousKey of ["ArrowLeft", "ArrowUp", "PageUp", "p"]) {
    await key(cdp, "End");
    await key(cdp, previousKey);
    assert.deepEqual(await state(cdp), [2, 0], `previous key ${previousKey}`);
    assertions++;
  }
  for (const previousKey of ["ArrowUp", "PageUp", "p"]) {
    await goToState(cdp, richTopology, 2, 0);
    await key(cdp, previousKey);
    assert.deepEqual(await state(cdp), [1, 2], `previous key boundary ${previousKey}`);
    assertions++;
  }
  await key(cdp, "End");
  await key(cdp, " ", { shiftKey: true });
  assert.deepEqual(await state(cdp), [2, 0], "previous key Shift+Space");
  assertions++;
  await goToState(cdp, richTopology, 2, 0);
  await key(cdp, " ", { shiftKey: true });
  assert.deepEqual(await state(cdp), [1, 2], "previous key boundary Shift+Space");
  assertions++;

  // The common Next button must advance one frame internally and cross both boundaries.
  for (const [fromGroup, fromFrame, toGroup, toFrame] of [
    [0, 0, 1, 0],
    [1, 0, 1, 1],
    [1, 2, 2, 0],
  ]) {
    await goToState(cdp, richTopology, fromGroup, fromFrame);
    await evaluate(cdp, `document.getElementById('btn-next').click()`);
    assert.deepEqual(
      await state(cdp),
      [toGroup, toFrame],
      `common Next ${fromGroup}-${fromFrame} -> ${toGroup}-${toFrame}`
    );
    assertions++;
  }

  await key(cdp, "Home");
  await evaluate(cdp, `document.getElementById('btn-next-section').click()`);
  assert.deepEqual(await state(cdp), [1, 0]);
  assert.deepEqual(await evaluate(cdp, `({
    wide: document.getElementById('counter-wide').textContent,
    compact: document.getElementById('counter-compact').textContent,
    previousRoute: document.getElementById('prev-route-icon').textContent,
    nextRoute: document.getElementById('next-route-icon').textContent,
  })`), {
    wide: "Section 2/3 · Slide 1/3",
    compact: "2/3 · 1/3",
    previousRoute: "←",
    nextRoute: "↓",
  });
  assertions += 2;

  await evaluate(cdp, `document.getElementById('btn-prev-section').click()`);
  assert.deepEqual(await state(cdp), [0, 0], "previous section targets frame 0");
  await evaluate(cdp, `document.getElementById('btn-next-section').click()`);
  assert.deepEqual(await state(cdp), [1, 0], "next section targets frame 0");
  assertions += 2;

  await key(cdp, "ArrowDown");
  assert.deepEqual(await state(cdp), [1, 1]);
  await evaluate(cdp, `new Promise((resolve) => setTimeout(resolve, 350))`);
  const dotState = await evaluate(cdp, `[...document.querySelectorAll('.v-dot')].map((dot) => ({
    tag: dot.tagName,
    current: dot.getAttribute('aria-current'),
    tabIndex: dot.tabIndex,
    width: dot.getBoundingClientRect().width,
    height: dot.getBoundingClientRect().height,
  }))`);
  assert.equal(dotState.filter((dot) => dot.current === "true" && dot.tabIndex === 0).length, 1);
  assert.ok(dotState.every((dot) => dot.tag === "BUTTON" && dot.width >= 24 && dot.height >= 24));
  assertions += 3;

  // Home/End retain their deck-endpoint contract when a roving dot owns focus.
  await evaluate(cdp, `document.querySelector('.v-dot.active').focus({ preventScroll: true })`);
  await physicalKey(cdp, "End", "End", 35);
  assert.deepEqual(await state(cdp), [2, 1], "focused dot End reaches deck end");
  assert.equal(await activeDescriptor(cdp), "dot:1", "deck-end dot retains focus");
  await goToState(cdp, richTopology, 1, 1);
  await evaluate(cdp, `document.querySelector('.v-dot.active').focus({ preventScroll: true })`);
  await physicalKey(cdp, "Home", "Home", 36);
  assert.deepEqual(await state(cdp), [0, 0], "focused dot Home reaches deck start");
  assert.equal(await activeDescriptor(cdp), "achmage-stage", "dot falls back to stage when endpoint has no dots");
  assertions += 4;
  await goToState(cdp, richTopology, 1, 1);
  await waitForFramePosition(cdp);

  assert.deepEqual(await navigationUiState(cdp), {
    wide: "Section 2/3 · Slide 2/3",
    compact: "2/3 · 2/3",
    previousRoute: "↑",
    nextRoute: "↓",
    previousDisabled: false,
    nextDisabled: false,
    previousSectionDisabled: false,
    nextSectionDisabled: false,
    dotCount: 3,
    currentDot: 1,
  });
  const richGeometry = await frameGeometry(cdp);
  assert.ok(
    richGeometry.frameCoordinatesMatch,
    `frame coordinates match stage: ${JSON.stringify(richGeometry.frameDiagnostics)}`
  );
  assert.ok(richGeometry.transformMatches, "stack transform matches current frame");
  assert.ok(richGeometry.locatorInsideStage, "locator remains inside stage");
  assert.ok(richGeometry.documentOverflowX <= 0 && richGeometry.documentOverflowY <= 0, "document does not overflow");
  assertions += 5;

  // Actual tab traversal sees only the current frame control, then the roving current dot.
  await focusTabSentinel(cdp);
  await physicalKey(cdp, "Tab", "Tab", 9);
  assert.equal(await activeDescriptor(cdp), "frame:2-2");
  await physicalKey(cdp, "Tab", "Tab", 9);
  assert.equal(await activeDescriptor(cdp), "dot:1");
  assertions += 2;

  // Authored controls in the active frame keep native Space/Enter ownership.
  await evaluate(cdp, `window.fixtureActivationCount = 0`);
  await evaluate(cdp, `document.querySelector('.achmage-frame[aria-hidden="false"] .fixture-frame-control').focus()`);
  await physicalKey(cdp, " ", "Space", 32);
  assert.deepEqual(await state(cdp), [1, 1]);
  assert.equal(await evaluate(cdp, `window.fixtureActivationCount`), 1);
  await physicalKey(cdp, "Enter", "Enter", 13);
  assert.deepEqual(await state(cdp), [1, 1]);
  assert.equal(await evaluate(cdp, `window.fixtureActivationCount`), 2);
  assertions += 4;

  // Native and ARIA-authored dialog surfaces retain physical navigation keys.
  await evaluate(cdp, `(() => {
    const frame = document.querySelector('.achmage-frame[aria-hidden="false"]');
    const nativeDialog = document.createElement('dialog');
    nativeDialog.id = 'authored-native-dialog';
    nativeDialog.tabIndex = -1;
    nativeDialog.open = true;
    frame.appendChild(nativeDialog);
    const ariaDialog = document.createElement('div');
    ariaDialog.id = 'authored-aria-dialog';
    ariaDialog.setAttribute('role', 'dialog');
    ariaDialog.tabIndex = -1;
    frame.appendChild(ariaDialog);
  })()`);
  for (const surfaceId of ["authored-native-dialog", "authored-aria-dialog"]) {
    await evaluate(cdp, `document.getElementById(${JSON.stringify(surfaceId)}).focus({ preventScroll: true })`);
    assert.equal(await activeDescriptor(cdp), surfaceId, `${surfaceId} owns focus`);
    assertions++;
    for (const [keyValue, code, virtualKeyCode] of [
      ["ArrowRight", "ArrowRight", 39],
      ["ArrowLeft", "ArrowLeft", 37],
      ["PageDown", "PageDown", 34],
      ["PageUp", "PageUp", 33],
      ["Home", "Home", 36],
      ["End", "End", 35],
    ]) {
      await physicalKey(cdp, keyValue, code, virtualKeyCode);
      assert.deepEqual(await state(cdp), [1, 1], `${surfaceId} retains ${keyValue}`);
      assertions++;
    }
  }
  await evaluate(cdp, `document.getElementById('authored-native-dialog').remove(); document.getElementById('authored-aria-dialog').remove()`);

  // Programmatic deck-endpoint navigation never loses outgoing-frame focus to BODY.
  await evaluate(cdp, `(() => {
    const frame = document.querySelector('.achmage-frame[aria-hidden="false"]');
    frame.tabIndex = -1;
    frame.focus({ preventScroll: true });
  })()`);
  await physicalKey(cdp, "End", "End", 35);
  assert.deepEqual(await state(cdp), [2, 1], "focused frame End reaches deck end");
  assert.equal(await activeDescriptor(cdp), "btn-prev", "deck-end focus uses an enabled destination control");
  await goToState(cdp, richTopology, 1, 1);
  await evaluate(cdp, `(() => {
    const frame = document.querySelector('.achmage-frame[aria-hidden="false"]');
    frame.tabIndex = -1;
    frame.focus({ preventScroll: true });
  })()`);
  await physicalKey(cdp, "Home", "Home", 36);
  assert.deepEqual(await state(cdp), [0, 0], "focused frame Home reaches deck start");
  assert.equal(await activeDescriptor(cdp), "btn-next", "deck-start focus uses an enabled destination control");
  assertions += 4;

  await evaluate(cdp, `(() => {
    const frame = document.querySelector('.achmage-frame[aria-hidden="false"]');
    frame.tabIndex = -1;
    frame.focus({ preventScroll: true });
  })()`);
  await physicalKey(cdp, "End", "End", 35);
  assert.deepEqual(await state(cdp), [2, 1], "deck-start focused frame End reaches deck end");
  assert.equal(await activeDescriptor(cdp), "btn-prev", "disabled source control cannot drop deck-end focus");
  await evaluate(cdp, `(() => {
    const frame = document.querySelector('.achmage-frame[aria-hidden="false"]');
    frame.tabIndex = -1;
    frame.focus({ preventScroll: true });
  })()`);
  await physicalKey(cdp, "Home", "Home", 36);
  assert.deepEqual(await state(cdp), [0, 0], "deck-end focused frame Home reaches deck start");
  assert.equal(await activeDescriptor(cdp), "btn-next", "disabled source control cannot drop deck-start focus");
  assertions += 4;
  await goToState(cdp, richTopology, 1, 1);

  // If a transition is invoked while frame content owns focus, focus moves before it is hidden/inert.
  await evaluate(cdp, `document.querySelector('.achmage-frame[aria-hidden="false"] .fixture-frame-control').focus()`);
  await evaluate(cdp, `document.getElementById('btn-next').click()`);
  assert.deepEqual(await state(cdp), [1, 2]);
  assert.equal(await activeDescriptor(cdp), "btn-next");
  assert.deepEqual(await axFrameControlNames(cdp), ["Frame 2-3 control"]);
  assertions += 3;

  await evaluate(cdp, `document.querySelector('.achmage-frame[aria-hidden="false"] .fixture-frame-control').focus()`);
  await evaluate(cdp, `document.getElementById('btn-next').click()`);
  assert.deepEqual(await state(cdp), [2, 0]);
  assert.equal(await activeDescriptor(cdp), "btn-next");
  assert.deepEqual(await axFrameControlNames(cdp), ["Frame 3-1 control"]);
  assertions += 3;

  const axState = await fullAxTree(cdp);
  const axButtonNames = axState
    .filter((node) => !node.ignored && node.role?.value === "button")
    .map((node) => node.name?.value)
    .filter(Boolean);
  assert.ok(axButtonNames.includes("Previous section"));
  assert.ok(axButtonNames.includes("Next section"));
  assert.ok(axButtonNames.includes("Navigation help"));
  assert.ok(axState.some((node) => node.properties?.some(
    (property) => property.name === "live" && property.value?.value === "polite"
  )));
  assert.ok(axState.some((node) => node.properties?.some(
    (property) => property.name === "atomic" && property.value?.value === true
  )));
  assert.equal(
    await evaluate(cdp, `document.getElementById('position-status').textContent`),
    "Section 3 of 3, slide 1 of 2"
  );
  assert.ok(axState.some((node) => node.name?.value === "Section 3 of 3, slide 1 of 2"));
  assertions += 7;

  // Focused native controls consume Space/Enter exactly once through native activation.
  await key(cdp, "Home");
  await evaluate(cdp, `document.getElementById('btn-next').focus()`);
  await physicalKey(cdp, " ", "Space", 32);
  assert.deepEqual(await state(cdp), [1, 0]);
  await key(cdp, "Home");
  await evaluate(cdp, `document.getElementById('btn-next-section').focus()`);
  await physicalKey(cdp, "Enter", "Enter", 13);
  assert.deepEqual(await state(cdp), [1, 0]);
  await key(cdp, "Home");
  await physicalKey(cdp, " ", "Space", 32);
  assert.deepEqual(await state(cdp), [1, 0]);
  assertions += 3;

  // Authored targets, default-prevented events, and host modifiers are not hijacked.
  await evaluate(cdp, `(() => {
    const input = document.createElement('input');
    input.id = 'ownership-input';
    document.querySelector('.achmage-stage').appendChild(input);
    input.focus();
  })()`);
  await physicalKey(cdp, "ArrowRight", "ArrowRight", 39);
  assert.deepEqual(await state(cdp), [1, 0]);
  await evaluate(cdp, `document.getElementById('ownership-input').remove()`);
  await evaluate(cdp, `(() => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    event.preventDefault();
    document.dispatchEvent(event);
  })()`);
  assert.deepEqual(await state(cdp), [1, 0]);
  await key(cdp, "f", { ctrlKey: true });
  assert.equal(await evaluate(cdp, `Boolean(document.fullscreenElement)`), false);
  await key(cdp, "ArrowRight", { ctrlKey: true });
  assert.deepEqual(await state(cdp), [1, 0]);
  assertions += 4;

  await evaluate(cdp, `document.getElementById('btn-help').click()`);
  assert.equal(await evaluate(cdp, `document.getElementById('help-dialog').open`), true);
  assert.equal(await activeDescriptor(cdp), "btn-help-close");
  await physicalKey(cdp, "Escape", "Escape", 27);
  await evaluate(cdp, `new Promise((resolve) => setTimeout(resolve, 25))`);
  assert.equal(await evaluate(cdp, `document.getElementById('help-dialog').open`), false);
  assert.equal(await activeDescriptor(cdp), "btn-help");
  assertions += 4;

  await focusBody(cdp);
  await physicalKey(cdp, "f", "KeyF", 70);
  await evaluate(cdp, `new Promise((resolve) => setTimeout(resolve, 50))`);
  assert.deepEqual(await evaluate(cdp, `({
    fullscreen: Boolean(document.fullscreenElement),
    pressed: document.getElementById('btn-fs').getAttribute('aria-pressed'),
    label: document.getElementById('btn-fs').getAttribute('aria-label'),
  })`), { fullscreen: true, pressed: "true", label: "Exit fullscreen" });
  await physicalKey(cdp, "Escape", "Escape", 27);
  await evaluate(cdp, `new Promise((resolve) => setTimeout(resolve, 50))`);
  assert.deepEqual(await evaluate(cdp, `({
    fullscreen: Boolean(document.fullscreenElement),
    pressed: document.getElementById('btn-fs').getAttribute('aria-pressed'),
    label: document.getElementById('btn-fs').getAttribute('aria-label'),
  })`), { fullscreen: false, pressed: "false", label: "Enter fullscreen" });
  assertions += 2;

  // Stage edge click follows reading order instead of skipping sections.
  await key(cdp, "Home");
  await evaluate(cdp, `(() => {
    const stage = document.querySelector('.achmage-stage');
    const rect = stage.getBoundingClientRect();
    stage.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width * 0.8 }));
  })()`);
  assert.deepEqual(await state(cdp), [1, 0]);
  await evaluate(cdp, `(() => {
    const stage = document.querySelector('.achmage-stage');
    const rect = stage.getBoundingClientRect();
    stage.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width * 0.2 }));
  })()`);
  assert.deepEqual(await state(cdp), [0, 0]);
  assertions += 2;

  await goToState(cdp, richTopology, 1, 0);
  await clickStageEdge(cdp, "next");
  assert.deepEqual(await state(cdp), [1, 1], "stage next click advances inside a section");
  await goToState(cdp, richTopology, 1, 2);
  await clickStageEdge(cdp, "next");
  assert.deepEqual(await state(cdp), [2, 0], "stage next click crosses the second boundary");
  await goToState(cdp, richTopology, 1, 2);
  await clickStageEdge(cdp, "previous");
  assert.deepEqual(await state(cdp), [1, 1], "stage previous click advances inside a section");
  await goToState(cdp, richTopology, 2, 0);
  await clickStageEdge(cdp, "previous");
  assert.deepEqual(await state(cdp), [1, 2], "stage previous click crosses the second boundary");
  assertions += 4;

  // Dot controls retain >=3:1 contrast over a fixed backing on dark and light slides.
  await key(cdp, "ArrowRight");
  for (const stageBackground of ["#000000", "#ffffff"]) {
    const contrast = await evaluate(cdp, `(() => {
      document.querySelector('.achmage-stage').style.background = '${stageBackground}';
      const dots = [...document.querySelectorAll('.v-dot')];
      const active = dots.find((dot) => dot.classList.contains('active'));
      const inactive = dots.find((dot) => !dot.classList.contains('active'));
      active.focus({ preventScroll: true });
      const backing = getComputedStyle(document.getElementById('v-dots')).backgroundColor;
      const activeColor = getComputedStyle(active, '::before').backgroundColor;
      const inactiveColor = getComputedStyle(inactive, '::before').backgroundColor;
      const focusColor = getComputedStyle(active).outlineColor;
      const rgb = (value) => value.match(/[\\d.]+/g).slice(0, 3).map(Number);
      const luminance = (value) => {
        const channels = rgb(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : Math.pow((normalized + 0.055) / 1.055, 2.4);
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const ratio = (a, b) => {
        const lighter = Math.max(luminance(a), luminance(b));
        const darker = Math.min(luminance(a), luminance(b));
        return (lighter + 0.05) / (darker + 0.05);
      };
      return {
        active: ratio(activeColor, backing),
        inactive: ratio(inactiveColor, backing),
        focus: ratio(focusColor, backing),
      };
    })()`);
    assert.ok(contrast.active >= 3, `${stageBackground} active dot contrast ${contrast.active}`);
    assert.ok(contrast.inactive >= 3, `${stageBackground} inactive dot contrast ${contrast.inactive}`);
    assert.ok(contrast.focus >= 3, `${stageBackground} focus contrast ${contrast.focus}`);
    assertions += 3;
  }

  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  assert.deepEqual(await evaluate(cdp, `(() => {
    const group = document.querySelector('.achmage-logical-group[aria-hidden="false"]');
    group.classList.add('enter-right');
    const result = {
      transition: getComputedStyle(group.querySelector('.achmage-frame-stack')).transitionDuration,
      animation: getComputedStyle(group).animationName,
      dotTransition: getComputedStyle(document.querySelector('.v-dot'), '::before').transitionDuration,
    };
    group.classList.remove('enter-right');
    return result;
  })()`), { transition: "0s", animation: "none", dotTransition: "0s" });
  assertions++;

  for (const width of [320, 480, 800, 1920]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(cdp, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const geometry = await evaluate(cdp, `(() => {
      const controls = document.querySelector('.achmage-controls');
      const controlsRect = controls.getBoundingClientRect();
      const buttons = [...controls.querySelectorAll('button')];
      const compact = document.querySelector('#btn-next-section .section-compact');
      const wide = document.querySelector('#btn-next-section .section-wide');
      const primaryLabels = [...controls.querySelectorAll('#btn-prev .primary-wide, #btn-prev .primary-compact, #btn-next .primary-wide, #btn-next .primary-compact')];
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        return getComputedStyle(element).display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const isInsideControls = (element) => {
        if (!isVisible(element)) return true;
        const rect = element.getBoundingClientRect();
        return rect.left >= controlsRect.left - 1 && rect.right <= controlsRect.right + 1 &&
          rect.top >= controlsRect.top - 1 && rect.bottom <= controlsRect.bottom + 1;
      };
      return {
        overflow: controls.scrollWidth - controls.clientWidth,
        controlsHeight: controls.getBoundingClientRect().height,
        undersized: buttons.filter((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width < 24 || rect.height < 24;
        }).length,
        compactSectionLabel: isVisible(compact),
        wideSectionLabel: isVisible(wide),
        sectionLabelsInside: isInsideControls(compact) && isInsideControls(wide),
        visiblePrimaryText: primaryLabels.filter(isVisible).map((element) => element.textContent),
        primaryLabelsInside: primaryLabels.every(isInsideControls),
      };
    })()`);
    assert.ok(geometry.overflow <= 0, `${width}px control overflow: ${geometry.overflow}`);
    assert.equal(geometry.controlsHeight, 56, `${width}px controls height`);
    assert.equal(geometry.undersized, 0, `${width}px target size`);
    assert.equal(geometry.compactSectionLabel, width <= 680, `${width}px compact Section label`);
    assert.equal(geometry.wideSectionLabel, width > 680, `${width}px wide Section label`);
    assert.ok(geometry.sectionLabelsInside, `${width}px Section label bounds`);
    assert.deepEqual(
      geometry.visiblePrimaryText,
      width <= 680 ? ["Prev", "Next"] : ["Previous", "Next"],
      `${width}px visible primary text`
    );
    assert.ok(geometry.primaryLabelsInside, `${width}px primary label bounds`);
    const resizedFrames = await frameGeometry(cdp);
    assert.ok(resizedFrames.frameCoordinatesMatch, `${width}px frame coordinates: ${JSON.stringify(resizedFrames)}`);
    assert.ok(resizedFrames.transformMatches, `${width}px frame transform`);
    assert.ok(resizedFrames.documentOverflowX <= 0 && resizedFrames.documentOverflowY <= 0, `${width}px document overflow`);
    assertions += 11;
  }

  // A >10-frame locator is bounded and scrolls the active target into view.
  const longPath = path.join(buildDir, `topology-long-${longTopology.join("-")}.html`);
  await writeFile(longPath, buildNavigationFixture(longTopology), "utf8");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 240,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Page.navigate", { url: pathToFileURL(longPath).href });
  await waitForReady(cdp);
  const longInitial = await locatorGeometry(cdp);
  assert.ok(longInitial.count > 10);
  assert.ok(longInitial.top >= longInitial.stageTop - 1);
  assert.ok(longInitial.bottom <= longInitial.stageBottom + 1);
  assert.ok(longInitial.scrollHeight > longInitial.clientHeight);
  assert.ok(longInitial.targetsAtLeast24);
  assert.ok(longInitial.documentOverflowX <= 0 && longInitial.documentOverflowY <= 0);
  assertions += 6;

  await key(cdp, "End");
  assert.deepEqual(await state(cdp), [0, longTopology[0] - 1]);
  const longEnd = await locatorGeometry(cdp);
  assert.ok(longEnd.activeTop >= longEnd.top - 1 && longEnd.activeBottom <= longEnd.bottom + 1);
  assert.ok(longEnd.scrollTop > 0);
  assert.deepEqual(await axFrameControlNames(cdp), [`Frame 1-${longTopology[0]} control`]);
  assertions += 4;

  await focusTabSentinel(cdp);
  await physicalKey(cdp, "Tab", "Tab", 9);
  assert.equal(await activeDescriptor(cdp), `frame:1-${longTopology[0]}`);
  assertions++;

  // Exercise the production SlidePreviewView onOpen -> active-file -> render path.
  const hostPath = path.join(buildDir, "iframe-title.html");
  await writeFile(
    hostPath,
    `<!doctype html><html><body><script>var activeDocument = document;</script><script src="${pathToFileURL(previewFixtureBundle).href}"></script></body></html>`,
    "utf8"
  );
  await cdp.send("Page.navigate", { url: pathToFileURL(hostPath).href });
  await waitForDocument(cdp);
  await waitForPreviewFixture(cdp);
  const previewFixture = await evaluate(cdp, `window.navigationPreviewFixture`);
  assert.equal(previewFixture.initialTitle, "Achmage slide preview");
  assert.equal(previewFixture.activeTitle, "Slides: Navigation fixture");
  assert.ok(previewFixture.renderCalls >= 1, "SlidePreviewView render path ran");
  assert.ok(previewFixture.vaultReads >= 1, "SlidePreviewView read the active file");
  assert.equal(previewFixture.status, "1 slides");
  const hostAx = await fullAxTree(cdp);
  assert.equal(await evaluate(cdp, `document.querySelector('iframe').title`), "Slides: Navigation fixture");
  assert.ok(hostAx.some((node) =>
    String(node.role?.value).toLowerCase().includes("iframe") &&
    node.name?.value === "Slides: Navigation fixture"
  ));
  assertions += 7;

  // The committed bilingual demos must be exact product exports, not stale hand-edited shells.
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  for (const demo of exportedDemos) {
    assertions += await validateExportedDemo(cdp, demo);
  }

  console.log(`Navigation acceptance PASS (${assertions} assertions)`);
} finally {
  if (cdp) cdp.close();
  chrome.kill();
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  await rm(chromeUserData, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  }).catch(() => {});
}

async function state(cdp) {
  return evaluate(cdp, `[window.achmageGroupIndex, window.achmageFrameIndex]`);
}

async function validateExportedDemo(cdp, demo) {
  let assertions = 0;
  const markdown = await readFile(demo.sourcePath, "utf8");
  const h2Titles = [...markdown.matchAll(/^##[ \t]+(.+?)\r?$/gm)].map((match) =>
    match[1].trim()
  );
  assert.equal(h2Titles.length, demo.topology.length - 1, `${demo.label} source H2 count`);
  assertions++;

  await cdp.send("Page.navigate", { url: pathToFileURL(demo.exportPath).href });
  await waitForReady(cdp);

  const snapshot = await evaluate(cdp, `(() => {
    const groups = [...document.querySelectorAll('.achmage-logical-group')];
    const shellIds = [
      'btn-prev',
      'prev-route-icon',
      'counter-wide',
      'counter-compact',
      'next-route-icon',
      'btn-next',
      'btn-prev-section',
      'btn-next-section',
      'btn-fs',
      'btn-help',
      'help-dialog',
      'position-status',
      'v-dots',
    ];
    const frames = groups.flatMap((group) => [...group.querySelectorAll('.achmage-frame')]);
    const demoImages = [...document.images]
      .filter((image) => image.getAttribute('alt') === ${JSON.stringify(demo.imageAlt)});
    return {
      title: document.title,
      titleText: document.querySelector('.asu-title-text')?.textContent?.trim() || '',
      groupIndices: groups.map((group) => Number(group.dataset.group)),
      groupTitles: groups.map((group) => group.dataset.title || ''),
      declaredFrames: groups.map((group) => Number(group.dataset.frames)),
      actualFrames: groups.map((group) => group.querySelectorAll('.achmage-frame').length),
      frameIndices: groups.map((group) =>
        [...group.querySelectorAll('.achmage-frame')].map((frame) => Number(frame.dataset.frame))
      ),
      svgCount: document.querySelectorAll('.achmage-frame > svg[data-marpit-svg]').length,
      invalidViewBoxes: [...document.querySelectorAll('.achmage-frame > svg[data-marpit-svg]')]
        .filter((svg) => svg.getAttribute('viewBox') !== '0 0 1920 1080').length,
      shellCounts: shellIds.map((id) => document.querySelectorAll('#' + id).length),
      legacyShellCount:
        document.querySelectorAll('#btn-first, #btn-last, .v-ind').length,
      markerPresent: document.body.textContent.includes(${JSON.stringify(demo.marker)}),
      demoImages: demoImages.map((image) => ({
        source: image.getAttribute('src') || '',
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      })),
      obsidianLinkCount:
        document.querySelectorAll('a[href="https://obsidian.md"]').length,
      currentFrames: frames.filter((frame) => frame.getAttribute('aria-hidden') === 'false').length,
      visibleHasInert: frames.some((frame) =>
        frame.getAttribute('aria-hidden') === 'false' && frame.hasAttribute('inert')
      ),
      hiddenWithoutInert: frames.some((frame) =>
        frame.getAttribute('aria-hidden') === 'true' && !frame.hasAttribute('inert')
      ),
    };
  })()`);

  assert.equal(snapshot.title, demo.title, `${demo.label} document title`);
  assert.equal(snapshot.titleText, demo.title, `${demo.label} title slide text`);
  assert.deepEqual(
    snapshot.groupIndices,
    Array.from({ length: demo.topology.length }, (_, index) => index),
    `${demo.label} group indices`
  );
  assert.equal(snapshot.groupTitles[0], "", `${demo.label} title group metadata`);
  assert.deepEqual(snapshot.groupTitles.slice(1), h2Titles, `${demo.label} H2 mapping`);
  assert.deepEqual(snapshot.declaredFrames, demo.topology, `${demo.label} declared topology`);
  assert.deepEqual(snapshot.actualFrames, demo.topology, `${demo.label} actual topology`);
  assert.ok(
    snapshot.frameIndices.every((indices) =>
      indices.every((frame, index) => frame === index)
    ),
    `${demo.label} frame indices`
  );
  const topology = demo.topology;
  const frameCount = topology.reduce((total, count) => total + count, 0);
  assert.equal(snapshot.svgCount, frameCount, `${demo.label} Marp SVG count`);
  assert.equal(snapshot.invalidViewBoxes, 0, `${demo.label} 1920x1080 SVGs`);
  assert.ok(snapshot.shellCounts.every((count) => count === 1), `${demo.label} navigation shell`);
  assert.equal(snapshot.legacyShellCount, 0, `${demo.label} legacy navigation shell`);
  assert.equal(snapshot.markerPresent, true, `${demo.label} navigation guidance`);
  assert.equal(snapshot.demoImages.length, 1, `${demo.label} exact demo image alt`);
  const demoImage = snapshot.demoImages[0];
  const embeddedImage = demoImage.source.startsWith("data:image/jpeg;base64,");
  const exactNetworkFallback =
    demoImage.source === "https://picsum.photos/seed/achmage/1600/900";
  assert.ok(
    exactNetworkFallback ||
      (embeddedImage &&
        demoImage.complete &&
        demoImage.naturalWidth === 1600 &&
        demoImage.naturalHeight === 900),
    `${demo.label} embedded demo image decodes or exact fallback is preserved`
  );
  assert.equal(snapshot.obsidianLinkCount, 1, `${demo.label} external hyperlink`);
  assert.deepEqual(
    {
      currentFrames: snapshot.currentFrames,
      visibleHasInert: snapshot.visibleHasInert,
      hiddenWithoutInert: snapshot.hiddenWithoutInert,
    },
    { currentFrames: 1, visibleHasInert: false, hiddenWithoutInert: false },
    `${demo.label} initial frame exposure`
  );
  assertions += 17;

  const expectedOrder = topology.flatMap((frames, group) =>
    Array.from({ length: frames }, (_, frame) => [group, frame])
  );
  assert.deepEqual(await state(cdp), [0, 0], `${demo.label} initial position`);
  assertions++;
  for (let index = 1; index < expectedOrder.length; index++) {
    await key(cdp, "ArrowRight");
    assert.deepEqual(
      await state(cdp),
      expectedOrder[index],
      `${demo.label} forward frame ${index}`
    );
    assertions++;
  }
  await key(cdp, "ArrowRight");
  assert.deepEqual(await state(cdp), expectedOrder.at(-1), `${demo.label} forward endpoint`);
  assertions++;
  for (let index = expectedOrder.length - 2; index >= 0; index--) {
    await key(cdp, "ArrowLeft");
    assert.deepEqual(
      await state(cdp),
      expectedOrder[index],
      `${demo.label} reverse frame ${index}`
    );
    assertions++;
  }
  await key(cdp, "ArrowLeft");
  assert.deepEqual(await state(cdp), [0, 0], `${demo.label} reverse endpoint`);
  assertions++;

  await key(cdp, "End");
  assert.deepEqual(await state(cdp), expectedOrder.at(-1), `${demo.label} End`);
  assert.deepEqual(
    await evaluate(cdp, `({
      next: document.getElementById('btn-next').disabled,
      nextSection: document.getElementById('btn-next-section').disabled,
    })`),
    { next: true, nextSection: true },
    `${demo.label} end controls`
  );
  await key(cdp, "Home");
  assert.deepEqual(await state(cdp), [0, 0], `${demo.label} Home`);
  assert.deepEqual(
    await evaluate(cdp, `({
      previous: document.getElementById('btn-prev').disabled,
      previousSection: document.getElementById('btn-prev-section').disabled,
    })`),
    { previous: true, previousSection: true },
    `${demo.label} start controls`
  );
  assertions += 4;

  for (let group = 1; group < topology.length; group++) {
    await evaluate(cdp, `document.getElementById('btn-next-section').click()`);
    assert.deepEqual(await state(cdp), [group, 0], `${demo.label} next section ${group}`);
    assertions++;
  }
  for (let group = topology.length - 2; group >= 0; group--) {
    await evaluate(cdp, `document.getElementById('btn-prev-section').click()`);
    assert.deepEqual(await state(cdp), [group, 0], `${demo.label} previous section ${group}`);
    assertions++;
  }

  const grammarGroup = topology.findIndex((frames) => frames >= 3);
  assert.ok(grammarGroup > 0, `${demo.label} has representative three-frame section`);
  assertions++;
  const nextKeys = ["ArrowRight", "ArrowDown", "PageDown", " ", "n"];
  for (const nextKey of nextKeys) {
    await goToState(cdp, topology, grammarGroup, 0);
    assert.equal(
      await key(cdp, nextKey),
      true,
      `${demo.label} next grammar ${JSON.stringify(nextKey)} prevents browser default`
    );
    assert.deepEqual(
      await state(cdp),
      [grammarGroup, 1],
      `${demo.label} next grammar ${JSON.stringify(nextKey)} inside section`
    );
    await goToState(cdp, topology, grammarGroup, topology[grammarGroup] - 1);
    assert.equal(
      await key(cdp, nextKey),
      true,
      `${demo.label} boundary next grammar ${JSON.stringify(nextKey)} prevents browser default`
    );
    assert.deepEqual(
      await state(cdp),
      [grammarGroup + 1, 0],
      `${demo.label} next grammar ${JSON.stringify(nextKey)} across section`
    );
    assertions += 4;
  }

  const previousKeys = [
    { label: "ArrowLeft", keyValue: "ArrowLeft" },
    { label: "ArrowUp", keyValue: "ArrowUp" },
    { label: "PageUp", keyValue: "PageUp" },
    { label: "Shift+Space", keyValue: " ", modifiers: { shiftKey: true } },
    { label: "P", keyValue: "p" },
  ];
  for (const previousKey of previousKeys) {
    await goToState(cdp, topology, grammarGroup, topology[grammarGroup] - 1);
    assert.equal(
      await key(cdp, previousKey.keyValue, previousKey.modifiers),
      true,
      `${demo.label} previous grammar ${previousKey.label} prevents browser default`
    );
    assert.deepEqual(
      await state(cdp),
      [grammarGroup, topology[grammarGroup] - 2],
      `${demo.label} previous grammar ${previousKey.label} inside section`
    );
    await goToState(cdp, topology, grammarGroup + 1, 0);
    assert.equal(
      await key(cdp, previousKey.keyValue, previousKey.modifiers),
      true,
      `${demo.label} boundary previous grammar ${previousKey.label} prevents browser default`
    );
    assert.deepEqual(
      await state(cdp),
      [grammarGroup, topology[grammarGroup] - 1],
      `${demo.label} previous grammar ${previousKey.label} across section`
    );
    assertions += 4;
  }

  await goToState(cdp, topology, grammarGroup, 0);
  await evaluate(cdp, `document.getElementById('btn-next').click()`);
  assert.deepEqual(
    await state(cdp),
    [grammarGroup, 1],
    `${demo.label} primary Next advances inside section`
  );
  await goToState(cdp, topology, grammarGroup, topology[grammarGroup] - 1);
  await evaluate(cdp, `document.getElementById('btn-next').click()`);
  assert.deepEqual(
    await state(cdp),
    [grammarGroup + 1, 0],
    `${demo.label} primary Next crosses section boundary`
  );
  await goToState(cdp, topology, grammarGroup, topology[grammarGroup] - 1);
  await evaluate(cdp, `document.getElementById('btn-prev').click()`);
  assert.deepEqual(
    await state(cdp),
    [grammarGroup, topology[grammarGroup] - 2],
    `${demo.label} primary Previous reverses inside section`
  );
  await goToState(cdp, topology, grammarGroup + 1, 0);
  await evaluate(cdp, `document.getElementById('btn-prev').click()`);
  assert.deepEqual(
    await state(cdp),
    [grammarGroup, topology[grammarGroup] - 1],
    `${demo.label} primary Previous crosses section boundary`
  );
  await goToState(cdp, topology, grammarGroup, 0);
  await evaluate(cdp, `document.querySelector('.v-dot[data-frame="2"]').click()`);
  assert.deepEqual(
    await state(cdp),
    [grammarGroup, 2],
    `${demo.label} non-current dot targets its frame`
  );
  assertions += 5;

  await goToState(cdp, topology, grammarGroup, 0);
  await focusBody(cdp);
  const beforePhysicalSpaceScroll = await evaluate(cdp, `window.scrollY`);
  await physicalKey(cdp, " ", "Space", 32);
  assert.deepEqual(
    await state(cdp),
    [grammarGroup, 1],
    `${demo.label} physical Space advances`
  );
  assert.equal(
    await evaluate(cdp, `window.scrollY`),
    beforePhysicalSpaceScroll,
    `${demo.label} physical Space does not scroll the page`
  );
  await goToState(cdp, topology, grammarGroup, topology[grammarGroup] - 1);
  await focusBody(cdp);
  const beforePhysicalPageDownScroll = await evaluate(cdp, `window.scrollY`);
  await physicalKey(cdp, "PageDown", "PageDown", 34);
  assert.deepEqual(
    await state(cdp),
    [grammarGroup + 1, 0],
    `${demo.label} physical PageDown crosses section boundary`
  );
  assert.equal(
    await evaluate(cdp, `window.scrollY`),
    beforePhysicalPageDownScroll,
    `${demo.label} physical PageDown does not scroll the page`
  );
  assertions += 4;

  await goToState(cdp, topology, grammarGroup, 0);
  await clickStageEdge(cdp, "next");
  assert.deepEqual(
    await state(cdp),
    [grammarGroup, 1],
    `${demo.label} stage right edge follows reading order`
  );
  await goToState(cdp, topology, grammarGroup + 1, 0);
  await clickStageEdge(cdp, "previous");
  assert.deepEqual(
    await state(cdp),
    [grammarGroup, topology[grammarGroup] - 1],
    `${demo.label} stage left edge reverses reading order`
  );
  assertions += 2;

  await goToState(cdp, topology, grammarGroup, 1);
  await evaluate(cdp, `document.getElementById('btn-help').click()`);
  assert.equal(
    await evaluate(cdp, `document.getElementById('help-dialog').open`),
    true,
    `${demo.label} help opens`
  );
  assert.equal(await activeDescriptor(cdp), "btn-help-close", `${demo.label} help initial focus`);
  assert.deepEqual(
    await evaluate(cdp, `(() => {
      const text = document.getElementById('help-dialog').textContent;
      const normalized = text.toLocaleLowerCase();
      return {
        nextGrammar: ['Right', 'Down', 'Page Down', 'Space', 'N'].every((term) => text.includes(term)),
        previousGrammar: ['Left', 'Up', 'Page Up', 'Shift+Space', 'P'].every((term) => text.includes(term)),
        sections: normalized.includes('section') || text.includes('섹션'),
      };
    })()`),
    { nextGrammar: true, previousGrammar: true, sections: true },
    `${demo.label} help documents complete grammar`
  );
  await key(cdp, "ArrowRight");
  assert.deepEqual(
    await state(cdp),
    [grammarGroup, 1],
    `${demo.label} help owns navigation keys`
  );
  await physicalKey(cdp, "Escape", "Escape", 27);
  await evaluate(cdp, `new Promise((resolve) => setTimeout(resolve, 25))`);
  assert.equal(
    await evaluate(cdp, `document.getElementById('help-dialog').open`),
    false,
    `${demo.label} help closes with Escape`
  );
  assert.equal(await activeDescriptor(cdp), "btn-help", `${demo.label} help restores focus`);
  assertions += 6;

  const multiFrameGroup = topology.findIndex((frames) => frames > 1);
  assert.ok(multiFrameGroup > 0, `${demo.label} has overflow frames`);
  assertions++;
  for (let frame = 0; frame < topology[multiFrameGroup]; frame++) {
    await goToState(cdp, topology, multiFrameGroup, frame);
    assert.deepEqual(
      await navigationUiState(cdp),
      {
        wide: `Section ${multiFrameGroup + 1}/${topology.length} \u00b7 Slide ${frame + 1}/${topology[multiFrameGroup]}`,
        compact: `${multiFrameGroup + 1}/${topology.length} \u00b7 ${frame + 1}/${topology[multiFrameGroup]}`,
        previousRoute: frame > 0 ? "\u2191" : "\u2190",
        nextRoute: frame < topology[multiFrameGroup] - 1 ? "\u2193" : "\u2192",
        previousDisabled: false,
        nextDisabled: false,
        previousSectionDisabled: false,
        nextSectionDisabled: false,
        dotCount: topology[multiFrameGroup],
        currentDot: frame,
      },
      `${demo.label} route UI frame ${frame}`
    );
    assertions++;
  }

  const actualDots = await evaluate(cdp, `[...document.querySelectorAll('.v-dot')].map((dot) => ({
    tag: dot.tagName,
    current: dot.getAttribute('aria-current'),
    tabIndex: dot.tabIndex,
    width: dot.getBoundingClientRect().width,
    height: dot.getBoundingClientRect().height,
  }))`);
  assert.equal(
    actualDots.filter((dot) => dot.current === "true" && dot.tabIndex === 0).length,
    1,
    `${demo.label} roving current dot`
  );
  assert.ok(
    actualDots.every((dot) => dot.tag === "BUTTON" && dot.width >= 24 && dot.height >= 24),
    `${demo.label} native dot targets`
  );
  assertions += 2;

  return assertions;
}

async function key(cdp, keyValue, modifiers = {}) {
  const code = keyValue === " " ? "Space" : keyValue;
  return evaluate(cdp, `(() => {
    const event = new KeyboardEvent('keydown', ${JSON.stringify({
      key: keyValue,
      code,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    })});
    document.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
}

async function physicalKey(cdp, keyValue, code, virtualKeyCode) {
  const params = {
    key: keyValue,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  };
  const text = keyValue === "Enter" ? "\r" : undefined;
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...params, ...(text ? { text } : {}) });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

async function focusBody(cdp) {
  await evaluate(cdp, `document.body.tabIndex = -1; document.body.focus()`);
}

async function focusTabSentinel(cdp) {
  await evaluate(cdp, `(() => {
    let sentinel = document.getElementById('tab-sentinel');
    if (!sentinel) {
      sentinel = document.createElement('button');
      sentinel.id = 'tab-sentinel';
      sentinel.textContent = 'Tab sentinel';
      sentinel.style.position = 'fixed';
      sentinel.style.left = '-10000px';
      document.querySelector('.achmage-stage').before(sentinel);
    }
    sentinel.focus();
  })()`);
}

async function activeDescriptor(cdp) {
  return evaluate(cdp, `(() => {
    const element = document.activeElement;
    if (element.classList.contains('fixture-frame-control')) return 'frame:' + element.dataset.position;
    if (element.classList.contains('v-dot')) return 'dot:' + element.dataset.frame;
    return element.id || element.tagName.toLowerCase();
  })()`);
}

async function fullAxTree(cdp) {
  return (await cdp.send("Accessibility.getFullAXTree")).nodes;
}

async function axFrameControlNames(cdp) {
  const nodes = await fullAxTree(cdp);
  return nodes
    .filter((node) =>
      !node.ignored &&
      node.role?.value === "button" &&
      /^Frame \d+-\d+ control$/.test(node.name?.value || "")
    )
    .map((node) => node.name.value)
    .sort();
}

async function navigationUiState(cdp) {
  return evaluate(cdp, `(() => {
    const dots = [...document.querySelectorAll('.v-dot')];
    return {
      wide: document.getElementById('counter-wide').textContent,
      compact: document.getElementById('counter-compact').textContent,
      previousRoute: document.getElementById('prev-route-icon').textContent,
      nextRoute: document.getElementById('next-route-icon').textContent,
      previousDisabled: document.getElementById('btn-prev').disabled,
      nextDisabled: document.getElementById('btn-next').disabled,
      previousSectionDisabled: document.getElementById('btn-prev-section').disabled,
      nextSectionDisabled: document.getElementById('btn-next-section').disabled,
      dotCount: dots.length,
      currentDot: dots.findIndex((dot) => dot.getAttribute('aria-current') === 'true'),
    };
  })()`);
}

async function goToState(cdp, topology, targetGroup, targetFrame) {
  await key(cdp, "Home");
  const steps = topology
    .slice(0, targetGroup)
    .reduce((total, frameCount) => total + frameCount, 0) + targetFrame;
  for (let index = 0; index < steps; index++) await key(cdp, "ArrowRight");
}

async function clickStageEdge(cdp, direction) {
  const fraction = direction === "next" ? 0.8 : 0.2;
  await evaluate(cdp, `(() => {
    const stage = document.querySelector('.achmage-stage');
    const rect = stage.getBoundingClientRect();
    stage.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: rect.left + rect.width * ${fraction},
    }));
  })()`);
}

async function frameGeometry(cdp) {
  return evaluate(cdp, `(() => {
    const stage = document.querySelector('.achmage-stage').getBoundingClientRect();
    const group = document.querySelector('.achmage-logical-group[aria-hidden="false"]');
    const frames = [...group.querySelectorAll('.achmage-frame')];
    const currentFrame = Number(window.achmageFrameIndex);
    const stack = group.querySelector('.achmage-frame-stack');
    const matrix = new DOMMatrixReadOnly(getComputedStyle(stack).transform);
    const expectedTranslate = -currentFrame * stage.height;
    const locator = document.getElementById('v-dots').getBoundingClientRect();
    const frameDiagnostics = frames.map((frame, index) => {
      const rect = frame.getBoundingClientRect();
      return {
        index,
        top: rect.top,
        height: rect.height,
        expectedTop: stage.top + (index - currentFrame) * stage.height,
        expectedHeight: stage.height,
      };
    });
    return {
      frameCoordinatesMatch: frameDiagnostics.every((frame) =>
        Math.abs(frame.top - frame.expectedTop) <= 1 &&
        Math.abs(frame.height - frame.expectedHeight) <= 1
      ),
      frameDiagnostics,
      transformMatches: Math.abs(matrix.m42 - expectedTranslate) <= 1,
      locatorInsideStage: locator.top >= stage.top - 1 && locator.bottom <= stage.bottom + 1,
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      documentOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    };
  })()`);
}

async function waitForFramePosition(cdp) {
  const deadline = Date.now() + 1_500;
  let geometry;
  while (Date.now() < deadline) {
    geometry = await frameGeometry(cdp);
    if (geometry.frameCoordinatesMatch && geometry.transformMatches) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for frame position: ${JSON.stringify(geometry)}`);
}

async function locatorGeometry(cdp) {
  return evaluate(cdp, `(() => {
    const stage = document.querySelector('.achmage-stage').getBoundingClientRect();
    const locatorElement = document.getElementById('v-dots');
    const locator = locatorElement.getBoundingClientRect();
    const active = locatorElement.querySelector('.v-dot.active').getBoundingClientRect();
    const targets = [...locatorElement.querySelectorAll('.v-dot')];
    return {
      count: targets.length,
      stageTop: stage.top,
      stageBottom: stage.bottom,
      top: locator.top,
      bottom: locator.bottom,
      activeTop: active.top,
      activeBottom: active.bottom,
      clientHeight: locatorElement.clientHeight,
      scrollHeight: locatorElement.scrollHeight,
      scrollTop: locatorElement.scrollTop,
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      documentOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      targetsAtLeast24: targets.every((target) => {
        const rect = target.getBoundingClientRect();
        return rect.width >= 24 && rect.height >= 24;
      }),
    };
  })()`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitForReady(cdp) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, `document.readyState === 'complete' && typeof window.achmageGroupIndex === 'number'`);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for navigation fixture");
}

async function waitForDocument(cdp) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `document.readyState === 'complete'`)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for document");
}

async function waitForPreviewFixture(cdp) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await evaluate(cdp, `({
      ready: Boolean(window.navigationPreviewFixture),
      error: window.navigationPreviewFixtureError || null,
    })`);
    if (result.error) throw new Error(result.error);
    if (result.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for SlidePreviewView title fixture");
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForChrome(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chrome DevTools endpoint did not start");
}
