import {
  normalizePath,
  requestUrl,
  type TFile,
  type Vault,
} from "obsidian";
import type { SlideMapEntry } from "../preprocessor/overflowSplitter";
import {
  VIDEO_ARTIFACT_SCHEMA_VERSION,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type VideoDeckArtifactDraftV1,
  type VideoDeckArtifactFrameV1,
  type VideoDeckArtifactV1,
} from "./videoTypes";
import { buildStandaloneSvg, rasterizeStandaloneSvg } from "./videoCompositor";

const DEFAULT_REMOTE_TIMEOUT_MS = 15_000;
const ROOT_SELECTOR_RE = /div\.marpit\s*>\s*svg/g;
const SVG_OPEN_RE = /<svg\b([^>]*)>/i;
const ATTRIBUTE_ASSET_TAG_RE = /<(?:img|image)\b[^>]*>/gi;
const ATTRIBUTE_ASSET_RE = /\b(?:src|href|xlink:href)\s*=\s*(["'])(.*?)\1/gi;

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

interface AssetReference {
  readonly start: number;
  readonly end: number;
  readonly rawUrl: string;
  readonly kind: "image" | "css";
}

interface NormalizedResource extends VideoResolvedResourceV1 {
  readonly dataUri: string;
}

interface VaultResourceIndex {
  readonly byPath: ReadonlyMap<string, TFile>;
  readonly byResourceUrl: ReadonlyMap<string, TFile>;
}

/**
 * Capture the final decorated Marp output before the interactive HTML shell is
 * assembled. The frame SVG strings are referenced directly (not copied); only
 * the opt-in caller retains this additional object graph and shared CSS string.
 */
export function buildVideoDeckArtifactDraft(
  slides: readonly string[],
  sharedCss: string,
  slideMap: readonly SlideMapEntry[]
): VideoDeckArtifactDraftV1 {
  const frames = slides.map((svg, physicalIndex) => {
    const entry = slideMap[physicalIndex];
    return Object.freeze({
      physicalIndex,
      logicalIndex: entry?.logical ?? physicalIndex,
      frameIndex: entry?.frame ?? 0,
      frameCount: entry?.totalFrames ?? 1,
      title: entry?.title ?? `Slide ${physicalIndex + 1}`,
      svg,
    });
  });

  return Object.freeze({
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss,
    frames: Object.freeze(frames),
  });
}

/**
 * Convert the renderer draft into the immutable, self-contained encoder
 * contract. Every resource is embedded and every finished frame is decoded in
 * the captured document before a hash is published. There is deliberately no
 * permissive fallback: a missing asset would make the MP4 differ from Preview.
 */
export async function normalizeVideoDeckArtifact(
  draft: VideoDeckArtifactDraftV1,
  options: NormalizeVideoDeckArtifactOptionsV1
): Promise<VideoDeckArtifactV1> {
  throwIfAborted(options.signal);
  validateDraft(draft);

  const rewrittenCss = rewriteMarpRootSelectors(draft.sharedCss);
  const initialFrames = draft.frames.map((frame) =>
    normalizePhysicalSvgRoot(frame.svg, draft.width, draft.height)
  );
  const cssReferences = collectCssUrlReferences(rewrittenCss);
  const referencesByFrame = initialFrames.map((svg) => collectAssetReferences(svg));
  const uniqueUrls = new Map<
    string,
    { kind: "image" | "css"; frameIndex: number | null }
  >();

  for (const reference of cssReferences) {
    const url = decodeReferenceUrl(reference.rawUrl);
    if (!isEmbeddedAssetReference(url)) continue;
    if (!uniqueUrls.has(url)) uniqueUrls.set(url, { kind: "css", frameIndex: null });
  }

  referencesByFrame.forEach((references, frameIndex) => {
    for (const reference of references) {
      const url = decodeReferenceUrl(reference.rawUrl);
      if (!isEmbeddedAssetReference(url)) continue;
      if (!uniqueUrls.has(url)) uniqueUrls.set(url, { kind: reference.kind, frameIndex });
    }
  });

  const resourceCache = new Map<string, NormalizedResource>();
  const progressTotal = uniqueUrls.size + draft.frames.length * 2;
  const resolveResource = options.resolveResource ?? createDefaultResourceResolver(options);
  let resourceIndex = 0;
  for (const [url, context] of uniqueUrls) {
    throwIfAborted(options.signal);
    try {
      const resolved = await resolveResource({
        url,
        kind: context.kind,
        frameIndex: context.frameIndex,
        sourcePath: options.sourcePath,
        signal: options.signal,
      });
      throwIfAborted(options.signal);
      const bytes = copyBytes(resolved.bytes);
      const mimeType = normalizeMimeType(resolved.mimeType, url);
      assertSupportedAssetMime(mimeType, url);
      resourceCache.set(url, {
        bytes,
        mimeType,
        dataUri: bytesToDataUri(bytes, mimeType),
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

  await validateEmbeddedFonts(resourceCache, options);

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

  return Object.freeze({
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss: normalizedSharedCss,
    artifactHash,
    frames: frozenFrames,
  });
}

export function rewriteMarpRootSelectors(css: string): string {
  return css.replace(ROOT_SELECTOR_RE, "svg");
}

function normalizePhysicalSvgRoot(
  physicalSvg: string,
  width: number = VIDEO_WIDTH,
  height: number = VIDEO_HEIGHT
): string {
  const match = SVG_OPEN_RE.exec(physicalSvg);
  if (!match || match.index !== physicalSvg.search(/\S/)) {
    throw new Error("Video export expected each physical frame to be a root SVG element.");
  }

  let attributes = match[1];
  attributes = setSvgAttribute(attributes, "xmlns", "http://www.w3.org/2000/svg");
  attributes = setSvgAttribute(attributes, "xmlns:xlink", "http://www.w3.org/1999/xlink");
  attributes = setSvgAttribute(attributes, "width", String(width));
  attributes = setSvgAttribute(attributes, "height", String(height));
  attributes = setSvgAttribute(attributes, "viewBox", `0 0 ${width} ${height}`);
  const root = `<svg${attributes}>`;
  return `${physicalSvg.slice(0, match.index)}${root}${physicalSvg.slice(match.index + match[0].length)}`;
}

async function resolveDefaultResource(
  request: VideoResourceRequestV1,
  options: NormalizeVideoDeckArtifactOptionsV1,
  vaultIndex: VaultResourceIndex
): Promise<VideoResolvedResourceV1> {
  const url = request.url.trim();
  if (/^data:/i.test(url)) return parseDataUri(url);
  if (/^https?:/i.test(url)) {
    const response = await withAbortAndTimeout(
      requestUrl({ url }),
      request.signal,
      options.remoteTimeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS,
      `Timed out fetching remote video asset: ${url}`,
      options.activeDocument.win
    );
    const header = response.headers?.["content-type"] ?? response.headers?.["Content-Type"];
    return {
      bytes: new Uint8Array(response.arrayBuffer),
      mimeType: String(header ?? mimeFromPath(url)),
    };
  }
  if (/^blob:/i.test(url)) {
    const response = await options.activeDocument.win.fetch(url, { signal: request.signal });
    if (!response.ok) throw new Error(`Blob asset returned HTTP ${response.status}.`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type") ?? mimeFromPath(url),
    };
  }
  if (/^file:/i.test(url)) {
    throw new Error("File URLs outside the vault are not supported.");
  }

  const file = findVaultFile(vaultIndex, url, options.sourcePath);
  if (!file) throw new Error("The asset was not found in the current vault.");
  const bytes = await options.vault.readBinary(file);
  throwIfAborted(request.signal);
  return { bytes: new Uint8Array(bytes), mimeType: mimeFromPath(file.path) };
}

function createDefaultResourceResolver(
  options: NormalizeVideoDeckArtifactOptionsV1
): (request: VideoResourceRequestV1) => Promise<VideoResolvedResourceV1> {
  const byPath = new Map<string, TFile>();
  const byResourceUrl = new Map<string, TFile>();
  for (const file of options.vault.getFiles()) {
    byPath.set(normalizePath(file.path), file);
    byResourceUrl.set(comparableResourceUrl(options.vault.getResourcePath(file)), file);
  }
  const index = { byPath, byResourceUrl };
  return (request) => resolveDefaultResource(request, options, index);
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

  const decoded = safelyDecodeUri(rawUrl).replace(/[?#].*$/, "").replace(/^\/+/, "");
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
  return safelyDecodeUri(url).replace(/[?#].*$/, "").replace(/\\/g, "/");
}

function collectAssetReferences(svg: string): readonly AssetReference[] {
  const references: AssetReference[] = [...collectCssUrlReferences(svg)];
  for (const tagMatch of svg.matchAll(ATTRIBUTE_ASSET_TAG_RE)) {
    const tag = tagMatch[0];
    const tagOffset = tagMatch.index;
    for (const attribute of tag.matchAll(ATTRIBUTE_ASSET_RE)) {
      const rawUrl = attribute[2];
      const valueOffset = attribute.index + attribute[0].indexOf(rawUrl);
      references.push({
        start: tagOffset + valueOffset,
        end: tagOffset + valueOffset + rawUrl.length,
        rawUrl,
        kind: "image",
      });
    }
  }
  references.sort((a, b) => a.start - b.start || a.end - b.end);
  return references.filter((reference, index) => {
    const previous = references[index - 1];
    return !previous || reference.start >= previous.end;
  });
}

function collectCssUrlReferences(text: string): readonly AssetReference[] {
  const result: AssetReference[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    const token = lower.indexOf("url", cursor);
    if (token < 0) break;
    let open = token + 3;
    while (/\s/.test(text[open] ?? "")) open += 1;
    if (text[open] !== "(") {
      cursor = token + 3;
      continue;
    }
    let valueStart = open + 1;
    while (/\s/.test(text[valueStart] ?? "")) valueStart += 1;
    const quote = text[valueStart] === "\"" || text[valueStart] === "'" ? text[valueStart] : "";
    if (quote) valueStart += 1;
    let valueEnd = valueStart;
    let escaped = false;
    while (valueEnd < text.length) {
      const character = text[valueEnd];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if ((quote && character === quote) || (!quote && character === ")")) {
        break;
      }
      valueEnd += 1;
    }
    if (valueEnd >= text.length) {
      throw new Error("Video export found an unterminated CSS url() asset reference.");
    }
    result.push({
      start: valueStart,
      end: valueEnd,
      rawUrl: text.slice(valueStart, valueEnd).trim(),
      kind: "css",
    });
    cursor = valueEnd + 1;
  }
  return result;
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
    const decoded = decodeReferenceUrl(reference.rawUrl);
    if (isEmbeddedAssetReference(decoded)) {
      const normalized = resources.get(decoded);
      if (!normalized) {
        throw new Error(
          `Video export left an unresolved asset${frameIndex === null ? " in shared CSS" : ` in slide ${frameIndex + 1}`}: ${decoded}`
        );
      }
      output += normalized.dataUri;
    } else {
      output += reference.rawUrl;
    }
    cursor = reference.end;
  }
  output += svg.slice(cursor);

  const unresolved = collectAssetReferences(output).find((reference) =>
    isEmbeddedAssetReference(decodeReferenceUrl(reference.rawUrl)) &&
    !/^data:/i.test(decodeReferenceUrl(reference.rawUrl))
  );
  if (unresolved) {
    throw new Error(
      `Video export left an external asset${frameIndex === null ? " in shared CSS" : ` in slide ${frameIndex + 1}`}: ${unresolved.rawUrl}`
    );
  }
  return output;
}

async function validateEmbeddedFonts(
  resources: ReadonlyMap<string, NormalizedResource>,
  options: NormalizeVideoDeckArtifactOptionsV1
): Promise<void> {
  const fontEntries = [...resources.entries()].filter(([, resource]) =>
    isFontMime(resource.mimeType)
  );
  const FontFaceConstructor = (
    options.activeDocument.win as Window & { FontFace: typeof FontFace }
  ).FontFace;
  for (let index = 0; index < fontEntries.length; index += 1) {
    throwIfAborted(options.signal);
    const [url, resource] = fontEntries[index];
    let face: FontFace | undefined;
    try {
      face = new FontFaceConstructor(
        `AchmageVideoValidation${index}`,
        Uint8Array.from(resource.bytes).buffer
      );
      face = await withAbortAndTimeout(
        face.load(),
        options.signal,
        options.remoteTimeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS,
        `Timed out loading embedded font: ${url}`,
        options.activeDocument.win
      );
      options.activeDocument.fonts.add(face);
      await withAbortAndTimeout(
        Promise.resolve(options.activeDocument.fonts.ready),
        options.signal,
        options.remoteTimeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS,
        `Timed out activating embedded font: ${url}`,
        options.activeDocument.win
      );
    } catch (error) {
      throw new Error(`Video export could not load embedded font: ${url}. ${errorMessage(error)}`, {
        cause: error,
      });
    } finally {
      if (face) options.activeDocument.fonts.delete(face);
    }
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

function setSvgAttribute(attributes: string, name: string, value: string): string {
  const escapedName = name.replace(":", "\\:");
  const pattern = new RegExp(`\\s${escapedName}\\s*=\\s*(["']).*?\\1`, "i");
  const replacement = ` ${name}="${value}"`;
  return pattern.test(attributes) ? attributes.replace(pattern, replacement) : `${attributes}${replacement}`;
}

function decodeReferenceUrl(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\\([()'"\\])/g, "$1")
    .trim();
}

function isEmbeddedAssetReference(url: string): boolean {
  return url.length > 0 && !url.startsWith("#") && !/^(?:about:|javascript:)/i.test(url);
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
      const binary = atob(payload.replace(/\s/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return { bytes, mimeType };
    }
    return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mimeType };
  } catch (error) {
    throw new Error(`Malformed data URI payload. ${errorMessage(error)}`, { cause: error });
  }
}

function bytesToDataUri(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function normalizeMimeType(value: string, url: string): string {
  const normalized = value.split(";")[0].trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream" || normalized === "text/plain") {
    return mimeFromPath(url);
  }
  return normalized;
}

function assertSupportedAssetMime(mimeType: string, url: string): void {
  if (mimeType.startsWith("image/") || isFontMime(mimeType)) return;
  throw new Error(`Unsupported asset type ${mimeType} for ${url}.`);
}

function isFontMime(mimeType: string): boolean {
  return mimeType.startsWith("font/") || /^(?:application\/(?:font-|x-font-|vnd\.ms-fontobject))/.test(mimeType);
}

function mimeFromPath(path: string): string {
  const clean = path.replace(/[?#].*$/, "").toLowerCase();
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".svg")) return "image/svg+xml";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".bmp")) return "image/bmp";
  if (clean.endsWith(".avif")) return "image/avif";
  if (clean.endsWith(".woff2")) return "font/woff2";
  if (clean.endsWith(".woff")) return "font/woff";
  if (clean.endsWith(".ttf")) return "font/ttf";
  if (clean.endsWith(".otf")) return "font/otf";
  throw new Error(`Could not determine the asset type for ${path}.`);
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

async function withAbortAndTimeout<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
  activeWindow: Window
): Promise<T> {
  throwIfAborted(signal);
  let abortListener: (() => void) | undefined;
  const timeout = activeWindow.sleep(timeoutMs).then(() => Promise.reject(new Error(timeoutMessage)));
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    abortListener = () => reject(new DOMException("Video export was cancelled.", "AbortError"));
    signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    return await Promise.race([operation, timeout, aborted]);
  } finally {
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }
}
