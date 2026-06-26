import {
  clearCache,
  layout,
  measureLineStats,
  measureNaturalWidth,
  prepare,
  prepareWithSegments,
  type PrepareOptions,
} from "../vendor/pretext/layout";
import {
  measureRichInlineStats,
  prepareRichInline,
  type RichInlineItem,
} from "../vendor/pretext/rich-inline";
import type {
  LanguageProfile,
  MeasurementCacheStats,
  MeasurementEngineName,
  TextMeasurement,
} from "./measurementTypes";

export class PretextMeasurementUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "PretextMeasurementUnavailable";
    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        configurable: true,
      });
    }
  }
}

export interface MeasureTextInput {
  text: string;
  font: string;
  maxWidth: number;
  lineHeight: number;
  language: LanguageProfile;
  whiteSpace?: "normal" | "pre-wrap";
  wordBreak?: "normal" | "keep-all";
}

export interface MeasureRichInlineInput {
  items: RichInlineItem[];
  maxWidth: number;
  lineHeight: number;
  locale?: string;
}

export interface PretextMeasurementEngineOptions {
  maxEntries?: number;
  locale?: string;
}

export class PretextMeasurementEngine {
  readonly name: MeasurementEngineName = "pretext";
  private readonly maxEntries: number;
  private readonly locale: string;
  private readonly textCache = new Map<string, TextMeasurement>();
  private readonly richInlineCache = new Map<string, TextMeasurement>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private cacheEvictions = 0;

  constructor(options: PretextMeasurementEngineOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 1200);
    this.locale = options.locale ?? "auto";
  }

  measureText(input: MeasureTextInput): TextMeasurement {
    const options: PrepareOptions = {
      whiteSpace: input.whiteSpace ?? "normal",
      wordBreak: input.wordBreak ?? wordBreakForLanguage(input.language),
    };
    const text = normalizeInputText(input.text, options.whiteSpace);
    const maxWidth = Math.max(1, input.maxWidth);
    const lineHeight = Math.max(1, input.lineHeight);
    const cacheKey = measurementCacheKey({
      kind: "text",
      text,
      font: input.font,
      whiteSpace: options.whiteSpace ?? "normal",
      wordBreak: options.wordBreak ?? "normal",
      locale: this.locale,
      maxWidth,
      lineHeight,
    });
    const cached = this.getCached(this.textCache, cacheKey);
    if (cached) return { ...cached, cacheHit: true };

    try {
      const prepared = prepare(text, input.font, options);
      const preparedWithSegments = prepareWithSegments(text, input.font, options);
      const result = layout(prepared, maxWidth, lineHeight);
      const stats = measureLineStats(preparedWithSegments, maxWidth);
      const naturalWidth = measureNaturalWidth(preparedWithSegments);
      const measurement: TextMeasurement = {
        engine: this.name,
        text,
        language: input.language,
        wordBreak: options.wordBreak ?? "normal",
        whiteSpace: options.whiteSpace ?? "normal",
        font: input.font,
        maxWidth,
        lineHeight,
        lineCount: result.lineCount,
        maxLineWidth: stats.maxLineWidth,
        height: result.height,
        naturalWidth,
        isOverflow: stats.maxLineWidth > maxWidth || result.height > lineHeight * 12,
        density: densityFor(result.lineCount, result.height, lineHeight),
        warnings: [],
        inlineMode: "plain",
        cacheHit: false,
        cacheKey,
      };
      this.setCached(this.textCache, cacheKey, measurement);
      return measurement;
    } catch (error) {
      throw new PretextMeasurementUnavailable(
        "Pretext measurement requires a canvas-capable runtime.",
        { cause: error }
      );
    }
  }

  measureRichInline(input: MeasureRichInlineInput): TextMeasurement {
    const maxWidth = Math.max(1, input.maxWidth);
    const lineHeight = Math.max(1, input.lineHeight);
    const text = input.items.map((item) => item.text).join("");
    const cacheKey = measurementCacheKey({
      kind: "rich",
      text: input.items
        .map((item) => `${item.text}\u0000${item.font}\u0000${item.break ?? "normal"}\u0000${item.extraWidth ?? 0}`)
        .join("\u0001"),
      font: input.items.map((item) => item.font).join("|"),
      whiteSpace: "normal",
      wordBreak: "normal",
      locale: input.locale ?? this.locale,
      maxWidth,
      lineHeight,
    });
    const cached = this.getCached(this.richInlineCache, cacheKey);
    if (cached) return { ...cached, cacheHit: true };

    try {
      const prepared = prepareRichInline(input.items);
      const stats = measureRichInlineStats(prepared, maxWidth);
      const measurement: TextMeasurement = {
        engine: this.name,
        text,
        language: "mixed",
        wordBreak: "normal",
        whiteSpace: "normal",
        font: input.items[0]?.font ?? "",
        maxWidth,
        lineHeight,
        lineCount: stats.lineCount,
        maxLineWidth: stats.maxLineWidth,
        height: stats.lineCount * lineHeight,
        naturalWidth: stats.maxLineWidth,
        isOverflow: stats.maxLineWidth > maxWidth || stats.lineCount * lineHeight > lineHeight * 12,
        density: densityFor(stats.lineCount, stats.lineCount * lineHeight, lineHeight),
        warnings: ["richInline"],
        inlineMode: "rich",
        cacheHit: false,
        cacheKey,
      };
      this.setCached(this.richInlineCache, cacheKey, measurement);
      return measurement;
    } catch (error) {
      throw new PretextMeasurementUnavailable(
        "Pretext rich-inline measurement requires a canvas-capable runtime.",
        { cause: error }
      );
    }
  }

  assertAvailable(): void {
    this.measureText({
      text: "pretext probe",
      font: "400 16px Arial",
      maxWidth: 120,
      lineHeight: 20,
      language: "en",
    });
  }

  clear(): void {
    this.textCache.clear();
    this.richInlineCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.cacheEvictions = 0;
    clearCache();
  }

  stats(): MeasurementCacheStats {
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      evictions: this.cacheEvictions,
      size: this.textCache.size + this.richInlineCache.size,
      maxEntries: this.maxEntries,
    };
  }

  private getCached(
    cache: Map<string, TextMeasurement>,
    key: string
  ): TextMeasurement | undefined {
    const cached = cache.get(key);
    if (!cached) {
      this.cacheMisses++;
      return undefined;
    }
    cache.delete(key);
    cache.set(key, cached);
    this.cacheHits++;
    return cached;
  }

  private setCached(
    cache: Map<string, TextMeasurement>,
    key: string,
    value: TextMeasurement
  ): void {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (this.textCache.size + this.richInlineCache.size > this.maxEntries) {
      const oldestCache =
        this.textCache.size >= this.richInlineCache.size
          ? this.textCache
          : this.richInlineCache;
      const oldestKey = oldestCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      oldestCache.delete(oldestKey);
      this.cacheEvictions++;
    }
  }
}

