import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, "build", "test", "native-1920-v5-acceptance");
const outfile = join(outdir, "render-native-1920-v5-acceptance.cjs");
const stub = join(outdir, "obsidian-stub.js");

async function rewriteBundledStageDefaults(file) {
  const source = await readFile(file, "utf8");
  const next = source
    .replace(/width:\s*1(?:2)(?:8)0px;/g, "width: 1920px;")
    .replace(/height:\s*7(?:2)0px;/g, "height: 1080px;");
  if (next !== source) await writeFile(file, next);
}

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
    "export class Setting { constructor() {} setName(){return this} setDesc(){return this} addDropdown(){return this} addToggle(){return this} addSlider(){return this} addText(){return this} }",
    "export function debounce(fn) { return fn; }",
  ].join("\n")
);

await build({
  entryPoints: [join(root, "src", "tests", "renderNative1920V5Acceptance.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile,
  sourcemap: "inline",
  plugins: [
    {
      name: "obsidian-stub",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: stub }));
      },
    },
  ],
});

await rewriteBundledStageDefaults(outfile);

const result = spawnSync(process.execPath, [outfile], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
