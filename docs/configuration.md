# Configuration

Where the panel reads its settings: the layered config files, the port, the
per-machine preferences, and the local speech servers.

## Panel config

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

## Running on another port

`PANEL_PORT=3020 pnpm start` moves the whole set — the script, the server and
the links it prints. A port you name that way is an address, not a preference:
if something else already holds it the panel says so and stops, rather than
quietly binding the next one up where `pnpm stop` would never find it. Set
`port` in `panel/panel.config.local.ts` instead and the old behaviour applies —
the panel steps to the next free port and prints where it landed.

## Workspace preferences

`.pavilio/preferences/<machineId>.json` — one level above `panel/`, at your workspace root — is where the panel remembers the choices that are worth keeping: sidebar and pane state, sort orders, favorites, the speech voice, per-project and per-repo toggles. It belongs to the workspace, not to the browser, so it travels with your private repo. Anything that names a live session — a focused terminal, a grid layout — stays in browser storage instead and never lands here.

There is **one file per machine**, written only by that machine's panel; nothing is merged between machines behind your back. A machine with no file of its own is seeded at boot from the mirror machine's file (see [Two machines](workspaces.md#two-machines-one-mirror-the-rest-consumers)). Any machine that has neither its own file nor a mirror's file to copy — the mirror itself on its first boot after the upgrade, or a consumer whose pull has not brought the mirror's file yet — seeds once from the old single shared `.pavilio/preferences.json`, if the workspace still has one; the legacy file is never written again. To take another machine's choices later, use **Copy preferences from another machine** in Settings: it replaces this machine's file with that machine's committed one and reloads the page.

The files are gitignored in this repository (they would carry your project names and absolute repo paths); `.pavilio/preferences.example.json` is shipped in their place, so you can see the format. The panel reads its file **once at boot** — after pulling a change to it, restart the panel.

In a Quick Start clone (clone mode) that ignore stays in force: the workspace *is* a pavilio clone, so `.pavilio/preferences/` is never committed there, per-machine files do not travel between machines, and seeding from the mirror or **Copy preferences from another machine** has nothing to offer. The multi-machine setup is a sync-mode workspace (see [Teams: a private workspace tracking upstream](workspaces.md#teams-a-private-workspace-tracking-upstream)).

## Local speech servers

Four speech engines talk to a server on your own machine, and each is turned on by its address:

- `openai` — any OpenAI-compatible speech server (OmniVoice, for one): `OPENAI_TTS_BASE_URL`.
- `kokoro` — a local [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI): `KOKORO_TTS_BASE_URL`.
- `pocket` — a local Pocket TTS server for English: `POCKET_TTS_BASE_URL`.
- `pocket-pl` — a second Pocket TTS server with a Polish model: `POCKET_PL_TTS_BASE_URL`.

Set the address in **Settings → Speech** (the engine's address field) or as a line in the panel secrets file, `~/.panel/secrets.env` (`$PANEL_AUTH_STATE_DIR/secrets.env` when that is set). A variable in the panel's environment wins over both, and the field then shows it read-only. The default cascade order is `openai`, `pocket`, `kokoro`, `elevenlabs`, `cartesia`, `speechify`, `azure`, `edge`, `pocket-pl`, with `pocket-pl` off by default; an engine without an address is skipped. A saved order gets Pocket at the end: move it up in Settings.

`PANEL_TTS_SERVER_CTL` names the servers' control scripts (anything that takes `start|stop`): one or more absolute paths separated by `:`, like `PATH`. `pnpm start` runs `<ctl> start` for each, in order, and `pnpm stop` runs `<ctl> stop` for each, in reverse order; empty entries are skipped and a path listed twice runs once. A path that itself contains `:` is not supported. A missing script, a failure or a hang past `PANEL_TTS_SERVER_CTL_TIMEOUT` (default 60 s, per script) costs one warning line for that script, never the panel or the other scripts.

**Kokoro.** `pnpm install:kokoro` sets it up (in a synced workspace, which has no root `package.json` script for it, run `bash scripts/install:kokoro`):

- needs `git`, `uv` and `espeak-ng`, and prints the install command for any that are missing;
- clones Kokoro-FastAPI at a pinned tag into `~/.local/share/pavilio/kokoro-fastapi` (or `$PAVILIO_KOKORO_DIR`) and writes `kokoroctl` (`start|stop|restart|status|log`) beside it; the server listens on `http://127.0.0.1:8880`, on the GPU (MPS) on macOS and on the CPU on Linux/WSL;
- writes `KOKORO_TTS_BASE_URL` to the secrets file and appends `kokoroctl` to `PANEL_TTS_SERVER_CTL`, keeping any other server's script already listed there;
- starts the server once to check it answers — the first start downloads the model, so this can take up to 300 s.

Then restart the panel (`pnpm stop && pnpm start`); it starts and stops Kokoro itself from then on — unless a `PANEL_TTS_SERVER_CTL` in the panel's environment wins and does not list `kokoroctl` (the installer warns then). Re-running the installer changes nothing that is already in place; `pnpm install:kokoro --uninstall` (or `bash scripts/install:kokoro --uninstall`) stops the server, removes its files and its `KOKORO_TTS_BASE_URL` line, and removes only its own entry from the secrets file's `PANEL_TTS_SERVER_CTL` — other servers' scripts stay. A `PANEL_TTS_SERVER_CTL` set in the panel's environment must be edited by hand; the uninstaller warns when it still lists `kokoroctl`.

Kokoro has a fixed catalog of 54 preset voices (default `af_heart`) and uses one voice for every language; there is no voice cloning — that stays with OmniVoice. It also has **no Polish phonemizer**: Polish text goes through its fallback and may sound off. To keep it away from Polish on a machine, switch `kokoro` off in that machine's cascade.

**Installing engines.** `pnpm install:speech` installs the speech Stop hooks and then shows a menu of the local engines (`omnivoice`, `kokoro`, `pocket`, `pocket-pl`) on a terminal; engines that already have an address are ticked. To skip the menu, pass `--engines=omnivoice,kokoro,pocket,pocket-pl` (any subset, or `none` for hooks only); in a synced workspace run `bash scripts/install:speech`. `--uninstall --engines=...` removes the named engines. OmniVoice is not installed by this script: get it from https://github.com/gmotyl/omnivoice-server.

**Pocket.** Pocket TTS is installed by the `pocket` and `pocket-pl` entries of the menu (or `--engines=pocket,pocket-pl`):

- creates a venv with a pinned `pocket-tts` in `~/.local/share/pavilio/pocket-tts` (or `$PAVILIO_POCKET_DIR`) and writes `pocketctl` (`start|stop|restart|status|log`) there;
- English listens on `http://127.0.0.1:8890` (`POCKET_TTS_BASE_URL`), Polish on `http://127.0.0.1:8891` (`POCKET_PL_TTS_BASE_URL`); each server uses about 1.1 GB of RAM;
- a small file server on `http://127.0.0.1:8892` (`POCKET_VOICE_FILES_URL`) serves your workspace voices (`.pavilio/voices`), so Pocket can clone them; `POCKET_TTS_CLONING` is `1` when English cloning is on;
- appends `pocketctl` to `PANEL_TTS_SERVER_CTL` like Kokoro does; restart the panel afterwards.

Both servers clone any clip in `.pavilio/voices`; the Polish one clones only (it refuses preset voices), and a Polish clip can speak English, so pick the engine per project. English cloning needs the gated weights, which need a Hugging Face login. Without one the installer prints that cloning is off, and English then has the preset voices only. To turn it on:

1. accept the terms at https://huggingface.co/kyutai/pocket-tts
2. run `uvx hf auth login`
3. re-run `pnpm install:speech`

The Polish model sometimes stops early on a clip (it drops the last clause, or stops after one sentence), and nothing detects that. Check each Polish voice with a test sample before relying on it.

**Per project.** The project voice picker has an **Engine** select (`Default` follows the engine chosen in Settings; stored as `speech.engineByProject`) and a **Speed** control: a rate button that steps through 0.8, 1.0, 1.2, 1.5 and 2.0, and a slider from 0.5 to 2.0 (stored as `speech.rateByProject`). Speed only changes the playback rate, so pitch is preserved and no engine is asked again.
