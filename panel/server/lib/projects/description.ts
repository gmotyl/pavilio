import { readFileSync, realpathSync } from "fs";
import { isAbsolute, join, relative } from "path";

import { splitFrontmatter } from "./frontmatter";

/** Longest description returned, ellipsis included. */
export const DESCRIPTION_MAX = 140;

const OVERVIEW_HEADING = /^##\s+.*overview\s*$/i;

/**
 * The file's text when it exists and its realpath stays under the project dir's realpath — a
 * symlinked card or wiki must not surface an arbitrary file's opening chars in the archive list.
 */
function readText(projectDir: string, path: string): string | null {
  try {
    const root = realpathSync(projectDir);
    const real = realpathSync(path);
    const rel = relative(root, real);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
    return readFileSync(real, "utf8");
  } catch {
    return null;
  }
}

/** First paragraph (non-heading lines up to a blank line or heading), joined on spaces. */
function firstParagraph(lines: string[]): string | null {
  const para: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const isBreak = line === "" || line.startsWith("#");
    if (isBreak) {
      if (para.length) break;
      continue;
    }
    para.push(line);
  }
  return para.length ? para.join(" ") : null;
}

function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/.exec(text);
  return match ? match[0] : text;
}

function overviewSentence(body: string): string | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => OVERVIEW_HEADING.test(l.trim()));
  if (start < 0) return null;
  const rest: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // The section ends at the next heading of the same or higher level.
    if (/^#{1,2}\s/.test(line.trim())) break;
    rest.push(line);
  }
  const para = firstParagraph(rest);
  return para ? firstSentence(para) : null;
}

function cut(text: string): string {
  if (text.length <= DESCRIPTION_MAX) return text;
  return `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`;
}

/**
 * One-line description of a project dir, first hit wins: `topic` frontmatter of `PROJECT.md`,
 * the first sentence under its first `## …Overview` heading, the first paragraph of
 * `wiki/overview.md`. Cut to {@link DESCRIPTION_MAX} chars with an ellipsis; null when none.
 */
export function projectDescription(projectDir: string): string | null {
  const card = readText(projectDir, join(projectDir, "PROJECT.md"));
  if (card !== null) {
    const { data, body } = splitFrontmatter(card);
    const topic = typeof data.topic === "string" ? data.topic.trim() : "";
    if (topic) return cut(topic);
    const sentence = overviewSentence(body);
    if (sentence) return cut(sentence);
  }
  const overview = readText(projectDir, join(projectDir, "wiki", "overview.md"));
  if (overview !== null) {
    const para = firstParagraph(splitFrontmatter(overview).body.split(/\r?\n/));
    if (para) return cut(para);
  }
  return null;
}
