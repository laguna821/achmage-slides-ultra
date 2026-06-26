// Bundles src/tests/overflowMatrix.ts (with the obsidian stub) into a runnable
// CJS file and executes it. Mirrors render-native-1920-v5-acceptance.mjs but
// targets the geometric zero-overflow harness (Phase 0).
import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, "build", "test", "native-1920-v5-overflow");
const outfile = join(outdir, "render-overflow-matrix.cjs");
const stub = join(outdir, "obsidian-stub.js");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await writeFile(
  stub,
  [
    "export class App {}",
    "export class Plugin {}",
    "export class ItemView {}",
    "export class WorkspaceLeaf {}",
    "export class TFile {}",
    "export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }",
    "export class Notice { constructor() {} }",
    "export class Setting { constructor() {} setName(){return this} setDesc(){return this} addDropdown(){return this} addToggle(){return this} addSlider(){return this} addText(){return this} addButton(){return this} }",
    "export function debounce(fn) { return fn; }",
  ].join("\n")
);

await build({
  entryPoints: [join(root, "src", "tests", "overflowMatrix.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile,
  sourcemap: "inline",
  plugins: [
    {
      name: "obsidian-stub",
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: stub }));
      },
    },
  ],
});

const result = spawnSync(process.execPath, [outfile], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
