import {
  normalizePath,
  requestUrl,
  type TFile,
  type Vault,
} from "obsidian";
import {
  accumulateBudgetShrink,
  aggregateOverflow,
  type ProbeResult,
} from "../audit/overflowProbe";
import { evaluateOverflowProbe } from "../audit/auditLoop";
import {
  VIDEO_ARTIFACT_SCHEMA_VERSION,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type VideoDeckArtifactDraftV1,
  type VideoDeckArtifactFrameV1,
  type VideoDeckArtifactV1,
} from "./videoTypes";
import { buildStandaloneSvg, rasterizeStandaloneSvg } from "./videoCompositor";

export { buildVideoDeckArtifactDraft } from "./videoTypes";

const DEFAULT_REMOTE_TIMEOUT_MS = 15_000;
const MAX_SINGLE_RESOURCE_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_RESOURCE_BYTES = 64 * 1024 * 1024;
// This counts the final serialized markup before the encoder creates another
// standalone-SVG copy. It is a conservative admission limit for transient
// copies, not a measured proof of any process-wide heap ceiling.
const MAX_EMBEDDED_ARTIFACT_CHARACTERS = 48 * 1024 * 1024;
const MAX_IMAGE_DIMENSION_PX = 8_192;
// Preserve common 6000x4000 photographs and 8K UHD sources while bounding one
// decoder surface and the aggregate unique-image inventory. These are
// conservative worst-case admission limits, not a proof of peak process heap.
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_TOTAL_IMAGE_PIXELS = 134_217_728;
const ROOT_SELECTOR_RE = /div\.marpit\s*>\s*svg/g;
const UNSUPPORTED_AUTHORED_MEDIA_RE = /<(?:video|source|iframe|object|embed|canvas|audio)\b/i;
const UNSUPPORTED_AUTHORED_MEDIA_TAGS = new Set([
  "audio",
  "canvas",
  "embed",
  "iframe",
  "object",
  "source",
  "video",
]);
const FINAL_OVERFLOW_TOLERANCE_PX = 2;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const UNSAFE_CAPTURE_TAGS = new Set([
  "animate",
  "animatemotion",
  "animatetransform",
  "applet",
  "audio",
  "base",
  "bgsound",
  "canvas",
  "embed",
  "frame",
  "frameset",
  "iframe",
  "link",
  "marquee",
  "object",
  "progress",
  "script",
  "set",
  "source",
  "video",
]);
const NAVIGABLE_ATTRIBUTE_NAMES = new Set([
  "action",
  "formaction",
  "href",
  "src",
  "xlink:href",
]);
const FRAGMENT_ONLY_HREF_TAGS = new Set(["mpath", "pattern", "textpath", "use"]);
const SVG_URL_PRESENTATION_ATTRIBUTES = new Set([
  "clip-path",
  "cursor",
  "fill",
  "filter",
  "marker",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "stroke",
]);
const SAFE_FRAGMENT_CSS_PROPERTIES = new Set([
  "clip-path",
  "fill",
  "filter",
  "marker",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "stroke",
]);

export type VideoArtifactProgressPhase =
  | "normalizing-assets"
  | "validating-assets"
  | "hashing";

export interface VideoArtifactProgressV1 {
  readonly phase: VideoArtifactProgressPhase;
  readonly completed: number;
  readonly total: number;
  readonly frameIndex?: number;
  readonly resource?: string;
}

export interface VideoResourceRequestV1 {
  readonly url: string;
  readonly kind: "image" | "css";
  readonly frameIndex: number | null;
  readonly sourcePath?: string;
  readonly signal?: AbortSignal;
}

export interface VideoResolvedResourceV1 {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export interface NormalizeVideoDeckArtifactOptionsV1 {
  readonly vault: Vault;
  /** Captured owner document; required so readiness is checked before encode. */
  readonly activeDocument: Document;
  /** Vault-relative source note path, used for ordinary relative Markdown images. */
  readonly sourcePath?: string;
  readonly signal?: AbortSignal;
  readonly remoteTimeoutMs?: number;
  readonly onProgress?: (progress: VideoArtifactProgressV1) => void;
  /** Dependency seam used by acceptance tests; production normally omits it. */
  readonly resolveResource?: (
    request: VideoResourceRequestV1
  ) => Promise<VideoResolvedResourceV1>;
}

export interface AuditVideoDeckArtifactOptionsV1
  extends NormalizeVideoDeckArtifactOptionsV1 {
  readonly maxPasses: number;
  readonly shrinkMargin: number;
}

export interface AuditedVideoDeckArtifactV1 {
  readonly artifact: VideoDeckArtifactV1;
  readonly predictiveOverflowPx: number;
  readonly finalOverflowPx: number;
  readonly converged: boolean;
  readonly passes: number;
}

interface AssetReference {
  readonly start: number;
  readonly end: number;
  readonly rawUrl: string;
  readonly kind: "image" | "css";
}

interface MarkupAttribute {
  readonly name: string;
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly rawValue: string;
}

interface MarkupStartTag {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly attributes: readonly MarkupAttribute[];
}

interface NormalizedResource {
  readonly dataUri: string;
}

interface AssetUrlParts {
  readonly canonicalUrl: string;
  readonly resolutionUrl: string;
  readonly fragment: string;
}

interface VaultResourceIndex {
  readonly byPath: ReadonlyMap<string, TFile>;
  readonly byResourceUrl: ReadonlyMap<string, TFile>;
}

const EMPTY_VAULT_RESOURCE_INDEX: VaultResourceIndex = {
  byPath: new Map(),
  byResourceUrl: new Map(),
};

/**
 * Reject authored active content before the audit iframe receives `srcdoc`.
 * Marp intentionally preserves raw HTML, so this check must run on every
 * render pass rather than waiting for post-audit asset normalization.
 */
export function assertVideoCaptureSafe(
  draft: VideoDeckArtifactDraftV1,
  activeDocument: Document
): void {
  validateDraft(draft);
  assertNoCssImports(draft.sharedCss, "shared slide CSS");
  assertNoCssAnimations(draft.sharedCss, "shared slide CSS");

  draft.frames.forEach((frame, frameIndex) => {
    const root = parsePhysicalSvgRoot(frame.svg, activeDocument);
    const elements = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const element of elements) {
      const tag = element.localName.toLowerCase();
      if (tag.includes(":") || element.prefix) {
        throw new Error(
          `Video export does not support namespace-prefixed element <${element.tagName}> in slide ${frameIndex + 1}. Use canonical SVG/HTML element names before exporting.`
        );
      }
      if (UNSAFE_CAPTURE_TAGS.has(tag)) {
        throw unsupportedAuthoredElement(tag, frameIndex);
      }
      if (
        tag === "meta" &&
        element.getAttribute("http-equiv")?.trim().toLowerCase() === "refresh"
      ) {
        throw unsupportedAuthoredElement("meta refresh", frameIndex);
      }
      if (tag === "style") {
        const css = element.textContent ?? "";
        assertNoCssImports(css, `slide ${frameIndex + 1} <style>`);
        assertNoCssAnimations(css, `slide ${frameIndex + 1} <style>`);
      }
      if (
        tag === "input" &&
        element.getAttribute("type")?.trim().toLowerCase() === "image" &&
        element.getAttribute("src")?.trim()
      ) {
        throw unsupportedResourceAttribute("input[type=image]", "src", frameIndex);
      }

      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.localName.toLowerCase();
        if (!isCanonicalQualifiedAttribute(attribute)) {
          throw new Error(
            `Video export does not support namespace-aliased attribute ${attribute.name} in slide ${frameIndex + 1}. Use the canonical attribute name before exporting.`
          );
        }
        const value = attribute.value.trim();
        if (name.startsWith("on") || attribute.name.toLowerCase().startsWith("on") || name === "srcdoc") {
          throw new Error(
            `Video export does not support active authored attribute ${attribute.name} in slide ${frameIndex + 1}. Remove executable HTML before exporting.`
          );
        }
        if (isUnsupportedAutoloadAttribute(tag, name, value)) {
          throw unsupportedResourceAttribute(tag, attribute.name, frameIndex);
        }
        if (name === "srcset" && value) {
          throw unsupportedResourceAttribute(tag, attribute.name, frameIndex);
        }
        if (
          NAVIGABLE_ATTRIBUTE_NAMES.has(name) &&
          /^(?:javascript:|vbscript:|data:text\/html)/i.test(
            Array.from(value).filter((character) => character.charCodeAt(0) > 0x20).join("")
          )
        ) {
          throw new Error(
            `Video export blocked an executable ${attribute.name} URL in slide ${frameIndex + 1}.`
          );
        }
        if (
          FRAGMENT_ONLY_HREF_TAGS.has(tag) &&
          name === "href" &&
          value &&
          !value.startsWith("#")
        ) {
          throw unsupportedResourceAttribute(tag, attribute.name, frameIndex);
        }
        if (name === "style") {
          assertNoCssImports(value, `slide ${frameIndex + 1} style attribute`);
          assertNoCssAnimations(value, `slide ${frameIndex + 1} style attribute`);
        }
      }
    }

    if (/<\?xml-stylesheet\b/i.test(frame.svg)) {
      throw new Error(
        `Video export does not support XML stylesheet processing instructions in slide ${frameIndex + 1}.`
      );
    }
  });
}

/**
 * Convert the renderer draft into the immutable, self-contained encoder
 * contract. Every resource is embedded and every finished frame is decoded in
 * the captured document before a hash is published. There is deliberately no
 * permissive fallback: a missing asset would make the MP4 differ from Preview.
 */
interface NormalizedVideoDeckArtifactPass {
  readonly artifact: VideoDeckArtifactV1;
  readonly probe: ProbeResult;
}

interface NormalizeVideoDeckArtifactControls {
  readonly enforceOverflow: boolean;
  readonly resolvedResourceCache?: Map<string, VideoResolvedResourceV1>;
}

export async function normalizeVideoDeckArtifact(
  draft: VideoDeckArtifactDraftV1,
  options: NormalizeVideoDeckArtifactOptionsV1
): Promise<VideoDeckArtifactV1> {
  return (await normalizeVideoDeckArtifactPass(draft, options, {
    enforceOverflow: true,
  })).artifact;
}

/**
 * Runs the correction loop only over bounded, resource-normalized markup.
 * Raw deck HTML is never assigned to an audit iframe, and the exact artifact
 * measured on the converged pass is returned to the encoder without another
 * render or fetch.
 */
