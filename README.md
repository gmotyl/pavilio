# Pavilio

> A dashboard for the AI coding agents running on your machine.

Pavilio is an AI-assisted multi-project workspace with a local web panel. It's a starter kit for
managing multiple projects with AI coding agents — run agents side by side, read their answers,
keep notes and plans, manage git, and search across project knowledge, all from one local
dashboard. Fork it, configure it, and start working.

**Local-first. Agent-agnostic. Open source.**

## Features

- **Terminal grid** — run Claude Code, opencode or Codex sessions side by side in browser terminals,
  with an **answer pane** that shows each agent's latest reply
- **Speech** — agent answers and documents read aloud, with per-project voices
- **Project tabs** — notes, **Plans**, **Mockups**, **Wiki** and **QA** runs for every project
- **Time tracking** — per-project time entries recorded as you work
- **Git panel** — status, diffs, history, branches and worktrees; stage, commit and push
- **Mobile access** — reach the panel from your phone over Tailscale, paired by QR code
- **Auto-sync** — the workspace commits and syncs your notes across machines on its own

## Quick Start

```bash
git clone https://github.com/gmotyl/pavilio.git my-workspace && cd my-workspace
pnpm bootstrap
pnpm start
```

The panel is then on <http://localhost:3010>. What `pnpm bootstrap` does, and why it is not
`pnpm setup`: [docs/install.md](./docs/install.md).

