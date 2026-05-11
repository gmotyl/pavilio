# Pavilio

The control room for AI coding agents. A local web panel that helps users orchestrate notes, plans, progress tracking, and git activity across multiple projects, each of which can link to one or more code repositories.

## Language

**Workspace**:
A user's fork of `gmotyl/pavilio`. Contains the framework (panel, scripts, commands) at the root and the user's private project data under `projects/`. Updates to the framework arrive via `scripts/update.sh`.
_Avoid_: fork, instance

**Project**:
A folder under `projects/<name>/` that groups notes, plans, progress entries, and a list of linked code repositories for one body of work.
_Avoid_: workspace (means the fork), folder, directory

**Linked repository**:
A git worktree referenced from a project's `repos.json`. The repository lives outside `projects/` (typically under `~/git/...`). The project does not own its source.
_Avoid_: repo of a project, child repo, sub-repo

**Notes world**:
Everything under `projectsDir` (the workspace's `projects/` folder). The panel owns reads, writes, and the file watcher here. Single root, single path-traversal guard. Filesystem mutations are safe — no external history to preserve.
_Avoid_: notes folder, project files (ambiguous), workspace data

**Repo world**:
Everything inside a linked repository. The panel only reads from here, and writes go through `git` (commit, pull). Filesystem mutations would silently rewrite git history, so the panel does not move or rename files in repo world.
_Avoid_: code world, source files, project repos

**Panel**:
The Vite + React + Express app at `panel/` that the workspace runs locally. Single user, no multi-tenancy. Served at `http://localhost:3010` and optionally over LAN.
_Avoid_: UI, dashboard, app

**Section**:
A conventional subfolder of a project — `notes/`, `progress/`, `plans/`, `memo/`, `qa/`. The panel renders each section as its own list with section-specific UI rules (e.g. `qa/` shows `run.md` folder names; `plans/` overlays the active-plans banner).
_Avoid_: subfolder (use when speaking generically), category, tab

**Active plan**:
A plan file path listed in `projects/<name>/plans/CURRENT.md`. Multiple lines = multiple in-progress plans. The panel surfaces these prominently on the project view so agents resume in the right place.
_Avoid_: open plan, current plan (file is `CURRENT.md`, but the concept is "active")

## Relationships

- A **Workspace** owns many **Projects**
- A **Project** owns its **Notes world** subtree and references zero or more **Linked repositories**
- A **Linked repository** is **Repo world** — read-only to the panel's filesystem mutations
- A **Project** is composed of **Sections**; each section is one **Notes world** subfolder
- An **Active plan** is a **Notes world** file path advertised through `plans/CURRENT.md`

## Example dialogue

> **User:** "I want to drag files in the panel. Should it work on the code in my linked repos?"
> **Domain expert:** "No — only in the **Notes world**. Moving a tracked file in **Repo world** would need `git mv` semantics to preserve history; the panel doesn't do that yet."

## Flagged ambiguities

- "workspace" was used for both the user's fork and the in-app concept of a project — resolved: **Workspace** is the fork; **Project** is the folder under it.
- "repo" was used both for the project folder and for the linked code repository — resolved: **Project** is the notes folder; **Linked repository** is the external git worktree.