export async function auditVideoDeckArtifact(
  render: (
    budgetShrink: Readonly<Record<number, number>> | undefined
  ) => VideoDeckArtifactDraftV1,
  options: AuditVideoDeckArtifactOptionsV1
): Promise<AuditedVideoDeckArtifactV1> {
  if (!Number.isInteger(options.maxPasses) || options.maxPasses < 0) {
    throw new RangeError("Video artifact audit maxPasses must be a non-negative integer.");
  }
  if (!Number.isFinite(options.shrinkMargin) || options.shrinkMargin < 0) {
    throw new RangeError("Video artifact audit shrinkMargin must be non-negative.");
  }
  const budgetShrink: Record<number, number> = {};
  const resolvedResourceCache = new Map<string, VideoResolvedResourceV1>();
  let predictiveOverflowPx = -1;
  let finalOverflowPx = -1;
  let finalArtifact: VideoDeckArtifactV1 | null = null;
  let passes = 0;

  for (let pass = 0; pass <= options.maxPasses; pass += 1) {
    throwIfAborted(options.signal);
    passes = pass + 1;
    const draft = render(pass === 0 ? undefined : budgetShrink);
    const normalized = await normalizeVideoDeckArtifactPass(draft, options, {
      enforceOverflow: false,
      resolvedResourceCache,
    });
    throwIfAborted(options.signal);
    const { worst, groupOverflow } = aggregateOverflow(
      normalized.probe,
      FINAL_OVERFLOW_TOLERANCE_PX
    );
    if (pass === 0) predictiveOverflowPx = worst;
    finalOverflowPx = worst;
    finalArtifact = normalized.artifact;
    if (worst <= FINAL_OVERFLOW_TOLERANCE_PX) {
      return Object.freeze({
        artifact: finalArtifact,
        predictiveOverflowPx,
        finalOverflowPx,
        converged: true,
        passes,
      });
    }
    if (pass < options.maxPasses) {
      accumulateBudgetShrink(
        budgetShrink,
        groupOverflow,
        FINAL_OVERFLOW_TOLERANCE_PX,
        options.shrinkMargin
      );
    }
  }

  if (!finalArtifact) {
    throw new Error("Video artifact audit did not produce a render pass.");
  }
  return Object.freeze({
    artifact: finalArtifact,
    predictiveOverflowPx,
    finalOverflowPx,
    converged: false,
    passes,
  });
}

