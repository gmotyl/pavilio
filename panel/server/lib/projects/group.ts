import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { splitFrontmatter } from "./frontmatter";
import { projectCardDir } from "./kind";

/** A trimmed non-empty string `group`, otherwise null. */
export function readGroup(data: Record<string, unknown>): string | null {
  const group = data.group;
  if (typeof group !== "string") return null;
  const trimmed = group.trim();
  return trimmed ? trimmed : null;
}

/** The project's `group` from its `PROJECT.md` frontmatter; missing project or card → null. */
export function projectGroup(projectsDir: string, project: string): string | null {
  const dir = projectCardDir(projectsDir, project);
  if (!dir) return null;
  const card = join(dir, "PROJECT.md");
  if (!existsSync(card)) return null;
  return readGroup(splitFrontmatter(readFileSync(card, "utf8")).data);
}

const FENCE = /^(\uFEFF?---\r?\n)((?:[\s\S]*?\r?\n)?)(---[ \t]*(?:\r?\n|$))/;
const GROUP_LINE = /^group:.*(?:\r?\n|$)/m;

function groupLine(group: string, eol: string): string {
  return `group: ${JSON.stringify(group)}${eol}`.replace(/^group: "([A-Za-z0-9 _.-]*[A-Za-z0-9_.-])"/, "group: $1");
}

/**
 * Edits only the `group:` line of the leading frontmatter — adds, replaces or removes it.
 * With no frontmatter and a non-null group, prepends a block holding only `group:`.
 */
export function rewriteGroup(text: string, group: string | null): string {
  const match = FENCE.exec(text);
  if (!match) {
    if (group === null) return text;
    return `---\n${groupLine(group, "\n")}---\n${text}`;
  }
  const [whole, open, inner, close] = match;
  const eol = open.endsWith("\r\n") ? "\r\n" : "\n";
  let next: string;
  if (GROUP_LINE.test(inner)) {
    next = inner.replace(GROUP_LINE, (line) =>
      group === null ? "" : groupLine(group, line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : ""),
    );
  } else {
    if (group === null) return text;
    next = inner + groupLine(group, eol);
  }
  return open + next + close + text.slice(whole.length);
}
