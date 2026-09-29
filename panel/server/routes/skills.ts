import { Router } from "express";
import { promises as fs } from "fs";
import { join } from "path";
import { resolveRoot } from "../lib/file-roots.js";

/**
 * GET /api/skills — the workspace's skills, discovered on every request.
 *
 * The `skills` root from file-roots.ts is walked each time: no cache and no
 * hard-coded list of names, so a skill dir added or removed shows up (or
 * disappears) on the next call without a restart.
 *
 * Discovery rules:
 * - every direct child directory of the root that holds a `SKILL.md` is a skill;
 *   its `name` is the directory name, not the frontmatter `name`;
 * - symlinked skill dirs are followed (the workspace links some skills in from
 *   `.agents/skills/`); dangling links are skipped silently;
 * - hidden entries (`.foo`) and plain files are skipped;
 * - a missing root yields an empty list, not an error.
 * Order is unspecified (callers sort).
 */

export interface SkillEntry {
  name: string;
  /** Frontmatter `description`, "" when absent. */
  description: string;
  /** Relative to the workspace root, always `skills/<name>/SKILL.md`. */
  path: string;
}

const router = Router();

router.get("/", async (_req, res) => {
  try {
    res.json(await discoverSkills(resolveRoot("skills")));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export async function discoverSkills(root: string): Promise<SkillEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }

  const entries = await Promise.all(
    names
      .filter((name) => !name.startsWith("."))
      .map(async (name): Promise<SkillEntry | null> => {
        const skillFile = join(root, name, "SKILL.md");
        let text: string;
        try {
          // stat() (not lstat) follows symlinks, both for the dir and the file.
          if (!(await fs.stat(join(root, name))).isDirectory()) return null;
          if (!(await fs.stat(skillFile)).isFile()) return null;
          text = await fs.readFile(skillFile, "utf8");
        } catch (err) {
          // Missing SKILL.md, dangling symlink, or an entry removed mid-walk.
          if (isNotFound(err) || isCode(err, "ENOTDIR")) return null;
          throw err;
        }
        return { name, description: parseDescription(text), path: `skills/${name}/SKILL.md` };
      }),
  );
  return entries.filter((e): e is SkillEntry => e !== null);
}

function isCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

function isNotFound(err: unknown): boolean {
  return isCode(err, "ENOENT");
}

/**
 * Extract the `description` value from a Markdown file's YAML frontmatter.
 *
 * The panel has no YAML dependency, so this is a deliberately small reader
 * for the one top-level key we need. Supported forms: plain scalars (with
 * multi-line continuation folded to spaces), single/double quoted scalars,
 * and `>` / `|` block scalars (with optional `-`/`+` chomping). Anything it
 * cannot find yields "".
 */
export function parseDescription(text: string): string {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return "";
  const end = lines.findIndex((l, i) => i > 0 && (l.trim() === "---" || l.trim() === "..."));
  if (end === -1) return "";
  const fm = lines.slice(1, end);

  const start = fm.findIndex((l) => /^description\s*:/.test(l));
  if (start === -1) return "";
  const first = fm[start].replace(/^description\s*:/, "").trim();

  // Continuation lines: indented (or blank) lines until the next top-level key.
  const rest: string[] = [];
  for (let i = start + 1; i < fm.length; i++) {
    const l = fm[i];
    if (l.trim() !== "" && !/^\s/.test(l)) break;
    rest.push(l);
  }

  const block = /^([>|])([+-]?)\d*\s*(#.*)?$/.exec(first);
  if (block) return blockScalar(rest, block[1] as ">" | "|", block[2]);

  if (first.startsWith('"')) return doubleQuoted([first, ...rest.map((l) => l.trim())].join(" "));
  if (first.startsWith("'")) return singleQuoted([first, ...rest.map((l) => l.trim())].join(" "));

  // Plain scalar: strip a trailing comment, fold continuation lines.
  const parts = [first.replace(/\s+#.*$/, ""), ...rest.map((l) => l.trim())].filter((p) => p !== "");
  return parts.join(" ");
}

function blockScalar(lines: string[], style: ">" | "|", chomp: string): string {
  // Drop trailing blank lines; chomping decides what to re-add.
  let last = lines.length;
  while (last > 0 && lines[last - 1].trim() === "") last--;
  const body = lines.slice(0, last);
  const indent = Math.min(
    ...body.filter((l) => l.trim() !== "").map((l) => l.match(/^\s*/)![0].length),
  );
  const stripped = body.map((l) => (l.trim() === "" ? "" : l.slice(indent)));

  let value: string;
  if (style === "|") {
    value = stripped.join("\n");
  } else {
    // Folded: single newlines become spaces, blank lines become newlines.
    value = stripped
      .join("\n")
      .split(/\n{2,}/)
      .map((para) => para.replace(/\n/g, " "))
      .join("\n");
  }
  if (value === "") return "";
  // Default "clip" keeps one trailing newline; for a one-line UI string we
  // drop it unless "+" (keep) asked for trailing newlines explicitly.
  return chomp === "+" ? value + "\n" : value;
}

function singleQuoted(raw: string): string {
  const m = /^'((?:[^']|'')*)'/.exec(raw);
  return (m ? m[1] : raw.slice(1)).replace(/''/g, "'");
}

function doubleQuoted(raw: string): string {
  const m = /^"((?:[^"\\]|\\.)*)"/.exec(raw);
  const inner = m ? m[1] : raw.slice(1);
  return inner.replace(/\\(.)/g, (_, c: string) =>
    c === "n" ? "\n" : c === "t" ? "\t" : c,
  );
}

export default router;
