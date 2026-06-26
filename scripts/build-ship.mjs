// Sync native 1920 v5 build artifacts (main.js / manifest.json / styles.css) to the
// sibling native 1920 v5 dist folder. Manual carry-over from M0; automated as M1 first
// task per BLUEPRINT.md §6 Status.
//
// Usage:
//   npm run build:ship              # production build then ship
//   node scripts/build-ship.mjs     # ship only (assumes main.js up-to-date)
//
// PowerShell-compatible (`&&` not used). Exits non-zero on any missing source.

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const destRoot = join(sourceRoot, "build", "dist", "native-1920-v5");

const FILES = ["main.js", "manifest.json", "styles.css"];

mkdirSync(destRoot, { recursive: true });

let failed = 0;
for (const name of FILES) {
  const from = join(sourceRoot, name);
  const to = join(destRoot, name);
  if (!existsSync(from)) {
    console.error(`[build-ship] missing source: ${from}`);
    failed++;
    continue;
  }
  copyFileSync(from, to);
  const size = statSync(to).size;
  console.log(`[build-ship] ${name}  ${size.toLocaleString()} bytes  ->  ${to}`);
}

if (failed > 0) {
  console.error(`[build-ship] ${failed} file(s) failed to copy`);
  process.exit(2);
}

console.log(`[build-ship] OK (${FILES.length} files)`);
