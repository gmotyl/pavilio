---
name: pavilio-code-review
description: Two-axis review (Standards + Spec) of the diff between HEAD and a fixed point, using the project's documented standards (PROJECT.md, CONTEXT.md, qa/REVIEW_RULES.md, ADRs) and the originating spec. Use when the user wants to review a branch, PR, or work-in-progress, asks to "review since X", or as the branch-level review step at the end of [[pavilio-execute-plan]].
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

**Validate it as a git ref before using it in any command.** The fixed point is user-supplied and gets interpolated into shell commands, so confirm it resolves first: run `git rev-parse --verify --quiet "<fixed-point>^{commit}"`. If that prints nothing (non-zero exit), the ref is invalid — stop and ask the user to clarify. Never pass an unvalidated or shell-unsafe string (spaces, `;`, `|`, `$(...)`, backticks) into the diff/log commands.

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

Each sub-agent must return findings as a **table**, one row per finding, using this shared status vocabulary so the aggregate reads at a glance:

| Emoji | Status | Meaning |
|-------|--------|---------|
| 🔴 | HARD | Blocking — a documented rule is violated / a requirement is wrong or missing. Must fix (or explicitly defer with a ticket). |
| 🟡 | JUDGEMENT | Debatable or non-blocking concern; worth a human decision. |
| 💡 | NIT | Cosmetic / optional. |
| ✅ | PASS | Checked and correct — include the notable ones so the reader sees what was verified, not just what failed. |

Sub-agents return **only the table** (rows sorted 🔴 → 🟡 → 💡 → ✅), no prose preamble. Keep each `Finding` cell to one tight sentence; put the file:line in `Location`.

**Standards sub-agent prompt** — include:

- The full diff command and commit list.
- The list of standards-source files from step 3.
- The brief: "Read the standards docs (especially `qa/REVIEW_RULES.md`), then the diff. Emit a markdown table with columns `| Status | Area | Finding | Location | Reference |` — one row per check, `Status` one of 🔴/🟡/💡/✅, `Reference` citing the standard (file + rule). Cover every place the diff violates a documented standard **and** the notable things it got right (✅). Skip anything tooling enforces. Rows sorted 🔴→🟡→💡→✅. Table only, no prose. Under 400 words."

**Spec sub-agent prompt** — include:

- The diff command and commit list.
- The path or fetched contents of the spec.
- The brief: "Read the spec, then the diff. Emit a markdown table with columns `| Status | Kind | Finding | Location | Spec ref |` where `Kind` is one of `missing`, `scope-creep`, `wrong`, or `ok`, `Status` one of 🔴/🟡/💡/✅, and `Spec ref` quotes/cites the spec line. Include ✅ rows confirming the requirements that ARE correctly implemented. Rows sorted 🔴→🟡→💡→✅. Table only, no prose. Under 400 words."

If the spec is missing, skip the Spec sub-agent and note it.

### 6. Aggregate

Render one scannable report. Do **not** merge or rerank across axes — Standards and Spec stay separate — but present each as its sub-agent's table.

```
## 🔎 Code review — <branch> vs <fixed-point> (<N> commits, <M> files)

🔴 hard · 🟡 judgement · 💡 nit · ✅ pass

### Standards
<Standards table>

### Spec
<Spec table, or "_No spec available — Spec axis skipped._">

### Verdict
| Axis | 🔴 | 🟡 | 💡 |
|------|----|----|----|
| Standards | n | n | n |
| Spec | n | n | n |

**Worst issue:** <one line — the single most important 🔴, with the fix.>
**Recommendation:** <ship / ship-with-follow-up-ticket / fix-first>
```

If there are zero 🔴/🟡/💡 on an axis, still show the table (all ✅) so the reader sees it was actually reviewed.

## Why two axes

A change can pass one axis and fail the other:

- Follows every standard but implements the wrong thing → Standards pass, Spec fail.
- Does exactly what the issue asked but breaks conventions → Spec pass, Standards fail.

Reporting them separately stops one axis from masking the other.
