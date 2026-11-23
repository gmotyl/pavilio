import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import { addProjectToRegistry } from "../registry";
import { assertContainedDir, isDanglingLink } from "../wiki/contained-dir";
import { KNOWLEDGE_PROJECT, knowledgeTargetsIn } from "../wiki/harvest";
import { renderIndexes } from "../wiki/index-md";
import { WIKI_GITIGNORE_LINES } from "../wiki/lock";
import { GROUP_NAME_MAX, parseGroupName, rewriteGroup } from "./group";
import type { ProjectKind } from "./kind";
import { isValidProjectSlug } from "./slug";

/**
 * The project scaffold: the deterministic skeleton of a new project, the same for every entry
 * point (`scripts/project new`, `/pavilio-new-project`, `/pavilio-wiki-research`).
 *
 * | kind      | creates                                                                  |
 * | --------- | ------------------------------------------------------------------------ |
 * | project   | `PROJECT.md`, `STATUS.md`, `progress/`, `wiki/` skeleton, registry row   |
 * | research  | the same, plus `topic`/`created` frontmatter and `wiki/raw/`             |
 * | knowledge | `PROJECT.md`, `wiki/` skeleton, registry row                             |
 *
 * A `group` adds `group: <group>` to the card frontmatter of any kind; a grouped knowledge
 * project is that group's wiki, and its overview line says so.
 *
 * A folder that exists without `PROJECT.md` (notes waiting for a card) only gets the parts it
 * lacks: an existing file is never rewritten, and an existing dir gets no `.gitkeep`. Research code
 * lives in the spikes repo (`scripts/project spike-repo`), not in the project folder; a legacy
 * `spikes/` dir is left as it is.
 */

export type ScaffoldInput = {
  projectsDir: string;
  name: string;
  kind: ProjectKind;
  topic?: string;
  group?: string;
  today: string;
};
export type ScaffoldResult =
  | { ok: true; created: string[] } // project-relative paths written
  | { ok: false; ask: true; reason: "exists" | "archived" };

function projectCard(input: ScaffoldInput): string {
  const { name, kind, topic, today } = input;
  const group = input.group?.trim();
  const frontmatter = [`kind: ${kind}`];
  if (kind === "research") {
    // JSON string = a double-quoted YAML scalar, safe for any topic text.
    frontmatter.push(`topic: ${JSON.stringify(topic ?? "")}`, `created: ${today}`);
  }
  const overview =
    kind === "research"
      ? `Research project: ${topic ?? "[topic]"}. External material lives in \`wiki/raw/\`, code in the spikes repo (\`scripts/project spike-repo ${name}\`).`
      : kind === "knowledge"
        ? group
          ? `Group knowledge for ${group}: findings shared by its projects, promoted from their wikis.`
          : "Workspace-wide knowledge: generic findings promoted from project wikis."
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
  const card = lines.join("\n");
  return group ? rewriteGroup(card, group) : card;
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

/** A grouped non-knowledge project also collects group-scoped findings; a group wiki does not. */
function openQuestions(input: ScaffoldInput): string {
  const grouped = Boolean(input.group?.trim()) && input.kind !== "knowledge";
  return [
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
    ...(grouped ? ["## Group candidates", ""] : []),
  ].join("\n");
}

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
  files.push(
    ["wiki/index.md", emptyIndex()],
    ["wiki/overview.md", wikiOverview(input)],
    ["wiki/log.md", ""],
    ["wiki/open-questions.md", openQuestions(input)],
    ["wiki/.gitignore", WIKI_GITIGNORE_LINES.join("\n") + "\n"],
  );
  keptDirs.push("wiki/sources", "wiki/entities", "wiki/concepts");
  if (input.kind === "research") keptDirs.push("wiki/raw");
  return { files, keptDirs };
}

/**
 * Refuse (throw, before anything is written) when the project dir, a dir the skeleton writes
 * through, or a skeleton file is a symlink or resolves outside `projectsDir` — `mkdirSync` and
 * `writeFileSync` would follow it and scaffold outside the workspace.
 */
function assertWritable(projectsDir: string, name: string, files: [string, string][], keptDirs: string[]): void {
  const dirs = new Set(["", ...keptDirs, ...files.map(([rel]) => dirname(rel))]);
  for (const dir of dirs) {
    assertContainedDir(projectsDir, [name, ...dir.split("/").filter((s) => s && s !== ".")]);
  }
  for (const [rel] of files) {
    if (isDanglingLink(join(projectsDir, name, rel)) && !existsSync(join(projectsDir, name, rel))) {
      throw new Error(`refusing a symlinked ${name}/${rel}`);
    }
  }
}

/**
 * Refuse a knowledge project whose harvest target is taken — `knowledge` for no group, one wiki
 * per group: a second one makes `scripts/wiki targets` ambiguous and blocks every harvest.
 */
function assertFreeKnowledgeTarget(projectsDir: string, group: string | null): void {
  const targets = knowledgeTargetsIn(projectsDir);
  const taken = group === null ? targets.global : (targets.groups[group] ?? null);
  if (taken === null) return;
  throw new Error(
    group === null
      ? `the workspace already has its ungrouped knowledge wiki: ${taken}`
      : `group ${group} already has a knowledge wiki: ${taken}`,
  );
}

/**
 * Create the skeleton of project `name` under `projectsDir` and add its registry row. Asks (writes
 * nothing) when the project already has a card or the name is taken under `archived/`. Throws on
 * a name that is not a slug, on a research project without a topic, on an empty or over-long
 * group, on a grouped `knowledge`, and on a knowledge project whose harvest target (the
 * ungrouped one, or its group's) already exists.
 */
export function scaffoldProject(input: ScaffoldInput): ScaffoldResult {
  const { projectsDir, name } = input;
  if (!isValidProjectSlug(name)) throw new Error(`invalid project name: ${JSON.stringify(name)}`);
  if (input.kind === "research" && !input.topic?.trim()) {
    throw new Error("a topic is required for research projects (--topic \"…\")");
  }
  if (input.group !== undefined && !input.group.trim()) throw new Error("--group must not be empty");
  if (input.group !== undefined && parseGroupName(input.group) === undefined) {
    throw new Error(`--group must be one line of at most ${GROUP_NAME_MAX} characters`);
  }
  if (name === KNOWLEDGE_PROJECT && input.group !== undefined) {
    throw new Error(`${KNOWLEDGE_PROJECT} is the workspace-wide knowledge wiki and takes no --group`);
  }
  const projectDir = join(projectsDir, name);
  if (existsSync(join(projectDir, "PROJECT.md"))) return { ok: false, ask: true, reason: "exists" };
  if (existsSync(join(projectsDir, "archived", name))) return { ok: false, ask: true, reason: "archived" };
  if (input.kind === "knowledge") assertFreeKnowledgeTarget(projectsDir, input.group?.trim() || null);

  const { files, keptDirs } = skeleton(input);
  assertWritable(projectsDir, name, files, keptDirs);
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
