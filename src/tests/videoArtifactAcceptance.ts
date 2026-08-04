import {
  auditVideoDeckArtifact,
  assertVideoCaptureSafe,
  normalizeVideoDeckArtifact,
  rewriteMarpRootSelectors,
  type VideoArtifactProgressV1,
  type VideoResolvedResourceV1,
} from "../video/videoArtifact";
import { VideoFrameCompositor, standaloneSvgToDataUri } from "../video/videoCompositor";
import {
  VIDEO_ARTIFACT_SCHEMA_VERSION,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type VideoDeckArtifactDraftV1,
} from "../video/videoTypes";
import { createVideoTimeline, sampleVideoTimeline } from "../video/videoTimeline";
import type { Vault } from "obsidian";

declare global {
  interface Window {
    __VIDEO_ARTIFACT_ACCEPTANCE__?: {
      readonly passed: boolean;
      readonly assertions: number;
      readonly error?: string;
    };
  }
}

let assertions = 0;

function check(value: unknown, message: string): asserts value {
  assertions += 1;
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
}

function svgBytes(color: string): Uint8Array {
  return new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect id="symbol" width="8" height="8" fill="${color}"/></svg>`
  );
}

function pngHeader(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concatenateBytes(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IEND", new Uint8Array(0))
  );
}

function concatenateBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(12 + data.byteLength);
  new DataView(output.buffer).setUint32(0, data.byteLength);
  output.set(new TextEncoder().encode(type), 4);
  output.set(data, 8);
  return output;
}

function animatedPngBytes(): Uint8Array {
  const base = pngHeader(1, 1);
  return concatenateBytes(
    base.subarray(0, base.byteLength - 12),
    pngChunk("acTL", new Uint8Array(8)),
    base.subarray(base.byteLength - 12)
  );
}

function animatedGifBytes(): Uint8Array {
  const header = Uint8Array.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  ]);
  const frame = Uint8Array.from([
    0x2c,
    0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00,
    0x00,
    0x02,
    0x02, 0x44, 0x01,
    0x00,
  ]);
  return concatenateBytes(header, frame, frame, Uint8Array.of(0x3b));
}

function gifWithDescriptor(
  screenWidth: number,
  screenHeight: number,
  left: number,
  top: number,
  width: number,
  height: number
): Uint8Array {
  const bytes = animatedGifBytes().slice(0, 28);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(6, screenWidth, true);
  view.setUint16(8, screenHeight, true);
  view.setUint16(14, left, true);
  view.setUint16(16, top, true);
  view.setUint16(18, width, true);
  view.setUint16(20, height, true);
  bytes[27] = 0x3b;
  return bytes;
}

function webpWithChunks(
  animationFlag: boolean,
  additionalChunks: readonly string[] = []
): Uint8Array {
  const vp8xData = new Uint8Array(10);
  if (animationFlag) vp8xData[0] = 0x02;
  const chunks = [riffChunk("VP8X", vp8xData), ...additionalChunks.map((type) =>
    riffChunk(type, new Uint8Array(0))
  )];
  const payload = concatenateBytes(new TextEncoder().encode("WEBP"), ...chunks);
  const output = new Uint8Array(8 + payload.byteLength);
  output.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(output.buffer).setUint32(4, payload.byteLength, true);
  output.set(payload, 8);
  return output;
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const paddedLength = data.byteLength + (data.byteLength % 2);
  const output = new Uint8Array(8 + paddedLength);
  output.set(new TextEncoder().encode(type), 0);
  new DataView(output.buffer).setUint32(4, data.byteLength, true);
  output.set(data, 8);
  return output;
}

function bmffBox(type: string, payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(8 + payload.byteLength);
  new DataView(output.buffer).setUint32(0, output.byteLength);
  output.set(new TextEncoder().encode(type), 4);
  output.set(payload, 8);
  return output;
}

function avifWithIspeDimensions(
  dimensions: readonly { readonly width: number; readonly height: number }[]
): Uint8Array {
  const ftypPayload = new Uint8Array(12);
  ftypPayload.set(new TextEncoder().encode("avif"), 0);
  ftypPayload.set(new TextEncoder().encode("avif"), 8);
  const ispeBoxes = dimensions.map(({ width, height }) => {
    const payload = new Uint8Array(12);
    const view = new DataView(payload.buffer);
    view.setUint32(4, width);
    view.setUint32(8, height);
    return bmffBox("ispe", payload);
  });
  const ipco = bmffBox("ipco", concatenateBytes(...ispeBoxes));
  const iprp = bmffBox("iprp", ipco);
  const meta = bmffBox("meta", concatenateBytes(new Uint8Array(4), iprp));
  return concatenateBytes(bmffBox("ftyp", ftypPayload), meta);
}

function physicalSvg(color: string, extra = "", sectionHtml = ""): string {
  return `<svg data-marpit-svg="" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="${color}"/>${extra}<foreignObject width="1920" height="1080"><section xmlns="http://www.w3.org/1999/xhtml" class="asu-native-1920-v5" style="box-sizing:border-box;position:relative;width:1920px;height:1080px;margin:0;padding:0;overflow:hidden">${sectionHtml}<div class="asu-frame-line-bottom" style="position:absolute;left:0;right:0;bottom:0;height:0"></div></section></foreignObject></svg>`;
}

function makeDraft(): VideoDeckArtifactDraftV1 {
  const topology = [
    { logicalIndex: 0, frameIndex: 0, frameCount: 2, color: "#ff0000" },
    { logicalIndex: 0, frameIndex: 1, frameCount: 2, color: "#0000ff" },
    { logicalIndex: 1, frameIndex: 0, frameCount: 1, color: "#00ff00" },
  ] as const;
  return {
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss:
      "div.marpit > svg > rect{shape-rendering:crispEdges}.asu-css-once-sentinel{background-image:url('https://assets.test/background.svg?v=1#symbol')}",
    frames: topology.map((entry, physicalIndex) => ({
      physicalIndex,
      logicalIndex: entry.logicalIndex,
      frameIndex: entry.frameIndex,
      frameCount: entry.frameCount,
      title: `Frame ${physicalIndex + 1}`,
      svg: physicalSvg(
        entry.color,
        physicalIndex === 0
          ? '<image href="app://vault/local.svg" width="1" height="1" opacity="0"/>'
          : ""
      ),
    })),
  };
}

async function run(): Promise<void> {
  equal(rewriteMarpRootSelectors("div.marpit>svg, div.marpit > svg{x:1}"), "svg, svg{x:1}", "root selector rewrite");
  check(standaloneSvgToDataUri("<svg>한😀</svg>").startsWith("data:image/svg+xml;base64,"), "UTF-8 SVG data URI");

  const localBytes = svgBytes("#ffffff");
  const localFile = {
    path: "assets/local.svg",
    extension: "svg",
    stat: { size: localBytes.byteLength },
  };
  const hashFile = {
    path: "assets/hash#image.svg",
    extension: "svg",
    stat: { size: localBytes.byteLength },
  };
  const vault = {
    getFiles: () => [localFile, hashFile],
    getResourcePath: (file: typeof localFile) => file === hashFile
      ? "app://vault/hash%23image.svg?cache=1"
      : "app://vault/local.svg?cache=1",
    readBinary: async () => localBytes.buffer.slice(0),
  } as unknown as Vault;
  const progress: VideoArtifactProgressV1[] = [];
  const remote = svgBytes("#101010");
  const artifact = await normalizeVideoDeckArtifact(makeDraft(), {
    vault,
    activeDocument: document,
    sourcePath: "notes/deck.md",
    onProgress: (value) => progress.push(value),
    resolveResource: async (request): Promise<VideoResolvedResourceV1> => {
      if (request.url === "app://vault/local.svg") return { bytes: localBytes, mimeType: "image/svg+xml" };
      if (request.url === "https://assets.test/background.svg?v=1") {
        return { bytes: remote, mimeType: "image/svg+xml" };
      }
      throw new Error(`Unexpected test asset ${request.url}`);
    },
  });

  equal(artifact.frames.length, 3, "physical frame count");
  check(Object.isFrozen(artifact), "artifact frozen");
  check(Object.isFrozen(artifact.frames), "artifact frame list frozen");
  check(artifact.frames.every((frame) => Object.isFrozen(frame)), "artifact frames frozen");
  check(/^[a-f0-9]{64}$/.test(artifact.artifactHash), "artifact SHA-256");
  check(artifact.frames.every((frame) => /^[a-f0-9]{64}$/.test(frame.contentHash)), "frame SHA-256");
  check(!artifact.sharedCss.includes("div.marpit"), "Marp wrapper selector removed");
  check(!/https?:|app:|blob:/i.test(artifact.sharedCss), "shared CSS resources embedded");
  check(/data:image\/svg\+xml;base64,[^)'"\s]+#symbol/.test(artifact.sharedCss), "external SVG fragment preserved");
  check(
    artifact.frames.every((frame) => !/app:\/\/vault|https:\/\/assets\.test|blob:/i.test(frame.svg)),
    "frame resources embedded"
  );
  check(artifact.frames.every((frame) => /width="1920"/.test(frame.svg)), "explicit frame width");
  check(artifact.frames.every((frame) => /height="1080"/.test(frame.svg)), "explicit frame height");
  equal(
    [artifact.sharedCss, ...artifact.frames.map((frame) => frame.svg)].join("").split("asu-css-once-sentinel").length - 1,
    1,
    "shared CSS sentinel stored exactly once in final artifact"
  );
  equal(progress.filter((item) => item.phase === "normalizing-assets").length, 2, "resource deduplication");
  equal(progress.filter((item) => item.phase === "validating-assets").length, 3, "every frame readiness checked");
  equal(progress.filter((item) => item.phase === "hashing").length, 3, "every frame hashed");
  check(
    progress.every((item, index) => index === 0 || item.completed >= progress[index - 1].completed),
    "artifact progress is monotonic"
  );
  equal(progress.at(-1)?.completed, progress.at(-1)?.total, "artifact progress reaches completion");

  const blobUrl = URL.createObjectURL(
    new Blob([Uint8Array.from(svgBytes("#222222")).buffer], { type: "image/svg+xml" })
  );
  const inlineUrl =
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%228%22%20height%3D%228%22%3E%3Crect%20width%3D%228%22%20height%3D%228%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E";
  const defaultDraft: VideoDeckArtifactDraftV1 = {
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss: ".remote{background-image:url('https://default.test/remote.svg')}",
    frames: [{
      physicalIndex: 0,
      logicalIndex: 0,
      frameIndex: 0,
      frameCount: 1,
      title: "Default resolver",
      svg: physicalSvg(
        "#333333",
        `<image href="app://vault/local.svg" width="1" height="1"/><image href="assets/local.svg" width="1" height="1"/><image href="assets/hash%23image.svg#symbol" width="1" height="1"/><image href="${blobUrl}" width="1" height="1"/><image href="${inlineUrl}" width="1" height="1"/>`
      ),
    }],
  };
  try {
    const defaultArtifact = await normalizeVideoDeckArtifact(defaultDraft, {
      vault,
      activeDocument: document,
    });
    check(!defaultArtifact.sharedCss.includes("https://default.test"), "default requestUrl asset embedded");
    check(!defaultArtifact.frames[0].svg.includes("app://vault"), "default app resource embedded from vault");
    check(!defaultArtifact.frames[0].svg.includes("assets/local.svg"), "default vault-relative resource embedded");
    check(
      /data:image\/svg\+xml;base64,[^"\s]+#symbol/.test(defaultArtifact.frames[0].svg),
      "percent-encoded hash filename resolves and preserves external fragment"
    );
    check(!defaultArtifact.frames[0].svg.includes(blobUrl), "default blob resource embedded");
    check(!defaultArtifact.frames[0].svg.includes("data:image/svg+xml,%3C"), "data URI canonicalized");
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  const httpStatusMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    {
      ...singleFrameDraft(physicalSvg("#ffffff")),
      sharedCss: ".missing{background-image:url('https://default.test/404.svg')}",
    },
    { vault, activeDocument: document }
  ));
  check(/HTTP 404.*default\.test\/404\.svg/i.test(httpStatusMessage), "non-2xx remote assets fail with URL and status");

  const declaredTooLargeMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    {
      ...singleFrameDraft(physicalSvg("#ffffff")),
      sharedCss: ".large{background-image:url('https://default.test/declared-too-large.svg')}",
    },
    { vault, activeDocument: document }
  ));
  check(
    /declared-too-large\.svg.*above the 24 MiB per-resource capture limit/i.test(declaredTooLargeMessage),
    "remote Content-Length is rejected before ASU copies the response body"
  );

  const repeated = await normalizeVideoDeckArtifact(makeDraft(), {
    vault,
    activeDocument: document,
    resolveResource: async (request) => request.url.startsWith("app:")
      ? { bytes: localBytes, mimeType: "image/svg+xml" }
      : { bytes: remote, mimeType: "image/svg+xml" },
  });
  equal(repeated.artifactHash, artifact.artifactHash, "artifact normalization deterministic");
  check(repeated.frames.length === 3, "normal final overflow probe passes every frame");

  const rawMarp = await normalizeVideoDeckArtifact(
    singleFrameDraft(
      '<svg data-marpit-svg="" viewBox="0 0 1920 1080"><foreignObject width="1920" height="1080"><section class="asu-native-1920-v5" style="box-sizing:border-box;position:relative;width:1920px;height:1080px;margin:0;padding:80px;overflow:hidden"><h2>Raw Marp string</h2><p>Line one<br>Line two</p><div class="asu-frame-line-bottom" style="position:absolute;left:0;right:0;bottom:0;height:0"></div></section></foreignObject></svg>'
    ),
    { vault, activeDocument: document }
  );
  check(
    rawMarp.frames[0].svg.includes('xmlns="http://www.w3.org/1999/xhtml"'),
    "raw Marp foreignObject receives its implicit XHTML namespace before image decode"
  );
  check(
    /<br\b[^>]*\/>/.test(rawMarp.frames[0].svg),
    "raw Marp HTML void elements are XML-self-closing before image decode"
  );

  const finalImageReadiness = await normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg(
      "#ffffff",
      "",
      `<img src="${inlineUrl}" width="8" height="8">`
    )),
    { vault, activeDocument: document }
  );
  check(
    finalImageReadiness.frames.length === 1,
    "final capture document with an HTML image passes the readiness/overflow gate"
  );

  let codeLiteralResolverCalls = 0;
  const codeLiteralUrl = "https://assets.invalid/code-example.png";
  const codeLiteralArtifact = await normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg(
      "#ffffff",
      "",
      `<pre><code>body { background: url(${codeLiteralUrl}); }</code></pre>`
    )),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => {
        codeLiteralResolverCalls += 1;
        return { bytes: remote, mimeType: "image/svg+xml" };
      },
    }
  );
  equal(codeLiteralResolverCalls, 0, "code-block url() text never enters the asset resolver");
  check(
    codeLiteralArtifact.frames[0].svg.includes(codeLiteralUrl),
    "code-block url() text remains visible and byte-preserved"
  );

  let styleResolverCalls = 0;
  const styledArtifact = await normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg(
      "#ffffff",
      '<style>.asset-backed{background-image:url("real.svg")}</style>',
      '<div class="asset-backed" style="width:8px;height:8px"></div>'
    )),
    {
      vault,
      activeDocument: document,
      resolveResource: async (request) => {
        styleResolverCalls += 1;
        equal(request.url, "real.svg", "actual style URL enters resolver");
        return { bytes: remote, mimeType: "image/svg+xml" };
      },
    }
  );
  equal(styleResolverCalls, 1, "actual style URL resolves exactly once");
  check(!styledArtifact.frames[0].svg.includes('url("real.svg")'), "actual style URL is embedded");

  let filterResolverCalls = 0;
  const filterArtifact = await normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg(
      "#ffffff",
      '<defs><filter id="asset-filter"><feImage href="filter.svg" result="asset"/><feBlend in="SourceGraphic" in2="asset"/></filter></defs><rect width="8" height="8" filter="url(#asset-filter)"/>'
    )),
    {
      vault,
      activeDocument: document,
      resolveResource: async (request) => {
        filterResolverCalls += 1;
        equal(request.url, "filter.svg", "feImage URL enters resolver");
        return { bytes: remote, mimeType: "image/svg+xml" };
      },
    }
  );
  equal(filterResolverCalls, 1, "feImage resource resolves exactly once");
  check(!filterArtifact.frames[0].svg.includes('href="filter.svg"'), "feImage resource is embedded");

  let presentationResolverCalls = 0;
  const presentationArtifact = await normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg(
      "#ffffff",
      `<rect width="8" height="8" fill="url('paint.svg#symbol')"/>`
    )),
    {
      vault,
      activeDocument: document,
      resolveResource: async (request) => {
        presentationResolverCalls += 1;
        equal(request.url, "paint.svg", "SVG presentation URL enters resolver");
        return { bytes: remote, mimeType: "image/svg+xml" };
      },
    }
  );
  equal(presentationResolverCalls, 1, "SVG presentation resource resolves exactly once");
  check(
    /fill="url\('data:image\/svg\+xml;base64,[^']+#symbol'\)"/.test(presentationArtifact.frames[0].svg),
    "SVG presentation resource is embedded with its fragment"
  );

  const activeFixtures = [
    { label: "script", svg: physicalSvg("#fff", "", '<script>parent.document.body.dataset.asuMp4Executed="1"</script>') },
    { label: "event attribute", svg: physicalSvg("#fff", "", '<div onload="parent.document.body.dataset.asuMp4Executed=\'1\'"></div>') },
    { label: "executable URL", svg: physicalSvg("#fff", "", '<a href="java script:alert(1)">unsafe</a>') },
    { label: "SMIL animation", svg: physicalSvg("#fff", '<animate attributeName="opacity" values="0;1" dur="1s"/>') },
    { label: "namespace-prefixed SVG element", svg: physicalSvg("#fff", '<e:animate xmlns:e="http://www.w3.org/2000/svg" attributeName="opacity" values="0;1" dur="1s"/>') },
    { label: "namespace-aliased image attribute", svg: physicalSvg("#fff", '<image xmlns:q="http://www.w3.org/1999/xlink" q:href="data:image/png;base64,AAAA"/>') },
    { label: "CSS animation", svg: physicalSvg("#fff", "", '<div style="animation:pulse 1s infinite"></div>') },
    { label: "CSS transition", svg: physicalSvg("#fff", "", '<div style="opacity:1;transition:opacity 1s"></div>') },
    { label: "srcset", svg: physicalSvg("#fff", "", '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" srcset="https://assets.invalid/two.png 2x">') },
    { label: "external use", svg: physicalSvg("#fff", '<use href="https://assets.invalid/icons.svg#x"/>') },
    { label: "stylesheet link", svg: physicalSvg("#fff", "", '<link rel="stylesheet" href="https://assets.invalid/a.css">') },
    { label: "meta refresh", svg: physicalSvg("#fff", "", '<meta http-equiv="refresh" content="0;url=https://assets.invalid/">') },
    { label: "image input", svg: physicalSvg("#fff", "", '<input type="image" src="https://assets.invalid/button.png">') },
    { label: "legacy table background", svg: physicalSvg("#fff", "", '<table background="https://assets.invalid/background.png"><tr><td>unsafe</td></tr></table>') },
    { label: "legacy tbody background", svg: physicalSvg("#fff", "", '<table><tbody background="https://assets.invalid/body.png"><tr><td>unsafe</td></tr></tbody></table>') },
    { label: "legacy row background", svg: physicalSvg("#fff", "", '<table><tr background="https://assets.invalid/row.png"><td>unsafe</td></tr></table>') },
    { label: "legacy column background", svg: physicalSvg("#fff", "", '<table><colgroup><col background="https://assets.invalid/column.png"></colgroup></table>') },
    { label: "standalone track source", svg: physicalSvg("#fff", "", '<track src="https://assets.invalid/captions.vtt">') },
    { label: "marquee", svg: physicalSvg("#fff", "", '<marquee>moving</marquee>') },
    { label: "indeterminate progress", svg: physicalSvg("#fff", "", '<progress></progress>') },
  ];
  delete document.body.dataset.asuMp4Executed;
  for (const fixture of activeFixtures) {
    const message = await artifactFailure(async () => {
      assertVideoCaptureSafe(singleFrameDraft(fixture.svg), document);
    });
    check(message.length > 0, `${fixture.label} fails before audit iframe load`);
  }
  check(!document.body.dataset.asuMp4Executed, "active-content safety parsing never executes authored code");

  const importMessage = await artifactFailure(async () => {
    assertVideoCaptureSafe({
      ...singleFrameDraft(physicalSvg("#fff")),
      sharedCss: '@import "https://assets.invalid/theme.css"; .safe{color:black}',
    }, document);
  });
  check(/does not support CSS @import/i.test(importMessage), "string-form shared CSS import fails closed");

  const fragmentCssMessage = await artifactFailure(async () => {
    assertVideoCaptureSafe({
      ...singleFrameDraft(physicalSvg("#fff")),
      sharedCss: ".unsafe{background:url(#capture-document)}",
    }, document);
  });
  check(
    /fragment-only CSS resource/i.test(fragmentCssMessage),
    "fetch-capable CSS fragment fails before capture iframe load"
  );

  const fragmentImageMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#fff", '<image href="#capture-document"/>')),
    { vault, activeDocument: document }
  ));
  check(
    /fragment-only .*image resources/i.test(fragmentImageMessage),
    "fragment-only image href cannot reload the capture document"
  );

  for (const [label, css] of [
    ["escaped url", String.raw`.unsafe{background:u\72l(https://assets.invalid/a.png)}`],
    ["comment-spliced url", ".unsafe{background:u/**/rl(https://assets.invalid/a.png)}"],
    ["escaped import", String.raw`@\69mport "https://assets.invalid/a.css";`],
  ] as const) {
    const message = await artifactFailure(async () => {
      assertVideoCaptureSafe({
        ...singleFrameDraft(physicalSvg("#fff")),
        sharedCss: css,
      }, document);
    });
    check(/obfuscated CSS/i.test(message), `${label} fails closed before capture`);
  }

  for (const [label, css] of [
    ["literal transition", ".unsafe{opacity:1;transition:opacity 1s}"],
    ["escaped transition property", String.raw`.unsafe{trans\69tion:opacity 1s}`],
    ["comment-spliced transition property", ".unsafe{trans/**/ition:opacity 1s}"],
    ["starting style", "@starting-style{.unsafe{opacity:0}}.unsafe{opacity:1}"],
    ["escaped starting style", String.raw`@starting-st\79le{.unsafe{opacity:0}}`],
  ] as const) {
    const message = await artifactFailure(async () => {
      assertVideoCaptureSafe({
        ...singleFrameDraft(physicalSvg("#fff")),
        sharedCss: css,
      }, document);
    });
    check(/CSS (?:transition|@starting-style)/i.test(message), `${label} fails before capture`);
  }
  assertVideoCaptureSafe({
    ...singleFrameDraft(physicalSvg("#fff")),
    sharedCss: String.raw`.u\72l{color:black}`,
  }, document);
  check(true, "an escaped selector that is not a resource token remains supported");

  for (const [label, css] of [
    ["escaped animation property", String.raw`.unsafe{anim\61tion:pulse 1s infinite}`],
    ["comment-spliced animation property", ".unsafe{ani/**/mation:pulse 1s infinite}"],
    ["escaped prefixed animation property", String.raw`.unsafe{-webkit-anim\61tion:pulse 1s infinite}`],
  ] as const) {
    const message = await artifactFailure(async () => {
      assertVideoCaptureSafe({
        ...singleFrameDraft(physicalSvg("#fff")),
        sharedCss: css,
      }, document);
    });
    check(/CSS animation/i.test(message), `${label} fails before capture`);
  }

  for (const [label, css] of [
    ["literal image-set", '.unsafe{background:image-set("https://assets.invalid/a.png" 1x)}'],
    ["literal webkit image-set", '.unsafe{background:-webkit-image-set("https://assets.invalid/a.png" 1x)}'],
    ["escaped image-set", String.raw`.unsafe{background:im\61ge-set("https://assets.invalid/a.png" 1x)}`],
    ["comment-spliced webkit image-set", '.unsafe{background:-webkit-im/**/age-set("https://assets.invalid/a.png" 1x)}'],
  ] as const) {
    const message = await artifactFailure(async () => {
      assertVideoCaptureSafe({
        ...singleFrameDraft(physicalSvg("#fff")),
        sharedCss: css,
      }, document);
    });
    check(/CSS image-set/i.test(message), `${label} with a quoted URL fails before capture`);
  }

  const escapedUrlArgumentMessage = await artifactFailure(async () => {
    assertVideoCaptureSafe({
      ...singleFrameDraft(physicalSvg("#fff")),
      sharedCss: String.raw`.unsafe{background:url(https\3a //assets.invalid/a.png)}`,
    }, document);
  });
  check(
    /escaped or comment-obfuscated CSS url\(\) arguments/i.test(escapedUrlArgumentMessage),
    "an escaped CSS url() argument fails before capture"
  );

  const lazyVault = {
    getFiles: () => { throw new Error("vault scan must remain lazy"); },
    getResourcePath: () => { throw new Error("vault resource map must remain lazy"); },
  } as unknown as Vault;
  const noAssetArtifact = await normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff")),
    { vault: lazyVault, activeDocument: document }
  );
  check(noAssetArtifact.frames.length === 1, "asset-free export does not scan the vault");

  let oversizedVaultReads = 0;
  const oversizedVaultFile = {
    path: "assets/preflight-too-large.png",
    extension: "png",
    stat: { size: 24 * 1024 * 1024 + 1 },
  };
  const oversizedVault = {
    getFiles: () => [oversizedVaultFile],
    getResourcePath: () => "app://vault/preflight-too-large.png",
    readBinary: async () => {
      oversizedVaultReads += 1;
      return new ArrayBuffer(0);
    },
  } as unknown as Vault;
  const oversizedVaultMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="assets/preflight-too-large.png"/>')),
    { vault: oversizedVault, activeDocument: document }
  ));
  check(/preflight-too-large\.png.*above the 24 MiB per-resource capture limit/i.test(oversizedVaultMessage), "vault stat size fails before readBinary");
  equal(oversizedVaultReads, 0, "oversized vault asset is never read into memory");

  const oversizedMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="oversized.png"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({
        bytes: new Uint8Array(24 * 1024 * 1024 + 1),
        mimeType: "image/png",
      }),
    }
  ));
  check(/above the 24 MiB per-resource capture limit/i.test(oversizedMessage), "oversized asset fails within a bounded budget");

  const originalCreateEl = document.win.createEl;
  let repeatedLargeDecoderElements = 0;
  document.win.createEl = <K extends keyof HTMLElementTagNameMap>(
    tag: K
  ): HTMLElementTagNameMap[K] => {
    if (tag === "img" || tag === "canvas") repeatedLargeDecoderElements += 1;
    return originalCreateEl(tag);
  };
  try {
    const repeatedLargeBytes = new Uint8Array(20 * 1024 * 1024);
    repeatedLargeBytes.set(pngHeader(1, 1));
    const repeatedLargeMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
      singleFrameDraft(physicalSvg(
        "#ffffff",
        '<image href="repeated-large.png"/><image href="repeated-large.png"/>'
      )),
      {
        vault,
        activeDocument: document,
        resolveResource: async () => ({
          bytes: repeatedLargeBytes,
          mimeType: "image/png",
        }),
      }
    ));
    check(
      /exceed the 48 MiB serialized video capture budget/i.test(repeatedLargeMessage),
      "repeated data-URI expansion fails at the serialized-artifact gate"
    );
    equal(
      repeatedLargeDecoderElements,
      0,
      "serialized-artifact budget rejects repeated large images before decoder allocation"
    );
  } finally {
    document.win.createEl = originalCreateEl;
  }

  const oversizedBlobUrl = URL.createObjectURL(new Blob(
    [new Uint8Array(24 * 1024 * 1024 + 1)],
    { type: "image/png" }
  ));
  try {
    const oversizedBlobMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
      singleFrameDraft(physicalSvg("#ffffff", `<image href="${oversizedBlobUrl}"/>`)),
      { vault, activeDocument: document }
    ));
    check(
      /above the 24 MiB per-resource capture limit/i.test(oversizedBlobMessage),
      "blob response streaming stops at the per-resource byte cap"
    );
  } finally {
    URL.revokeObjectURL(oversizedBlobUrl);
  }

  const giantDimensionMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="dimension-bomb.png"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({
        bytes: pngHeader(100_000, 100_000),
        mimeType: "image/png",
      }),
    }
  ));
  check(
    /dimensions 100000x100000 exceed.*pre-decode limit/i.test(giantDimensionMessage),
    "compressed image dimensions fail before browser decode"
  );

  const avisSequence = avifWithIspeDimensions([{ width: 16, height: 16 }]);
  avisSequence.set(new TextEncoder().encode("avis"), 8);
  for (const [label, filename, mimeType, bytes, expected] of [
    ["APNG acTL", "animated.png", "image/apng", animatedPngBytes(), /Animated APNG/i],
    ["multi-frame GIF", "animated.gif", "image/gif", animatedGifBytes(), /multi-frame GIF/i],
    ["WebP VP8X animation flag", "animated-flag.webp", "image/webp", webpWithChunks(true), /Animated WebP/i],
    ["WebP ANIM chunk", "animated-anim.webp", "image/webp", webpWithChunks(false, ["ANIM"]), /Animated WebP/i],
    ["WebP ANMF chunk", "animated-anmf.webp", "image/webp", webpWithChunks(false, ["ANMF"]), /Animated WebP/i],
    ["AVIF sequence brand", "animated.avif", "image/avif", avisSequence, /AVIF image sequences/i],
  ] as const) {
    const message = await artifactFailure(() => normalizeVideoDeckArtifact(
      singleFrameDraft(physicalSvg("#ffffff", `<image href="${filename}"/>`)),
      {
        vault,
        activeDocument: document,
        resolveResource: async () => ({ bytes, mimeType }),
      }
    ));
    check(expected.test(message), `${label} fails before browser decode`);
  }

  const multiIspeMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="multi-ispe.avif"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({
        bytes: avifWithIspeDimensions([
          { width: 16, height: 16 },
          { width: 100_000, height: 100_000 },
        ]),
        mimeType: "image/avif",
      }),
    }
  ));
  check(
    /AVIF ispe item dimensions 100000x100000 exceed.*pre-decode limit/i.test(multiIspeMessage),
    "every AVIF ispe surface is checked instead of trusting a decoy first item"
  );

  const cumulativeIspeMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="auxiliary-surfaces.avif"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({
        bytes: avifWithIspeDimensions([
          { width: 6_000, height: 6_000 },
          { width: 6_000, height: 6_000 },
          { width: 6_000, height: 6_000 },
          { width: 6_000, height: 6_000 },
        ]),
        mimeType: "image/avif",
      }),
    }
  ));
  check(
    /unique decoded-image inventory above the 134217728-pixel capture limit/i.test(
      cumulativeIspeMessage
    ),
    "AVIF auxiliary/tile ispe surfaces count toward the cumulative predecode budget"
  );

  const icoMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="icon.ico"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({
        bytes: new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
        mimeType: "image/x-icon",
      }),
    }
  ));
  check(
    /ICO image assets are not supported.*static PNG/i.test(icoMessage),
    "ICO assets fail with an actionable PNG conversion instruction"
  );

  const gifDescriptorMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="descriptor-decoy.gif"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({
        bytes: gifWithDescriptor(1, 1, 0, 0, 65_535, 65_535),
        mimeType: "image/gif",
      }),
    }
  ));
  check(
    /GIF image descriptor 0,0 65535x65535 exceeds its 1x1 logical screen/i.test(
      gifDescriptorMessage
    ),
    "GIF descriptor dimensions cannot hide behind a decoy logical screen"
  );

  const nestedRasterData = `data:image/png;base64,${btoa(
    String.fromCharCode(...pngHeader(100_000, 100_000))
  )}`;
  const nestedRasterSvg = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="${nestedRasterData}" width="8" height="8"/></svg>`
  );
  const nestedRasterMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="nested-raster.svg"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({ bytes: nestedRasterSvg, mimeType: "image/svg+xml" }),
    }
  ));
  check(
    /nested data image dimensions 100000x100000 exceed.*pre-decode limit/i.test(nestedRasterMessage),
    "data-embedded raster images inside SVG receive the same dimension gate"
  );

  const nestedAnimatedData = `data:image/png;base64,${btoa(
    String.fromCharCode(...animatedPngBytes())
  )}`;
  const nestedAnimatedSvg = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="${nestedAnimatedData}" width="8" height="8"/></svg>`
  );
  const nestedAnimatedMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="nested-animated.svg"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({ bytes: nestedAnimatedSvg, mimeType: "image/svg+xml" }),
    }
  ));
  check(/Animated APNG/i.test(nestedAnimatedMessage), "nested data:image animation is rejected recursively");

  const nestedFontSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><style>@font-face{font-family:nested;src:url(data:font/woff2;base64,AAAA)}</style><text font-family="nested">A</text></svg>'
  );
  const nestedFontMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="nested-font.svg"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({ bytes: nestedFontSvg, mimeType: "image/svg+xml" }),
    }
  ));
  check(
    /nested data font.*cannot be readiness-validated/i.test(nestedFontMessage),
    "nested SVG data fonts fail closed before outer image decode"
  );

  const percentEncodedSvg =
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%228%22%20height%3D%228%22%3E%3Crect%20width%3D%228%22%20height%3D%228%22%2F%3E%3C%2Fsvg%3E";
  const percentEncodedArtifact = await normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", `<image href="${percentEncodedSvg}"/>`)),
    { vault, activeDocument: document }
  );
  check(
    percentEncodedArtifact.frames[0].svg.includes("data:image/svg+xml;base64,"),
    "valid percent-encoded non-base64 data SVG remains supported"
  );

  const oversizedRawUnicodeMessage = await artifactFailure(() =>
    normalizeVideoDeckArtifact(
      {
        ...singleFrameDraft(physicalSvg("#ffffff")),
        sharedCss: `.oversized{background-image:url("data:image/svg+xml,${"한".repeat(
          Math.floor((24 * 1024 * 1024) / 3) + 1
        )}")}`,
      },
      { vault, activeDocument: document }
    )
  );
  check(
    /data URI.*above the 24 MiB per-resource capture limit/i.test(
      oversizedRawUnicodeMessage
    ),
    "raw Unicode data URI is rejected by its UTF-8 upper bound before decode/encode"
  );

  const largeVector = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8192" height="4882" viewBox="0 0 8192 4882"><rect width="8192" height="4882" fill="black"/></svg>'
  );
  const cumulativePixelsMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg(
      "#ffffff",
      [1, 2, 3, 4].map((index) =>
        `<image href="large-vector-${index}.svg" width="1" height="1"/>`
      ).join("")
    )),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({ bytes: largeVector, mimeType: "image/svg+xml" }),
    }
  ));
  check(
    /unique decoded-image inventory above the 134217728-pixel capture limit/i.test(cumulativePixelsMessage),
    "unique images have a cumulative decoded-pixel budget"
  );

  const corruptMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="corrupt.png"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]),
        mimeType: "image/png",
      }),
    }
  ));
  check(/could not decode image asset corrupt\.png/i.test(corruptMessage), "corrupt image hard-fails before capture");

  const nestedSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="https://nested.test/image.png"/></svg>'
  );
  const nestedMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="nested.svg"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({ bytes: nestedSvg, mimeType: "image/svg+xml" }),
    }
  ));
  check(/nested non-fragment resource.*nested\.test/i.test(nestedMessage), "nested SVG resource fails closed");

  const nestedCdataStyleSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><style><![CDATA[rect{--decoy:</style>;fill:url(https://nested.invalid/missed.svg)}]]></style><rect width="8" height="8"/></svg>'
  );
  const nestedCdataStyleMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="nested-cdata-style.svg"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({ bytes: nestedCdataStyleSvg, mimeType: "image/svg+xml" }),
    }
  ));
  check(
    /nested non-fragment resource.*nested\.invalid\/missed\.svg/i.test(nestedCdataStyleMessage),
    "DOM-decoded CDATA style cannot hide a nested external URL behind literal close markup"
  );

  const nestedAliasedAttributeSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:q="http://www.w3.org/1999/xlink" width="8" height="8"><image q:href="data:image/png;base64,AAAA"/></svg>'
  );
  const nestedAliasedAttributeMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="nested-aliased-attribute.svg"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({
        bytes: nestedAliasedAttributeSvg,
        mimeType: "image/svg+xml",
      }),
    }
  ));
  check(
    /namespace-aliased attribute q:href/i.test(nestedAliasedAttributeMessage),
    "aliased XLink resource attributes fail before outer SVG decode"
  );

  const nestedImportSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><style>@import "data:text/css,.safe%7Bcolor:black%7D"; @import "https://nested.test/second.css";</style><rect width="8" height="8"/></svg>'
  );
  const nestedImportMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="nested-import.svg"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({ bytes: nestedImportSvg, mimeType: "image/svg+xml" }),
    }
  ));
  check(/does not support CSS @import/i.test(nestedImportMessage), "every nested SVG CSS import fails closed");

  for (const [label, nestedMarkup] of [
    ["nested SMIL", '<animate attributeName="opacity" dur="1s" values="0;1"/>'],
    ["nested script", '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><script>parent.document.body.dataset.asuMp4Executed="1"</script></div></foreignObject>'],
    ["nested CSS animation", '<style>rect{animation:pulse 1s infinite}</style>'],
    ["nested CSS transition", '<style>@starting-style{rect{opacity:0}}rect{opacity:1;transition:opacity 1s}</style>'],
    ["nested obfuscated CSS URL", String.raw`<style>rect{fill:u\72l(https://assets.invalid/a.svg)}</style>`],
    ["nested marquee", '<foreignObject><marquee xmlns="http://www.w3.org/1999/xhtml">moving</marquee></foreignObject>'],
    ["nested indeterminate progress", '<foreignObject><progress xmlns="http://www.w3.org/1999/xhtml"></progress></foreignObject>'],
  ] as const) {
    const bytes = new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">${nestedMarkup}<rect width="8" height="8"/></svg>`
    );
    const message = await artifactFailure(() => normalizeVideoDeckArtifact(
      singleFrameDraft(physicalSvg("#ffffff", '<image href="nested-active.svg"/>')),
      {
        vault,
        activeDocument: document,
        resolveResource: async () => ({ bytes, mimeType: "image/svg+xml" }),
      }
    ));
    check(message.length > 0, `${label} fails inside a resolved SVG asset`);
  }

  const activeNestedData = `data:image/svg+xml;base64,${btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><script>parent.document.body.dataset.asuMp4Executed="1"</script></svg>'
  )}`;
  const recursiveActiveSvg = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="${activeNestedData}" width="8" height="8"/></svg>`
  );
  const recursiveActiveMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="nested-data-active.svg"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({ bytes: recursiveActiveSvg, mimeType: "image/svg+xml" }),
    }
  ));
  check(/nested data SVG.*active <script>/i.test(recursiveActiveMessage), "data-embedded SVG is recursively safety-checked");
  check(!document.body.dataset.asuMp4Executed, "nested SVG safety parsing remains inert");

  const nestedEmbeddedChild = `data:image/svg+xml;base64,${btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="black"/></svg>'
  )}`;
  const selfContainedNestedSvg = new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="${nestedEmbeddedChild}" width="8" height="8"/></svg>`
  );
  const selfContainedNested = await normalizeVideoDeckArtifact(
    singleFrameDraft(physicalSvg("#ffffff", '<image href="nested-embedded.svg"/>')),
    {
      vault,
      activeDocument: document,
      resolveResource: async () => ({
        bytes: selfContainedNestedSvg,
        mimeType: "image/svg+xml",
      }),
    }
  );
  check(
    selfContainedNested.frames.length === 1,
    "self-contained data URI inside an SVG remains supported"
  );

  for (const tag of ["video", "source", "iframe", "object", "embed", "canvas", "audio"]) {
    const authoredMarkup = tag === "source" || tag === "embed"
      ? `<${tag}>`
      : `<${tag}></${tag}>`;
    const mediaMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
      singleFrameDraft(physicalSvg("#ffffff", "", authoredMarkup)),
      { vault, activeDocument: document }
    ));
    check(
      new RegExp(`does not support authored <${tag}> media`, "i").test(mediaMessage),
      `authored ${tag} fails closed (${mediaMessage})`
    );
  }

  const overflowMessage = await artifactFailure(() => normalizeVideoDeckArtifact(
    singleFrameDraft(
      physicalSvg(
        "#ffffff",
        "",
        '<p style="position:absolute;left:0;top:1070px;height:100px;margin:0">Overflow</p>'
      )
    ),
    { vault, activeDocument: document }
  ));
  check(/final normalized slide overflow is \d+px.*maximum 2px/i.test(overflowMessage), "final normalized overflow hard-fails");

  let auditedResolverCalls = 0;
  let auditedRenderCalls = 0;
  const boundedAudit = await auditVideoDeckArtifact(
    (budgetShrink) => {
      auditedRenderCalls += 1;
      const corrected = Boolean(budgetShrink && Object.keys(budgetShrink).length > 0);
      const draft = singleFrameDraft(physicalSvg(
        "#ffffff",
        "",
        `<div class="audit-asset" data-audit-pass="${corrected ? "corrected" : "predictive"}" style="width:8px;height:8px"></div><p style="position:absolute;left:0;top:${corrected ? 100 : 1070}px;height:100px;margin:0">Audit order</p>`
      ));
      return {
        ...draft,
        sharedCss: '.audit-asset{background-image:url("https://audit.test/pinned.svg")}',
        frames: draft.frames.map((frame) => ({
          ...frame,
          title: corrected ? "Corrected artifact" : "Predictive artifact",
        })),
      };
    },
    {
      vault,
      activeDocument: document,
      maxPasses: 1,
      shrinkMargin: 28,
      resolveResource: async () => {
        auditedResolverCalls += 1;
        return { bytes: remote, mimeType: "image/svg+xml" };
      },
    }
  );
  equal(auditedRenderCalls, 2, "bounded audit performs one predictive and one correction render");
  equal(auditedResolverCalls, 1, "correction passes pin each canonical resource exactly once");
  equal(boundedAudit.passes, 2, "bounded audit reports both passes");
  check(boundedAudit.predictiveOverflowPx > 2, "predictive normalized artifact measures overflow");
  check(boundedAudit.converged && boundedAudit.finalOverflowPx <= 2, "corrected normalized artifact converges");
  equal(
    boundedAudit.artifact.frames[0].title,
    "Corrected artifact",
    "encoder artifact is the exact final probed correction pass"
  );
  check(
    boundedAudit.artifact.frames[0].svg.includes('data-audit-pass="corrected"'),
    "final artifact retains corrected-pass markup"
  );
  check(
    !boundedAudit.artifact.sharedCss.includes("https://audit.test") &&
      boundedAudit.artifact.sharedCss.includes("data:image/svg+xml;base64,"),
    "audit iframe input is self-contained and contains no raw resource URL"
  );

  const compositor = new VideoFrameCompositor(artifact, { activeDocument: document });
  const timeline = createVideoTimeline(artifact.frames, 0.5);
  const first = await compositor.render(sampleVideoTimeline(timeline, 0));
  assertPixel(first, 960, 540, [255, 0, 0], "hold frame is red");
  equal(compositor.getRetainedFrameIndices().join(","), "0", "hold retains one source bitmap");

  const firstTransitionMid = timeline.holdFrames + 4;
  const vertical = await compositor.render(sampleVideoTimeline(timeline, firstTransitionMid));
  assertPixel(vertical, 100, 100, [255, 0, 0], "vertical transition current half");
  assertPixel(vertical, 100, 900, [0, 0, 255], "vertical transition next half");
  equal(compositor.getRetainedFrameIndices().join(","), "0,1", "transition retains exactly two bitmaps");

  const secondSegment = timeline.holdFrames + timeline.transitionFrames;
  const horizontal = await compositor.render(
    sampleVideoTimeline(timeline, secondSegment + timeline.holdFrames + 4)
  );
  assertPixel(horizontal, 100, 100, [0, 0, 255], "horizontal transition current half");
  assertPixel(horizontal, 1800, 100, [0, 255, 0], "horizontal transition next half");
  equal(compositor.getRetainedFrameIndices().join(","), "1,2", "bitmap cache evicts prior source");
  compositor.dispose();
  equal(compositor.getRetainedFrameIndices().length, 0, "dispose releases bitmap cache");

  const popout = document.createElement("iframe");
  document.body.append(popout);
  try {
    const popoutDocument = popout.contentDocument;
    const popoutWindow = popout.contentWindow;
    check(popoutDocument && popoutWindow, "cross-realm document is available");
    Object.defineProperty(popoutDocument, "win", {
      configurable: true,
      value: popoutWindow,
    });
    popoutWindow.createEl = <K extends keyof HTMLElementTagNameMap>(
      tag: K
    ): HTMLElementTagNameMap[K] => popoutDocument.createElement(tag);
    const foreignCanvas = popoutDocument.createElement("canvas");
    check(
      foreignCanvas.constructor !== HTMLCanvasElement,
      "pop-out canvas reproduces the main-realm instanceof mismatch"
    );
    const popoutCompositor = new VideoFrameCompositor(artifact, {
      activeDocument: popoutDocument,
    });
    const popoutOutput = await popoutCompositor.render(sampleVideoTimeline(timeline, 0));
    check(popoutOutput instanceof OffscreenCanvas, "encoder canvas belongs to the module realm");
    assertPixel(popoutOutput, 960, 540, [255, 0, 0], "pop-out source composites correctly");
    popoutCompositor.dispose();
  } finally {
    popout.remove();
  }

  const aborted = new AbortController();
  aborted.abort();
  let abortName = "";
  try {
    await normalizeVideoDeckArtifact(makeDraft(), {
      vault,
      activeDocument: document,
      signal: aborted.signal,
      resolveResource: async () => ({ bytes: remote, mimeType: "image/svg+xml" }),
    });
  } catch (error) {
    abortName = error instanceof DOMException ? error.name : "";
  }
  equal(abortName, "AbortError", "normalization observes AbortSignal");

  const missingDraft: VideoDeckArtifactDraftV1 = {
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss: "",
    frames: [{
      physicalIndex: 0,
      logicalIndex: 0,
      frameIndex: 0,
      frameCount: 1,
      title: "Missing",
      svg: physicalSvg("#ffffff", '<image href="missing.png"/>'),
    }],
  };
  let missingMessage = "";
  try {
    await normalizeVideoDeckArtifact(missingDraft, { vault, activeDocument: document });
  } catch (error) {
    missingMessage = error instanceof Error ? error.message : String(error);
  }
  check(/slide 1.*missing\.png.*not found/i.test(missingMessage), "missing asset is an actionable hard failure");
}

function assertPixel(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  x: number,
  y: number,
  expected: readonly [number, number, number],
  message: string
): void {
  const context = canvas.getContext("2d");
  if (!context || !("getImageData" in context)) {
    throw new Error("Acceptance canvas context unavailable.");
  }
  const actual = [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
  assertions += 1;
  if (actual.some((value, index) => Math.abs(value - expected[index]) > 2)) {
    throw new Error(`${message}: ${actual.join(",")} !== ${expected.join(",")}`);
  }
}

function singleFrameDraft(svg: string): VideoDeckArtifactDraftV1 {
  return {
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss: "",
    frames: [{
      physicalIndex: 0,
      logicalIndex: 0,
      frameIndex: 0,
      frameCount: 1,
      title: "Acceptance",
      svg,
    }],
  };
}

async function artifactFailure(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

void run().then(
  () => {
    window.__VIDEO_ARTIFACT_ACCEPTANCE__ = { passed: true, assertions };
  },
  (error: unknown) => {
    window.__VIDEO_ARTIFACT_ACCEPTANCE__ = {
      passed: false,
      assertions,
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
    };
  }
);
