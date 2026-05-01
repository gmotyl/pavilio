# Panel UI Polish — Design Spec
_2026-05-01_

## Overview

Eight focused UI improvements to the Pavilio panel: sidebar restructure, mobile shortcut bar refresh, git diff layout, and reactive indicators.

---

## 1. Remove "New in project" from drawer

**File:** `panel/src/features/terminal/TerminalSpineDrawer.tsx`

Remove the entire bottom section (the "New in project" pill-buttons block). The `+` button in `TerminalMobileRail` and the sidebar `+` button (change 4b below) are sufficient for creating terminals.

---

## 2. Busy dot indicator on mobile hamburger

**File:** `panel/src/features/terminal/TerminalMobileRail.tsx`

Add a small dot overlay on the Menu (☰) button using the existing `useAggregateActivity()` hook:

- `busy` → amber dot (`var(--accent)` or `#f9e2af`)
- `attention` → green dot (`#a6e3a1`)
- `idle` → no dot

Dot is 6×6px, positioned absolute top-right of the button, with a 1px dark ring so it shows on any background.

---

## 3. Terminal focused-session highlight in sidebar

**File:** `panel/src/features/terminal/TerminalNavList.tsx`

`TerminalNavList` already renders all sessions grouped by project. Currently session buttons have no selected state.

**Change:** Track the globally focused session ID by listening to the `panel-terminal-focus` custom event (`TERMINAL_FOCUS_EVENT`). On mount, seed initial state from `localStorage["panel-terminal-focus-${project}"]` for the current project (read from `useParams`).

When a session button matches the tracked focused ID, apply the selected style:
- `background: var(--bg-active)` (same as NavLink active state)
- `color: var(--text-primary)`

The focused state resets to `null` when the user navigates away from any `/iterm` route (detect via `useLocation` watching `section !== "iterm"`).

---

## 4. Merged Projects + Terminals sidebar (Option A — manual expand)

**Files:** `panel/src/features/shell/LeftSidebar.tsx`, `panel/src/features/terminal/TerminalNavList.tsx`, new `panel/src/features/projects/useArchivedProjects.ts`, new route `/archive`

### 4a. Remove separate `TerminalNavList` section

The standalone "Terminals" section header is removed. Terminal sessions are now inline subtrees within the Projects list.

### 4b. Projects list with terminal subtrees

Each project row:
```
[▶/▼ chevron]  [project name]  [+ new terminal]  [⊡ archive]
```

- **Chevron (▶/▼):** toggles expand/collapse of the terminal session list for that project. Collapse state is per-project, persisted in `localStorage["panel-project-expanded-${name}"]`.
- **Project name click:** navigate to `/project/:name/iterm`
- **`+` button:** creates a new terminal in that project (calls `createTerminal({ project: name })`); only visible on row hover
- **`⊡` archive button:** moves project to archived state; only visible on row hover

When expanded, terminal sessions appear indented below the project row with:
- Activity LED dot (existing `TerminalActivityLed`)
- Session name (monospace)
- Selected state (highlight) when that session is focused (from change 3)

Collapsed projects with ≥1 busy/attention terminal show the aggregate dot to the right of the project name (same colors as change 2).

### 4c. Archive feature

**Data model:** `panel-archived-projects` localStorage key — a JSON array of `{ name: string, archivedAt: string }` objects. Archived projects are filtered out of the main nav list.

**Archive action:** clicking ⊡ on a project row sets it as archived, removes it from the main list. If currently viewing that project, navigate to `/` (Dashboard).

**Archive nav item:** Always-last entry in the Projects section:
```
📦  Archive
```
Clicking navigates to `/archive`.

### 4d. Archive page (`/archive`)

New page at `panel/src/pages/ArchivePage.tsx` (add route in router config).

Layout:
- Header: 📦 Archive
- Filter input (local state, filters by project name substring, case-insensitive)
- List of archived project cards: name, archived date, **Restore** button
- Restore: removes from archived list, returns project to main nav

---

## 5. Simplify TerminalNavList section header

