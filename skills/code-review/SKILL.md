---
name: code-review
description: Two-axis review (Standards + Spec) of the diff between HEAD and a fixed point, using the project's documented standards (PROJECT.md, CONTEXT.md, qa/REVIEW_RULES.md, ADRs) and the originating spec. Use when the user wants to review a branch, PR, or work-in-progress, or asks to "review since X".
---

# Code Review

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards** — does the code conform to this repo's + project's documented standards?
- **Spec** — does the code faithfully implement the originating issue / PRD / spec?

Both axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings.

## Process

### 1. Resolve the project

Determine the project name (in order):

1. An explicit argument the user passed.
2. The current working directory — if under a repo associated with a project, or if `pwd` ends in `projects/<name>`.
3. Ask the user which project if ambiguous.

Read, if present:

- `projects/<name>/PROJECT.md` — overview, repos, conventions.
- `projects/<name>/CONTEXT.md` — domain glossary, project-specific terms.

### 2. Pin the fixed point

Whatever the user said is the fixed point — a commit SHA, branch, tag, `main`, `HEAD~5`, etc. Pass it through; don't be opinionated. If they didn't specify one, ask: "Review against what — a branch, a commit, or `main`?" Don't proceed until you have it.

Capture once: `git diff <fixed-point>...HEAD` (three-dot, against the merge-base) and the commit list via `git log <fixed-point>..HEAD --oneline`.

### 3. Identify the standards sources

Collect every file that documents how code should be written for this project:

- `projects/<name>/qa/REVIEW_RULES.md` — **project-specific review rules** (conventions, preferred libraries, patterns, anti-patterns). Primary source.
- `projects/<name>/PROJECT.md`, `projects/<name>/CONTEXT.md`.
- Repo-level `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `STYLE.md` / `STANDARDS.md` / `STYLEGUIDE.md`.
- `docs/adr/` (architectural decisions are standards).
- `.editorconfig`, `eslint.config.*`, `biome.json`, `prettier.config.*`, `tsconfig.json` — machine-enforced; **note them but don't re-check what tooling already enforces**.

### 4. Identify the spec source (optional)

Look for the originating spec, in order:

1. Issue references in commit messages (`#123`, `Closes #45`, GitLab `!67`).
2. A path the user passed as an argument.
3. A PRD/spec/plan under `docs/`, `specs/`, or `projects/<name>/plans/` matching the branch/feature.
4. If nothing is found, ask the user. If they say there is none, the **Spec** sub-agent is skipped and the report notes "no spec available".

### 5. Spawn both sub-agents in parallel

Send a single message with two `Agent` tool calls (general-purpose subagent for both).

**Standards sub-agent prompt** — include:

- The full diff command and commit list.
- The list of standards-source files from step 3.
- The brief: "Read the standards docs (especially `qa/REVIEW_RULES.md`). Then read the diff. Report — per file/hunk where relevant — every place the diff violates a documented standard. Cite the standard (file + rule). Distinguish hard violations from judgement calls. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent prompt** — include:

- The diff command and commit list.
- The path or fetched contents of the spec.
- The brief: "Read the spec. Then read the diff. Report: (a) requirements asked for but missing/partial; (b) behaviour not asked for (scope creep); (c) requirements implemented but apparently wrong. Quote the spec line per finding. Under 400 words."

If the spec is missing, skip the Spec sub-agent and note it.

### 6. Aggregate

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank — the two axes are deliberately separate. End with a one-line summary: total findings per axis, and the single worst issue flagged.

## Why two axes

A change can pass one axis and fail the other:

- Follows every standard but implements the wrong thing → Standards pass, Spec fail.
- Does exactly what the issue asked but breaks conventions → Spec pass, Standards fail.

Reporting them separately stops one axis from masking the other.
