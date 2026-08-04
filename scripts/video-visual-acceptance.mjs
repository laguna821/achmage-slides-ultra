import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outdir = path.join(root, "build", "test", "video-visual");
const outfile = path.join(outdir, "video-visual-acceptance.js");
const reportPath = path.join(outdir, "report.json");
const selectedSourceIndices = Object.freeze([0, 3, 7, 18, 23, 28, 33, 38, 40, 42, 44, 47]);
const categories = Object.freeze(["background", "callout", "card", "cjk", "code", "image", "math"]);
const executablePath = [
  process.env.ACHMAGE_BROWSER,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((candidate) => candidate && existsSync(candidate));

if (!executablePath) {
  throw new Error("Video visual acceptance requires Chromium. Set ACHMAGE_BROWSER to fail closed with an explicit browser.");
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "tests", "videoVisualAcceptance.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome138",
  outfile,
  plugins: [{
    name: "obsidian-video-visual-stub",
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian-video-visual-stub",
        namespace: "obsidian-video-visual-stub",
      }));
      builder.onLoad({ filter: /.*/, namespace: "obsidian-video-visual-stub" }, () => ({
        loader: "js",
        contents: [
          "export const normalizePath = (value) => value.replace(/\\\\/g, '/').replace(/^\\.\\//, '');",
          "export const requestUrl = async ({url}) => { throw new Error('Visual corpus is offline and must not request ' + url); };",
        ].join("\n"),
      }));
    },
  }],
});

const exampleNames = (await readdir(path.join(root, "examples")))
  .filter((name) => name.endsWith(".slides.html"))
  .sort((left, right) => left.localeCompare(right, "en"));
