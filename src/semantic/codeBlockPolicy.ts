// V5 PR-A2b ??single source for code block snippet/full policy.
//
// Before PR-A2b the 12-line threshold + 7/4 head/tail shape lived in three
// modules: measureSemanticBlocks (snippet planning), planning (rendering
// chunkCodeBlock), splitLayoutPlan (layout splitCodeGroup). PR-A2b moves
// the constants + decision into this single module. With user decision D1
// pretextMeasurer is the fourth caller ??its measurement now respects the
// same policy so legacy/raw fallback paths align with native 1920 v5 semantic snippet
// truncation (invariant 14 ??render-truth honesty).
//
// PR-B3 will extend the API with `auto` mode (??2 ??full single-frame,
// ??3 ??full + frame split, invariant 11) and frontmatter override
// (`achmage.codeMode`, `<!-- _codeMode: full -->`).
//
// Design constraint: ContentSignature is content-only (invariant 12).
// `signature` carries no typography/viewport/theme inputs ??`ctx` is
// reserved for those (empty in PR-A2b for legacy parity).

export const CODE_SNIPPET_FULL_LINES = 12;
export const CODE_SNIPPET_HEAD_LINES = 7;
export const CODE_SNIPPET_TAIL_LINES = 4;

export type CodeMode = "full" | "snippet" | "auto";

export interface CodeBlockSignature {
  /** Total non-fence line count (excludes triple-backtick markers). */
  lineCount: number;
  /** Optional language hint ??reserved for PR-B3+ (codeWalkthrough patterns). */
  language?: string;
}

// PR-A2b: empty (legacy parity). PR-B3+ will add typography, slot region,
// layoutKind, frontmatter override origin.
export interface CodeBlockContext {
  readonly _v5PhaseAReserved?: never;
}

export interface SnippetShape {
  headLineCount: number;
  tailLineCount: number;
}

/** Returns the head/tail split for snippet mode (shape only ??no measurement-driven adjustment). */
export function snippetShape(): SnippetShape {
  return {
    headLineCount: CODE_SNIPPET_HEAD_LINES,
    tailLineCount: CODE_SNIPPET_TAIL_LINES,
  };
}

/**
 * Decide whether a code block renders as `full` or `snippet`.
 *
 * PR-A2b legacy semantics: lineCount > CODE_SNIPPET_FULL_LINES ??"snippet";
 * lineCount ??CODE_SNIPPET_FULL_LINES ??"full". The override parameter is
 * reserved for PR-B3's `_codeMode: full|snippet|auto` frontmatter API; if
 * "auto" or undefined, falls through to the legacy threshold.
 */
export function decideCodeMode(
  signature: CodeBlockSignature,
  _ctx: CodeBlockContext = {},
  override?: CodeMode
): CodeMode {
  if (override === "snippet" || override === "full") return override;
  return signature.lineCount > CODE_SNIPPET_FULL_LINES ? "snippet" : "full";
}
