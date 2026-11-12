# Windows and WSL2

On Windows, Pavilio runs inside WSL2 and the browser runs on the Windows side.
This page covers the desktop shortcut that starts the panel, what to do when the
browser ends up on the Vite dev server, and how the panel becomes reachable from
other devices on your network. For installing under WSL2 in the first place, see
[Install → WSL2](install.md#wsl2).

## Windows desktop shortcut (WSL2)

`pnpm bootstrap` writes this shortcut for you, and `pnpm setup:shortcut` rewrites
it on its own — it reopens the same file rather than leaving a second, suffixed
copy behind. Both run from inside WSL and drive the Windows side through
`powershell.exe`, so there is nothing to place by hand and nothing
machine-specific committed to the repo: there is no `.lnk` file in it, setup
generates the shortcut. Anywhere that is not WSL, the step reports
`skipped (not WSL)` and succeeds.

What it writes, as `Pavilio Panel` on your Windows desktop:

| Field | Value |
| --- | --- |
| Target | `C:\Windows\System32\wsl.exe` |
| Arguments | `~ -d "<your distro>" -- bash -lc "'<workspace>/scripts/start-panel-windows.sh'"` |
| Working directory | `C:\Windows\System32` |
| Icon | `C:\Windows\System32\wsl.exe,0` |
| Description | `Start the Pavilio panel` |

Four details in those arguments are load-bearing, and worth knowing before you
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
- **`"'<workspace>/…'"`** — the launcher path is single-quoted *inside* the
  double quotes. `bash -lc` re-parses its argument as a command string, so a
  workspace path with a space (`/mnt/c/Users/Jane Doe/…`) has to arrive already
  quoted; without the inner quotes the shortcut saves fine and then flashes
  "No such file or directory" on every double-click.

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

The usual cause is the **workspace's own root `package.json`**: `pnpm sync` syncs `panel/`, `skills/`, `commands/` and `scripts/`, but never the root `package.json`, so a workspace set up before the entry-point split can still carry a `start` script that changes into `panel/` and launches its `dev` script in the background. Point it at the serving entry:

```json
"build": "pnpm -C panel build",
"dev":   "pnpm -C panel dev",
"start": "./scripts/panel start"
```

A missing `panel/dist` is never a silent fallback to Vite: `./scripts/panel start` (what `pnpm start` calls) builds the bundle first, and the serving entry started any other way fails loudly instead. `pnpm sync` and `pnpm pull` build the bundle as part of their run, so it normally stays fresh — the exception is the first sync after upgrading to a build-aware `update.sh`, where the copy of the script already running is still the old one. Run `pnpm build` once by hand, or `pnpm sync` twice.

### LAN access from phone or other devices

To reach the panel from other devices on your Wi-Fi (phone, MacBook, tablet), Windows needs a `netsh portproxy` entry that forwards `<hostLanIp>:3010` into the WSL VM. WSL doesn't add this for you, and creating it requires admin elevation.

The desktop shortcut's launcher, `scripts/start-panel-windows.sh`, handles this: it starts the panel, checks the portproxy, prompts UAC **only when the entry is missing or stale**, then prints clickable pair links (local + LAN). Subsequent launches are silent no-ops. `pnpm bootstrap` already points the shortcut at it.

What it does:

1. Resolves node and the package manager (see [the shortcut section](#windows-desktop-shortcut-wsl2) above), then starts the panel through `scripts/panel` — detached and logged. A start that fails stops the run right there, under the build error that explains it.
2. Detects the current WSL VM IP (changes on each WSL restart).
3. Reads `netsh portproxy show all`; if the entry for port 3010 is missing or points at a stale WSL IP, opens a UAC prompt to add `0.0.0.0:3010 → <wslIp>:3010` and (re)create the `Pavilio LAN 3010` firewall rule. **Click Yes** on the prompt — only needed on first run or after Windows loses the entry.
4. Calls `/api/mobile-access/lan/enable` so the panel binds `0.0.0.0`.
5. Prints `http://localhost:3010/#mt=…` and `http://<lanIp>:3010/#mt=…`. Ctrl+click in Windows Terminal to open in your browser; copy the LAN one to your phone or MacBook.

A few points worth knowing:

- The portproxy entry is bound to `listenaddress=0.0.0.0`, matching the form WSL uses for its preinstalled 22/80/443 forwards. Specific-IP entries can drop on Windows reboot if the adapter hasn't been assigned the IP yet by the time the IP Helper service applies persisted config (DHCP-timing race). `0.0.0.0` survives reboots reliably.
- If you cancel the UAC prompt, the panel still runs locally and on `127.0.0.1` — only LAN reach is affected. Re-run the shortcut to retry.
- Extra ports can go through the same UAC-once flow: set `PANEL_EXTRA_PORTS` in the untracked `scripts/start-panel-windows.local.env` (e.g. `"3000"` for a Vite dev server) and the launcher forwards those too.

For reach beyond your own network, see
[Mobile access (Tailscale)](mobile-access-tailscale.md).