async function normalizeVideoDeckArtifactPass(
  draft: VideoDeckArtifactDraftV1,
  options: NormalizeVideoDeckArtifactOptionsV1,
  controls: NormalizeVideoDeckArtifactControls
): Promise<NormalizedVideoDeckArtifactPass> {
  throwIfAborted(options.signal);
  assertVideoCaptureSafe(draft, options.activeDocument);

  const rewrittenCss = rewriteMarpRootSelectors(draft.sharedCss);
  const initialFrames = draft.frames.map((frame, frameIndex) => {
    assertNoUnsupportedAuthoredMedia(frame.svg, frameIndex);
    return normalizePhysicalSvgRoot(
      frame.svg,
      draft.width,
      draft.height,
      options.activeDocument
    );
  });
  initialFrames.forEach((svg, frameIndex) => assertNoUnsupportedAuthoredMedia(svg, frameIndex));
  const cssReferences = collectCssUrlReferences(rewrittenCss);
  const referencesByFrame = initialFrames.map((svg, frameIndex) =>
    collectAssetReferences(svg, `slide ${frameIndex + 1}`)
  );
  const uniqueUrls = new Map<
    string,
    { kind: "image" | "css"; frameIndex: number | null; parts: AssetUrlParts }
  >();

  for (const reference of cssReferences) {
    const parts = splitAssetUrl(reference.rawUrl);
    if (!isEmbeddedAssetReference(parts.canonicalUrl)) continue;
    if (!uniqueUrls.has(parts.canonicalUrl)) {
      uniqueUrls.set(parts.canonicalUrl, { kind: "css", frameIndex: null, parts });
    }
  }

  referencesByFrame.forEach((references, frameIndex) => {
    for (const reference of references) {
      const parts = splitAssetUrl(reference.rawUrl);
      if (!isEmbeddedAssetReference(parts.canonicalUrl)) continue;
      if (!uniqueUrls.has(parts.canonicalUrl)) {
        uniqueUrls.set(parts.canonicalUrl, { kind: reference.kind, frameIndex, parts });
      }
    }
  });

  const referenceCounts = new Map<string, number>();
  for (const reference of [cssReferences, ...referencesByFrame].flat()) {
    const canonicalUrl = splitAssetUrl(reference.rawUrl).canonicalUrl;
    if (!isEmbeddedAssetReference(canonicalUrl)) continue;
    referenceCounts.set(canonicalUrl, (referenceCounts.get(canonicalUrl) ?? 0) + 1);
  }

  const resourceCache = new Map<string, NormalizedResource>();
  const progressTotal = uniqueUrls.size + draft.frames.length * 2;
  const resolveResource = options.resolveResource ?? createDefaultResourceResolver(options);
  let resourceIndex = 0;
  let totalResolvedBytes = 0;
  let totalDecodedImagePixels = 0;
  let projectedArtifactCharacters = rewrittenCss.length + initialFrames.reduce(
    (sum, svg) => sum + svg.length,
    0
  );
  if (projectedArtifactCharacters > MAX_EMBEDDED_ARTIFACT_CHARACTERS) {
    throw new Error("Video export slide markup exceeds the 48 MiB serialized capture budget.");
  }
  for (const [url, context] of uniqueUrls) {
    throwIfAborted(options.signal);
    try {
      // Fragment variants of one pinned resource must never refetch mutable
      // bytes between audit passes (or between #symbol references).
      const resolvedCacheKey = context.parts.resolutionUrl;
      let resolved = controls.resolvedResourceCache?.get(resolvedCacheKey);
      const wasCached = Boolean(resolved);
      if (!resolved) {
        const source = await resolveResource({
          url: context.parts.resolutionUrl,
          kind: context.kind,
          frameIndex: context.frameIndex,
          sourcePath: options.sourcePath,
          signal: options.signal,
        });
        throwIfAborted(options.signal);
        const sourceByteLength = source.bytes.byteLength;
        if (sourceByteLength > MAX_SINGLE_RESOURCE_BYTES) {
          throw new Error(
            `Asset is ${formatMiB(sourceByteLength)}, above the 24 MiB per-resource capture limit.`
          );
        }
        if (totalResolvedBytes + sourceByteLength > MAX_TOTAL_RESOURCE_BYTES) {
          throw new Error("Resolved assets exceed the 64 MiB total capture limit.");
        }
        if (controls.resolvedResourceCache) {
          const cachedBytes = [...controls.resolvedResourceCache.values()].reduce(
            (sum, item) => sum + item.bytes.byteLength,
            0
          );
          if (cachedBytes + sourceByteLength > MAX_TOTAL_RESOURCE_BYTES) {
            throw new Error(
              "Resolved assets across video audit correction passes exceed the 64 MiB pinned-resource limit."
            );
          }
        }
        resolved = {
          bytes: copyBytes(source.bytes),
          mimeType: source.mimeType,
        };
      }
      const bytes = resolved.bytes;
      if (bytes.byteLength > MAX_SINGLE_RESOURCE_BYTES) {
        throw new Error(
          `Asset is ${formatMiB(bytes.byteLength)}, above the 24 MiB per-resource capture limit.`
        );
      }
      if (totalResolvedBytes + bytes.byteLength > MAX_TOTAL_RESOURCE_BYTES) {
        throw new Error("Resolved assets exceed the 64 MiB total capture limit.");
      }
      if (!wasCached && controls.resolvedResourceCache) {
        controls.resolvedResourceCache.set(resolvedCacheKey, resolved);
      }
      totalResolvedBytes += bytes.byteLength;
      const mimeType = normalizeMimeType(resolved.mimeType, url);
      assertSupportedAssetMime(mimeType, url);
      const dataUriCharacters = base64DataUriCharacterLength(bytes.byteLength, mimeType);
      const repeatedCharacters = dataUriCharacters * (referenceCounts.get(url) ?? 1);
      if (
        !Number.isSafeInteger(repeatedCharacters) ||
        projectedArtifactCharacters + repeatedCharacters > MAX_EMBEDDED_ARTIFACT_CHARACTERS
      ) {
        throw new Error(
          "Embedded assets would exceed the 48 MiB serialized video capture budget. Reduce repeated or oversized images."
        );
      }
      if (mimeType.startsWith("image/")) {
        const decodedPixels = await validateResolvedImage(
          bytes,
          mimeType,
          url,
          totalDecodedImagePixels,
          options
        );
        totalDecodedImagePixels += decodedPixels;
      } else if (isFontMime(mimeType)) {
        await validateEmbeddedFont(bytes, url, options);
      }
      const dataUri = bytesToDataUri(bytes, mimeType);
      projectedArtifactCharacters += repeatedCharacters;
      resourceCache.set(url, {
        dataUri,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error(
        `Video export could not embed asset${context.frameIndex === null ? " in shared CSS" : ` in slide ${context.frameIndex + 1}`}: ${url}. ${errorMessage(error)}`,
        { cause: error }
      );
    }
    resourceIndex += 1;
    reportProgress(options, {
      phase: "normalizing-assets",
      completed: resourceIndex,
      total: progressTotal,
      ...(context.frameIndex === null ? {} : { frameIndex: context.frameIndex }),
      resource: url,
    });
  }

  const normalizedSharedCss = replaceAssetReferences(
    rewrittenCss,
    cssReferences,
    resourceCache,
    null
  );
  const normalizedSvgs = initialFrames.map((svg, frameIndex) => {
    const references = referencesByFrame[frameIndex];
    return replaceAssetReferences(svg, references, resourceCache, frameIndex);
  });

  for (let frameIndex = 0; frameIndex < normalizedSvgs.length; frameIndex += 1) {
    throwIfAborted(options.signal);
    const standaloneSvg = buildStandaloneSvg(
      normalizedSvgs[frameIndex],
      normalizedSharedCss,
      draft.width,
      draft.height
    );
    const validationCanvas = await rasterizeStandaloneSvg(standaloneSvg, {
      activeDocument: options.activeDocument,
      signal: options.signal,
    });
    // Readiness validation is intentionally sequential. Release each 8 MiB
    // raster immediately so a 100/500-slide deck cannot depend on GC timing.
    validationCanvas.width = 1;
    validationCanvas.height = 1;
    reportProgress(options, {
      phase: "validating-assets",
      completed: uniqueUrls.size + frameIndex + 1,
      total: progressTotal,
      frameIndex,
    });
  }

  const finalProbe = await measureFinalCaptureOverflow(
    normalizedSharedCss,
    normalizedSvgs,
    draft,
    options
  );
  const { worst: finalOverflowPx } = aggregateOverflow(
    finalProbe,
    FINAL_OVERFLOW_TOLERANCE_PX
  );
  if (controls.enforceOverflow && finalOverflowPx > FINAL_OVERFLOW_TOLERANCE_PX) {
    throw new Error(
      `Video export final normalized slide overflow is ${finalOverflowPx}px (maximum ${FINAL_OVERFLOW_TOLERANCE_PX}px).`
    );
  }

  const frames: VideoDeckArtifactFrameV1[] = [];
  for (let frameIndex = 0; frameIndex < draft.frames.length; frameIndex += 1) {
    throwIfAborted(options.signal);
    const source = draft.frames[frameIndex];
    const svg = normalizedSvgs[frameIndex];
    const contentHash = await sha256Hex(svg, options.activeDocument.win.crypto);
    frames.push(Object.freeze({
      physicalIndex: source.physicalIndex,
      logicalIndex: source.logicalIndex,
      frameIndex: source.frameIndex,
      frameCount: source.frameCount,
      title: source.title,
      svg,
      contentHash,
    }));
    reportProgress(options, {
      phase: "hashing",
      completed: uniqueUrls.size + draft.frames.length + frameIndex + 1,
      total: progressTotal,
      frameIndex,
    });
  }

  const frozenFrames = Object.freeze(frames.slice());
  const sharedCssHash = await sha256Hex(
    normalizedSharedCss,
    options.activeDocument.win.crypto
  );
  const artifactHash = await sha256Hex(JSON.stringify({
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCssHash,
    frames: frozenFrames.map((frame) => ({
      physicalIndex: frame.physicalIndex,
      logicalIndex: frame.logicalIndex,
      frameIndex: frame.frameIndex,
      frameCount: frame.frameCount,
      title: frame.title,
      contentHash: frame.contentHash,
    })),
  }), options.activeDocument.win.crypto);

  const artifact = Object.freeze({
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss: normalizedSharedCss,
    artifactHash,
    frames: frozenFrames,
  });
  return { artifact, probe: finalProbe };
}

export function rewriteMarpRootSelectors(css: string): string {
  return css.replace(ROOT_SELECTOR_RE, "svg");
}

function normalizePhysicalSvgRoot(
  physicalSvg: string,
  width: number = VIDEO_WIDTH,
  height: number = VIDEO_HEIGHT,
  activeDocument: Document
): string {
  const root = parsePhysicalSvgRoot(physicalSvg, activeDocument);
  root.setAttribute("xmlns", SVG_NAMESPACE);
  root.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // Marp's `result.slides` are HTML-serialized SVG strings. Parsing them in an
  // inert HTML document restores the browser's implicit XHTML namespace inside
  // foreignObject and HTML void-element semantics (`<br>` -> `<br />`).
  // XMLSerializer then produces the self-contained XML form required by an
  // SVG loaded through HTMLImageElement without rebuilding any layout nodes.
  const Serializer = (
    activeDocument.win as unknown as { XMLSerializer: typeof XMLSerializer }
  ).XMLSerializer;
  return new Serializer().serializeToString(root);
}

function parsePhysicalSvgRoot(
  physicalSvg: string,
  activeDocument: Document
): Element {
  const Parser = (
    activeDocument.win as unknown as { DOMParser: typeof DOMParser }
  ).DOMParser;
  const parsed = new Parser().parseFromString(physicalSvg.trim(), "text/html");
  const root = parsed.body.firstElementChild;
  if (
    !root ||
    parsed.body.childElementCount !== 1 ||
    root.localName.toLowerCase() !== "svg" ||
    root.namespaceURI !== SVG_NAMESPACE
  ) {
    throw new Error("Video export expected each physical frame to be a root SVG element.");
  }
  return root;
}

async function resolveDefaultResource(
  request: VideoResourceRequestV1,
  options: NormalizeVideoDeckArtifactOptionsV1,
  vaultIndex: VaultResourceIndex
): Promise<VideoResolvedResourceV1> {
  const url = request.url.trim();
  if (/^data:/i.test(url)) return parseDataUri(url);
  if (/^https?:/i.test(url)) {
    // Obsidian's requestUrl buffers the response internally and exposes no
    // AbortSignal hook. The timeout/cancel race below stops this export job,
    // while the host request may finish in the background. Content-Length and
    // the returned buffer are still checked before ASU makes another copy.
    const response = await withAbortAndTimeout(
      requestUrl({ url }),
      request.signal,
      options.remoteTimeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS,
      `Timed out fetching remote video asset: ${url}`,
      options.activeDocument.win
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Remote asset returned HTTP ${response.status}: ${url}`);
    }
    assertDeclaredContentLength(response.headers, url);
    assertResourceByteLength(response.arrayBuffer.byteLength, url);
    const header = response.headers?.["content-type"] ?? response.headers?.["Content-Type"];
    return {
      bytes: new Uint8Array(response.arrayBuffer),
      mimeType: String(header ?? mimeFromPath(url)),
    };
  }
  if (/^blob:/i.test(url)) {
    const response = await options.activeDocument.win.fetch(url, { signal: request.signal });
    if (!response.ok) throw new Error(`Blob asset returned HTTP ${response.status}.`);
    assertDeclaredContentLength(response.headers, url);
    const bytes = await readBoundedResponseBytes(response, url, request.signal);
    return {
      bytes,
      mimeType: response.headers.get("content-type") ?? mimeFromPath(url),
    };
  }
  if (/^file:/i.test(url)) {
    throw new Error("File URLs outside the vault are not supported.");
  }

  const file = findVaultFile(vaultIndex, url, options.sourcePath);
  if (!file) throw new Error("The asset was not found in the current vault.");
  assertVaultFileSize(file);
  const bytes = await options.vault.readBinary(file);
  throwIfAborted(request.signal);
  return { bytes: new Uint8Array(bytes), mimeType: mimeFromVaultPath(file.path) };
}

function createDefaultResourceResolver(
  options: NormalizeVideoDeckArtifactOptionsV1
): (request: VideoResourceRequestV1) => Promise<VideoResolvedResourceV1> {
  let index: VaultResourceIndex | undefined;
  return async (request) => {
    const url = request.url.trim();
    if (!/^(?:data:|https?:|blob:|file:)/i.test(url)) {
      const direct = findDirectVaultFile(options.vault, url, options.sourcePath);
      if (direct) {
        assertVaultFileSize(direct);
        const bytes = await options.vault.readBinary(direct);
        throwIfAborted(request.signal);
        return {
          bytes: new Uint8Array(bytes),
          mimeType: mimeFromVaultPath(direct.path),
        };
      }
      index ??= buildVaultResourceIndex(options.vault);
    }
    return resolveDefaultResource(
      request,
      options,
      index ?? EMPTY_VAULT_RESOURCE_INDEX
    );
  };
}

async function readBoundedResponseBytes(
  response: Response,
  url: string,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    assertResourceByteLength(buffer.byteLength, url);
    return new Uint8Array(buffer);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      assertResourceByteLength(total, url);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function buildVaultResourceIndex(vault: Vault): VaultResourceIndex {
  const byPath = new Map<string, TFile>();
  const byResourceUrl = new Map<string, TFile>();
  for (const file of vault.getFiles()) {
    byPath.set(normalizePath(file.path), file);
    byResourceUrl.set(comparableResourceUrl(vault.getResourcePath(file)), file);
  }
  return { byPath, byResourceUrl };
}

function findDirectVaultFile(
  vault: Vault,
  rawUrl: string,
  sourcePath?: string
): TFile | null {
  if (/^app:/i.test(rawUrl)) return null;
  const getAbstractFileByPath: unknown = Reflect.get(vault, "getAbstractFileByPath");
  if (typeof getAbstractFileByPath !== "function") return null;

  const decoded = safelyDecodeUri(rawUrl).replace(/^\/+/, "");
  const candidates = [decoded];
  if (sourcePath && !decoded.startsWith("/")) {
    const slash = sourcePath.lastIndexOf("/");
    if (slash >= 0) candidates.unshift(`${sourcePath.slice(0, slash + 1)}${decoded}`);
  }
  for (const candidate of candidates) {
    const path = normalizePath(candidate.replace(/\\/g, "/"));
    const file: unknown = Reflect.apply(getAbstractFileByPath, vault, [path]);
    if (isTFileLike(file)) return file;
  }
  return null;
}

function isTFileLike(value: unknown): value is TFile {
  return typeof value === "object" && value !== null &&
    typeof Reflect.get(value, "path") === "string" &&
    typeof Reflect.get(value, "extension") === "string";
}

function findVaultFile(
  index: VaultResourceIndex,
  rawUrl: string,
  sourcePath?: string
): TFile | null {
  const comparable = comparableResourceUrl(rawUrl);
  if (/^app:/i.test(rawUrl)) {
    return index.byResourceUrl.get(comparable) ?? null;
  }

  const decoded = safelyDecodeUri(rawUrl).replace(/^\/+/, "");
  const candidates = [decoded];
  if (sourcePath && !decoded.startsWith("/")) {
    const slash = sourcePath.lastIndexOf("/");
    if (slash >= 0) candidates.unshift(`${sourcePath.slice(0, slash + 1)}${decoded}`);
  }
  const normalizedCandidates = new Set(
    candidates.map((candidate) => normalizePath(candidate.replace(/\\/g, "/")))
  );
  for (const candidate of normalizedCandidates) {
    const file = index.byPath.get(candidate);
    if (file) return file;
  }
  return null;
}

function comparableResourceUrl(url: string): string {
  return safelyDecodeUri(splitAssetUrl(url).resolutionUrl).replace(/\\/g, "/");
}

function assertVaultFileSize(file: TFile): void {
  const stat: unknown = Reflect.get(file, "stat");
  const size: unknown = stat && typeof stat === "object"
    ? Reflect.get(stat, "size")
    : undefined;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Could not determine the vault asset size before reading ${file.path}.`);
  }
  assertResourceByteLength(size, file.path);
}

function assertDeclaredContentLength(
  headers: Headers | Record<string, string> | undefined,
  url: string
): void {
  if (!headers) return;
  let raw: string | null | undefined;
  const get: unknown = Reflect.get(headers, "get");
  if (typeof get === "function") {
    raw = Reflect.apply(get, headers, ["content-length"]) as string | null;
  } else {
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() !== "content-length") continue;
      const value: unknown = Reflect.get(headers, name);
      if (typeof value === "string") raw = value;
      break;
    }
  }
  if (!raw) return;
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`Remote asset returned an invalid Content-Length for ${url}.`);
  }
  const size = Number(value);
  if (!Number.isSafeInteger(size)) {
    throw new Error(`Remote asset Content-Length is too large to validate for ${url}.`);
  }
  assertResourceByteLength(size, url);
}

function assertResourceByteLength(bytes: number, url: string): void {
  if (bytes > MAX_SINGLE_RESOURCE_BYTES) {
    throw new Error(
      `Asset ${url} is ${formatMiB(bytes)}, above the 24 MiB per-resource capture limit.`
    );
  }
}

