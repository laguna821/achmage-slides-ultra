import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = resolve(root, "main.js");
const buildScript = resolve(root, "esbuild.config.mjs");

function buildAndRead() {
  const result = spawnSync(process.execPath, [buildScript, "production"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(
      `Production build failed with exit ${result.status ?? 1}: ${result.error?.message ?? "unknown error"}.`
    );
  }
  return readFileSync(mainPath);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateUtf8(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error("main.js must not contain a UTF-8 BOM.");
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (source.includes("\uFFFD")) {
    throw new Error("main.js contains a Unicode replacement character.");
  }
}

const first = buildAndRead();
const second = buildAndRead();
validateUtf8(first);
validateUtf8(second);

if (!first.equals(second)) {
  throw new Error(
    `Production build is not deterministic: ${sha256(first)} != ${sha256(second)}.`
  );
}
if (second.byteLength >= 5_600_000) {
  throw new Error(
    `main.js is ${second.byteLength} bytes; expected < 5,600,000 under the approved 1.2.0 bundle safety ceiling.`
  );
}

console.log(
  JSON.stringify(
    {
      builds: 2,
      bytes: second.byteLength,
      sha256: sha256(second),
      validUtf8: true,
      bom: false,
      replacementCharacter: false,
      underApproved5600000: true,
      under5150000: second.byteLength < 5_150_000,
      under5MiB: second.byteLength < 5 * 1024 * 1024,
    },
    null,
    2
  )
);
