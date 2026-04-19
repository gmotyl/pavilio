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
npm run dev
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
4. Start: `pnpm dev`
5. Access: `https://<your-lan-ip>:3010/login`

## Contributing

Make improvements directly in [pavilio](https://github.com/gmotyl/pavilio). If you're using this as an upstream for a private workspace, run `scripts/update.sh` to pull the latest changes — never push from your private repo back here.
