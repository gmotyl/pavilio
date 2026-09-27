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

## Quick Start

```bash
git clone https://github.com/gmotyl/pavilio.git my-workspace && cd my-workspace
pnpm bootstrap
pnpm start
```

The panel is then on <http://localhost:3010>.

> **`bootstrap`, not `setup`.** Every command in this README is named so that
> the bare `pnpm <name>` spelling reaches *this* workspace's script. That rules
> out the names pnpm claims for itself: `pnpm setup` appends pnpm's `PNPM_HOME`
> block to your shell profile; `pnpm update` — and its aliases `pnpm upgrade`
> and `pnpm up` — rewrites your lockfile; `pnpm restart` is npm's lifecycle
> spelling that runs `stop`, `restart` *and* `start`. None of them ever reads
> `package.json` the way you meant. So setup is `pnpm bootstrap`, the update is
> `pnpm pull`, and the restart is `pnpm reboot`.

`pnpm bootstrap` is idempotent — re-run it whenever you like. It never overwrites
a file you own and never adds a remote twice. In one pass it:

1. **toolchain** — finds `node` (**Node 22 or newer** is required) and picks
   `pnpm`, `corepack pnpm` or `npm`, whichever this machine actually has. It
   records the interpreter's directory in `scripts/start-panel-windows.local.env`,
   which is the Windows launcher's only way back to it.
2. **seed** — creates `projects/` and, if you do not have one yet,
   `.projects.local.md` from `AGENTS.md.example`. That file is your private
   project registry; once it exists, setup leaves it alone.
