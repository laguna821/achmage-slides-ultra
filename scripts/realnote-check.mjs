// Browser-free 실 노트 라우팅 점검. src/tests/realnoteCheck.ts를 obsidian stub과 함께
// 번들해 실행. tier2-dump.mjs와 동형(헤드리스 브라우저는 Dropbox/CJK 경로에서 못 뜸).
// Run: node scripts/realnote-check.mjs "<note.md 경로>"
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, "build", "test", "tier2-dump");
const outfile = join(outdir, "realnote-check.cjs");
const stub = join(outdir, "obsidian-stub.js");

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
  entryPoints: [join(root, "src", "tests", "realnoteCheck.ts")],
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

const note = process.argv[2];
const result = spawnSync(process.execPath, [outfile, note], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
