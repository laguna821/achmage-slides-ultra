// Browser-free Tier 2 composer check. Bundles src/tests/tier2Dump.ts with the
// obsidian stub and runs it. Mirrors render-overflow-matrix.mjs minus the headless
// browser (which can't launch in the Dropbox/CJK path environment).
import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, "build", "test", "tier2-dump");
const outfile = join(outdir, "tier2-dump.cjs");
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
  entryPoints: [join(root, "src", "tests", "tier2Dump.ts")],
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

const result = spawnSync(process.execPath, [outfile], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