3. **panel install** and **panel build** — the only two steps that are fatal.
4. **remotes** — see [Keep your notes safe](#keep-your-notes-safe) below.
5. **skills** — installs everything under `skills/` as slash commands, for each
   agent already configured on this machine: Claude Code (`~/.claude`), opencode
   (`~/.config/opencode` or a local `.opencode/`), Codex (`~/.codex`). Agents you
   do not have are reported as skipped, not installed.
6. **speech** and **shortcut** — the spoken Stop-hook announcements, and (WSL2
   only) the Windows desktop shortcut.

Every step prints exactly one line: `✓` done, `–` skipped and why, `✗` failed and
the command to retry it with. Only the two package-manager steps stop the run —
everything after them is a convenience, so a machine with no Codex, no WSL or a
locked-down home directory still ends up with a working panel.

Flags: `--no-speech`, `--no-shortcut`, `--yes` (never prompt — for CI, re-runs
and scripts).

### macOS

Nothing extra to do. Install Node 22 or newer, run the three commands above, and
that is the whole install — the Windows shortcut step reports
`skipped (not WSL)` and every other step applies unchanged.

To reach the panel from your phone, use Tailscale rather than your LAN: see
[Mobile access (Tailscale)](#mobile-access-tailscale).

### WSL2

Run the three commands **inside WSL**, from a normal terminal. Setup then also
writes a **`Pavilio Panel` shortcut to your Windows desktop** — see
[Windows desktop shortcut](#windows-desktop-shortcut-wsl2) for exactly what it
puts there. Double-clicking it opens a console, starts the panel, and prints
clickable pair links for the local browser and for your phone.

Two things to expect on a first run:

- **One UAC prompt, once.** Reaching the panel from another device on your Wi-Fi
  needs a Windows `netsh portproxy` entry into the WSL VM, and creating one
  requires elevation. The launcher asks **only when that entry is missing or
  stale** — every later launch is a silent no-op. Cancelling it costs you LAN
  access and nothing else: the panel still runs, locally and on `127.0.0.1`.
- **`node/pnpm not found` in the shortcut window.** The shortcut runs
  `bash -lc`, a login shell that reads `/etc/profile` and `~/.profile` but
  **never `~/.bashrc`** — which is where fnm and nvm are usually wired up. The
  launcher therefore resolves the interpreter itself, from the pin that
  `pnpm bootstrap` wrote. If that pin is missing or points at a node you have
  since removed, open a normal terminal in the workspace and re-run
  `pnpm bootstrap`: it re-pins whichever node you are really using.

### Keep your notes safe

Your notes, progress files and project registry are ordinary **git commits on
`main` in this workspace**. There is no database and no sync service behind the
panel, so the workspace needs a remote of its own to be safe anywhere — and
setup wires up two:

- **`origin`** — *your* private repository, the one you push notes to. Setup asks
  for it once, with the prompt `Private repo URL for your notes (Enter to skip):`.
  Give it a URL and it adds the remote, fetches it, and points `main` at
  `origin/main`. Press Enter to skip, and add it later with
  `git remote add origin <url>`.
- **`upstream`** — pavilio itself, fetch-only: its push URL is set to `no_push`,
  so a stray `git push upstream` fails immediately instead of asking for
  credentials to a repository you cannot write to.

`pnpm pull` then updates the workspace by **rebasing your commits onto
`upstream/main`** (`git pull --rebase --autostash`). Your notes are replayed on
top of the new version rather than merged into it, so the history stays linear
and still pushes cleanly to your own `origin`. After the rebase it reinstalls the
panel's dependencies, regenerates the agent slash-commands and rebuilds the
bundle — but it never restarts the running panel, which may be serving the very
terminal you started the update from. It ends by reminding you to restart it
yourself.

One exception worth remembering: `pnpm pull` refreshes the Claude Code and
opencode slash-commands, but **not** Codex. Run `pnpm setup:codex` by hand after
`skills/` changes.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm start` | Start the panel detached on <http://localhost:3010>. Builds `panel/dist` first if it is missing; appends output to `panel/.panel.log`. |
| `pnpm stop` | Stop whatever is holding the panel port. |
| `pnpm reboot` | Stop, then start. Every browser terminal session lives inside the panel process, so this closes all of them — it says how many before doing it. |
| `pnpm status` | One line: running (with pid) or stopped. Exits 0 when running, 3 when not. |
| `pnpm pull` | Update from upstream, then reinstall, regenerate commands and rebuild the bundle. |
| `pnpm sync` | The same script under a second name. `pull` came first and stayed; `sync` reads better next to the team workflow below. |
| `pnpm build` | Rebuild the served bundle by hand. |
| `pnpm test` | The panel test suite. |
| `pnpm bootstrap` | Re-run setup. Safe at any time, and the way to re-pin node. |
| `pnpm setup:shortcut` | Rewrite the Windows desktop shortcut in place (WSL2 only). |
| `pnpm setup:codex` | Re-link `skills/` into Codex. |

None of these needs a `run` in front of it: `bootstrap`, `pull`, `sync` and
`reboot` are named precisely so that they do not collide with `pnpm setup`,
`pnpm update` and `pnpm restart`, which pnpm handles itself and would never pass
on to `package.json`. `update` is the one with a reach beyond its own name: pnpm
documents `pnpm up` and `pnpm upgrade` as aliases of it, so all three rewrite
your lockfile and none of them can be the update command here.

All of the panel commands are thin wrappers around
`./scripts/panel start|stop|restart|status`, which needs no package manager at
all — that is what the Windows launcher calls.

**Running on another port.** `PANEL_PORT=3020 pnpm start` moves the whole set —
the script, the server and the links it prints. A port you name that way is an
address, not a preference: if something else already holds it the panel says so
and stops, rather than quietly binding the next one up where `pnpm stop` would
never find it. Set `port` in `panel/panel.config.local.ts` instead and the old
behaviour applies — the panel steps to the next free port and prints where it
landed.

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
/pavilio-session-start [project]
  → /pavilio-grill              (design — you approve it, nothing gets coded yet)
      ↳ pavilio-writing-plans   (auto: grill hands off, writes the bite-sized plan)
  → /pavilio-execute-plan       (build task by task: test → implement → verify → commit)
  → /pavilio-session-end        (commit progress, propose todos)
```

Skills are optional — the panel and scripts work without them — but they make the biggest difference in the quality and consistency of AI-assisted work.

## Built-in Skills

Every skill under `skills/` is exposed as a slash command in Claude Code and opencode (run `pnpm setup:claude-code` / `pnpm setup:opencode`, or `pnpm pull` which refreshes both). The self-contained **pavilio-** family:

| Command | What it does |
|---------|--------------|
| `/pavilio-session-start` | Start/resume a project — load context, open the progress file, enter planning mode |
| `/pavilio-session-end` | Verify progress is captured, commit + push, propose Todoist follow-ups |
| `/pavilio-grill` | Stress-test an idea or plan into a sharp, domain-aligned design |
| `/pavilio-writing-plans` | Turn an approved spec into a bite-sized, test-first plan (usually invoked automatically by `/pavilio-grill`) |
| `/pavilio-execute-plan` | Execute a written plan task-by-task with review checkpoints; stop and ask when blocked |
| `/pavilio-handoff` | Delegate a task by prebaking a handoff file for later execution |
| `/pavilio-compact` | Package the current session's remaining work into a handoff before context runs out |
| `/pavilio-resume` | Pick up a prebaked handoff file and execute its todo list top-down |
| `/pavilio-manager` | Proactive managing-developer advisor — briefs and prioritizes work |
| `/pavilio-audit` | Deep repo audit → health grade + prioritized improvement plan |
| `/pavilio-qa-agent` | Acceptance-criteria-driven QA runner |
| `/pavilio-create-skill` | Scaffold a new workspace skill (slash command in both agents) |

## Windows desktop shortcut (WSL2)

`pnpm bootstrap` writes this shortcut for you, and `pnpm setup:shortcut` rewrites
it on its own — it reopens the same file rather than leaving a second, suffixed
copy behind. Both run from inside WSL and drive the Windows side through
`powershell.exe`, so there is nothing to place by hand and nothing
machine-specific committed to the repo. Anywhere that is not WSL, the step
reports `skipped (not WSL)` and succeeds.

What it writes, as `Pavilio Panel` on your Windows desktop:

| Field | Value |
| --- | --- |
| Target | `C:\Windows\System32\wsl.exe` |
| Arguments | `~ -d "<your distro>" -- bash -lc "<workspace>/scripts/start-panel-windows.sh"` |
| Working directory | `C:\Windows\System32` |
| Icon | `C:\Windows\System32\wsl.exe,0` |
| Description | `Start the Pavilio panel` |

Three details in those arguments are load-bearing, and worth knowing before you
edit them by hand:

- **`-d "<your distro>"`** pins the distro to the one setup ran in. Without it
  `wsl.exe` opens whichever distro is currently default, which changes as soon as
  another is installed or `wsl --set-default` runs — and then the shortcut opens
  a distro with no workspace in it.
- **`--`** ends `wsl.exe`'s own options; everything after it is the command for
  Linux. Drop it and `wsl.exe` tries to parse `bash -lc …` as its own flags.
- **`bash -lc`** is a *login* shell, so `/etc/profile` and `~/.profile` are read
  — and **`~/.bashrc` is not**, with or without `-l`. Bash skips it for
  non-interactive shells, and Ubuntu's default copy returns on its own second
  line (`[ -z "$PS1" ] && return`). A version manager wired up only there — the
  usual home for fnm's `eval "$(fnm env)"` or nvm's `nvm.sh` — is therefore
  invisible to the shortcut, which is why the launcher resolves node itself
  instead of trusting PATH.

The shortcut runs `scripts/start-panel-windows.sh`, which resolves the toolchain,
hands the panel over to `scripts/panel`, repairs the Windows portproxy when it
needs repairing, and prints the pair links. It is portable: on macOS or native
Linux the Windows-specific block is skipped, so the same script still works as a
plain launcher.

### If the browser console shows Vite HMR messages

The panel has two entry points: `server/index.ts` **serves** the built bundle from `panel/dist` (what `pnpm start` runs), and `server/dev.ts` runs Vite with HMR (what `pnpm dev` runs, for a checkout where the panel itself is being developed). The launcher must end up on the serving entry — a Vite dev server left running all day reloads the page whenever anything rewrites the working tree, which wipes out terminal state.

So `[vite] (client) hmr update …` in the console means the wrong entry is live. Confirm with:

```bash
ps aux | grep 'tsx server'      # want server/index.ts, not server/dev.ts
```

The usual cause is the **workspace's own root `package.json`**: `pnpm pull` syncs `panel/`, `skills/`, `commands/` and `scripts/`, but never the root `package.json`, so a workspace set up before the entry-point split can still carry `"start": "cd panel && npm run dev &"`. Point it at the serving entry:

```json
"build": "pnpm -C panel build",
"dev":   "pnpm -C panel dev",
"start": "./scripts/panel start"
```

A missing `panel/dist` is never a silent fallback to Vite: `./scripts/panel start` (what `pnpm start` calls) builds the bundle first, and the serving entry started any other way fails loudly instead. `pnpm pull` builds the bundle as part of its run, so it normally stays fresh — the exception is the first pull after upgrading to a build-aware `update.sh`, where the copy of the script already running is still the old one. Run `pnpm build` once by hand, or `pnpm pull` twice.

### LAN access from phone or other devices

To reach the panel from other devices on your Wi-Fi (phone, MacBook, tablet), Windows needs a `netsh portproxy` entry that forwards `<hostLanIp>:3010` into the WSL VM. WSL doesn't add this for you, and creating it requires admin elevation.

The desktop shortcut's launcher, `scripts/start-panel-windows.sh`, handles this: it starts the panel, checks the portproxy, prompts UAC **only when the entry is missing or stale**, then prints clickable pair links (local + LAN). Subsequent launches are silent no-ops. `pnpm bootstrap` already points the shortcut at it.

What it does:

1. Resolves node and the package manager (see the shortcut section above), then starts the panel through `scripts/panel` — detached and logged. A start that fails stops the run right there, under the build error that explains it.
2. Detects the current WSL VM IP (changes on each WSL restart).
3. Reads `netsh portproxy show all`; if the entry for port 3010 is missing or points at a stale WSL IP, opens a UAC prompt to add `0.0.0.0:3010 → <wslIp>:3010` and (re)create the `Pavilio LAN 3010` firewall rule. **Click Yes** on the prompt — only needed on first run or after Windows loses the entry.
4. Calls `/api/mobile-access/lan/enable` so the panel binds `0.0.0.0`.
5. Prints `http://localhost:3010/#mt=…` and `http://<lanIp>:3010/#mt=…`. Ctrl+click in Windows Terminal to open in your browser; copy the LAN one to your phone or MacBook.

A few points worth knowing:

- The portproxy entry is bound to `listenaddress=0.0.0.0`, matching the form WSL uses for its preinstalled 22/80/443 forwards. Specific-IP entries can drop on Windows reboot if the adapter hasn't been assigned the IP yet by the time the IP Helper service applies persisted config (DHCP-timing race). `0.0.0.0` survives reboots reliably.
- If you cancel the UAC prompt, the panel still runs locally and on `127.0.0.1` — only LAN reach is affected. Re-run the shortcut to retry.
- Extra ports can go through the same UAC-once flow: set `PANEL_EXTRA_PORTS` in the untracked `scripts/start-panel-windows.local.env` (e.g. `"3000"` for a Vite dev server) and the launcher forwards those too.

## Project Structure

```
my-workspace/
├── panel/               # Local web dashboard (Vite + React + Express)
├── projects/            # Your project data (auto-discovered)
│   └── my-project/
│       ├── PROJECT.md   # Stable resume card (required for discovery)
│       ├── STATUS.md    # Volatile state, written by pavilio-note/bootstrap (not needed for discovery)
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

### Workspace preferences

`.pavilio/preferences.json` — one level above `panel/`, at your workspace root — is where the panel remembers the choices that are worth carrying between machines: sidebar and pane state, sort orders, favorites, the speech voice, per-project and per-repo toggles. It belongs to the workspace, not to the browser, so it travels with your private repo and a second machine opens the panel the way you left it. Anything that names a live session — a focused terminal, a grid layout — stays in browser storage instead and never lands here.

The file is gitignored in this repository (it would carry your project names and absolute repo paths); `.pavilio/preferences.example.json` is shipped in its place, so you can see the format. The panel reads it **once at boot** — after pulling a change to it, restart the panel.

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

### Terminal

Full terminal sessions in the browser, one per agent. Keyboard shortcuts differ from stock xterm.js so that copy and cancel never fire from the same chord on Windows:

| Chord | Action |
| --- | --- |
| `Ctrl+C` | Copies the selection. With nothing selected, sends the interrupt (`^C`) instead. |
| `Ctrl+Shift+C` | Always sends the interrupt, even with a selection — the unambiguous cancel chord. |
| `Ctrl+V` | Pastes. |
| `Shift+Enter` | Inserts a continuation (`\` + newline) rather than submitting. |

Note that `Ctrl+Shift+C` is **not** copy here, which is where it differs from most terminals — `Ctrl+C` took over that job.

## Teams: a private workspace tracking upstream

The Quick Start clone is already a workspace that tracks upstream: `pnpm
bootstrap` renames the pavilio remote to `upstream`, leaves `origin` free for
your own private repository, and `pnpm pull` rebases your notes onto whatever
upstream has grown since. For one person, that is the whole story.

Teams usually want the other shape — **one private workspace repository, with a
pavilio clone beside it** to sync from. New panel features, skills and scripts
flow in; files that only exist in your private repo are never touched.

```bash
# Clone both into the same parent directory
git clone git@github.com:gmotyl/pavilio.git              # the upstream
git clone git@github.com:YOUR_TEAM/my-workspace.git      # your private repo
cd my-workspace

# Your private project registry
cp ../pavilio/AGENTS.md.example .projects.local.md
# Edit .projects.local.md with your actual projects

pnpm bootstrap
```

To take a new upstream version, from the workspace:

```bash
pnpm pull                                 # or: bash scripts/update.sh [/path/to/pavilio]
```

`scripts/update.sh` has two modes and chooses between them itself, by asking
whether the workspace it is running in is a pavilio clone — read from its
remotes, not from what the directory is called, so the Quick Start's
`my-workspace` is recognised as readily as a folder named `pavilio`:

- **Clone mode** — the workspace *is* a pavilio clone (the Quick Start shape):
  `upstream` (or, before `pnpm bootstrap` has run, `origin`) points at pavilio
  itself. It rebases your commits onto `upstream/main` and commits nothing on
  your behalf: the tracked files there are your own work.
- **Sync mode** — the workspace is a separate repository with a pavilio clone as
  its sibling (the shape above). It fast-forwards that clone to `origin/main`,
  then **rsyncs** `panel/`, `skills/`, `scripts/` and — when the upstream has one
  — `commands/` into the workspace, and commits the result for you as
  `chore(sync): pavilio upstream @ <sha>`. Only `panel/` is mirrored with
  `--delete`, so modules retired upstream disappear here too; `skills/`,
  `scripts/` and `commands/` keep whatever you added downstream. Pass the clone's
  path as an argument when it is not the sibling directory named `pavilio` — an
  explicit path always means sync mode, whatever the workspace's own remotes say.

Both modes then reinstall the panel's dependencies, regenerate the agent
slash-commands and rebuild the served bundle. Neither one restarts a running
panel — do that yourself with `pnpm reboot`.

### Private config

| File | Purpose |
|------|---------|
| `.projects.local.md` | Your private project registry (gitignored) |
| `panel/panel.config.local.ts` | Local panel path overrides (gitignored) |
| `scripts/start-panel-windows.local.env` | Per-host launcher settings and the node pin (gitignored) |

### Rules

- Improve the panel, skills, commands and scripts in `pavilio` directly — never
  push changes from your private workspace back here.
- `AGENTS.md` and `CLAUDE.md` are manually maintained on both sides — cherry-pick
  upstream improvements as needed.
- `pnpm pull` regenerates the Claude Code and opencode slash-commands, but not
  the Codex ones: run `pnpm setup:codex` yourself after `skills/` changes.

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

## Mobile access (Tailscale)

Reach the panel from your phone without exposing it to your LAN or the public internet. The panel binds only to `127.0.0.1`; `tailscale serve` on your Mac proxies HTTPS from your tailnet into loopback, and a rotating 256-bit pairing token (delivered via QR) gates the phone.

**Setup, pairing, troubleshooting, and threat model:** [docs/mobile-access-tailscale.md](./docs/mobile-access-tailscale.md).

TL;DR:

1. `brew install --cask tailscale` on the Mac, sign in.
2. Enable **HTTPS Certificates** + **MagicDNS** at <https://login.tailscale.com/admin/dns>.
3. Install Tailscale on the phone, sign in with the same account.
4. In the panel sidebar, toggle **Mobile access** on → scan the QR.

## License

MIT — see [LICENSE](./LICENSE)

## Author

Created by Greg Motyl — [github.com/gmotyl](https://github.com/gmotyl)

[![BuyMeACoffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/motyl.dev)
