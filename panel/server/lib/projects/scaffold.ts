import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import { addProjectToRegistry } from "../registry";
import { renderIndexes } from "../wiki/index-md";
import { WIKI_GITIGNORE_LINES } from "../wiki/lock";
import type { ProjectKind } from "./kind";

/**
 * The project scaffold: the deterministic skeleton of a new project, the same for every entry
 * point (`scripts/project new`, `/pavilio-new-project`, `/pavilio-wiki-research`).
 *
 * | kind      | creates                                                                  |
 * | --------- | ------------------------------------------------------------------------ |
 * | project   | `PROJECT.md`, `STATUS.md`, `progress/`, `wiki/` skeleton, registry row   |
 * | research  | the same, plus `topic`/`created` frontmatter, `spikes/`, `wiki/raw/`     |
 * | knowledge | `PROJECT.md`, `wiki/` skeleton, registry row                             |
 *
 * A folder that exists without `PROJECT.md` (notes waiting for a card) only gets the parts it
 * lacks: an existing file is never rewritten, and an existing dir gets no `.gitkeep`.
 */

export type ScaffoldInput = { projectsDir: string; name: string; kind: ProjectKind; topic?: string; today: string };
export type ScaffoldResult =
  | { ok: true; created: string[] } // project-relative paths written
  | { ok: false; ask: true; reason: "exists" | "archived" };

/** A plain dir name: no separators, no dot segments, not the archive dir itself. */
export function isValidProjectName(name: string): boolean {
  return !!name && name !== "." && !name.includes("..") && !/[/\\]/.test(name) && name !== "archived" && name.trim() === name;
}

function projectCard(input: ScaffoldInput): string {
  const { name, kind, topic, today } = input;
  const frontmatter = [`kind: ${kind}`];
  if (kind === "research") {
    // JSON string = a double-quoted YAML scalar, safe for any topic text.
    frontmatter.push(`topic: ${JSON.stringify(topic ?? "")}`, `created: ${today}`);
  }
  const overview =
    kind === "research"
      ? `Research project: ${topic ?? "[topic]"}. External material lives in \`wiki/raw/\`, throwaway code in \`spikes/<slug>/\`.`
      : kind === "knowledge"
        ? "Workspace-wide knowledge: generic findings promoted from project wikis."
        : "[2-3 sentences: what the project is, for whom, where Greg fits.]";
  const seeAlso =
    kind === "knowledge"
      ? ["- [wiki/overview.md](./wiki/overview.md) — wiki entry page"]
      : [
          "- [STATUS.md](./STATUS.md) — current focus, open questions, active team (volatile, rewritten per meeting)",
          "- [wiki/overview.md](./wiki/overview.md) — wiki entry page",
        ];
  const lines = ["---", ...frontmatter, "---", `# ${name}`, "", `> Last updated: ${today} · scaffold`, "", "## Overview", "", overview, ""];
  if (kind !== "knowledge") {
    lines.push(
      "## Repositories & working rules",
      "",
      "| Repo | Path | Remote | Notes |",
      "| ---- | ---- | ------ | ----- |",
      "",
      "## Technology Stack",
      "",
    );
  }
  lines.push("## See also", "", ...seeAlso, "");
  return lines.join("\n");
}

function statusCard(input: ScaffoldInput): string {
  return [
    `# ${input.name} — Status`,
    "",
    `> Last updated: ${input.today} · scaffold`,
    "",
    "## Current Focus",
    "",
    "## Open Questions / Blockers",
    "",
    "## Recent Decisions",
    "",
    "## Team (active)",
    "",
    "| Name | Role | Current focus |",
    "| ---- | ---- | ------------- |",
    "",
  ].join("\n");
}

function wikiOverview(input: ScaffoldInput): string {
  const about = input.kind === "research" && input.topic ? `Research into ${input.topic}.` : `The ${input.name} wiki.`;
  return [
    "---",
    "type: overview",
    `title: ${JSON.stringify(`${input.name} wiki overview`)}`,
    `description: ${JSON.stringify(`Entry page for the ${input.name} wiki`)}`,
    `created: ${input.today}`,
    `updated: ${input.today}`,
    "---",
    `# ${input.name}`,
    "",
    `${about} No pages yet — ingest records or material to grow it.`,
    "",
  ].join("\n");
}

const OPEN_QUESTIONS = [
  "---",
  "type: open-questions",
  'description: "Gaps the wiki could not answer and knowledge waiting for a home"',
  "---",
  "# Open questions",
  "",
  "## Gaps",
  "",
  "## Knowledge candidates",
  "",
].join("\n");

function emptyIndex(): string {
  const rendered = renderIndexes([]);
  if (!rendered.ok) throw new Error(rendered.error);
  return rendered.files.get("index.md") ?? "";
}

/** Files (project-relative path → content) and dirs that carry a `.gitkeep` when created. */
function skeleton(input: ScaffoldInput): { files: [string, string][]; keptDirs: string[] } {
  const files: [string, string][] = [["PROJECT.md", projectCard(input)]];
  const keptDirs: string[] = [];
  if (input.kind !== "knowledge") {
    files.push(["STATUS.md", statusCard(input)]);
    keptDirs.push("progress");
  }
  if (input.kind === "research") keptDirs.push("spikes");
  files.push(
    ["wiki/index.md", emptyIndex()],
    ["wiki/overview.md", wikiOverview(input)],
    ["wiki/log.md", ""],
    ["wiki/open-questions.md", OPEN_QUESTIONS],
    ["wiki/.gitignore", WIKI_GITIGNORE_LINES.join("\n") + "\n"],
  );
  keptDirs.push("wiki/sources", "wiki/entities", "wiki/concepts");
  if (input.kind === "research") keptDirs.push("wiki/raw");
  return { files, keptDirs };
}

/**
 * Create the skeleton of project `name` under `projectsDir` and add its registry row. Asks (writes
 * nothing) when the project already has a card or the name is taken under `archived/`. Throws on
 * an unsafe name.
 */
export function scaffoldProject(input: ScaffoldInput): ScaffoldResult {
  const { projectsDir, name } = input;
  if (!isValidProjectName(name)) throw new Error(`invalid project name: ${JSON.stringify(name)}`);
  const projectDir = join(projectsDir, name);
  if (existsSync(join(projectDir, "PROJECT.md"))) return { ok: false, ask: true, reason: "exists" };
  if (existsSync(join(projectsDir, "archived", name))) return { ok: false, ask: true, reason: "archived" };

  const { files, keptDirs } = skeleton(input);
  const created: string[] = [];
  // Dirs first: whether a dir pre-existed decides its `.gitkeep`, before files land in it.
  for (const dir of keptDirs) {
    const abs = join(projectDir, dir);
    if (existsSync(abs)) continue;
    mkdirSync(abs, { recursive: true });
    writeFileSync(join(abs, ".gitkeep"), "");
    created.push(`${dir}/.gitkeep`);
  }
  for (const [rel, content] of files) {
    const abs = join(projectDir, rel);
    if (existsSync(abs)) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    created.push(rel);
  }
  addProjectToRegistry(projectsDir, name);
  return { ok: true, created: created.sort() };
}