function collectAssetReferences(
  svg: string,
  context: string = "SVG frame"
): readonly AssetReference[] {
  if (/<\?xml-stylesheet\b/i.test(svg)) {
    throw new Error(`Video export does not support XML stylesheet processing instructions in ${context}.`);
  }

  const references: AssetReference[] = [];
  let cursor = 0;
  while (cursor < svg.length) {
    const tag = nextMarkupStartTag(svg, cursor);
    if (!tag) break;
    cursor = tag.end + 1;

    if (tag.name === "link") {
      throw new Error(`Video export does not support authored <link> resources in ${context}.`);
    }
    if (tag.name === "style") {
      const closeStart = svg.toLowerCase().indexOf("</style", cursor);
      if (closeStart < 0) {
        throw new Error(`Video export found an unterminated <style> element in ${context}.`);
      }
      references.push(...collectCssUrlReferences(
        svg.slice(cursor, closeStart),
        cursor,
        `${context} <style>`
      ));
      const closeEnd = findMarkupTagEnd(svg, closeStart);
      cursor = closeEnd + 1;
    }

    if (tag.name === "input") {
      const type = tag.attributes.find((attribute) => attribute.name === "type");
      const src = tag.attributes.find((attribute) => attribute.name === "src");
      if (
        type &&
        decodeReferenceUrl(type.rawValue).toLowerCase() === "image" &&
        src?.rawValue.trim()
      ) {
        throw new Error(
          `Video export does not support authored input[type=image][src] resources in ${context}. Replace it with one static img element.`
        );
      }
    }

    for (const attribute of tag.attributes) {
      if (
        isUnsupportedAutoloadAttribute(
          tag.name,
          attribute.name,
          decodeReferenceUrl(attribute.rawValue)
        )
      ) {
        throw new Error(
          `Video export does not support authored ${tag.name}[${attribute.name}] network resources in ${context}. Replace it with a collected static img element.`
        );
      }
      if (attribute.name === "style") {
        references.push(...collectCssUrlReferences(
          attribute.rawValue,
          attribute.valueStart,
          `${context} style attribute`
        ));
      }
      if (SVG_URL_PRESENTATION_ATTRIBUTES.has(attribute.name)) {
        references.push(...collectCssUrlReferences(
          attribute.rawValue,
          attribute.valueStart,
          `${context} ${tag.name}[${attribute.name}]`,
          SAFE_FRAGMENT_CSS_PROPERTIES.has(attribute.name)
        ));
      }
      if (attribute.name === "srcset" && attribute.rawValue.trim()) {
        throw new Error(
          `Video export does not support ${tag.name}[srcset] in ${context}. Use one static src image.`
        );
      }
      if (
        FRAGMENT_ONLY_HREF_TAGS.has(tag.name) &&
        (attribute.name === "href" || attribute.name === "xlink:href") &&
        decodeReferenceUrl(attribute.rawValue) &&
        !decodeReferenceUrl(attribute.rawValue).startsWith("#")
      ) {
        throw new Error(
          `Video export supports only fragment-local ${tag.name}[${attribute.name}] references in ${context}. Flatten the external resource first.`
        );
      }

      const isHtmlImage = tag.name === "img" && attribute.name === "src";
      const isSvgImage =
        (tag.name === "image" || tag.name === "feimage") &&
        (attribute.name === "href" || attribute.name === "xlink:href");
      if (isHtmlImage || isSvgImage) {
        if (decodeReferenceUrl(attribute.rawValue).startsWith("#")) {
          throw new Error(
            `Video export does not support fragment-only ${tag.name}[${attribute.name}] image resources in ${context}. Embed one static image instead.`
          );
        }
        references.push({
          start: attribute.valueStart,
          end: attribute.valueEnd,
          rawUrl: attribute.rawValue,
          kind: "image",
        });
      }
    }
  }

  references.sort((a, b) => a.start - b.start || a.end - b.end);
  return references.filter((reference, index) => {
    const previous = references[index - 1];
    return !previous || reference.start >= previous.end;
  });
}

function collectCssUrlReferences(
  text: string,
  baseOffset: number = 0,
  context: string = "CSS",
  allowFragmentOnly: boolean = false
): readonly AssetReference[] {
  assertNoCssImageSets(text, context);
  assertNoObfuscatedCssResourceTokens(text, context);
  const result: AssetReference[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    if (text.startsWith("/*", cursor)) {
      const close = text.indexOf("*/", cursor + 2);
      if (close < 0) throw new Error(`Video export found an unterminated CSS comment in ${context}.`);
      cursor = close + 2;
      continue;
    }
    if (text[cursor] === '"' || text[cursor] === "'") {
      cursor = skipCssString(text, cursor, context);
      continue;
    }
    if (
      lower.startsWith("@import", cursor) &&
      isCssTokenBoundary(text[cursor - 1]) &&
      isCssTokenBoundary(text[cursor + 7])
    ) {
      throw new Error(
        `Video export does not support CSS @import in ${context}. Inline the stylesheet before exporting.`
      );
    }
    if (
      !lower.startsWith("url", cursor) ||
      !isCssTokenBoundary(text[cursor - 1]) ||
      !isCssTokenBoundary(text[cursor + 3])
    ) {
      cursor += 1;
      continue;
    }

    let open = cursor + 3;
    while (/\s/.test(text[open] ?? "")) open += 1;
    if (text[open] !== "(") {
      cursor += 3;
      continue;
    }
    let valueStart = open + 1;
    while (/\s/.test(text[valueStart] ?? "")) valueStart += 1;
    const quote = cssQuoteTokenAt(text, valueStart);
    if (quote) valueStart += quote.length;
    let valueEnd = valueStart;
    let escaped = false;
    while (valueEnd < text.length) {
      const character = text[valueEnd];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (quote && text.slice(valueEnd, valueEnd + quote.length).toLowerCase() === quote.toLowerCase()) ||
        (!quote && character === ")")
      ) {
        break;
      }
      valueEnd += 1;
    }
    if (valueEnd >= text.length) {
      throw new Error("Video export found an unterminated CSS url() asset reference.");
    }
    const rawUrl = text.slice(valueStart, valueEnd).trim();
    if (rawUrl.includes("\\") || rawUrl.includes("/*")) {
      throw new Error(
        `Video export does not support escaped or comment-obfuscated CSS url() arguments in ${context}. Use one literal static asset URL before exporting.`
      );
    }
    if (
      decodeReferenceUrl(rawUrl).startsWith("#") &&
      !allowFragmentOnly &&
      !isSafeSvgCssFragmentDeclaration(text, valueStart)
    ) {
      throw new Error(
        `Video export does not support fragment-only CSS resource ${rawUrl} in ${context}. Use a local SVG paint/filter property or embed one static asset.`
      );
    }
    result.push({
      start: baseOffset + valueStart,
      end: baseOffset + valueEnd,
      rawUrl,
      kind: "css",
    });
    cursor = valueEnd + (quote?.length ?? 1);
  }
  return result;
}

function isSafeSvgCssFragmentDeclaration(text: string, valueStart: number): boolean {
  const prefix = text.slice(0, valueStart);
  const declarationStart = Math.max(prefix.lastIndexOf(";"), prefix.lastIndexOf("{")) + 1;
  const declarationPrefix = prefix.slice(declarationStart);
  const match = declarationPrefix.match(/^\s*([A-Za-z-]+)\s*:\s*[^;{}]*$/);
  return Boolean(match && SAFE_FRAGMENT_CSS_PROPERTIES.has(match[1].toLowerCase()));
}

function nextMarkupStartTag(text: string, from: number): MarkupStartTag | null {
  let cursor = from;
  while (cursor < text.length) {
    const start = text.indexOf("<", cursor);
    if (start < 0) return null;
    if (text.startsWith("<!--", start)) {
      const end = text.indexOf("-->", start + 4);
      if (end < 0) throw new Error("Video export found an unterminated markup comment.");
      cursor = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", start)) {
      const end = text.indexOf("]]>", start + 9);
      if (end < 0) throw new Error("Video export found an unterminated CDATA section.");
      cursor = end + 3;
      continue;
    }
    const first = text[start + 1];
    if (first === "/" || first === "!" || first === "?") {
      cursor = findMarkupTagEnd(text, start) + 1;
      continue;
    }

    let nameEnd = start + 1;
    while (/[A-Za-z0-9:_-]/.test(text[nameEnd] ?? "")) nameEnd += 1;
    if (nameEnd === start + 1) {
      cursor = start + 1;
      continue;
    }
    const end = findMarkupTagEnd(text, start);
    return {
      name: text.slice(start + 1, nameEnd).toLowerCase(),
      start,
      end,
      attributes: parseMarkupAttributes(text, nameEnd, end),
    };
  }
  return null;
}

function findMarkupTagEnd(text: string, start: number): number {
  let quote = "";
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return cursor;
    }
  }
  throw new Error("Video export found an unterminated markup tag.");
}

function parseMarkupAttributes(
  text: string,
  from: number,
  tagEnd: number
): readonly MarkupAttribute[] {
  const attributes: MarkupAttribute[] = [];
  let cursor = from;
  while (cursor < tagEnd) {
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (cursor >= tagEnd || text[cursor] === "/") break;
    const nameStart = cursor;
    while (cursor < tagEnd && !/[\s=/>]/.test(text[cursor])) cursor += 1;
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const name = text.slice(nameStart, cursor).toLowerCase();
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] !== "=") continue;
    cursor += 1;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    const quote = text[cursor] === '"' || text[cursor] === "'" ? text[cursor] : "";
    if (quote) cursor += 1;
    const valueStart = cursor;
    if (quote) {
      while (cursor < tagEnd && text[cursor] !== quote) cursor += 1;
    } else {
      while (cursor < tagEnd && !/[\s>]/.test(text[cursor])) cursor += 1;
    }
    const valueEnd = cursor;
    attributes.push({
      name,
      valueStart,
      valueEnd,
      rawValue: text.slice(valueStart, valueEnd),
    });
    if (quote && text[cursor] === quote) cursor += 1;
  }
  return attributes;
}

function skipCssString(text: string, start: number, context: string): number {
  const quote = text[start];
  let escaped = false;
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === quote) {
      return cursor + 1;
    }
  }
  throw new Error(`Video export found an unterminated CSS string in ${context}.`);
}

function isCssTokenBoundary(character: string | undefined): boolean {
  return !character || !/[A-Za-z0-9_-]/.test(character);
}

function cssQuoteTokenAt(text: string, start: number): string {
  if (text[start] === '"' || text[start] === "'") return text[start];
  const remainder = text.slice(start).toLowerCase();
  for (const token of ["&quot;", "&apos;", "&#34;", "&#39;", "&#x22;", "&#x27;"]) {
    if (remainder.startsWith(token)) return text.slice(start, start + token.length);
  }
  return "";
}

function assertNoObfuscatedCssResourceTokens(text: string, context: string): void {
  let cursor = 0;
  while (cursor < text.length) {
    if (text.startsWith("/*", cursor)) {
      const close = text.indexOf("*/", cursor + 2);
      if (close < 0) {
        throw new Error(`Video export found an unterminated CSS comment in ${context}.`);
      }
      cursor = close + 2;
      continue;
    }
    if (text[cursor] === '"' || text[cursor] === "'") {
      cursor = skipCssString(text, cursor, context);
      continue;
    }
    if (
      !isCssTokenBoundary(text[cursor - 1]) ||
      !/[A-Za-z_@\\-]/.test(text[cursor])
    ) {
      cursor += 1;
      continue;
    }

    let token = "";
    let tokenCursor = cursor;
    let obfuscated = false;
    if (text[tokenCursor] === "@") {
      token = "@";
      tokenCursor += 1;
    }
    while (tokenCursor < text.length) {
      if (text.startsWith("/*", tokenCursor)) {
        const close = text.indexOf("*/", tokenCursor + 2);
        if (close < 0) {
          throw new Error(`Video export found an unterminated CSS comment in ${context}.`);
        }
        const next = text[close + 2];
        if (!/[A-Za-z0-9_\\-]/.test(next ?? "")) break;
        obfuscated = true;
        tokenCursor = close + 2;
        continue;
      }
      const character = text[tokenCursor];
      if (/[A-Za-z0-9_-]/.test(character)) {
        token += character.toLowerCase();
        tokenCursor += 1;
        continue;
      }
      if (character !== "\\") break;
      obfuscated = true;
      tokenCursor += 1;
      if (tokenCursor >= text.length || /[\r\n\f]/.test(text[tokenCursor])) break;
      const hex = text.slice(tokenCursor).match(/^[0-9a-f]{1,6}/i)?.[0] ?? "";
      if (hex) {
        const codePoint = Number.parseInt(hex, 16);
        token += codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint).toLowerCase()
          : "\ufffd";
        tokenCursor += hex.length;
        if (/\s/.test(text[tokenCursor] ?? "")) tokenCursor += 1;
      } else {
        token += text[tokenCursor].toLowerCase();
        tokenCursor += 1;
      }
    }

    let afterToken = tokenCursor;
    while (/\s/.test(text[afterToken] ?? "")) afterToken += 1;
    const obfuscatedUrl = token === "url" && text[afterToken] === "(";
    const obfuscatedImport = token === "@import" && isCssTokenBoundary(text[tokenCursor]);
    if (obfuscated && (obfuscatedUrl || obfuscatedImport)) {
      throw new Error(
        `Video export does not support obfuscated CSS ${obfuscatedUrl ? "url()" : "@import"} syntax in ${context}. Use a literal static resource token before exporting.`
      );
    }
    cursor = Math.max(tokenCursor, cursor + 1);
  }
}

