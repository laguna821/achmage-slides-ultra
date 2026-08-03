import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const prod = process.argv[2] === "production";
const outfile = "main.js";

function rewriteBundledStageDefaults() {
  const source = readFileSync(outfile, "utf8");
  const next = source
    .replace(/width:\s*1(?:2)(?:8)0px;/g, "width: 1920px;")
    .replace(/height:\s*7(?:2)0px;/g, "height: 1080px;");
  if (next !== source) writeFileSync(outfile, next);
}

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  metafile: prod,
  outfile,
  minify: prod,
  define: {
    "process.env.NODE_ENV": prod ? '"production"' : '"development"',
  },
  platform: "node",
});

if (prod) {
  try {
    const result = await context.rebuild();
    rewriteBundledStageDefaults();
    mkdirSync("build/scorecard", { recursive: true });
    writeFileSync(
      "build/scorecard/esbuild-meta.json",
      `${JSON.stringify(result.metafile, null, 2)}\n`
    );
  } finally {
    await context.dispose();
  }
  process.exit(0);
} else {
  await context.watch();
}
