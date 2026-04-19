# Pavilio

> A dashboard for the AI coding agents running on your machine.

Pavilio is an AI-assisted multi-project workspace with a local web panel. It's a starter kit for
managing multiple projects with AI coding agents — view notes, track agent activity, manage git,
and search across project knowledge, all from one local dashboard. Fork it, configure it, and
start working.

**Local-first. Agent-agnostic. Open source.**

- Website: [pavilio.ai](https://pavilio.ai)
- Docs: [pavilio.motyl.dev](https://pavilio.motyl.dev)
- Formerly `motyl-ai-workflow` (renamed 2026-04-19 — see [rename notice](https://github.com/gmotyl/motyl-ai-workflow))

## Features

- **Dashboard** with auto-discovered project cards (reads `PROJECT.md` from each project folder)
- **Markdown viewer** with direct Open in VS Code integration
- **Cmd+P fuzzy file finder** + semantic search via `qmd`
- **AI agent monitoring** — live sidebar showing Claude Code, OpenCode, and Qwen sessions
- **Git panel** — status, stage, commit, and push with smart commit message templates
- **Image optimization** — drag and drop images, auto-converted to WebP via sharp
- **Real-time updates** via WebSocket (file changes reflect instantly)
- **Three-column layout** — agents sidebar, content area, file tree

## Recommended Skills — Superpowers

This workflow is designed to work with **[Superpowers](https://github.com/obra/superpowers)** — a set of AI agent skills that enforce structured brainstorming, planning, and execution workflows. Installing Superpowers transforms your AI agent from a code autocompleter into a disciplined engineering partner.

### Install

Follow the instructions at **https://github.com/obra/superpowers**

### Key Skills

| Skill | When to Use |
|-------|------------|
| `superpowers:brainstorming` | Before any implementation — collaborative design with approval gate |
| `superpowers:writing-plans` | Turn approved designs into detailed step-by-step plans |
| `superpowers:executing-plans` | Task-by-task plan execution with review checkpoints |
| `superpowers:requesting-code-review` | After completing a feature or task |
| `superpowers:systematic-debugging` | When tracing bugs methodically |

### Session Workflow

```
resume [project]
  → superpowers:brainstorming  (design before coding)
  → superpowers:writing-plans  (turn design into tasks)
  → superpowers:executing-plans (build task by task)
  → end-session                (commit progress, propose todos)
```

Skills are optional — the panel and scripts work without them — but they make the biggest difference in the quality and consistency of AI-assisted work.

## Quick Start

Two ways to use this:

### Option A — Fork and own it (Recommended)

Like `create-react-app` used to be — fork once, make it yours, evolve it however you want. No upstream dependency.

```bash
# Fork this repo on GitHub, then:
git clone git@github.com:YOUR_USERNAME/pavilio.git my-workspace
cd my-workspace

# Configure the panel
cp panel/panel.config.ts panel/panel.config.local.ts
# Edit panel.config.local.ts with your paths

# Set up your private project registry
cp AGENTS.md.example .projects.local.md
# Edit .projects.local.md with your actual projects

# Start the panel
cd panel && npm install && npm run dev
# Open http://localhost:3010
```

You own the code. Customize freely. If you want to pull in future improvements from this repo, do it manually by cherry-picking what's useful.

### Option B — Track upstream (recommended for teams)

Keep your private workspace in sync with this repo. New panel features, scripts, and commands flow in automatically.

```bash
# Clone both repos into the same parent directory
git clone git@github.com:gmotyl/pavilio.git   # the upstream
git clone git@github.com:YOUR_USERNAME/my-workspace.git  # your private repo
cd my-workspace

# Set up private config
cp ../pavilio/AGENTS.md.example .projects.local.md
# Edit .projects.local.md with your actual projects

cp panel/panel.config.ts panel/panel.config.local.ts
# Edit panel.config.local.ts with your paths

# Start the panel
cd panel && npm install && npm run dev
```

To pull the latest improvements from upstream:

```bash
npm run update   # or: bash scripts/update.sh
```

This pulls `panel/`, `commands/`, and `scripts/` from the upstream clone. Your private files (`.projects.local.md`, `panel.config.local.ts`, custom scripts) are never touched.

## Project Structure

```
my-workspace/
├── panel/               # Local web dashboard (Vite + React + Express)
├── projects/            # Your project data (auto-discovered)
│   └── my-project/
│       ├── PROJECT.md   # Project overview (required for discovery)
│       ├── _index.json  # Machine-readable index
│       ├── notes/       # Meeting notes
│       │   └── log/     # Raw transcripts
│       ├── progress/    # Session progress tracking
│       └── plans/       # Design docs + implementation plans
├── commands/            # CLI command definitions
├── scripts/             # Utility scripts (cc, oc, backup, etc.)
├── AGENTS.md            # Agent instructions
└── CLAUDE.md            # Claude Code configuration
```

## Configuration

The panel uses a layered config approach:

- `panel/panel.config.ts` — committed defaults, safe to share
- `panel/panel.config.local.ts` — your local overrides, gitignored

Key settings:

```ts
// panel.config.local.ts
export default {
  projectsDir: "/Users/you/workspace/projects",
  port: 3010,
  agentRegistryPath: "/Users/you/.agent-registry.json",
};
```

`panel.config.local.ts` is in `.gitignore` — your paths never leak into the repo.

## Agent Tracking

The `scripts/cc` and `scripts/oc` wrapper scripts launch Claude Code and OpenCode while registering the session in a shared registry file.

How it works:

1. Run `cc` instead of `claude` — the wrapper captures the PID and writes an entry to `~/.agent-registry.json`
2. On exit, the wrapper removes the entry automatically
3. The panel sidebar polls the registry and shows live agent status

Registry format (`~/.agent-registry.json`):

```json
[
  {
    "pid": 12345,
    "agent": "claude",
    "project": "my-project",
    "startedAt": "2025-04-09T10:00:00Z"
  }
]
```

## Panel Features

### Dashboard

Lists all discovered projects. A project is discovered when its folder contains a `PROJECT.md` file. Shows project name, last activity, and open agent count.

### Markdown Viewer

Click any `.md` file to read it in the panel. The "Open in VS Code" button opens the file at the exact line in your editor. Drag and drop images into the viewer to optimize and embed them.

### Cmd+P Finder

Press `Cmd+P` anywhere in the panel to open the fuzzy file finder. Searches filenames across all projects. For semantic search across note content, use `qmd` from the terminal.

### Git Panel

Shows `git status` for each project. Stage files, write a commit message, and push — all from the browser. Commit templates pull context from the current project and session.

### File Tree

Right-hand sidebar showing the file tree for the active project. Click to navigate, right-click for basic file operations.

## Using as Your Upstream

Fork this repo as the foundation for your private workspace. Upgrades sync via rsync — your private files are never touched.

### One-Time Setup

```bash
# 1. Fork this repo on GitHub, then clone both repos side by side:
git clone git@github.com:YOUR_USERNAME/pavilio.git
git clone git@github.com:YOUR_USERNAME/my-workspace.git
# Both must be in the same parent directory so update.sh can find the upstream

# 2. In your private workspace, copy the private config templates:
cp AGENTS.md.example .projects.local.md
# Edit .projects.local.md with your actual projects
```

### Upgrading

```bash
bash scripts/update.sh
# or: npm run update
```

This pulls the latest from your `pavilio` fork (via `git pull`), then rsyncs `panel/`, `commands/`, and `scripts/` into your workspace. Files that only exist in your private repo are never deleted.

### Private Config

| File | Purpose |
|------|---------|
| `.projects.local.md` | Your private project registry (gitignored) |
| `panel/panel.config.local.ts` | Local panel path overrides (gitignored) |

### Rules

- Improve the panel, commands, and scripts in `pavilio` directly — never push changes from your private workspace back here
- `AGENTS.md` and `CLAUDE.md` are manually maintained — cherry-pick upstream improvements as needed

## Creating a New Project

```bash
mkdir -p projects/my-project
cat > projects/my-project/PROJECT.md <<'EOF'
# My Project

## Overview

Brief description here.
EOF
# Panel auto-discovers it on next refresh
```

The only required file is `PROJECT.md`. The panel picks it up on the next polling cycle (no restart needed).

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vite + React 19 + TypeScript |
| API server | Express |
| Real-time | WebSocket |
| Image optimization | sharp |
| Fuzzy search | fuse.js |
| Markdown rendering | react-markdown |
| File watching | chokidar |
| Styling | Tailwind CSS |

## Desktop App (Future)

The architecture — Vite frontend + Express backend — maps directly to a standard Electron or Tauri setup. The static build becomes the renderer process and the Express server runs as the main process. No structural changes required to convert this into a native desktop app.

## License

MIT — see [LICENSE](./LICENSE)

## Author

Created by Greg Motyl — [github.com/gmotyl](https://github.com/gmotyl)

[![BuyMeACoffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/motyl.dev)