function assertNoCssImports(text: string, context: string): void {
  collectCssUrlReferences(text, 0, context);
}

function assertNoCssImageSets(text: string, context: string): void {
  const syntax = canonicalCssSyntaxOutsideStrings(text, context);
  if (/(?:^|[^A-Za-z0-9_-])(?:-webkit-)?image-set\s*\(/i.test(syntax)) {
    throw new Error(
      `Video export does not support CSS image-set() in ${context}. Use one deterministic static image before exporting.`
    );
  }
}

function assertNoCssAnimations(text: string, context: string): void {
  const syntax = canonicalCssSyntaxOutsideStrings(text, context);
  if (/(?:^|[^A-Za-z0-9_-])@starting-style\b/i.test(syntax)) {
    throw new Error(
      `Video export does not support authored CSS @starting-style transitions in ${context}. Remove the transition before exporting.`
    );
  }
  const transitionDeclaration = /(?:^|[;{])\s*(?:-webkit-)?(transition(?:-(?:property|duration|delay|timing-function|behavior))?)\s*:\s*([^;}]+)/gi;
  for (const match of syntax.matchAll(transitionDeclaration)) {
    const property = match[1].toLowerCase();
    const effectiveValue = match[2]
      .trim()
      .toLowerCase()
      .replace(/\s*!important\s*$/, "")
      .trim();
    const disabled = property === "transition-duration" || property === "transition-delay"
      ? effectiveValue.split(",").every((item) => /^0(?:\.0+)?m?s$/.test(item.trim()))
      : /^(?:none|initial|unset)$/.test(effectiveValue);
    if (!disabled) {
      throw new Error(
        `Video export does not support authored CSS transition in ${context}. Remove it or replace it with a static state before exporting.`
      );
    }
  }
  const declaration = /(?:^|[;{])\s*(?:-webkit-)?(animation(?:-name|-duration)?)\s*:\s*([^;}]+)/gi;
  for (const match of syntax.matchAll(declaration)) {
    const property = match[1].toLowerCase();
    const value = match[2].trim().toLowerCase();
    const effectiveValue = value.replace(/\s*!important\s*$/, "").trim();
    const disabled = property === "animation-duration"
      ? effectiveValue.split(",").every((item) => /^0(?:\.0+)?m?s$/.test(item.trim()))
      : /^(?:none|initial|unset)$/.test(effectiveValue);
    if (!disabled) {
      throw new Error(
        `Video export does not support authored CSS animation in ${context}. Remove it or replace it with a static state before exporting.`
      );
    }
  }
}

function canonicalCssSyntaxOutsideStrings(text: string, context: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < text.length) {
    if (text.startsWith("/*", cursor)) {
      const close = text.indexOf("*/", cursor + 2);
      if (close < 0) {
        throw new Error(`Video export found an unterminated CSS comment in ${context}.`);
      }
      cursor = close + 2;
      continue;
    }
    if (text[cursor] === '"' || text[cursor] === "'") {
      cursor = skipCssString(text, cursor, context);
      output += " ";
      continue;
    }
    if (text[cursor] === "\\") {
      const decoded = decodeCssEscapeAt(text, cursor, context);
      output += decoded.value;
      cursor = decoded.end;
      continue;
    }
    output += text[cursor];
    cursor += 1;
  }
  return output;
}

function decodeCssEscapeAt(
  text: string,
  start: number,
  context: string
): { readonly value: string; readonly end: number } {
  let cursor = start + 1;
  if (cursor >= text.length) {
    throw new Error(`Video export found an unterminated CSS escape in ${context}.`);
  }
  if (text[cursor] === "\r" || text[cursor] === "\n" || text[cursor] === "\f") {
    if (text[cursor] === "\r" && text[cursor + 1] === "\n") cursor += 1;
    return { value: "", end: cursor + 1 };
  }
  const hex = text.slice(cursor).match(/^[0-9a-f]{1,6}/i)?.[0] ?? "";
  if (!hex) return { value: text[cursor], end: cursor + 1 };
  const codePoint = Number.parseInt(hex, 16);
  cursor += hex.length;
  if (text[cursor] === "\r" && text[cursor + 1] === "\n") {
    cursor += 2;
  } else if (/\s/.test(text[cursor] ?? "")) {
    cursor += 1;
  }
  return {
    value: codePoint > 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : "\ufffd",
    end: cursor,
  };
}

function isUnsupportedAutoloadAttribute(
  tag: string,
  attribute: string,
  value: string
): boolean {
  if (!value.trim()) return false;
  // Chromium still autoloads this legacy attribute on more HTML table-family
  // elements than the modern HTML surface documents consistently. Reject it
  // everywhere instead of maintaining an incomplete tag allowlist.
  if (attribute === "background") return true;
  if (tag === "track" && attribute === "src") return true;
  if (tag === "html" && attribute === "manifest") return true;
  if (tag === "img" && (attribute === "dynsrc" || attribute === "lowsrc")) return true;
  if ((tag === "command" || tag === "menuitem") && attribute === "icon") return true;
  return tag === "cursor" && (attribute === "href" || attribute === "xlink:href");
}

function unsupportedAuthoredElement(tag: string, frameIndex: number): Error {
  if (UNSUPPORTED_AUTHORED_MEDIA_TAGS.has(tag)) {
    return new Error(
      `Video export does not support authored <${tag}> media in slide ${frameIndex + 1}. Remove it or replace it with a static image.`
    );
  }
  return new Error(
    `Video export does not support authored <${tag}> content in slide ${frameIndex + 1}. Remove active or embedded HTML before exporting.`
  );
}

function unsupportedResourceAttribute(
  tag: string,
  attribute: string,
  frameIndex: number
): Error {
  return new Error(
    `Video export does not support authored ${tag}[${attribute}] resources in slide ${frameIndex + 1}. Flatten it to one static image before exporting.`
  );
}

function replaceAssetReferences(
  svg: string,
  references: readonly AssetReference[],
  resources: ReadonlyMap<string, NormalizedResource>,
  frameIndex: number | null
): string {
  let output = "";
  let cursor = 0;
  for (const reference of references) {
    output += svg.slice(cursor, reference.start);
    const parts = splitAssetUrl(reference.rawUrl);
    if (isEmbeddedAssetReference(parts.canonicalUrl)) {
      const normalized = resources.get(parts.canonicalUrl);
      if (!normalized) {
        throw new Error(
          `Video export left an unresolved asset${frameIndex === null ? " in shared CSS" : ` in slide ${frameIndex + 1}`}: ${parts.canonicalUrl}`
        );
      }
      output += `${normalized.dataUri}${parts.fragment}`;
    } else {
      output += reference.rawUrl;
    }
    cursor = reference.end;
  }
  output += svg.slice(cursor);

  const unresolved = collectAssetReferences(output).find((reference) =>
    isEmbeddedAssetReference(splitAssetUrl(reference.rawUrl).canonicalUrl) &&
    !/^data:/i.test(splitAssetUrl(reference.rawUrl).canonicalUrl)
  );
  if (unresolved) {
    throw new Error(
      `Video export left an external asset${frameIndex === null ? " in shared CSS" : ` in slide ${frameIndex + 1}`}: ${unresolved.rawUrl}`
    );
  }
  return output;
}

async function measureFinalCaptureOverflow(
  sharedCss: string,
  frames: readonly string[],
  draft: VideoDeckArtifactDraftV1,
  options: NormalizeVideoDeckArtifactOptionsV1
): Promise<ProbeResult> {
  throwIfAborted(options.signal);
  const iframe = options.activeDocument.win.createEl("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = [
    "position:fixed",
    "left:-99999px",
    "top:0",
    `width:${VIDEO_WIDTH}px`,
    `height:${VIDEO_HEIGHT}px`,
    "border:0",
    "opacity:0",
    "pointer-events:none",
  ].join(";");
  options.activeDocument.body.appendChild(iframe);
  try {
    const probe = await loadFinalCaptureAndProbe(
      iframe,
      buildFinalCaptureHtml(sharedCss, frames, draft),
      FINAL_OVERFLOW_TOLERANCE_PX,
      options
    );
    throwIfAborted(options.signal);
    if (!probe) {
      throw new Error("Video export could not run the final normalized overflow probe.");
    }
    if (probe.frameCount !== frames.length || probe.frames.length !== frames.length) {
      throw new Error(
        `Video export final overflow probe measured ${probe.frames.length}/${frames.length} frames.`
      );
    }
    return probe;
  } finally {
    iframe.remove();
  }
}

async function loadFinalCaptureAndProbe(
  iframe: HTMLIFrameElement,
  html: string,
  tolerancePx: number,
  options: NormalizeVideoDeckArtifactOptionsV1
): Promise<ProbeResult | null> {
  const timeoutMs = options.remoteTimeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS;
  let onLoad: (() => void) | undefined;
  const loaded = new Promise<void>((resolve) => {
    onLoad = resolve;
    iframe.addEventListener("load", onLoad, { once: true });
    iframe.srcdoc = html;
  });
  try {
    await withAbortAndTimeout(
      loaded,
      options.signal,
      timeoutMs,
      "Timed out loading the final video capture document.",
      options.activeDocument.win
    );
  } finally {
    if (onLoad) iframe.removeEventListener("load", onLoad);
  }

  const captureDocument = iframe.contentDocument;
  const captureWindow = iframe.contentWindow;
  if (!captureDocument || !captureWindow) return null;
  const images = Array.from(captureDocument.images);
  await withAbortAndTimeout(
    Promise.all([
      captureDocument.fonts.ready,
      ...images.map((image) => image.decode()),
    ]),
    options.signal,
    timeoutMs,
    "Timed out waiting for final video fonts and images.",
    options.activeDocument.win
  );
  await withAbortAndTimeout(
    new Promise<void>((resolve) => captureWindow.setTimeout(resolve, 64)),
    options.signal,
    1_000,
    "Timed out settling the final video capture layout.",
    options.activeDocument.win
  );
  throwIfAborted(options.signal);
  return evaluateOverflowProbe(iframe, tolerancePx);
}

