# Projects Panel

Local web dashboard for the pavilio workspace. Built with Vite + React + Express on port 3010.

## Features

- Project dashboard with auto-discovered project cards (reads PROJECT.md)
- Markdown viewer with VS Code integration
- Cmd+P fuzzy file finder across all projects
- AI agent monitoring sidebar (Claude Code, OpenCode sessions)
- Git panel — status, stage, commit, push
- Image optimization via drag-and-drop (sharp → WebP)
- Real-time updates via WebSocket

## Setup

```bash
cd panel
npm install
npm run build
npm start
# Open http://localhost:3010
```

## Configuration

`panel.config.ts` — committed defaults using relative paths, safe for all users.

To override locally (gitignored, never committed):

```ts
// panel/panel.config.local.ts
import type { PanelConfig } from "./panel.config";

const overrides: Partial<PanelConfig> = {
  projectsDir: "/absolute/path/to/your/projects",
  port: 3010,
  agentRegistryPath: "/Users/you/.agent-registry.json",
};

export default overrides;
```

### Environment variables

| Variable | Default | What it does |
| --- | --- | --- |
| `PAVILIO_ANSWER_WAVE_DEBOUNCE_MS` | `3000` | How long a session must stay busy before the agent may take the answer pane's body. Server-side, `busy` only means "the PTY emitted output in the last second", so a reattach repaint looks identical to an agent starting work; this window is what tells them apart. Anything that is not a finite number above zero (`abc`, `0`, `-1`, empty) falls back to the default — a zero or negative window is no debounce at all, not a shorter one. |
| `PANEL_TOKEN` | unset | Shared secret for LAN access (see below). |
| `PANEL_TLS_CERT` / `PANEL_TLS_KEY` | unset | Absolute paths to a certificate and its key; setting both serves the panel over HTTPS. |

All of these are read by the server process at boot, so a change needs a panel
**restart** — but no rebuild. `PAVILIO_ANSWER_WAVE_DEBOUNCE_MS` reaches the
browser on `GET /api/preferences.js` rather than through the bundle, which is
exactly why: a `VITE_*` variable would be baked in at build time and need one.

## Agent Tracking

Use `scripts/cc` instead of `claude` and `scripts/oc` instead of `opencode`. The wrapper scripts register/deregister sessions in `~/.agent-registry.json`, which the panel sidebar reads to show live agent status.

## LAN Access with Token Auth + HTTPS

1. Install mkcert: `brew install mkcert && mkcert -install`
2. Generate certs:
   ```
   cd panel
   mkcert localhost 127.0.0.1 $(ipconfig getifaddr en0)
   ```
3. Set env vars in `panel.config.local.ts` or shell:
   ```
   PANEL_TOKEN=<your-secret>
   PANEL_TLS_CERT=/path/to/localhost+N.pem
   PANEL_TLS_KEY=/path/to/localhost+N-key.pem
   ```
4. Build and start: `pnpm build && pnpm start`
5. Access: `https://<your-lan-ip>:3010/login`

## Contributing

Make improvements directly in [pavilio](https://github.com/gmotyl/pavilio). If you're using this as an upstream for a private workspace, run `scripts/update.sh` to pull the latest changes — never push from your private repo back here.
