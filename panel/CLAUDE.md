# Claude Code Configuration - Panel

## First Rule

Read `AGENTS.md` in this folder before doing anything else.

## How To Use This File

1. Read `panel/AGENTS.md` first.
2. Treat `panel/AGENTS.md` as the authoritative instruction set for panel work.
3. If `panel/CLAUDE.md` and `panel/AGENTS.md` ever conflict, follow `panel/AGENTS.md`.
4. Follow the feature-folder architecture in `panel/AGENTS.md`; do not recreate generic folders like `src/components` or `src/hooks`.
5. After structural changes, run `pnpm lint` from `panel/` — the type check; `pnpm build` is `vite build` only and does not typecheck.

## Quick Reminders

- Feature ownership lives in `src/features/`
- Shared UI shell lives in `src/features/shell/`
- Shared realtime refresh path lives in `src/features/realtime/useWebSocket.ts`
- Cross-feature composition happens mainly in `src/App.tsx` and `src/features/projects/ProjectView.tsx`