import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";

/** Longest description returned, ellipsis included. */
export const DESCRIPTION_MAX = 140;

const FENCE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const OVERVIEW_HEADING = /^##\s+.*overview\s*$/i;

function readText(path: string): string | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  // Editors on Windows may save a UTF-8 BOM, which would hide the opening fence.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Splits leading `---` frontmatter from the body; broken YAML yields no data. */
function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = FENCE.exec(text);
  if (!match) return { data: {}, body: text };
  const body = text.slice(match[0].length);
  try {
    const data = parseYaml(match[1] ?? "", { uniqueKeys: false });
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return { data: data as Record<string, unknown>, body };
    }
  } catch {
    // fall through: unreadable frontmatter carries no topic
  }
  return { data: {}, body };
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
  const card = readText(join(projectDir, "PROJECT.md"));
  if (card !== null) {
    const { data, body } = splitFrontmatter(card);
    const topic = typeof data.topic === "string" ? data.topic.trim() : "";
    if (topic) return cut(topic);
    const sentence = overviewSentence(body);
    if (sentence) return cut(sentence);
  }
  const overview = readText(join(projectDir, "wiki", "overview.md"));
  if (overview !== null) {
    const para = firstParagraph(splitFrontmatter(overview).body.split(/\r?\n/));
    if (para) return cut(para);
  }
  return null;
}
