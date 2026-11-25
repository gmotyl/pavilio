/**
 * Line numbers for the `diff` blocks a PR-explain story quotes (see
 * `skills/pavilio-pr-explain/SKILL.md`). Such a block opens with a header
 * `@@ <path> L<a>–<b> @@` naming the line its first quoted line sits on; a gap
 * inside the block is another `@@ <path> L<c> @@` header. Numbers are the head
 * version's, so context and added lines count and removed lines do not — unless
 * the header says `(before)`, which quotes the base version: then context and
 * removed lines count and added ones do not.
 *
 * A head-numbered header may add ` base L<c>`, the base line its first
 * base-side (context or removed) line sits on, so removed lines get a number
 * too. Under `(before)` the quoted lines are base lines already.
 */

import hljs from "highlight.js";
import { detectLang } from "./highlight";

/**
 * A story header: path (with any `(before)`/`(unchanged)` marker), then `L<start>` or `L<start>–<end>`
 * (en dash or hyphen), then an optional ` base L<start>`.
 */
const STORY_HEADER = /^@@ (\S.*?) L(\d+)(?:[–-]\d+)?(?: base L(\d+))? @@$/;

/** The `(…)` markers the skill writes after a header path. */
const MARKERS = /(?:\s+\([^()]*\))+$/;

/**
 * `(before)` as a marker the skill writes after the path: preceded by
 * whitespace and followed only by further `(…)` markers — never a `(before)`
 * inside the path itself, such as a directory named so.
 */
const BEFORE_MARKER = /\s\(before\)(?:\s+\([^()]*\))*$/;

type DiffLineKind = "header" | "context" | "added" | "removed" | "other";

export interface StoryDiffLine {
  text: string;
  kind: DiffLineKind;
  /** The quoted file's line number; null where the gutter stays empty. */
  number: number | null;
  /**
   * The base version's line number: null for `+` lines and when the header has no `base L`;
   * equals `number` under `(before)`.
   */
  base: number | null;
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
  let nextBase: number | null = null;
  let before = false;
  return lines.map((line) => {
    const kind = kindOf(line);
    if (kind === "header") {
      const [, path, start, baseStart] = STORY_HEADER.exec(line)!;
      next = Number(start);
      before = BEFORE_MARKER.test(path);
      nextBase = before ? null : baseStart === undefined ? null : Number(baseStart);
      return { text: line, kind, number: null, base: null };
    }
    const counted = kind === "context" || (kind === (before ? "removed" : "added"));
    const number = counted ? next++ : null;
    if (before) return { text: line, kind, number, base: number };
    if (nextBase === null || (kind !== "context" && kind !== "removed")) {
      return { text: line, kind, number, base: null };
    }
    return { text: line, kind, number, base: nextBase++ };
  });
}

/**
 * hljs language name for the block's first header path: the hand map's choice first, else the
 * extension itself when highlight.js knows it; null when unknown or there is no extension.
 */
export function storyDiffLanguage(lines: StoryDiffLine[]): string | null {
  const header = lines.find((line) => line.kind === "header");
  const match = header && STORY_HEADER.exec(header.text);
  if (!match) return null;
  const path = match[1].replace(MARKERS, "");
  const name = path.split("/").pop() ?? "";
  if (!name.includes(".")) return null;
  const ext = name.split(".").pop()!.toLowerCase();
  return detectLang(path) ?? (hljs.getLanguage(ext) ? ext : null);
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
