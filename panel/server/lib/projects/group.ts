import { parseDocument } from "yaml";
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

/** The longest group name the panel accepts (`PUT /:name/group`, group rename) and the CLI writes. */
export const GROUP_NAME_MAX = 64;

/**
 * A group name as the panel and `scripts/project new --group` accept it: null stays null, a
 * string is trimmed and empty means null; undefined = invalid (not a string or null, holds a line
 * break, or longer than `GROUP_NAME_MAX` once trimmed).
 */
export function parseGroupName(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string" || /[\r\n]/.test(v)) return undefined;
  const t = v.trim();
  return t.length > GROUP_NAME_MAX ? undefined : t || null;
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

/** Bare when YAML reads the bare value back as the identical string, otherwise double-quoted. */
function groupLine(group: string, eol: string): string {
  let bare = false;
  if (!/[\r\n]/.test(group)) {
    try {
      // parseDocument collects errors/warnings instead of logging them (no TAG_RESOLVE_FAILED noise).
      const doc = parseDocument(`group: ${group}`, { uniqueKeys: false });
      const data = doc.errors.length ? null : (doc.toJS() as Record<string, unknown> | null);
      bare = data?.group === group;
    } catch {
      bare = false;
    }
  }
  return `group: ${bare ? group : JSON.stringify(group)}${eol}`;
}

const lineEol = (line: string) => (line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "");

/**
 * Edits only the top-level `group:` entries of the leading frontmatter — adds, replaces or
 * removes them, including multi-line values (indented or `- ` continuation lines). Duplicates
 * are dropped after the first. With no frontmatter and a non-null group, prepends a block
 * holding only `group:` (after any BOM, using the file's line ending).
 */
export function rewriteGroup(text: string, group: string | null): string {
  const match = FENCE.exec(text);
  if (!match) {
    if (group === null) return text;
    const bom = text.charCodeAt(0) === 0xfeff ? "\uFEFF" : "";
    const rest = text.slice(bom.length);
    const eol = /^[^\n]*\r\n/.test(rest) ? "\r\n" : "\n";
    return `${bom}---${eol}${groupLine(group, eol)}---${eol}${rest}`;
  }
  const [whole, open, inner, close] = match;
  const eol = open.endsWith("\r\n") ? "\r\n" : "\n";
  const lines = inner.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const isCont = (l: string) => /^[ \t]/.test(l) || /^-(?:[ \t]|\r?\n|$)/.test(l);
  const isBlank = (l: string) => /^[ \t]*\r?\n?$/.test(l);
  const out: string[] = [];
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^group[ \t]*:/.test(line)) {
      out.push(line);
      continue;
    }
    let end = i + 1;
    for (let j = i + 1; j < lines.length; j++) {
      if (isCont(lines[j]) && !isBlank(lines[j])) end = j + 1;
      else if (!isBlank(lines[j])) break;
    }
    const last = lines[end - 1];
    if (!found && group !== null) out.push(groupLine(group, lineEol(last)));
    found = true;
    i = end - 1;
  }
  if (!found) {
    if (group === null) return text;
    out.push(groupLine(group, eol));
  }
  return open + out.join("") + close + text.slice(whole.length);
}