- **macOS** — nothing extra: Node 22 or newer and the three commands above ([details](./docs/install.md#macos)).
- **WSL2** — run them inside WSL; setup also writes a Windows desktop shortcut ([details](./docs/install.md#wsl2)).
- **Phone** — reach the panel over Tailscale: [docs/mobile-access-tailscale.md](./docs/mobile-access-tailscale.md).

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm start` | Start the panel detached on <http://localhost:3010>. Builds `panel/dist` first if it is missing; appends output to `panel/.panel.log`. |
| `pnpm stop` | Stop whatever is holding the panel port. |
| `pnpm reboot` | Stop, then start. Every browser terminal session lives inside the panel process, so this closes all of them — it says how many before doing it. |
| `pnpm status` | One line: running (with pid) or stopped. Exits 0 when running, 3 when not. |
| `pnpm sync` | Update from upstream pavilio, then reinstall, regenerate commands and rebuild the bundle. With several machines, only the mirror machine runs it. |
| `pnpm sync --promote` | Record this machine as the mirror machine, push that, then sync. |
| `pnpm pull` | Update this machine from the workspace's `origin` (`git pull --no-rebase`), then reinstall, regenerate commands and rebuild. Never touches upstream, never commits. |
| `pnpm build` | Rebuild the served bundle by hand. |
| `pnpm test` | The panel test suite. |
| `pnpm bootstrap` | Re-run setup. Safe at any time, and the way to re-pin node. |
| `pnpm setup:shortcut` | Rewrite the Windows desktop shortcut in place (WSL2 only). |
| `pnpm setup:codex` | Re-link `skills/` into Codex. |

## Session workflow

```
/pavilio-session-start [project]
  → /pavilio-grill              (design — you approve it, nothing gets coded yet)
      ↳ pavilio-writing-plans   (auto: grill hands off, writes the bite-sized plan)
  → /pavilio-execute-plan       (build task by task: test → implement → verify → commit)
  → /pavilio-session-end        (commit progress, propose todos)
```

Skills are optional — the panel and scripts work without them — but they make the biggest
difference in the quality and consistency of AI-assisted work.

## Built-in skills

Every skill under `skills/` is installed as a slash command for each agent `pnpm bootstrap` finds
on the machine — see [docs/agents.md](./docs/agents.md).

| Command | What it does |
|---|---|
| `/pavilio-archive-plan` | Archive a shipped change: fold its specs, glossary and wiki, retire its branch |
| `/pavilio-ask` | Shared reference: how every Pavilio skill asks the user a question |
| `/pavilio-audit` | Evidence-based repo audit → health grade + prioritized improvement plan |
| `/pavilio-code-review` | Two-axis review (standards + spec) of a branch, PR or work in progress |
| `/pavilio-compact` | Package the session's remaining work into a handoff for `/pavilio-resume` |
| `/pavilio-create-skill` | Scaffold a new workspace skill as a slash command for every agent |
| `/pavilio-execute-plan` | Execute a written plan task by task with implementer and reviewer sub-agents |
| `/pavilio-grill` | Stress-test an idea or plan into a sharp design and a complete OpenSpec change |
| `/pavilio-handoff` | Delegate a task by prebaking a handoff file for later execution |
| `/pavilio-manager` | Managing-developer advisor: prioritize today's work and write the briefing |
| `/pavilio-memo` | Create or edit a project memo and return its panel link |
| `/pavilio-memo-explain` | Memo with Mermaid diagrams explaining a concept, flow or decision |
| `/pavilio-memo-grill` | Grill a documentation topic one question at a time into a memo |
| `/pavilio-mermaid-chart` | Patterns for Mermaid diagrams that render well in the panel |
| `/pavilio-mockup` | Write a self-contained HTML mockup for the project's Mockups tab |
| `/pavilio-new-project` | Create a project, or build its `PROJECT.md` resume card from its notes |
| `/pavilio-note` | Turn a meeting transcript into project notes and Todoist follow-ups |
| `/pavilio-note-batch` | Batch-process unprocessed meetings from every connected notetaker |
| `/pavilio-openspec-migrate` | Move a project's flat plans and specs into the OpenSpec layout |
| `/pavilio-openspec-storage` | Shared reference: how Pavilio stores OpenSpec changes and specs |
| `/pavilio-pr-explain` | Explain a PR, branch or commit range as a diagram-rich memo |
| `/pavilio-qa-agent` | Acceptance-criteria-driven browser QA with evidence for every check |
| `/pavilio-question` | Answer questions about people, decisions and timelines from project notes |
| `/pavilio-resume` | Execute a prebaked handoff file (explicit invocation only) |
| `/pavilio-search` | Gather a project's notes, memos, plans and code into a cited context pack |
| `/pavilio-session-end` | Verify session progress is captured and commit it |
| `/pavilio-session-start` | Start or resume a project session and classify its intent |
| `/pavilio-ui-design` | Design a UI surface with a token plan and interface copy, then mock it up |
| `/pavilio-wiki` | Query, ingest into, or lint a project's LLM wiki |
| `/pavilio-wiki-ingest-knowledge` | Harvest well-sourced findings into the shared `knowledge` wiki |
| `/pavilio-wiki-migrate` | Backfill a project's wiki from its whole history |
| `/pavilio-wiki-research` | Research a topic into a wiki from web sources, round by round |
| `/pavilio-writing-plans` | Turn an approved spec into a bite-sized, contract-style task plan |

## Creating a project

Use the **New Project** dialog in the panel, or from a terminal:

```bash
scripts/project new my-project
```

The panel picks up any folder under `projects/` that has a `PROJECT.md` — no restart needed.

## Docs

- [docs/install.md](./docs/install.md) — what `pnpm bootstrap` does, macOS and WSL2 notes, keeping your notes safe
- [docs/windows-wsl.md](./docs/windows-wsl.md) — the Windows desktop shortcut, Vite HMR and LAN access
- [docs/workspaces.md](./docs/workspaces.md) — team workspaces tracking upstream, and mirror/consumer machines
- [docs/configuration.md](./docs/configuration.md) — panel config files, `PANEL_PORT`, preferences, speech servers
- [docs/agents.md](./docs/agents.md) — supported agents and how skills reach each of them
- [docs/architecture.md](./docs/architecture.md) — how the panel, skills, scripts and project data fit together
- [docs/mobile-access-tailscale.md](./docs/mobile-access-tailscale.md) — phone access over Tailscale: setup, pairing, threat model
- [panel/help/panel-guide.md](./panel/help/panel-guide.md) — panel features and keyboard shortcuts

## License

MIT — see [LICENSE](./LICENSE)

## Author

Created by Greg Motyl — [github.com/gmotyl](https://github.com/gmotyl)

[![BuyMeACoffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/motyl.dev)
