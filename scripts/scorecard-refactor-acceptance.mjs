// Bundle the scorecard refactor acceptance with a minimal Obsidian runtime stub.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, "build", "test", "scorecard-refactor");
const outfile = join(outdir, "scorecard-refactor-acceptance.cjs");
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
    "export class Setting { constructor() {} setName(){return this} setDesc(){return this} setHeading(){return this} addDropdown(){return this} addToggle(){return this} addSlider(){return this} addText(){return this} addButton(){return this} }",
    "export class SliderComponent {}",
    "export function createEl() { return {}; }",
    "export function debounce(fn) { return fn; }",
  ].join("\n")
);

await build({
  entryPoints: [join(root, "src", "tests", "scorecardRefactorAcceptance.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile,
  sourcemap: "inline",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "obsidian-stub",
      setup(bundle) {
        bundle.onResolve({ filter: /^obsidian$/ }, () => ({ path: stub }));
      },
    },
  ],
});

const result = spawnSync(process.execPath, [outfile], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
