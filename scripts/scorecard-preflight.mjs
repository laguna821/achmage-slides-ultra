import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = resolve(root, "main.js");
const stylesPath = resolve(root, "styles.css");
const metafilePath = resolve(root, "build/scorecard/esbuild-meta.json");

const main = readFileSync(mainPath);
const source = new TextDecoder("utf-8", { fatal: true }).decode(main);
const styles = readFileSync(stylesPath, "utf8");
const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));
const normalizedOutput = Object.entries(metafile.outputs).find(
  ([name]) =>
    name.replaceAll("\\", "/").endsWith("/main.js") || name === "main.js"
);

if (!normalizedOutput) {
  throw new Error("Scorecard preflight could not find main.js in the esbuild metafile.");
}

const [, output] = normalizedOutput;
const count = (pattern, value = source) => value.match(pattern)?.length ?? 0;
const cssWithoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, "");
const inputGroups = {};

for (const [input, detail] of Object.entries(output.inputs ?? {})) {
  const normalized = input.replaceAll("\\", "/");
  const group = normalized.includes("/mathjax-full/")
    ? "mathjax"
    : normalized.includes("/highlight.js/")
      ? "highlight.js"
      : normalized.includes("/katex/")
        ? "katex"
        : normalized.includes("/@marp-team/")
          ? "marp"
          : normalized.startsWith("src/")
            ? "project-src"
            : "other";
  inputGroups[group] = (inputGroups[group] ?? 0) + detail.bytesInOutput;
}

const result = {
  note: "Local preflight only; this is not equivalent to the Obsidian Developer Dashboard Scorecard.",
  main: {
    bytes: main.byteLength,
    sha256: createHash("sha256").update(main).digest("hex"),
    // esbuild records bytes before the production build's deterministic 1280x720 to
    // 1920x1080 text rewrite. Preserve both values instead of claiming equality.
    esbuildPrePostprocessBytes: output.bytes,
    postprocessByteDelta: main.byteLength - output.bytes,
    validUtf8: true,
    hasBom:
      main.byteLength >= 3 && main[0] === 0xef && main[1] === 0xbb && main[2] === 0xbf,
    replacementCharacters: count(/\uFFFD/g),
    under5150000: main.byteLength < 5_150_000,
    under5MiB: main.byteLength < 5 * 1024 * 1024,
    underOptional4900000Target: main.byteLength < 4_900_000,
    inputGroups,
  },
  css: {
    importantDeclarations: count(/!important\b/g, cssWithoutComments),
    importantMaximum: 0,
    mozRangeSelectors: count(/::-moz-range-/g, cssWithoutComments),
    mozRangeMaximum: 0,
    browserRangeSelectors: count(
      /::-(?:moz-range-[\w-]+|webkit-slider-(?:runnable-track|thumb))/g,
      cssWithoutComments
    ),
    browserRangeMaximum: 0,
  },
  bundleTokens: {
    evalCalls: count(/\.eval\s*\(/g),
    newFunction: count(/new Function/g),
    requireFs: count(/require\(["'](?:node:)?fs["']\)/g),
    base64Calls: count(/\b(?:atob|btoa)\s*\(/g),
  },
};

const failures = [];
if (result.main.hasBom) failures.push("main.js contains a UTF-8 BOM");
if (result.main.replacementCharacters > 0) {
  failures.push("main.js contains a Unicode replacement character");
}
if (!result.main.under5150000 || !result.main.under5MiB) {
  failures.push(`main.js is too large for the 1.1.3 artifact gate: ${result.main.bytes}`);
}
if (result.css.importantDeclarations > result.css.importantMaximum) {
  failures.push(
    `styles.css !important declarations increased to ${result.css.importantDeclarations}`
  );
}
if (result.css.mozRangeSelectors > result.css.mozRangeMaximum) {
  failures.push(`styles.css contains ${result.css.mozRangeSelectors} ::-moz-range selectors`);
}
if (result.css.browserRangeSelectors > result.css.browserRangeMaximum) {
  failures.push(
    `styles.css contains ${result.css.browserRangeSelectors} browser-specific range selectors`
  );
}
if (result.bundleTokens.evalCalls !== 1) failures.push("expected exactly one eval call");
if (result.bundleTokens.newFunction !== 1) failures.push("expected exactly one new Function");
if (result.bundleTokens.requireFs !== 1) failures.push("expected exactly one fs require");
if (result.bundleTokens.base64Calls !== 3) failures.push("expected exactly three base64 calls");

console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) {
  console.error(`Scorecard preflight failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
}
