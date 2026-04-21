# Architecture overview

A quick tour of how Pavilio is put together, so you know where to look when something breaks or you want to extend it.

## Two processes, one port

- **Backend** — Express server in `panel/server/`. Serves the API under `/api/*`, a WebSocket for real-time updates, and in dev delegates everything else to Vite middleware.
- **Frontend** — Vite + React 19 app in `panel/src/`. In dev it's mounted inside the Express server; in prod it's built to static assets and served by the same Express process.

Both run on the same port (default `3010`). Only one `pnpm dev` needed.

## Where the data lives

The panel has no database. Everything is files on disk:

- **`projectsDir`** (configured in `panel.config.local.ts`) — holds one folder per project. Each folder with a `PROJECT.md` gets a dashboard card.
- **`~/.agent-registry.json`** — active AI agent sessions write a PID + project + timestamp here; the panel sidebar reads it.
- **`~/.panel/`** — mobile-auth state (rotating pairing token, signing key).

Because it's all files, edits from VS Code, the terminal, or another agent show up in the panel within seconds via `chokidar` file watching.

## Feature folders

Frontend code is organized by feature, not by layer:

```
panel/src/features/
├── explorer/        # file tree
├── favicon/         # dynamic favicon reflecting agent activity
├── mobile-access/   # Tailscale pairing UI
├── projects/        # dashboard and per-project view
├── realtime/        # shared WebSocket hook
├── search/          # Cmd+P finder
└── shell/           # layout chrome (header, sidebars)
```

Each feature owns its components, hooks, and tests. Cross-feature composition happens in `App.tsx` and `features/projects/ProjectView.tsx`. Don't create generic `src/components` or `src/hooks` folders — that pattern is intentionally avoided.

## Adding an API endpoint

1. Add a handler file under `panel/server/routes/`.
2. Mount it in `panel/server/index.ts` (look for `app.use("/api/...", router)`).
3. Call it from the frontend via `fetch("/api/...")` — same origin, no CORS to worry about.

## Build and test

```bash
cd panel
pnpm install
pnpm dev          # dev server
pnpm build        # static build (for prod / desktop packaging)
pnpm test         # vitest
```