**File:** `panel/src/features/terminal/TerminalNavList.tsx`

Since TerminalNavList is being merged into the Projects section (change 4), its standalone section header is removed entirely. The `+` button for new terminal moves into each project row (change 4b).

The empty-state "New terminal" button (when no sessions exist) is also removed — the project row `+` button handles creation.

---

## 6. Git diff: file list always on left (GitLab style)

**Files:** `panel/src/features/git/GitChanges.tsx`, `panel/src/features/git/GitBranchDiff.tsx`, `panel/src/features/projects/ProjectView.tsx`

### Layout change

When a diff is open and `showListSidebar` is true, current layout is `[diff] [file-list aside]` (diff left, list right). Swap to `[file-list aside] [diff]` (list left, diff right).

Change the flex container from:
```tsx
<div className="md:flex md:gap-4">
  <div className="flex-1 min-w-0">{diffEl}</div>
  <aside className="hidden md:block w-[280px] shrink-0 ...">
    {renderSidebarList()}
  </aside>
</div>
```
to:
```tsx
<div className="md:flex md:gap-4">
  <aside className="hidden md:block w-[240px] shrink-0 ...">
    {renderSidebarList()}
  </aside>
  <div className="flex-1 min-w-0">{diffEl}</div>
</div>
```

### Always show on desktop

In `ProjectView.tsx`, change `showListSidebar={wide}` to `showListSidebar` (always true) for both `GitChanges` and `GitBranchDiff`. The wide toggle is no longer needed for git sections (it may still control other layout aspects or can be removed from the repos tab).

### Tree/flat toggle

Both `GitChanges` and `GitBranchDiff` already have `viewMode: "flat" | "tree"` and a toggle in the section header toolbar. Ensure the toggle icons (already exist: `AlignJustify` for flat, `Folder`/`ChevronRight` for tree) are present in the file list sidebar header when `showListSidebar` is true.

---

## 7. Mobile shortcut bar — new button set

**File:** `panel/src/features/terminal/TerminalShortcutBar.tsx`

### Final BUTTONS array

```
Esc   ↑   ↓   ←   →   Tab   ⇧Tab   Ctrl+C   ⏎
```

In code:
```ts
const BUTTONS: ShortcutButton[] = [
  { label: "Esc", data: "\x1b" },
  { label: "↑",   data: "\x1b[A", mono: true },
  { label: "↓",   data: "\x1b[B", mono: true },
  { label: "←",   data: "\x1b[D", mono: true },
  { label: "→",   data: "\x1b[C", mono: true },
  { label: "Tab", data: "\t",     mono: true },
  { label: "⇧Tab", data: "\x1b[Z", mono: true },
  { label: "Ctrl+C", data: "\x03", important: true },
  { label: "⏎",  data: "\r",      confirm: true },   // last
];
```

Removed: `yes`, `1`, `2`, `3`. Added: `↑ ↓ ← →`, `Tab`. Moved: `Esc` first, `⏎` last.

---

## 8. Git sidebar auto-refresh on terminal idle

**File:** `panel/src/features/git/useGitStatus.ts`

`useGitStatus` currently refetches on `file-change` and `git-change` WebSocket events. Add a subscription to terminal activity: when any session transitions to `"attention"` state (terminal went idle — the green LED), call `fetchStatus()`.

```ts
// In useGitStatus — add alongside existing WebSocket effect:
const { sessions } = useAllTerminalSessions();
useEffect(() => {
  const ids = sessions.map((s) => s.id);
  const unsubs = ids.map((id) =>
    subscribeActivity(id, () => {
      if (getActivityState(id) === "attention") fetchStatus();
    }),
  );
  return () => unsubs.forEach((u) => u());
}, [sessions]);
```

Imports needed: `useAllTerminalSessions`, `subscribeActivity`, `getActivityState` from the terminal feature.

---

## Out of scope

- Mobile layout of the merged sidebar (existing mobile nav remains unchanged)
- Wide-mode toggle removal (leave the toggle, just change the git default)
- Any backend changes (archive is client-side only via localStorage)