function buildFinalCaptureHtml(
  sharedCss: string,
  frames: readonly string[],
  draft: VideoDeckArtifactDraftV1
): string {
  const groups = new Map<number, string[]>();
  frames.forEach((svg, index) => {
    const frame = draft.frames[index];
    const group = groups.get(frame.logicalIndex) ?? [];
    group.push(
      `<div class="marpit achmage-frame" data-frame="${frame.frameIndex}">${svg}</div>`
    );
    groups.set(frame.logicalIndex, group);
  });
  const body = [...groups.entries()].map(([logicalIndex, groupFrames]) =>
    `<div class="achmage-logical-group" data-group="${logicalIndex}" style="display:block"><div class="achmage-frame-stack">${groupFrames.join("")}</div></div>`
  ).join("");
  const safeCss = sharedCss.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${safeCss}</style><style>html,body{margin:0;padding:0;width:${VIDEO_WIDTH}px;background:#000}.achmage-frame{width:${VIDEO_WIDTH}px;height:${VIDEO_HEIGHT}px}.achmage-frame>svg{display:block;width:${VIDEO_WIDTH}px;height:${VIDEO_HEIGHT}px}</style></head><body>${body}</body></html>`;
}

async function validateResolvedImage(
  bytes: Uint8Array,
  mimeType: string,
  url: string,
  decodedPixelsBefore: number,
  options: NormalizeVideoDeckArtifactOptionsV1
): Promise<number> {
  throwIfAborted(options.signal);
  const activeWindow = options.activeDocument.win;
  const image = activeWindow.createEl("img");
  const canvas = activeWindow.createEl("canvas");
  canvas.width = 1;
  canvas.height = 1;
  try {
    const dimensions = inspectImageDimensions(
      bytes,
      mimeType,
      url,
      options.activeDocument
    );
    const headerSurfacePixels = assertImageDimensions(dimensions, url);
    const nestedDecodedPixels = Math.max(
      0,
      dimensions.decodedPixels - headerSurfacePixels
    );
    const headerDecodedPixels = headerSurfacePixels + nestedDecodedPixels;
    if (decodedPixelsBefore + headerDecodedPixels > MAX_TOTAL_IMAGE_PIXELS) {
      throw new Error(
        `Image ${url} would raise the unique decoded-image inventory above the ${MAX_TOTAL_IMAGE_PIXELS}-pixel capture limit.`
      );
    }
    image.decoding = "sync";
    image.src = bytesToDataUri(bytes, mimeType);
    await withAbortAndTimeout(
      image.decode(),
      options.signal,
      options.remoteTimeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS,
      `Timed out decoding image asset: ${url}`,
      activeWindow
    );
    throwIfAborted(options.signal);
    if (image.naturalWidth < 1 || image.naturalHeight < 1) {
      throw new Error("Decoded image has no intrinsic dimensions.");
    }
    const naturalPixels = assertImageDimensions(
      { width: image.naturalWidth, height: image.naturalHeight },
      `${url} after decode`
    );
    const accountedPixels = nestedDecodedPixels + Math.max(
      headerSurfacePixels,
      naturalPixels
    );
    if (decodedPixelsBefore + accountedPixels > MAX_TOTAL_IMAGE_PIXELS) {
      throw new Error(
        `Image ${url} would raise the unique decoded-image inventory above the ${MAX_TOTAL_IMAGE_PIXELS}-pixel capture limit after decode.`
      );
    }
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create an image validation canvas.");
    context.drawImage(image, 0, 0, 1, 1);
    context.getImageData(0, 0, 1, 1);
    return accountedPixels;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(`Video export could not decode image asset ${url}. ${errorMessage(error)}`, {
      cause: error,
    });
  } finally {
    image.src = "";
    canvas.width = 1;
    canvas.height = 1;
  }
}

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

interface ImageInspection extends ImageDimensions {
  /** Own decoder surface plus recursively embedded data:image surfaces. */
  readonly decodedPixels: number;
}

function inspectImageDimensions(
  bytes: Uint8Array,
  mimeType: string,
  url: string,
  activeDocument: Document
): ImageInspection {
  let dimensions: ImageDimensions;
  switch (mimeType) {
    case "image/png":
      dimensions = inspectPngDimensions(bytes);
      break;
    case "image/jpeg":
      dimensions = inspectJpegDimensions(bytes);
      break;
    case "image/gif":
      dimensions = inspectGifDimensions(bytes);
      break;
    case "image/webp":
      dimensions = inspectWebpDimensions(bytes);
      break;
    case "image/bmp":
      dimensions = inspectBmpDimensions(bytes);
      break;
    case "image/avif":
      return inspectAvifDimensions(bytes);
    case "image/svg+xml":
      return inspectSvgAsset(bytes, url, activeDocument, 0);
    default:
      throw new Error(
        `Image type ${mimeType} cannot be dimension-checked before decode.`
      );
  }
  return { ...dimensions, decodedPixels: dimensions.width * dimensions.height };
}

function inspectPngDimensions(bytes: Uint8Array): ImageDimensions {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).every((value, index) =>
      value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]
    ) ||
    ascii(bytes, 12, 16) !== "IHDR"
  ) {
    throw new Error("PNG header does not contain a valid IHDR chunk.");
  }
  let cursor = 8;
  let sawEnd = false;
  while (cursor + 12 <= bytes.length) {
    const length = uint32be(bytes, cursor);
    const type = ascii(bytes, cursor + 4, cursor + 8);
    const next = cursor + 12 + length;
    if (next > bytes.length) throw new Error(`PNG ${type || "unknown"} chunk is truncated.`);
    if (type === "acTL") {
      throw new Error("Animated APNG images are not supported in deterministic MP4 export.");
    }
    cursor = next;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new Error("PNG image does not contain a complete IEND chunk.");
  return { width: uint32be(bytes, 16), height: uint32be(bytes, 20) };
}

function inspectGifDimensions(bytes: Uint8Array): ImageDimensions {
  const signature = ascii(bytes, 0, 6);
  if (bytes.length < 13 || (signature !== "GIF87a" && signature !== "GIF89a")) {
    throw new Error("GIF header is invalid.");
  }
  const screenWidth = uint16le(bytes, 6);
  const screenHeight = uint16le(bytes, 8);
  let cursor = 13;
  const screenPacked = bytes[10];
  if ((screenPacked & 0x80) !== 0) {
    cursor += 3 * (2 ** ((screenPacked & 0x07) + 1));
  }
  if (cursor > bytes.length) throw new Error("GIF global color table is truncated.");
  let frameCount = 0;
  let sawTrailer = false;
  while (cursor < bytes.length) {
    const marker = bytes[cursor];
    if (marker === 0x3b) {
      sawTrailer = true;
      cursor += 1;
      break;
    }
    if (marker === 0x21) {
      if (cursor + 2 > bytes.length) throw new Error("GIF extension header is truncated.");
      cursor = skipGifSubBlocks(bytes, cursor + 2);
      continue;
    }
    if (marker !== 0x2c || cursor + 10 > bytes.length) {
      throw new Error("GIF image stream contains an invalid block marker.");
    }
    const left = uint16le(bytes, cursor + 1);
    const top = uint16le(bytes, cursor + 3);
    const width = uint16le(bytes, cursor + 5);
    const height = uint16le(bytes, cursor + 7);
    if (
      width < 1 ||
      height < 1 ||
      left + width > screenWidth ||
      top + height > screenHeight
    ) {
      throw new Error(
        `GIF image descriptor ${left},${top} ${width}x${height} exceeds its ${screenWidth}x${screenHeight} logical screen.`
      );
    }
    frameCount += 1;
    if (frameCount > 1) {
      throw new Error("Animated multi-frame GIF images are not supported in deterministic MP4 export.");
    }
    const imagePacked = bytes[cursor + 9];
    cursor += 10;
    if ((imagePacked & 0x80) !== 0) {
      cursor += 3 * (2 ** ((imagePacked & 0x07) + 1));
    }
    if (cursor >= bytes.length) throw new Error("GIF image data is truncated.");
    cursor += 1; // LZW minimum code size.
    cursor = skipGifSubBlocks(bytes, cursor);
  }
  if (!sawTrailer || frameCount !== 1) {
    throw new Error("GIF image does not contain one complete static frame.");
  }
  return { width: screenWidth, height: screenHeight };
}

function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
  let cursor = start;
  while (cursor < bytes.length) {
    const size = bytes[cursor];
    cursor += 1;
    if (size === 0) return cursor;
    cursor += size;
    if (cursor > bytes.length) throw new Error("GIF data sub-block is truncated.");
  }
  throw new Error("GIF data sub-block terminator is missing.");
}

function inspectBmpDimensions(bytes: Uint8Array): ImageDimensions {
  if (bytes.length < 26 || ascii(bytes, 0, 2) !== "BM") {
    throw new Error("BMP header is invalid.");
  }
  const dibSize = uint32le(bytes, 14);
  if (dibSize === 12) {
    return { width: uint16le(bytes, 18), height: uint16le(bytes, 20) };
  }
  if (dibSize < 40 || bytes.length < 26) {
    throw new Error("BMP DIB header is not supported.");
  }
  return {
    width: Math.abs(int32le(bytes, 18)),
    height: Math.abs(int32le(bytes, 22)),
  };
}

function inspectJpegDimensions(bytes: Uint8Array): ImageDimensions {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("JPEG start-of-image marker is missing.");
  }
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let cursor = 2;
  while (cursor + 3 < bytes.length) {
    while (cursor < bytes.length && bytes[cursor] !== 0xff) cursor += 1;
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
    if (cursor >= bytes.length) break;
    const marker = bytes[cursor];
    cursor += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (cursor + 2 > bytes.length) break;
    const length = uint16be(bytes, cursor);
    if (length < 2 || cursor + length > bytes.length) break;
    if (sofMarkers.has(marker)) {
      if (length < 7) break;
      return {
        width: uint16be(bytes, cursor + 5),
        height: uint16be(bytes, cursor + 3),
      };
    }
    cursor += length;
  }
  throw new Error("JPEG does not contain a supported start-of-frame marker.");
}

