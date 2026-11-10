# Architecture

How the workspace is put together: the panel, the skills and scripts around it,
and the project data they all work on.

## The pieces

A workspace is one git repository with the framework at its root and your own
data under `projects/`:

- **`panel/`** — the local web panel, one Node process (Node 22 or newer) serving
  both the API and the UI on one port (3010 by default):
  - `panel/server/` — the Express API: `routes/` (one router per area — projects,
    files, git, terminals, speech, time, …), `lib/` (discovery, the file index, the
    terminal manager on `node-pty`, preferences, sync, the wiki and project CLIs),
    `watcher.ts` (chokidar file watching, pushed to the browser over a WebSocket).
    `index.ts` is the production entry and serves the prebuilt bundle;
    `dev.ts` mounts Vite in middleware mode for `pnpm dev`.
  - `panel/src/` — the Vite + React 19 UI, one folder per feature under
    `src/features/` (terminal, projects, git, speech, time, explorer, …).
  - `panel/help/` — the [panel guide](../panel/help/panel-guide.md), opened from
    the panel's sidebar.
- **`skills/`** — the agent skills, one `skills/<name>/SKILL.md` each. The panel
  lists them in its right sidebar; the setup scripts install them as slash
  commands for each agent — see [Agents](agents.md).
- **`scripts/`** — the shell entry points: `bootstrap`, `panel`
  (start/stop/restart/status), `update.sh` (`pnpm sync`), `pull`, the
  `setup:*` and `install:*` installers, the `ccl` / `oc` agent wrappers, and the
  `project` and `wiki` CLIs that skills call (thin wrappers that run the
  TypeScript under `panel/server/lib/` with the panel's own `tsx`).
- **`projects/`** — your notes, one folder per project. The panel discovers a
  project by its `PROJECT.md`; a project's `repos.json` links the code
  repositories it works on, which live elsewhere on disk.

## Notes world and repo world

The panel draws a hard line between two kinds of files:

- **Notes world** — everything under `projects/`. The panel owns it: it reads,
  writes, watches, moves and renames files here freely, because nothing outside
  the panel tracks those paths.
- **Repo world** — everything inside a linked repository. The panel only reads
  here, and writes go through `git` (commit, pull). It never moves or renames a
  file in repo world, because a plain filesystem rename would silently divorce a
  tracked file from its git history.

The reasoning, and what would have to change to lift the rule, is in
[ADR 0001](adr/0001-notes-world-vs-repo-world.md). The vocabulary — workspace,
project, linked repository, toolbox — is defined in
[`CONTEXT.md`](../CONTEXT.md).

## Project Structure

```
my-workspace/
├── panel/               # Local web dashboard (Vite + React + Express)
├── projects/            # Your project data (auto-discovered)
│   └── my-project/
│       ├── PROJECT.md   # Stable resume card (required for discovery)
│       ├── STATUS.md    # Volatile state, written by pavilio-note/bootstrap (not needed for discovery)
│       ├── DECISIONS.md # Key decisions
│       ├── _index.json  # Machine-readable index
│       ├── repos.json   # Linked code repositories (optional)
│       ├── notes/       # Meeting notes
│       │   └── log/     # Raw transcripts
│       ├── progress/    # Session progress tracking
│       ├── plans/       # OpenSpec changes and specs (plans/openspec/)
│       ├── memo/        # Memos
│       ├── wiki/        # The project's LLM wiki
│       └── time/        # Time tracking, one file per machine
├── skills/              # Agent skills (skills/<name>/SKILL.md)
├── commands/            # Extra slash-command definitions
├── scripts/             # Utility scripts (bootstrap, panel, ccl, oc, etc.)
├── docs/                # Documentation
├── AGENTS.md            # Agent instructions
└── CLAUDE.md            # Claude Code configuration
```

A new project gets `PROJECT.md`, `STATUS.md`, `progress/` and a `wiki/` skeleton
from the New Project dialog or `scripts/project new <name>`; the other files and
folders appear as the skills that write them are used.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vite 8 + React 19 + TypeScript |
| API server | Express 5 |
| Real-time | WebSocket (`ws`) |
| Terminals | xterm.js + node-pty |
| Image optimization | sharp |
| Fuzzy search | fuse.js |
| Markdown rendering | react-markdown |
| Diagrams | Mermaid |
| File watching | chokidar |
| Styling | Tailwind CSS 4 |
| Tests | Vitest |
