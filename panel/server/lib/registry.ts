import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";

/**
 * Keeps the private project registry (`.projects.local.md`, repo root)
 * in sync with project creation and archive/restore moves. All operations are best-effort:
 * a missing or unparseable registry is a no-op, never an error.
 */

const REGISTRY_FILE = ".projects.local.md";
const ARCHIVED_HEADER = "## Archived Projects";

function registryPath(projectsDir: string): string {
  return join(dirname(projectsDir), REGISTRY_FILE);
}

/** First cell of a markdown table row, or null for non-row / header / separator lines. */
function rowName(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const first = trimmed.split("|").map((c) => c.trim())[1] ?? "";
  if (!first || /^[-:]+$/.test(first) || first.toLowerCase() === "project") return null;
  return first;
}

/** End of the archived section: next `## ` heading or EOF. */
function sectionEnd(lines: string[], start: number): number {
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) return i;
  }
  return lines.length;
}

/**
 * Insert an active row for `name` after the last row of the first table above the archived
 * section, matching its column count. No-op when the name is already listed there or there is
 * no table. Returns whether a row was inserted.
 */
function insertActiveRow(lines: string[], name: string): boolean {
  const archStart = lines.findIndex((l) => l.trim() === ARCHIVED_HEADER);
  const limit = archStart === -1 ? lines.length : archStart;
  if (lines.some((l, i) => i < limit && rowName(l) === name)) return false;
  let headerIdx = -1;
  let insertAt = -1;
  let cols = 3;
  for (let i = 0; i < limit; i++) {
    if (!lines[i].trim().startsWith("|")) continue;
    if (headerIdx === -1) {
      headerIdx = i;
      cols = Math.max(lines[i].split("|").length - 2, 2);
    }
    insertAt = i + 1;
    if (i > headerIdx && !lines[i + 1]?.trim().startsWith("|")) break;
  }
  if (insertAt === -1) return false;
  const cells = Array.from({ length: cols }, (_, c) => (c === cols - 1 ? `\`projects/${name}/\`` : name));
  lines.splice(insertAt, 0, `| ${cells.join(" | ")} |`);
  return true;
}

export function markArchivedInRegistry(projectsDir: string, name: string): void {
  const path = registryPath(projectsDir);
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);

  let archStart = lines.findIndex((l) => l.trim() === ARCHIVED_HEADER);
  const activeLimit = archStart === -1 ? lines.length : archStart;
  const activeIdx = lines.findIndex((l, i) => i < activeLimit && rowName(l) === name);
  if (activeIdx !== -1) {
    lines.splice(activeIdx, 1);
    archStart = lines.findIndex((l) => l.trim() === ARCHIVED_HEADER);
  }

  const row = `| ${name} | \`projects/archived/${name}/\` |`;
  if (archStart === -1) {
    if (lines[lines.length - 1]?.trim() === "") lines.pop();
    lines.push(
      "",
      ARCHIVED_HEADER,
      "",
      "Located in `projects/archived/`. **Do not scan, index, or read without asking.**",
      "",
      "| Project | Path |",
      "|---------|------|",
      row,
      "",
    );
  } else {
    const end = sectionEnd(lines, archStart);
    const already = lines
      .slice(archStart, end)
      .some((l) => rowName(l) === name);
    if (already) {
      writeFileSync(path, lines.join(eol));
      return;
    }
    let insertAt = -1;
    for (let i = archStart + 1; i < end; i++) {
      if (lines[i].trim().startsWith("|")) insertAt = i + 1;
    }
    if (insertAt === -1) {
      lines.splice(archStart + 1, 0, "", "| Project | Path |", "|---------|------|", row);
    } else {
      lines.splice(insertAt, 0, row);
    }
  }
  writeFileSync(path, lines.join(eol));
}

export function markRestoredInRegistry(projectsDir: string, name: string): void {
  const path = registryPath(projectsDir);
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);

  const archStart = lines.findIndex((l) => l.trim() === ARCHIVED_HEADER);
  if (archStart !== -1) {
    const end = sectionEnd(lines, archStart);
    for (let i = archStart + 1; i < end; i++) {
      if (rowName(lines[i]) === name) {
        lines.splice(i, 1);
        break;
      }
    }
  }

  // Splicing above happens after archStart, so it can't shift the header index.
  insertActiveRow(lines, name);
  writeFileSync(path, lines.join(eol));
}

/**
 * Add an active row for a newly created project. A missing registry, a registry without a table
 * and a name already listed are all no-ops. Returns whether a row was written.
 */
export function addProjectToRegistry(projectsDir: string, name: string): boolean {
  const path = registryPath(projectsDir);
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  if (!insertActiveRow(lines, name)) return false;
  writeFileSync(path, lines.join(eol));
  return true;
}

/** Project names listed under `## Archived Projects`. A missing registry yields `[]`. */
export function readArchivedProjects(projectsDir: string): string[] {
  const path = registryPath(projectsDir);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const archStart = lines.findIndex((l) => l.trim() === ARCHIVED_HEADER);
  if (archStart === -1) return [];
  const names: string[] = [];
  for (let i = archStart + 1; i < sectionEnd(lines, archStart); i++) {
    const name = rowName(lines[i]);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Active project names from the registry — every table row above the archived section, in file
 * order. A missing registry yields `[]`.
 */
export function readActiveProjects(projectsDir: string): string[] {
  const path = registryPath(projectsDir);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const archStart = lines.findIndex((l) => l.trim() === ARCHIVED_HEADER);
  const limit = archStart === -1 ? lines.length : archStart;
  const names: string[] = [];
  for (let i = 0; i < limit; i++) {
    const name = rowName(lines[i]);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