function inspectWebpDimensions(bytes: Uint8Array): ImageDimensions {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") {
    throw new Error("WebP RIFF header is invalid.");
  }
  const riffEnd = uint32le(bytes, 4) + 8;
  if (riffEnd > bytes.length || riffEnd < 20) throw new Error("WebP RIFF payload is truncated.");
  const dimensions: ImageDimensions[] = [];
  let cursor = 12;
  while (cursor + 8 <= riffEnd) {
    const type = ascii(bytes, cursor, cursor + 4);
    const size = uint32le(bytes, cursor + 4);
    const data = cursor + 8;
    const end = data + size;
    if (end > riffEnd) throw new Error(`WebP ${type || "unknown"} chunk is truncated.`);
    if (type === "ANIM" || type === "ANMF") {
      throw new Error("Animated WebP images are not supported in deterministic MP4 export.");
    }
    if (type === "VP8X" && size >= 10) {
      if ((bytes[data] & 0x02) !== 0) {
        throw new Error("Animated WebP images are not supported in deterministic MP4 export.");
      }
      dimensions.push({
        width: 1 + uint24le(bytes, data + 4),
        height: 1 + uint24le(bytes, data + 7),
      });
    }
    if (type === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const b0 = bytes[data + 1];
      const b1 = bytes[data + 2];
      const b2 = bytes[data + 3];
      const b3 = bytes[data + 4];
      dimensions.push({
        width: 1 + b0 + ((b1 & 0x3f) << 8),
        height: 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
      });
    }
    if (
      type === "VP8 " &&
      size >= 10 &&
      bytes[data + 3] === 0x9d &&
      bytes[data + 4] === 0x01 &&
      bytes[data + 5] === 0x2a
    ) {
      dimensions.push({
        width: uint16le(bytes, data + 6) & 0x3fff,
        height: uint16le(bytes, data + 8) & 0x3fff,
      });
    }
    cursor = end + (size % 2);
  }
  if (cursor !== riffEnd) throw new Error("WebP chunk table has trailing truncated bytes.");
  if (dimensions.length === 0) {
    throw new Error("WebP does not contain a supported image bitstream header.");
  }
  let largest = dimensions[0];
  for (const candidate of dimensions) {
    assertImageDimensions(candidate, "WebP image header");
    if (candidate.width * candidate.height > largest.width * largest.height) {
      largest = candidate;
    }
  }
  return largest;
}

function inspectAvifDimensions(bytes: Uint8Array): ImageInspection {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") {
    throw new Error("AVIF ISO-BMFF header is invalid.");
  }
  const brands = readIsoBmffBrands(bytes);
  if (brands.includes("avis")) {
    throw new Error("Animated AVIF image sequences are not supported in deterministic MP4 export.");
  }
  if (!brands.includes("avif")) {
    throw new Error("AVIF compatible brand is missing.");
  }
  const dimensions: ImageDimensions[] = [];
  collectIspeDimensions(bytes, 0, bytes.length, 0, dimensions);
  if (dimensions.length === 0) {
    throw new Error("AVIF does not expose a bounded ispe dimension box.");
  }
  let largest = dimensions[0];
  let decodedPixels = 0;
  for (const candidate of dimensions) {
    const candidatePixels = assertImageDimensions(candidate, "AVIF ispe item");
    decodedPixels += candidatePixels;
    if (!Number.isSafeInteger(decodedPixels)) {
      throw new Error("AVIF cumulative ispe pixels exceed the safe validation range.");
    }
    if (candidatePixels > largest.width * largest.height) {
      largest = candidate;
    }
  }
  return {
    ...largest,
    decodedPixels,
  };
}

function readIsoBmffBrands(bytes: Uint8Array): readonly string[] {
  let size = uint32be(bytes, 0);
  let payload = 8;
  if (size === 1) {
    if (bytes.length < 24) throw new Error("AVIF ftyp extended-size box is truncated.");
    const high = uint32be(bytes, 8);
    const low = uint32be(bytes, 12);
    size = high * 0x1_0000_0000 + low;
    if (!Number.isSafeInteger(size)) throw new Error("AVIF ftyp box size is not safely bounded.");
    payload = 16;
  }
  if (size < payload + 8 || size > bytes.length || (size - payload - 8) % 4 !== 0) {
    throw new Error("AVIF ftyp brand table is malformed.");
  }
  const brands = [ascii(bytes, payload, payload + 4)];
  for (let cursor = payload + 8; cursor + 4 <= size; cursor += 4) {
    brands.push(ascii(bytes, cursor, cursor + 4));
  }
  return brands;
}

function collectIspeDimensions(
  bytes: Uint8Array,
  start: number,
  end: number,
  depth: number,
  output: ImageDimensions[]
): void {
  if (depth > 8) throw new Error("AVIF box nesting exceeds the validation limit.");
  const containers = new Set(["meta", "iprp", "ipco", "moov", "trak", "mdia", "minf", "stbl"]);
  let cursor = start;
  while (cursor + 8 <= end) {
    let size = uint32be(bytes, cursor);
    const type = ascii(bytes, cursor + 4, cursor + 8);
    let headerSize = 8;
    if (size === 1) {
      if (cursor + 16 > end) throw new Error("AVIF has a truncated extended-size box.");
      const high = uint32be(bytes, cursor + 8);
      const low = uint32be(bytes, cursor + 12);
      const extended = high * 0x1_0000_0000 + low;
      if (!Number.isSafeInteger(extended)) throw new Error("AVIF box size is not safely bounded.");
      size = extended;
      headerSize = 16;
    } else if (size === 0) {
      size = end - cursor;
    }
    if (size < headerSize || cursor + size > end) {
      throw new Error(`AVIF ${type || "unknown"} box exceeds its parent bounds.`);
    }
    const payload = cursor + headerSize;
    if (type === "ispe") {
      if (size < headerSize + 12) throw new Error("AVIF contains a truncated ispe box.");
      output.push({
        width: uint32be(bytes, payload + 4),
        height: uint32be(bytes, payload + 8),
      });
    }
    if (containers.has(type)) {
      const childStart = payload + (type === "meta" ? 4 : 0);
      if (childStart > cursor + size) throw new Error(`AVIF ${type} box is truncated.`);
      collectIspeDimensions(bytes, childStart, cursor + size, depth + 1, output);
    }
    cursor += size;
  }
  if (cursor !== end) throw new Error("AVIF box table has trailing truncated bytes.");
}

function inspectSvgAsset(
  bytes: Uint8Array,
  url: string,
  activeDocument: Document,
  depth: number
): ImageInspection {
  if (depth > 8) throw new Error(`SVG asset ${url} exceeds the nested SVG depth limit.`);
  let svg: string;
  try {
    svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`SVG asset ${url} is not valid UTF-8. ${errorMessage(error)}`, { cause: error });
  }
  if (/<\?xml-stylesheet\b/i.test(svg)) {
    throw new Error(`SVG asset ${url} contains an XML stylesheet instruction.`);
  }
  const Parser = (
    activeDocument.win as unknown as { DOMParser: typeof DOMParser }
  ).DOMParser;
  const parsed = new Parser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    !root ||
    root.localName.toLowerCase() !== "svg" ||
    root.namespaceURI !== SVG_NAMESPACE ||
    parsed.querySelector("parsererror")
  ) {
    throw new Error(`SVG asset ${url} is not well-formed SVG XML.`);
  }

  const references = assertSvgTreeSafe(root, url);
  let nestedDecodedPixels = 0;
  for (const rawUrl of references) {
    const parts = splitAssetUrl(rawUrl);
    if (isExternalNestedAsset(rawUrl)) {
      throw new Error(
        `SVG asset ${url} contains a nested non-fragment resource (${rawUrl}). Embed or flatten it before MP4 export.`
      );
    }
    if (!/^data:/i.test(parts.resolutionUrl)) continue;
    const nested = parseDataUri(parts.resolutionUrl);
    assertResourceByteLength(nested.bytes.byteLength, `${url} nested data resource`);
    const nestedMime = normalizeMimeType(nested.mimeType, parts.resolutionUrl);
    assertSupportedAssetMime(nestedMime, `${url} nested data resource`);
    if (nestedMime.startsWith("image/")) {
      const nestedInspection = nestedMime === "image/svg+xml"
        ? inspectSvgAsset(nested.bytes, `${url} nested data SVG`, activeDocument, depth + 1)
        : inspectImageDimensions(
          nested.bytes,
          nestedMime,
          `${url} nested data image`,
          activeDocument
        );
      assertImageDimensions(nestedInspection, `${url} nested data image`);
      nestedDecodedPixels += nestedInspection.decodedPixels;
    } else if (isFontMime(nestedMime)) {
      throw new Error(
        `SVG asset ${url} contains a nested data font that cannot be readiness-validated before capture. Flatten text to paths or move the font to the outer slide CSS.`
      );
    }
  }

  const dimensions = svgDimensions(root);
  return {
    ...dimensions,
    decodedPixels: dimensions.width * dimensions.height + nestedDecodedPixels,
  };
}

function assertSvgTreeSafe(root: Element, url: string): readonly string[] {
  const resources: string[] = [];
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    const tag = element.localName.toLowerCase();
    if (element.prefix) {
      throw new Error(
        `SVG asset ${url} contains namespace-prefixed element <${element.tagName}>. Use canonical SVG element names before exporting.`
      );
    }
    if (UNSAFE_CAPTURE_TAGS.has(tag)) {
      throw new Error(`SVG asset ${url} contains unsupported active <${tag}> content.`);
    }
    if (
      tag === "meta" &&
      element.getAttribute("http-equiv")?.trim().toLowerCase() === "refresh"
    ) {
      throw new Error(`SVG asset ${url} contains an unsupported meta refresh.`);
    }
    if (tag === "style") {
      const css = element.textContent ?? "";
      resources.push(...collectCssUrlReferences(
        css,
        0,
        `SVG asset ${url} <style>`
      ).map((reference) => reference.rawUrl));
      assertNoCssAnimations(css, `SVG asset ${url} <style>`);
    }
    if (
      tag === "input" &&
      element.getAttribute("type")?.trim().toLowerCase() === "image" &&
      element.getAttribute("src")?.trim()
    ) {
      throw new Error(`SVG asset ${url} contains unsupported input[type=image][src].`);
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName.toLowerCase();
      if (!isCanonicalQualifiedAttribute(attribute)) {
        throw new Error(
          `SVG asset ${url} contains namespace-aliased attribute ${attribute.name}. Use the canonical attribute name before exporting.`
        );
      }
      const value = attribute.value.trim();
      if (name.startsWith("on") || attribute.name.toLowerCase().startsWith("on") || name === "srcdoc") {
        throw new Error(
          `SVG asset ${url} contains active attribute ${attribute.name}.`
        );
      }
      if (isUnsupportedAutoloadAttribute(tag, name, value)) {
        throw new Error(
          `SVG asset ${url} contains unsupported ${tag}[${attribute.name}] network loading.`
        );
      }
      if (name === "srcset" && value) {
        throw new Error(`SVG asset ${url} contains unsupported ${tag}[srcset].`);
      }
      if (
        NAVIGABLE_ATTRIBUTE_NAMES.has(name) &&
        /^(?:javascript:|vbscript:|data:text\/html)/i.test(
          Array.from(value).filter((character) => character.charCodeAt(0) > 0x20).join("")
        )
      ) {
        throw new Error(`SVG asset ${url} contains an executable ${attribute.name} URL.`);
      }
      if (
        FRAGMENT_ONLY_HREF_TAGS.has(tag) &&
        name === "href" &&
        value &&
        !value.startsWith("#")
      ) {
        throw new Error(`SVG asset ${url} contains a non-local ${tag}[${attribute.name}].`);
      }
      if (name === "style") {
        resources.push(...collectCssUrlReferences(
          value,
          0,
          `SVG asset ${url} style attribute`
        ).map((reference) => reference.rawUrl));
        assertNoCssAnimations(value, `SVG asset ${url} style attribute`);
      }
      if (SVG_URL_PRESENTATION_ATTRIBUTES.has(name)) {
        resources.push(...collectCssUrlReferences(
          value,
          0,
          `SVG asset ${url} ${tag}[${attribute.name}]`,
          SAFE_FRAGMENT_CSS_PROPERTIES.has(name)
        ).map((reference) => reference.rawUrl));
      }
      const isHtmlImage = tag === "img" && name === "src";
      const isSvgImage = (tag === "image" || tag === "feimage") && name === "href";
      if ((isHtmlImage || isSvgImage) && value) {
        if (value.startsWith("#")) {
          throw new Error(
            `SVG asset ${url} contains fragment-only ${tag}[${attribute.name}] image loading.`
          );
        }
        resources.push(value);
      }
    }
  }
  return resources;
}

