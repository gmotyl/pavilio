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

**Toolbox**:
Workspace-level user-owned directories that hold tooling rather than notes: `skills/`, `commands/`, `.claude/commands/`, `.opencode/commands/`, `panel/`, `scripts/`. Same mutation policy as **Notes world** — the user owns these and the panel edits them freely (create, rename, drag, delete). Distinct from **Notes world** in one way only: `pnpm pull` may add or refresh files here from upstream pavilio, while leaving local-only files alone. The merge contract (which files are upstream-tracked vs local) is captured separately in a forthcoming ADR.
_Avoid_: framework world (implies read-only), config dirs (too generic)

**Panel**:
The Vite + React + Express app at `panel/` that the workspace runs locally. Single user, no multi-tenancy. Served at `http://localhost:3010` and optionally over LAN.
_Avoid_: UI, dashboard, app

**Section**:
A conventional subfolder of a project — `notes/`, `progress/`, `plans/`, `memo/`, `qa/`. The panel renders each section as its own list with section-specific UI rules (e.g. `qa/` shows `run.md` folder names; `plans/` overlays the active-plans banner).
_Avoid_: subfolder (use when speaking generically), category, tab

**Active plan**:
A plan file path listed in `projects/<name>/plans/CURRENT.md`. Multiple lines = multiple in-progress plans. The panel surfaces these prominently on the project view so agents resume in the right place.
_Avoid_: open plan, current plan (file is `CURRENT.md`, but the concept is "active")

**Overview script**:
A configured button on a project's Overview tab that runs a workspace shell script (`scripts/*.sh`) against the current project. Defined as one entry in the workspace `scripts/scripts.json`. Scoped to one **Project** at a time.
_Avoid_: action button (too generic), task (overloaded with Todoist), workflow.

**Scripts config**:
The workspace-level JSON file at `scripts/scripts.json`. Lists every **Overview script** with its label, description, target script path, and optional `outputMatch` / `timeoutSec` / `icon`. Ships in pavilio upstream; pulled to user workspaces via `scripts/update.sh`.
_Avoid_: scripts manifest, scripts registry.

**Manual entry**:
A user-entered time record on a **Project**'s Time tab: duration, date, optional note. The chargeable source of truth. Persisted as a JSONL line of `type: "manual"` under `projects/<name>/time/<hostname>.jsonl`. Editable and deletable from the entries list.
_Avoid_: time entry (ambiguous with busy block), time log.

**Busy block**:
A 15-minute coverage window opened by the panel's auto-tracker when one of a **Project**'s terminals stays `busy` for at least 10 continuous seconds (see [ADR 0003](docs/adr/0003-busy-debounce-threshold.md)). Persists as a JSONL line of `type: "busy_block"`. Surfaces only as a *reference* number in the "Auto-tracked" hero figure — it does NOT appear in the entries list, and it does NOT appear in exported reports. The user reads it and decides how many minutes to log as a **Manual entry**.
_Avoid_: auto-tracked entry (the row never appears in the user-facing list), busy slot, billable block.

**Time bucket**:
A `YYYY-MM-DD` local-date string used to group **Manual entries** and **Busy blocks** for daily totals and reports. Always local time, never UTC, because the user works on a single machine and "yesterday's evening" is yesterday's bucket regardless of UTC offset.
_Avoid_: date string (ambiguous, used everywhere), report day.

**Preamble**:
The DEC private mode state (alt screen, mouse tracking, bracketed paste) the server replays to a client when it attaches to a live session. Those bytes are emitted once at TUI startup and never again, so without the preamble a reconnecting xterm gets the wrong screen buffer and scroll/clicks break. Carried by `getModePreamble` / `terminal-mode-state.ts`. Restores *modes*, not screen contents.
_Avoid_: mode replay (collides with **Replay**), init sequence, header.

**Nudge**:
A double SIGWINCH (`cols-1 → cols`) the server fires at a TUI to prompt it to repaint its visible screen for a freshly-attached client. A heuristic — works only for TUIs that redraw on resize, never for plain shells, and a TUI may coalesce the two signals into a no-op. From `nudgeSession`. Restores a TUI's *screen* by asking the TUI to redraw it.
_Avoid_: resize hack, repaint, SIGWINCH (the mechanism, not the concept).

**Replay**:
A serialized screen + scrollback snapshot the server sends a client on attach, before live bytes, reconstructed from a per-session headless `@xterm/headless` terminal and `@xterm/addon-serialize` (see [ADR 0004](docs/adr/0004-headless-xterm-replay-on-reconnect.md)). Unlike **Nudge**, it restores exact contents for both TUIs *and* plain shells without the cooperation of the running program. Prefixed with a full reset; sent after the client's first **resize** so dimensions match.
_Avoid_: replay (lowercase, ambiguous with WS message replay), restore, snapshot (overloaded with buffer snapshot).

## Relationships

- A **Workspace** owns many **Projects**
- A **Project** owns its **Notes world** subtree and references zero or more **Linked repositories**
- A **Linked repository** is **Repo world** — read-only to the panel's filesystem mutations
- A **Project** is composed of **Sections**; each section is one **Notes world** subfolder
- An **Active plan** is a **Notes world** file path advertised through `plans/CURRENT.md`
- The **Scripts config** defines a list of **Overview scripts**; the **Panel** renders one button per entry on every **Project**'s Overview tab.
- The **Workspace** also contains the **Toolbox** — workspace-level tooling directories that the **Panel** edits with the same mutation policy as **Notes world**, but that `pnpm pull` may merge from upstream pavilio.
- A **Project**'s **Time bucket** for a given day contains zero or more **Manual entries** (chargeable) and zero or more **Busy blocks** (reference only). Exports include manual entries only.
- When a client attaches to a session, the **Panel** server sends three things in order: the **Preamble** (modes), then the **Replay** (screen + scrollback), then live PTY bytes. The **Nudge** is a legacy fallback that asks a TUI to redraw its own screen; **Replay** supersedes it for both TUIs and plain shells.

## Example dialogue

> **User:** "I want to drag files in the panel. Should it work on the code in my linked repos?"
> **Domain expert:** "No — only in the **Notes world**. Moving a tracked file in **Repo world** would need `git mv` semantics to preserve history; the panel doesn't do that yet."

## Flagged ambiguities

- "workspace" was used for both the user's fork and the in-app concept of a project — resolved: **Workspace** is the fork; **Project** is the folder under it.
- "repo" was used both for the project folder and for the linked code repository — resolved: **Project** is the notes folder; **Linked repository** is the external git worktree.
