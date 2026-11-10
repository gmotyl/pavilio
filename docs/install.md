# Install

The whole install is three commands, run from a normal terminal (inside WSL on
Windows):

```bash
git clone https://github.com/gmotyl/pavilio.git my-workspace && cd my-workspace
pnpm bootstrap
pnpm start
```

The panel is then on <http://localhost:3010>. This page explains what those
commands do, what to expect per platform, and how your notes stay safe.

## Command names

> **`bootstrap`, not `setup`.** Every workspace command is named so that
> the bare `pnpm <name>` spelling reaches *this* workspace's script. That rules
> out the names pnpm claims for itself: `pnpm setup` appends pnpm's `PNPM_HOME`
> block to your shell profile; `pnpm update` — and its aliases `pnpm upgrade`
> and `pnpm up` — rewrites your lockfile; `pnpm restart` is a built-in
> lifecycle command that runs `stop`, `restart` *and* `start` in turn. None of them ever reads
> `package.json` the way you meant. So setup is `pnpm bootstrap`, the update is
> `pnpm sync` (`pnpm pull` on a second machine — see
> [Two machines](workspaces.md#two-machines-one-mirror-the-rest-consumers)), and
> the restart is `pnpm reboot`.

None of the commands named above needs a `run` in front of it: `bootstrap`, `pull`, `sync` and
`reboot` are named precisely so that they do not collide with `pnpm setup`,
`pnpm update` and `pnpm restart`, which pnpm handles itself and would never pass
on to `package.json`. `update` is the one with a reach beyond its own name: pnpm
documents `pnpm up` and `pnpm upgrade` as aliases of it, so all three rewrite
your lockfile and none of them can be the update command here.

The panel commands (`pnpm start|stop|reboot|status`) are thin wrappers around
`./scripts/panel start|stop|restart|status`, which needs no package manager at
all — that is what the Windows launcher calls.

## What `pnpm bootstrap` does

`pnpm bootstrap` is idempotent — re-run it whenever you like. It never overwrites
a file you own and never adds a remote twice. In one pass it:

1. **toolchain** — finds `node` (**Node 22 or newer** is required) and picks
   `pnpm`, or `corepack pnpm` when pnpm is not on `PATH` — pnpm is the only
   package manager pavilio uses. It
   records the interpreter's directory in `scripts/start-panel-windows.local.env`,
   which is the Windows launcher's only way back to it.
2. **seed** — creates `projects/` and, if you do not have one yet,
   `.projects.local.md` from `AGENTS.md.example`. That file is your private
   project registry; once it exists, setup leaves it alone.
3. **panel install** and **panel build** — the only two steps that are fatal.
   Pavilio is one pnpm workspace with one root lockfile, so that single install
   covers the root and the panel alike; there is no separate panel install.
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

## Platform notes

### macOS

Nothing extra to do. Install Node 22 or newer, run the three commands above, and
that is the whole install — the Windows shortcut step reports
`skipped (not WSL)` and every other step applies unchanged.

To reach the panel from your phone, use Tailscale rather than your LAN: see
[Mobile access (Tailscale)](mobile-access-tailscale.md).

### WSL2

Run the three commands **inside WSL**, from a normal terminal. Setup then also
writes a **`Pavilio Panel` shortcut to your Windows desktop** — see
[Windows desktop shortcut](windows-wsl.md#windows-desktop-shortcut-wsl2) for exactly what it
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

## Keep your notes safe

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

`pnpm sync` then updates the workspace by **rebasing your commits onto
`upstream/main`** (`git pull --rebase --autostash upstream main`). Your notes
are replayed on top of the new version rather than merged into it, so the
history stays linear and still pushes cleanly to your own `origin`. After the rebase it reinstalls the
panel's dependencies, regenerates the agent slash-commands and rebuilds the
bundle — but it never restarts the running panel, which may be serving the very
terminal you started the update from. It ends by reminding you to restart it
yourself.

A second machine on the same workspace does not do that: there `pnpm pull` is the
update — it merges what the first machine pushed to `origin` and never touches
`upstream`. See
[Two machines](workspaces.md#two-machines-one-mirror-the-rest-consumers).

One exception worth remembering: `pnpm sync` and `pnpm pull` refresh the Claude
Code and opencode slash-commands, but **not** Codex — and only for an agent set
up in this workspace ([details](agents.md#codex-is-not-refreshed-by-sync-or-pull)).
Run `pnpm setup:codex` by hand after `skills/` changes.