function svgDimensions(root: Element): ImageDimensions {
  const width = parseSvgDimension(root.getAttribute("width"));
  const height = parseSvgDimension(root.getAttribute("height"));
  if (width !== null && height !== null) return { width, height };
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (
    viewBox?.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0
  ) {
    return { width: viewBox[2], height: viewBox[3] };
  }
  throw new Error("SVG has no finite intrinsic width/height or positive viewBox.");
}

function parseSvgDimension(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/^\+?((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:px)?$/i);
  if (!match) return null;
  const result = Number(match[1]);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function assertImageDimensions(dimensions: ImageDimensions, url: string): number {
  const { width, height } = dimensions;
  const pixels = width * height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Image ${url} has invalid intrinsic dimensions.`);
  }
  if (
    width > MAX_IMAGE_DIMENSION_PX ||
    height > MAX_IMAGE_DIMENSION_PX ||
    pixels > MAX_IMAGE_PIXELS
  ) {
    throw new Error(
      `Image ${url} dimensions ${width}x${height} exceed the ${MAX_IMAGE_DIMENSION_PX}px / ${MAX_IMAGE_PIXELS}-pixel pre-decode limit.`
    );
  }
  return pixels;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (start < 0 || end > bytes.length || end < start) return "";
  return String.fromCharCode(...bytes.subarray(start, end));
}

function uint16be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x1_0000;
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1_0000_00 +
    bytes[offset + 1] * 0x1_0000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x1_0000 +
    bytes[offset + 3] * 0x1_0000_00
  );
}

function int32le(bytes: Uint8Array, offset: number): number {
  const value = uint32le(bytes, offset);
  return value > 0x7fff_ffff ? value - 0x1_0000_0000 : value;
}

async function validateEmbeddedFont(
  bytes: Uint8Array,
  url: string,
  options: NormalizeVideoDeckArtifactOptionsV1
): Promise<void> {
  const FontFaceConstructor = (
    options.activeDocument.win as Window & { FontFace: typeof FontFace }
  ).FontFace;
  throwIfAborted(options.signal);
  try {
    const face = new FontFaceConstructor(
      "AchmageVideoValidation",
      Uint8Array.from(bytes).buffer
    );
    const loaded = await withAbortAndTimeout(
      face.load(),
      options.signal,
      options.remoteTimeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS,
      `Timed out loading embedded font: ${url}`,
      options.activeDocument.win
    );
    if (loaded.status !== "loaded") {
      throw new Error(`Font decoder reported ${loaded.status}.`);
    }
  } catch (error) {
    throw new Error(`Video export could not load embedded font: ${url}. ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

function validateDraft(draft: VideoDeckArtifactDraftV1): void {
  if (
    draft.schemaVersion !== VIDEO_ARTIFACT_SCHEMA_VERSION ||
    draft.width !== VIDEO_WIDTH ||
    draft.height !== VIDEO_HEIGHT
  ) {
    throw new Error("Video export received an incompatible renderer artifact.");
  }
  if (draft.frames.length === 0) throw new Error("Video export requires at least one slide.");
  draft.frames.forEach((frame, index) => {
    if (frame.physicalIndex !== index) {
      throw new Error(`Video export frame order is invalid at slide ${index + 1}.`);
    }
  });
}

function assertNoUnsupportedAuthoredMedia(svg: string, frameIndex: number): void {
  const match = svg.match(UNSUPPORTED_AUTHORED_MEDIA_RE);
  if (!match) return;
  const tag = match[0].slice(1).toLowerCase();
  throw new Error(
    `Video export does not support authored <${tag}> media in slide ${frameIndex + 1}. Remove it or replace it with a static image.`
  );
}

function decodeReferenceUrl(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\\([()'"\\])/g, "$1")
    .trim();
}

function isCanonicalQualifiedAttribute(attribute: Attr): boolean {
  const name = attribute.name.toLowerCase();
  if (!name.includes(":")) return true;
  return name.startsWith("xmlns:") ||
    name === "xlink:href" ||
    name === "xml:lang" ||
    name === "xml:space";
}

function splitAssetUrl(rawValue: string): AssetUrlParts {
  const canonicalUrl = decodeReferenceUrl(rawValue);
  const fragmentIndex = canonicalUrl.indexOf("#");
  const withoutFragment = fragmentIndex >= 0
    ? canonicalUrl.slice(0, fragmentIndex)
    : canonicalUrl;
  const fragment = fragmentIndex >= 0 ? canonicalUrl.slice(fragmentIndex) : "";
  if (/^data:/i.test(withoutFragment)) {
    return { canonicalUrl, resolutionUrl: withoutFragment, fragment };
  }
  const queryIndex = withoutFragment.indexOf("?");
  const baseUrl = queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
  const query = queryIndex >= 0 ? withoutFragment.slice(queryIndex) : "";
  const resolutionUrl = /^(?:https?|blob):/i.test(baseUrl) ? `${baseUrl}${query}` : baseUrl;
  return { canonicalUrl, resolutionUrl, fragment };
}

function isEmbeddedAssetReference(url: string): boolean {
  return url.length > 0 && !url.startsWith("#") && !/^(?:about:|javascript:)/i.test(url);
}

function isExternalNestedAsset(rawUrl: string): boolean {
  const canonicalUrl = splitAssetUrl(rawUrl).canonicalUrl;
  return isEmbeddedAssetReference(canonicalUrl) && !/^data:/i.test(canonicalUrl);
}

function parseDataUri(url: string): VideoResolvedResourceV1 {
  const comma = url.indexOf(",");
  if (comma < 5) throw new Error("Malformed data URI.");
  const metadata = url.slice(5, comma);
  const base64 = /(?:^|;)base64(?:;|$)/i.test(metadata);
  const mimeType = metadata.split(";")[0] || "text/plain";
  const payload = url.slice(comma + 1);
  try {
    if (base64) {
      let encodedCharacters = 0;
      for (const character of payload) {
        if (!/\s/.test(character)) encodedCharacters += 1;
      }
      const decodedUpperBound = Math.floor(encodedCharacters * 3 / 4);
      assertResourceByteLength(decodedUpperBound, "data URI");
      const binary = atob(payload.replace(/\s/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      assertResourceByteLength(bytes.byteLength, "data URI");
      return { bytes, mimeType };
    }
    assertResourceByteLength(
      nonBase64DataUriDecodedUpperBound(payload),
      "data URI"
    );
    const bytes = new TextEncoder().encode(decodeURIComponent(payload));
    assertResourceByteLength(bytes.byteLength, "data URI");
    return { bytes, mimeType };
  } catch (error) {
    throw new Error(`Malformed data URI payload. ${errorMessage(error)}`, { cause: error });
  }
}

function nonBase64DataUriDecodedUpperBound(payload: string): number {
  let bytes = 0;
  for (let index = 0; index < payload.length;) {
    if (
      payload[index] === "%" &&
      index + 2 < payload.length &&
      /^[0-9a-f]{2}$/i.test(payload.slice(index + 1, index + 3))
    ) {
      bytes += 1;
      index += 3;
    } else {
      const codePoint = payload.codePointAt(index) ?? 0xfffd;
      bytes += codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
      index += codePoint > 0xffff ? 2 : 1;
    }
    if (bytes > MAX_SINGLE_RESOURCE_BYTES) return bytes;
  }
  return bytes;
}

function bytesToDataUri(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function base64DataUriCharacterLength(byteLength: number, mimeType: string): number {
  return `data:${mimeType};base64,`.length + 4 * Math.ceil(byteLength / 3);
}

function normalizeMimeType(value: string, url: string): string {
  const normalized = value.split(";")[0].trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream" || normalized === "text/plain") {
    return mimeFromPath(url);
  }
  switch (normalized) {
    case "image/apng":
    case "image/x-png":
      return "image/png";
    case "image/jpg":
    case "image/pjpeg":
      return "image/jpeg";
    case "image/x-gif":
      return "image/gif";
    case "image/x-bmp":
    case "image/x-ms-bmp":
      return "image/bmp";
    case "image/vnd.microsoft.icon":
      return "image/x-icon";
    case "image/svg":
      return "image/svg+xml";
    default:
      return normalized;
  }
}

function assertSupportedAssetMime(mimeType: string, url: string): void {
  if (mimeType === "image/x-icon" || mimeType === "image/vnd.microsoft.icon") {
    throw new Error(
      `ICO image assets are not supported for deterministic video export: ${url}. Convert the icon to a static PNG before exporting.`
    );
  }
  if (mimeType.startsWith("image/") || isFontMime(mimeType)) return;
  throw new Error(`Unsupported asset type ${mimeType} for ${url}.`);
}

function isFontMime(mimeType: string): boolean {
  return mimeType.startsWith("font/") || /^(?:application\/(?:font-|x-font-|vnd\.ms-fontobject))/.test(mimeType);
}

function mimeFromPath(path: string): string {
  const clean = path.replace(/[?#].*$/, "").toLowerCase();
  return mimeFromCleanPath(clean, path);
}

function mimeFromVaultPath(path: string): string {
  return mimeFromCleanPath(path.toLowerCase(), path);
}

function mimeFromCleanPath(clean: string, original: string): string {
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".svg")) return "image/svg+xml";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".bmp")) return "image/bmp";
  if (clean.endsWith(".avif")) return "image/avif";
  if (clean.endsWith(".ico")) return "image/x-icon";
  if (clean.endsWith(".woff2")) return "font/woff2";
  if (clean.endsWith(".woff")) return "font/woff";
  if (clean.endsWith(".ttf")) return "font/ttf";
  if (clean.endsWith(".otf")) return "font/otf";
  throw new Error(`Could not determine the asset type for ${original}.`);
}

async function sha256Hex(value: string, cryptoApi: Crypto): Promise<string> {
  if (!cryptoApi.subtle) throw new Error("Video export requires the host SHA-256 API.");
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function safelyDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function reportProgress(
  options: NormalizeVideoDeckArtifactOptionsV1,
  progress: VideoArtifactProgressV1
): void {
  options.onProgress?.(Object.freeze(progress));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Video export was cancelled.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

async function withAbortAndTimeout<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
  _activeWindow: Window
): Promise<T> {
  throwIfAborted(signal);
  let abortListener: (() => void) | undefined;
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    abortListener = () => reject(new DOMException("Video export was cancelled.", "AbortError"));
    signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    return await Promise.race([operation, timeout, aborted]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }
}