export const semanticPretextEngine = new PretextMeasurementEngine();

export function isPretextMeasurementUnavailable(
  error: unknown
): error is PretextMeasurementUnavailable {
  return error instanceof PretextMeasurementUnavailable;
}

export function wordBreakForLanguage(
  language: LanguageProfile
): "normal" | "keep-all" {
  return language === "ko" || language === "mixed" || language === "cjk"
    ? "keep-all"
    : "normal";
}

function normalizeInputText(
  value: string,
  whiteSpace: "normal" | "pre-wrap" | undefined
): string {
  if (whiteSpace === "pre-wrap") return value.replace(/\r\n/g, "\n");
  return value.replace(/\s+/g, " ").trim();
}

export function measurementCacheKey(input: {
  kind: "text" | "rich";
  text: string;
  font: string;
  whiteSpace: string;
  wordBreak: string;
  locale: string;
  maxWidth: number;
  lineHeight: number;
}): string {
  return [
    input.kind,
    input.text,
    input.font,
    input.whiteSpace,
    input.wordBreak,
    input.locale,
    Math.round(input.maxWidth * 10) / 10,
    Math.round(input.lineHeight * 10) / 10,
  ].join("\u001f");
}

function densityFor(
  lineCount: number,
  height: number,
  lineHeight: number
): TextMeasurement["density"] {
  if (lineCount >= 9 || height > lineHeight * 9.5) return "overflow";
  if (lineCount >= 6 || height > lineHeight * 6) return "dense";
  if (lineCount <= 2) return "light";
  return "normal";
}