const englishName = exampleNames.find((name) => name.includes("English"));
const koreanName = exampleNames.find((name) => !name.includes("English"));
if (!englishName || !koreanName || exampleNames.length !== 2) {
  throw new Error(`Expected exactly the committed English and Korean slide HTML examples; found ${exampleNames.join(", ")}.`);
}
for (const name of [englishName, koreanName]) {
  const relative = `examples/${name}`;
  execFileSync("git", ["ls-files", "--error-unmatch", relative], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const sourceByRoute = new Map([
  ["/examples/en.html", await readFile(path.join(root, "examples", englishName), "utf8")],
  ["/examples/ko.html", await readFile(path.join(root, "examples", koreanName), "utf8")],
]);
const server = createServer((request, response) => {
  const body = sourceByRoute.get(request.url ?? "") ?? "<!doctype html><html><body></body></html>";
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") throw new Error("Video visual acceptance server did not bind.");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const fixtures = {
    width: 1920,
    height: 1080,
    decks: [],
  };
  for (const source of [
    { locale: "en", route: "/examples/en.html", name: englishName },
    { locale: "ko", route: "/examples/ko.html", name: koreanName },
  ]) {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    await page.goto(`${origin}${source.route}`, { waitUntil: "load", timeout: 60_000 });
    const extracted = await page.evaluate(({ locale, indices }) => {
      const categoryNames = ["background", "callout", "card", "cjk", "code", "image", "math"];
      const svgs = [...document.querySelectorAll(".achmage-frame > svg[data-marpit-svg]")];
      const inspect = (svg, sourceIndex) => {
        const wrapper = svg.closest(".achmage-frame");
        const group = svg.closest(".achmage-logical-group");
        const section = svg.querySelector("foreignObject > section") ?? svg.querySelector("section");
        const sectionHtml = section?.innerHTML ?? "";
        const searchable = `${section?.className ?? ""} ${section?.getAttribute("style") ?? ""} ${sectionHtml}`;
        const text = (section?.textContent ?? "").replace(/\s+/g, " ").trim();
        const imageCount = section?.querySelectorAll("img,image").length ?? 0;
        const categoryFlags = {
          background: imageCount > 0 || /background(?:-image)?|full[-_ ]?bleed|media[-_ ]?cover/i.test(searchable),
          callout: /callout|data-callout|admonition/i.test(searchable),
          card: /(?:asu-)?card|atlas|bento|definition-grid|data-role=["']card/i.test(searchable),
          cjk: /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text),
          code: Boolean(section?.querySelector("pre,code")),
          image: imageCount > 0,
          math: Boolean(section?.querySelector("mjx-container,.katex,math")) || /(?:katex|mathjax|mjx-)/i.test(searchable),
        };
        const categories = categoryNames.filter((category) => categoryFlags[category]);
        return {
          id: `${locale}-${String(sourceIndex + 1).padStart(2, "0")}`,
          locale,
          sourceIndex,
          sourceLogicalIndex: Number(group?.dataset.group ?? sourceIndex),
          sourceFrameIndex: Number(wrapper?.dataset.frame ?? 0),
          title: group?.dataset.title || text.slice(0, 120) || `Slide ${sourceIndex + 1}`,
          // Deliberately retain the committed HTML form. It relies on the
          // browser's implicit foreignObject XHTML namespace; production
          // normalization must materialize that namespace for standalone SVG.
          svg: svg.outerHTML,
          wrapperHtml: wrapper?.outerHTML ?? `<div class="marpit achmage-frame">${svg.outerHTML}</div>`,
          categories,
          imageCount,
        };
      };
      const all = svgs.map((svg, index) => inspect(svg, index));
      const availableCategories = Object.fromEntries(
        categoryNames.map((category) => [category, all.filter((frame) => frame.categories.includes(category)).length])
      );
      const exportedCss = [...document.querySelectorAll("head style")]
        .map((style) => style.textContent ?? "")
        .join("\n");
      const shellMarker = exportedCss.indexOf("/* ===== Achmage native 1920 v5");
      if (shellMarker < 0) throw new Error("Committed export renderer/shell CSS boundary was not found.");
      return {
        sourceFrameCount: all.length,
        // VideoDeckArtifact owns renderer CSS, not the interactive HTML shell
        // appended after this stable committed-export boundary.
        sharedCss: exportedCss.slice(0, shellMarker),
        availableCategories,
        frames: indices.map((index) => all[index]),
      };
    }, { locale: source.locale, indices: selectedSourceIndices });
    await page.close();

    if (extracted.sourceFrameCount !== 49) {
      throw new Error(`${source.locale} committed example changed from the qualified 49-frame topology.`);
    }
    if (extracted.frames.some((frame) => !frame)) {
      throw new Error(`${source.locale} committed example does not contain every selected physical frame.`);
    }
    fixtures.decks.push({
      locale: source.locale,
      sourceFile: `examples/${source.name}`,
      sourceFrameCount: extracted.sourceFrameCount,
      sharedCss: extracted.sharedCss,
      availableCategories: extracted.availableCategories,
      frames: extracted.frames,
    });
  }

  for (const category of categories) {
    const available = fixtures.decks.reduce((sum, deck) => sum + deck.availableCategories[category], 0);
    const selected = fixtures.decks.reduce((sum, deck) =>
      sum + deck.frames.filter((frame) => frame.categories.includes(category)).length,
    0);
    if (available > 0 && selected === 0) {
      throw new Error(`Selected visual corpus missed available ${category} content.`);
    }
  }

  const harness = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  await harness.goto(origin, { waitUntil: "load" });
  await harness.evaluate(() => {
    Object.defineProperty(Document.prototype, "win", {
      configurable: true,
      get() { return this.defaultView; },
    });
    window.createEl = (tag) => document.createElement(tag);
    window.sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  });
  const serializableFixtures = {
    ...fixtures,
    decks: fixtures.decks.map((deck) => ({
      ...deck,
      frames: deck.frames.map(({ wrapperHtml: _wrapperHtml, ...frame }) => frame),
    })),
  };
  await harness.evaluate((value) => { window.__VIDEO_VISUAL_FIXTURES__ = value; }, serializableFixtures);
  await harness.addScriptTag({ path: outfile });
  const prepared = await harness.evaluate(async () => {
    if (!window.__VIDEO_VISUAL_PREPARE__) throw new Error("Visual acceptance prepare API was not installed.");
    return window.__VIDEO_VISUAL_PREPARE__();
  });
  if (prepared.selectedFrames < 24 || prepared.overflowWorstPx > 2) {
    throw new Error(`Visual corpus preparation failed: ${JSON.stringify(prepared)}`);
  }

  for (const deck of fixtures.decks) {
    const canonical = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    await canonical.goto(origin, { waitUntil: "load" });
    await canonical.evaluate((sharedCss) => {
      const sourceStyle = document.createElement("style");
      sourceStyle.dataset.achmageCanonicalSource = "";
      sourceStyle.textContent = sharedCss;
      document.head.append(sourceStyle);
      const isolationStyle = document.createElement("style");
      isolationStyle.textContent = [
        "html,body{margin:0!important;padding:0!important;width:1920px!important;height:1080px!important;overflow:hidden!important;background:#000!important;display:block!important}",
        "body>.achmage-frame{width:1920px!important;height:1080px!important;min-height:1080px!important;display:flex!important;align-items:center!important;justify-content:center!important}",
        "body>.achmage-frame>svg[data-marpit-svg]{display:block!important;width:1920px!important;height:1080px!important;max-width:none!important;max-height:none!important}",
      ].join("\n");
      document.head.append(isolationStyle);
    }, deck.sharedCss);

    for (const frame of deck.frames) {
      const readiness = await canonical.evaluate(async (wrapperHtml) => {
        const template = document.createElement("template");
        template.innerHTML = wrapperHtml.trim();
        const wrapper = template.content.firstElementChild;
        if (!wrapper) throw new Error("Canonical committed frame wrapper was empty.");
        wrapper.removeAttribute("inert");
        wrapper.setAttribute("aria-hidden", "false");
        document.body.replaceChildren(wrapper);
        const htmlImages = [...wrapper.querySelectorAll("img")];
        await Promise.all(htmlImages.map(async (image) => {
          const source = image.currentSrc || image.src;
          if (!/^(?:data:|blob:)/i.test(source)) {
            throw new Error(`HTML image is not offline/self-contained: ${source}`);
          }
          if (image.complete && image.naturalWidth > 0) return;
          await image.decode();
        }));
        const svgImages = [...wrapper.querySelectorAll("image")];
        const svgImageUrls = svgImages.map((image, index) => {
          const url = image.getAttribute("href") ?? image.getAttribute("xlink:href") ?? "";
          if (!url) throw new Error(`SVG image ${index + 1} has no href resource.`);
          return url;
        });
        const cssBackgroundUrls = new Set();
        const collectCssUrls = (value) => {
          const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
          let match;
          while ((match = pattern.exec(value)) !== null) {
            const url = (match[1] ?? match[2] ?? match[3] ?? "").trim();
            if (url) cssBackgroundUrls.add(url);
          }
        };
        const renderedElements = [wrapper, ...wrapper.querySelectorAll("*")];
        for (const element of renderedElements) {
          collectCssUrls(getComputedStyle(element).backgroundImage);
          for (const pseudo of ["::before", "::after"]) {
            collectCssUrls(getComputedStyle(element, pseudo).backgroundImage);
          }
        }
        const verifyImage = async (image, label) => {
          if (!image.complete || image.naturalWidth < 1 || image.naturalHeight < 1) {
            throw new Error(`${label} decoded without intrinsic dimensions.`);
          }
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext("2d");
          if (!context) throw new Error(`${label} could not create a verification canvas.`);
          context.drawImage(image, 0, 0, 1, 1);
          context.getImageData(0, 0, 1, 1);
        };
        for (const [index, image] of htmlImages.entries()) {
          await verifyImage(image, `HTML image ${index + 1}`);
        }
        const verifyUrl = async (url, label) => {
          if (!/^(?:data:|blob:)/i.test(url)) {
            throw new Error(`${label} is not offline/self-contained: ${url}`);
          }
          const image = new Image();
          image.decoding = "sync";
          image.src = url;
          try {
            await image.decode();
            await verifyImage(image, label);
          } finally {
            image.src = "";
          }
        };
        let imageReferenceIndex = 0;
        for (const url of svgImageUrls) {
          imageReferenceIndex += 1;
          await verifyUrl(url, `SVG image ${imageReferenceIndex}`);
        }
        let backgroundReferenceIndex = 0;
        for (const url of cssBackgroundUrls) {
          backgroundReferenceIndex += 1;
          await verifyUrl(url, `CSS background-image ${backgroundReferenceIndex}`);
        }
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const fontFaces = [...document.fonts];
        return {
          // FontFaceSet.ready guarantees all currently used faces have settled;
          // unused weight/style declarations may legitimately remain unloaded.
          fontsReady: document.fonts.status === "loaded" &&
            fontFaces.some((font) => font.status === "loaded") &&
            document.fonts.check("16px 'Pretendard Variable'"),
          imagesReady: htmlImages.every((image) =>
            image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
          ),
          htmlImageElements: htmlImages.length,
          svgImageElements: svgImages.length,
          cssBackgroundUrls: cssBackgroundUrls.size,
          decodedImageReferences: htmlImages.length + svgImages.length + cssBackgroundUrls.size,
          loadedFontFaces: fontFaces.filter((font) => font.status === "loaded").length,
          width: document.body.firstElementChild?.getBoundingClientRect().width ?? 0,
          height: document.body.firstElementChild?.getBoundingClientRect().height ?? 0,
        };
      }, frame.wrapperHtml);
      if (!readiness.fontsReady || !readiness.imagesReady || readiness.width !== 1920 || readiness.height !== 1080) {
        throw new Error(`Canonical readiness failed for ${frame.id}: ${JSON.stringify(readiness)}`);
      }
      const png = await canonical.screenshot({ type: "png", animations: "disabled" });
      const result = await harness.evaluate(async ({ id, dataUrl, readiness }) => {
        if (!window.__VIDEO_VISUAL_COMPARE__) throw new Error("Visual comparison API was not installed.");
        return window.__VIDEO_VISUAL_COMPARE__(id, dataUrl, readiness);
      }, {
        id: frame.id,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
        readiness,
      });
      const ratioPercent = (result.differingPixelRatio * 100).toFixed(4);
      process.stdout.write(`  ${frame.id} ${ratioPercent}%\n`);
    }
    await canonical.close();
  }

  const report = await harness.evaluate(async () => {
    if (!window.__VIDEO_VISUAL_FINISH__) throw new Error("Visual acceptance report API was not installed.");
    return window.__VIDEO_VISUAL_FINISH__();
  });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const worstPercent = (report.worstDifferingPixelRatio * 100).toFixed(4);
  console.log(
    `Video visual acceptance PASS (${report.frames.length} real slides, worst ${worstPercent}% at ${report.worstFrameId}, overflow ${report.overflow.worstPx}px)`
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
