import type { Vault, TFile } from "obsidian";

/**
 * Convert Obsidian-specific markdown syntax to standard markdown
 * that marp-core can understand.
 */
export function convertObsidianSyntax(
  markdown: string,
  vault: Vault
): string {
  let result = markdown;

  // 1. Preserve wikilinks as semantic internal markdown links.
  result = convertWikilinks(result);

  // 2. Convert image embeds ![[image.png]] -> ![](image-path)
  result = convertImageEmbeds(result, vault);

  // 3. Convert note embeds ![[note]] -> inline content (simplified: just link text)
  result = convertNoteEmbeds(result);

  // 4. Preserve Obsidian callout metadata while keeping a readable markdown fallback.
  result = convertCallouts(result);

  // 5. Convert highlights ==text== -> <mark>text</mark>
  result = convertHighlights(result);

  // 6. Remove Obsidian comments %%comment%%
  result = removeObsidianComments(result);

  return result;
}

function convertWikilinks(markdown: string): string {
  return markdown.replace(
    /(?<!!)\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_match, page, alias) => {
      const target = String(page).trim();
      const label = String(alias || page).trim();
      return `[${escapeMarkdownLabel(label)}](obsidian://open?path=${encodeMarkdownUrlComponent(
        target
      )})`;
    }
  );
}

function convertImageEmbeds(markdown: string, vault: Vault): string {
  // ![[image.png]] -> ![](image-path)
  // ![[image.png|400]] -> ![](image-path) with width
  return markdown.replace(
    /!\[\[([^\]|]+?\.(png|jpg|jpeg|gif|svg|webp|bmp))(?:\|(\d+(?:x\d+)?))?\]\]/gi,
    (_match, filename, _ext, size) => {
      const file = vault
        .getFiles()
        .find((f: TFile) => f.name === filename || f.path.endsWith(filename));
      if (file) {
        const resourcePath = vault.getResourcePath(file);
        if (size) {
          return `![w:${size}](${resourcePath})`;
        }
        return `![](${resourcePath})`;
      }
      // Fallback: just use the filename.
      return size ? `![w:${size}](${filename})` : `![](${filename})`;
    }
  );
}

function convertNoteEmbeds(markdown: string): string {
  // ![[note]] (non-image) -> a semantic note-embed callout marker.
  return markdown.replace(
    /!\[\[([^\]]+?)(?:\.(md))?\]\]/gi,
    (_match, noteName) => {
      const target = String(noteName).trim();
      const label = target.replace(/\.md$/i, "");
      return `> <!-- asu-note-embed:${encodeURIComponent(
        target
      )} -->\n> **Note embed: ${escapeMarkdownInline(label)}**`;
    }
  );
}

function convertCallouts(markdown: string): string {
  return convertCalloutsWithMetadata(markdown);
}

function convertCalloutsWithMetadata(markdown: string): string {
  return markdown.replace(
    /^(>\s*)\[!+([^\]]+)\][^\S\r\n]*(.*)/gm,
    (_match, prefix, rawType, title) => {
      const parsed = normalizeCalloutMarker(String(rawType), String(title ?? ""));
      const normalizedType = parsed.type;
      const cleanTitle = parsed.title;
      const label = calloutLabel(normalizedType);
      const readable = cleanTitle
        ? `**${label}: ${cleanTitle}**`
        : `**${label}**`;
      return `${prefix}<!-- asu-callout:${normalizedType}:${encodeURIComponent(
        cleanTitle
      )} -->\n${prefix}${readable}`;
    }
  );
}

function normalizeCalloutMarker(rawType: string, rawTitle: string): { type: string; title: string } {
  const marker = rawType.trim();
  const normalized = normalizeCalloutType(marker);
  const cleanTitle = rawTitle.trim();
  if (normalized === "note" && !KNOWN_CALLOUT_TYPES.has(slugCalloutType(marker))) {
    return { type: "note", title: cleanTitle || marker };
  }
  return { type: normalized, title: cleanTitle };
}

const KNOWN_CALLOUT_TYPES = new Set([
  "note",
  "info",
  "important",
  "tip",
  "success",
  "question",
  "warning",
  "example",
  "abstract",
  "summary",
  "tldr",
  "todo",
  "hint",
  "check",
  "done",
  "faq",
  "attention",
  "fail",
  "missing",
  "danger",
  "error",
  "bug",
  "cite",
  "quote",
]);

function normalizeCalloutType(rawType: string): string {
  const slug = slugCalloutType(rawType);
  if (KNOWN_CALLOUT_TYPES.has(slug)) return slug;
  return "note";
}

function slugCalloutType(rawType: string): string {
  return rawType.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function calloutLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function convertHighlights(markdown: string): string {
  // ==highlighted text== -> <mark>text</mark>
  return markdown.replace(
    /==(.*?)==/g,
    (_match, text) => `<mark>${text}</mark>`
  );
}

function removeObsidianComments(markdown: string): string {
  // %%inline comment%% -> removed
  // Also handles multi-line %%...%%
  return markdown.replace(/%%[\s\S]*?%%/g, "");
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\*/g, "\\*");
}

function encodeMarkdownUrlComponent(value: string): string {
  return encodeURIComponent(value).replace(/[()]/g, (char) =>
    char === "(" ? "%28" : "%29"
  );
}
