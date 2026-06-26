import type { AchmageSettings } from "../settings";

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * Ensures the markdown has proper marp frontmatter.
 * If no frontmatter exists, injects defaults.
 * If frontmatter exists but missing marp keys, merges them in.
 *
 * native 1920 v5: Typography styles are injected as <style> HTML blocks in
 * slideRenderer.ts (not here) for reliable Marp parsing.
 */
export function injectFrontmatter(
  markdown: string,
  settings: AchmageSettings
): string {
  const match = markdown.match(FRONTMATTER_REGEX);

  const headingDivider = settings.headingDivider.length === 1
    ? settings.headingDivider[0]
    : `[${settings.headingDivider.join(", ")}]`;

  if (!match) {
    // No frontmatter at all ??inject complete default
    const frontmatter = buildFrontmatter(settings, headingDivider);
    return `${frontmatter}\n${markdown}`;
  }

  const existingYaml = match[1];
  const rest = markdown.slice(match[0].length);

  // Parse existing YAML lines
  const lines = existingYaml.split("\n");
  const keys = new Set(lines.map((l) => l.split(":")[0].trim()));

  // Only inject keys that are missing
  const additions: string[] = [];

  if (!keys.has("marp")) {
    additions.push("marp: true");
  }
  if (!keys.has("theme") && settings.defaultTheme !== "default") {
    additions.push(`theme: ${settings.defaultTheme}`);
  }
  // NOTE: Do NOT inject headingDivider here.
  // Our overflowSplitter already splits by headings and inserts --- separators.
  // Injecting headingDivider would cause marp to double-split.
  if (!keys.has("paginate") && settings.autoPaginate) {
    additions.push("paginate: true");
  }

  if (additions.length === 0) {
    return markdown; // Nothing to inject
  }

  const mergedYaml = [...lines, ...additions].join("\n");
  return `---\n${mergedYaml}\n---${rest}`;
}

function buildFrontmatter(
  settings: AchmageSettings,
  headingDivider: number | string
): string {
  const lines = ["---", "marp: true"];

  if (settings.defaultTheme !== "default") {
    lines.push(`theme: ${settings.defaultTheme}`);
  }

  // headingDivider NOT injected ??overflowSplitter handles heading-based splitting

  if (settings.autoPaginate) {
    lines.push("paginate: true");
  }

  if (settings.defaultTransition !== "none") {
    lines.push(`transition: ${settings.defaultTransition}`);
  }

  lines.push("---");
  return lines.join("\n");
}
