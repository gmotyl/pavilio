# AGENTS.md - Panel

Agent guidance for the `panel/` app. Read this before making panel-specific changes.

## Required Folder Rules

- Treat `src/features/` as the source of truth for frontend structure.
- Do **not** recreate generic top-level buckets such as `src/components`, `src/hooks`, `src/pages`, `src/lib`, or `src/types`.
- New UI, hooks, helpers, types, and tests should live with the feature that owns them.
- Prefer `src/features/<feature>/...` over universal folders. If code is reused, give it a named home such as `shell`, `realtime`, or `search`.
- Keep tests beside their feature in `src/features/<feature>/__tests__/`.
- Prefer named exports over default exports for feature code. Only use default exports when there is a clear framework or ergonomics reason.
- When a file starts carrying multiple responsibilities (for example component + provider + hook), extract it into a colocated module folder such as `FeatureThing/index.tsx`, `FeatureThing/Provider.tsx`, and `FeatureThing/useThing.ts`.

## Current Feature Map

- `agents/` — agent cards and agent settings page
- `skills/` — skill list and skill loading hook (right sidebar)
- `explorer/` — file tree, active file context, file index hook
- `git/` — git views, git summary, diff helpers, git tree utilities, git hooks
- `markdown/` — markdown viewer, renderer, mermaid integration, image drop zone
- `projects/` — dashboard, project page, project/favorites hooks
- `realtime/` — shared websocket invalidation hook
- `search/` — quick finder, grep row, grep result type
- `shell/` — layout, sidebars, breadcrumbs, wide mode/sidebar state hooks

## Naming Conventions

- Feature folders: lowercase (`git`, `projects`, `shell`)
- React component/page files: PascalCase (`GitChanges.tsx`, `ProjectView.tsx`)
- Hooks: camelCase with `use` prefix (`useProjects.ts`)
- Small non-component helpers: local convention (`file-tree.ts`, `grep.ts`)

## Architecture Insights

- `src/App.tsx` is the composition root. It wires `ActiveFileProvider`, `BreadcrumbActionsProvider`, and `FloatingActionProvider`, then mounts `QuickFinder` once for the whole app.
- `features/shell/Layout/` owns the app chrome. `LeftSidebar` contains project/agent/git navigation; `RightSidebar` contains Explorer + Skills.
- Pages should inject top-bar actions via `useBreadcrumbActions` / `useFloatingAction` rather than editing shell markup directly.
- `features/realtime/useWebSocket.ts` is the shared refresh signal. `useProjects`, `useAgents`, `useFileIndex`, `useGitStatus`, `MarkdownViewer`, and `ProjectView` rely on it; reuse it instead of adding duplicate polling.
- `features/explorer/useActiveFile.ts` is the shared file-preview context used by multiple screens.
- `features/projects/ProjectView.tsx` is an intentional composition page: it assembles markdown, git, search, explorer, and shell helpers in one place.
- `features/git/file-tree.ts` is shared by git tree-based views; keep git-specific tree shaping there rather than moving it to a generic utility folder.
- `features/search/QuickFinder.tsx` is global search UI, but it stays feature-owned and is mounted from `App.tsx`, not from the shell.
- `features/markdown/MarkdownRenderer.tsx` and `MermaidDiagram.tsx` are tightly coupled; changes to markdown rendering usually need both files reviewed.

## Persistence / State Notes

- Several panel preferences are persisted in `localStorage` (`useWideMode`, `useSidebarState`, `useGitViewMode`, branch diff base branch selection).
- When refactoring these features, preserve storage keys unless the user explicitly asks for a migration.
- Frontend tests assume browser-like `localStorage` behavior; check `src/test-setup.ts` before changing persistence code.

## Validation Checklist

- Update imports after any file move.
- Run `npm run build` from `panel/` after structural refactors.
- Prefer targeted tests for touched features.
- If test infrastructure failures appear unrelated, report them clearly instead of masking them.
