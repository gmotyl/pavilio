/**
 * Line numbers for the `diff` blocks a PR-explain story quotes (see
 * `skills/pavilio-pr-explain/SKILL.md`). Such a block opens with a header
 * `@@ <path> L<a>–<b> @@` naming the line its first quoted line sits on; a gap
 * inside the block is another `@@ <path> L<c> @@` header. Numbers are the head
 * version's, so context and added lines count and removed lines do not — unless
 * the header says `(before)`, which quotes the base version: then context and
 * removed lines count and added ones do not.
 */

/** A story header: path (with any `(before)`/`(unchanged)` marker), then `L<start>` or `L<start>–<end>`. */
const STORY_HEADER = /^@@ (\S.*?) L(\d+)(?:[–-]\d+)? @@$/;

type DiffLineKind = "header" | "context" | "added" | "removed" | "other";

export interface StoryDiffLine {
  text: string;
  kind: DiffLineKind;
  /** The quoted file's line number; null where the gutter stays empty. */
  number: number | null;
}

function kindOf(line: string): DiffLineKind {
  if (STORY_HEADER.test(line)) return "header";
  // A blank context line whose leading space was trimmed is still context.
  if (line === "" || line.startsWith(" ")) return "context";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "other";
}

/** The block's lines with their numbers, or null when its first line is not a story header. */
export function numberStoryDiff(text: string): StoryDiffLine[] | null {
  const lines = text.replace(/\n$/, "").split("\n");
  if (!STORY_HEADER.test(lines[0] ?? "")) return null;
  let next = 0;
  let before = false;
  return lines.map((line) => {
    const kind = kindOf(line);
    if (kind === "header") {
      const [, path, start] = STORY_HEADER.exec(line)!;
      next = Number(start);
      before = /\(before\)/.test(path);
      return { text: line, kind, number: null };
    }
    const counted = kind === "context" || (kind === (before ? "removed" : "added"));
    return { text: line, kind, number: counted ? next++ : null };
  });
}

/**
 * The highlight.js class each kind keeps, so a numbered block is coloured as
 * before. highlight.js's diff grammar does not recognise the story header, so
 * it stays unstyled, as it was.
 */
export const HLJS_CLASS: Record<DiffLineKind, string | undefined> = {
  header: undefined,
  context: undefined,
  added: "hljs-addition",
  removed: "hljs-deletion",
  other: undefined,
};
