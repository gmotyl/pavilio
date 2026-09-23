/**
 * Every setting the panel remembers, declared once.
 *
 * A declaration is the only place a key, a default and a storage decision are
 * written down; the hooks that used to hold all three keep only their public
 * shape. The `// was:` comment on each entry names the raw storage key it
 * replaces, so the migration and the one-time seed have a single map to work
 * from.
 *
 * Defaults reproduce today's behavior exactly, with one deliberate exception
 * noted at `view.wide`.
 *
 * NO MIGRATION SHIPS, AND THAT IS THE DESIGN. design.md's Migration section is
 * explicit: "Existing `localStorage` values are not migrated by code. No
 * migration path ships." So after deploy every migrated setting reads its
 * declared default, and the old raw keys each `// was:` names are ORPHANED —
 * left in the browser, read by nothing, including the stored `false` entries
 * inside the old `panel-commits-open` blob. They are not lost by oversight;
 * they are not carried over. The workspace file is seeded by hand instead,
 * from this table's `// was:` map — that is Task 11, and it is the reason the
 * old key is written down next to every declaration rather than deleted.
 *
 * Every import here is type-only on purpose. The registry sits underneath the
 * features, so pulling a feature module in at runtime would invert that — and
 * would close a cycle the moment those features start reading the registry.
 */
import { bool, json, num, oneOf, str } from "./codecs";
import { definePreference, type PreferenceDef } from "./types";

import type { SortDir, SortKey } from "../features/projects/fileListControls";
import type { RepoSearchScope } from "../features/projects/useRepoSearch";
import type { GitViewMode } from "../features/git/useGitViewMode";
import type { DrawerSide } from "../features/terminal/useTerminalDrawer";
import type { TileLayout } from "../features/terminal/tileLayout";
import type { Period } from "../features/time/periodRange";
import type { ReportDetail, ReportFormat } from "../features/time/reportFormatters";

/** The file list's one sort, shared across every tab and project. */
export interface FileListSort {
  sortKey: SortKey;
  sortDir: SortDir;
}

/** A project's remembered choices on the Time tab's report block. */
export interface TimeReportPrefs {
  period: Period;
  format: ReportFormat;
  detail: ReportDetail;
}

/**
 * The voice the panel speaks with when nothing is stored. It lives here, not
 * in `features/speech/voices.ts`, because the registry is the lower layer:
 * voices.ts imports it from here, and a future `usePreference` call in
 * voices.ts then adds no cycle.
 */
export const DEFAULT_SPEECH_VOICE = "en-US-AndrewMultilingualNeural";

/**
 * Every row of design.md's portability table is now declared below.
 *
 * Two of them used to be listed here as deliberately absent — a declaration
 * with no writer is dead weight — and both have since landed. "Pane widths"
 * went first, when the file list and the git-history tree each got a rail.
 * "Sidebar expanded / width, both sides" is the last: only the two `expanded`
 * flags existed until `2026-09-21-panel-ui-polish` Task 4 added the handles,
 * and `shell.leftSidebar.width` and `shell.rightSidebar.width` arrive with
 * them. `declarations.test.ts`'s NOT_YET_DECLARED list is empty as a result,
 * and stays in place: the next row the design names but nothing writes yet
 * goes there rather than turning this paragraph back into prose.
 */

/**
 * ===========================================================================
 *  ADDING A DECLARATION WHOSE VALUE NAMES A LIVE SESSION?
 *
 *  Set `portable: false` — AND add its key to `SESSION_NAMING` in
 *  `preferences/__tests__/portability-guard.test.ts`.
 *
 *  A session id, a session ORDER, a tiling keyed by session, an armed speech
 *  cell, a bookmark into a live pane: each names something that exists on
 *  THIS machine, in THIS browser, right now. `.pavilio/preferences.json` is
 *  committed to a notes repo and carried to another machine, where every one
 *  of them is a dangling reference.
 *
 *  `SESSION_NAMING` is a hand list and nothing forces it to grow with this
 *  table. That gap is known and deliberate. Deriving it from a marker on the
 *  declaration (`sessionBearing: true`) would MOVE the gap rather than close
 *  it: an author who forgets the list forgets the marker just as easily, and
 *  a forgotten marker makes the declaration vanish from the guard SILENTLY,
 *  while a stale hand list fails loudly the moment a key is renamed or
 *  dropped. The list is also the one assertion in that file that does not
 *  read `portable` off the declaration — which is exactly what lets it catch
 *  a flag flipped on one of these.
 * ===========================================================================
 */
export const preferences = {
  // ── Shell ────────────────────────────────────────────────────────────────
  leftSidebarExpanded: definePreference({
    key: "shell.leftSidebar.expanded", // was: panel:leftSidebar
    scope: "global",
    default: true,
    codec: bool,
    portable: true,
  }),
  rightSidebarExpanded: definePreference({
    key: "shell.rightSidebar.expanded", // was: panel:rightSidebar
    scope: "global",
    default: true,
    codec: bool,
    portable: true,
  }),
  /**
   * The left sidebar's width. No `// was:` line: nothing stored it before,
   * because the pane took a fixed 240px from the stylesheet — so a workspace
   * with no entry opens exactly as it always has. This default is now that
   * number's only home; `index.css` keeps no copy of it.
   *
   * Global, like the `expanded` flag above it: how wide you like your
   * navigation column is a habit, not a fact about one project.
   */
  leftSidebarWidth: definePreference({
    key: "shell.leftSidebar.width", // was: nothing — the sidebar had a fixed width
    scope: "global",
    default: 240,
    codec: num,
    portable: true,
  }),
  /**
   * The right sidebar's width, and a SECOND declaration rather than one keyed
   * by side — for the reason `useSidebarState` already gives about the two
   * `expanded` flags: the sides are not a list. They are also not the same
   * number. 264 was the width the layout hard-coded before the sidebar became
   * resizable; this declaration is its only home now, and it is wider than the
   * left on purpose: this side holds file trees, which indent.
   */
  rightSidebarWidth: definePreference({
    key: "shell.rightSidebar.width", // was: nothing — the sidebar had a fixed width
    scope: "global",
    default: 264,
    codec: num,
    portable: true,
  }),
  /** Scope argument: the right sidebar's section key, e.g. "skills". */
  rightSidebarSectionExpanded: definePreference({
    key: "shell.rightSidebar.section.expanded", // was: rightSidebar.<section>.expanded
    scope: "project",
    default: true,
    codec: bool,
    portable: true,
  }),
  projectExpanded: definePreference({
    key: "shell.project.expanded", // was: panel-project-expanded-<project>
    scope: "project",
    default: false,
    codec: bool,
    portable: true,
  }),
  /**
   * Scope argument: the view key, e.g. "viewer", "repos", "notes".
   *
   * The one default that does NOT reproduce today's behavior. `useWideMode`
   * reads `=== "true"`, so a fresh browser opens every view compact; wide is
   * the better starting point and this is where that flip is made.
   */
  wideMode: definePreference({
    key: "view.wide", // was: panel-wide-<viewKey>
    scope: "project",
    default: true,
    codec: bool,
    portable: true,
  }),

  // ── File list and project lists ──────────────────────────────────────────
  fileListSort: definePreference<FileListSort>({
    key: "fileList.sort", // was: panel:fileList.sort
    scope: "global",
    default: { sortKey: "date", sortDir: "desc" },
    codec: json<FileListSort>(),
    portable: true,
  }),
  fileListSidebarCollapsed: definePreference({
    key: "fileList.sidebarCollapsed", // was: panel:fileListSidebar.collapsed
    scope: "global",
    default: false,
    codec: bool,
    portable: true,
  }),
  /**
   * The pinned-open file list's width. No `// was:` line: nothing stored it
   * before, because the pane was the fixed `md:w-72` — 18rem, hence 288, so a
   * workspace with no entry opens exactly as it always has.
   *
   * Global, like the collapse flag above it: how wide you like to read a file
   * list is a habit, not a fact about one project.
   */
  fileListPaneWidth: definePreference({
    key: "fileList.paneWidth", // was: nothing — the pane had a fixed width
    scope: "global",
    default: 288,
    codec: num,
    portable: true,
  }),
  favoriteProjects: definePreference<string[]>({
    key: "projects.favorites", // was: panel:favoriteProjects
    scope: "global",
    default: [],
    codec: json<string[]>(),
    portable: true,
  }),
  repoSearchScope: definePreference<RepoSearchScope>({
    key: "repos.searchScope", // was: panel-repo-search-scope
    scope: "global",
    default: "changed",
    codec: oneOf<RepoSearchScope>(["changed", "branch-diff", "commits"]),
    portable: true,
  }),
  searchIncludeArchived: definePreference({
    key: "search.includeArchived", // was: panel-search-include-archived
    scope: "global",
    default: true,
    codec: bool,
    portable: true,
  }),

  // ── Git ──────────────────────────────────────────────────────────────────
  gitViewMode: definePreference<GitViewMode>({
    key: "git.viewMode", // was: panel-git-view-mode
    scope: "global",
    default: "flat",
    codec: oneOf<GitViewMode>(["flat", "tree"]),
    portable: true,
  }),
  /**
   * One key per repository, not the hook's single JSON blob. A blob's inner
   * keys can never run through `normalizeRepoScope`, so `~/git/prv/pavilio`
   * and `/root/git/prv/pavilio` would stay two entries with opposite values —
   * the exact collision repo scope exists to close, and the reason this is
   * symmetric with `git.branchDiff.open` rather than shaped like the hook.
   *
   * Default `true`: `useCommitsOpenMap.isOpen` reads `map[repoPath] !== false`,
   * so a repo with no entry is OPEN today. (Absent ≠ closed — the map merely
   * starts `{}`.)
   */
  commitsOpen: definePreference({
    key: "git.commitsOpen", // was: panel-commits-open (one blob keyed by repo path)
    scope: "repo",
    default: true,
    codec: bool,
    portable: true,
  }),
  /**
   * The git-history commit tree's width. No `// was:` line, for the same
   * reason as `fileList.paneWidth`: nothing stored it before, because the pane
   * was the fixed `w-[280px]` — so 280, and a workspace with no entry opens
   * exactly as it always has.
   *
   * Global, not `repo`, even though the tree only ever appears beside a repo's
   * diff. How wide you like to read a list of changed paths is a habit; it
   * does not become a different preference because you switched repository.
   * The scope is also load-bearing for the key: a `repo` scope would append
   * `@<repo>` to the storage key, and this one is read under the bare key.
   */
  gitHistoryPaneWidth: definePreference({
    key: "git.history.paneWidth", // was: nothing — the tree had a fixed width
    scope: "global",
    default: 280,
    codec: num,
    portable: true,
  }),
  /** Empty means "nothing chosen yet" — the view then picks main/master/develop. */
  branchDiffBase: definePreference({
    key: "git.branchDiff.base", // was: panel-branch-diff-base-<repo>
    scope: "repo",
    default: "",
    codec: str,
    portable: true,
  }),
  branchDiffOpen: definePreference({
    key: "git.branchDiff.open", // was: panel-branch-diff-open-<repo>
    scope: "repo",
    default: true,
    codec: bool,
    portable: true,
  }),
  worktreeExpanded: definePreference({
    key: "git.worktree.expanded", // was: panel-worktree-expanded-<worktree path>
    scope: "repo",
    default: false,
    codec: bool,
    portable: true,
  }),

  // ── Terminal ─────────────────────────────────────────────────────────────
  terminalDrawerOpen: definePreference({
    key: "terminal.drawer.open", // was: panel:terminalDrawer:open
    scope: "global",
    default: false,
    codec: bool,
    portable: true,
  }),
  terminalDrawerSide: definePreference<DrawerSide>({
    key: "terminal.drawer.side", // was: panel:terminalDrawer:side
    scope: "global",
    default: "left",
    codec: oneOf<DrawerSide>(["left", "right"]),
    portable: true,
  }),
  /** DRAWER_DEFAULT_WIDTH. The live viewport clamp stays in the hook. */
  terminalDrawerWidth: definePreference({
    key: "terminal.drawer.width", // was: panel:terminalDrawer:width
    scope: "global",
    default: 480,
    codec: num,
    portable: true,
  }),
  /** Scope argument: a project name, or "__all__" for the cross-project grid. */
  terminalMaximized: definePreference({
    key: "terminal.maximized", // was: panel-terminal-maximized-<project>
    scope: "project",
    default: false,
    codec: bool,
    portable: true,
  }),

  // ── Machine local: values naming a live session ──────────────────────────
  /** A session id, so it means nothing on another machine. */
  terminalFocus: definePreference<string | null>({
    key: "terminal.focus", // was: panel-terminal-focus-<project>
    scope: "project",
    default: null,
    codec: json<string | null>(),
    portable: false,
  }),
  terminalOrder: definePreference<string[]>({
    key: "terminal.order", // was: panel-terminal-order-<project|__all__>
    scope: "project",
    default: [],
    codec: json<string[]>(),
    portable: false,
  }),
  terminalGrid: definePreference<TileLayout>({
    key: "terminal.grid", // was: panel-terminal-grid-<project|__all__>
    scope: "project",
    default: [],
    codec: json<TileLayout>(),
    portable: false,
  }),

  // ── Speech ───────────────────────────────────────────────────────────────
  /**
   * Typed `string`, not `SpeechVoiceId`: the voice list is long enough that a
   * codec would have to duplicate it, and `resolveVoice()` already drops an
   * unknown id at the boundary. The default lives here and `voices.ts`
   * imports it — upward, from the lower layer — so there is one copy. The
   * other direction is what would close a cycle once voices.ts reads the
   * registry.
   */
  speechVoice: definePreference({
    key: "speech.voice", // was: panel-speech-voice
    scope: "global",
    default: DEFAULT_SPEECH_VOICE,
    codec: str,
    portable: true,
  }),
  answerPaneAutoOpen: definePreference({
    key: "speech.answerPane.autoOpen", // was: panel-answer-pane-auto-open
    scope: "global",
    default: false,
    codec: bool,
    portable: true,
  }),
  /** The one cell allowed to speak on its own — a session id. */
  speechArmedCell: definePreference<string | null>({
    key: "speech.armedCell", // was: panel-speech-armed
    scope: "global",
    default: null,
    codec: json<string | null>(),
    portable: false,
  }),

  // ── Navigation memory ────────────────────────────────────────────────────
  // Machine local, and narrower still: `sessionStorage`, not `localStorage`.
  // `features/shell/lastPath.ts` uses the session store on purpose, and
  // panel-shell's spec makes it normative — "a second browser tab keeps its
  // own independent bookmark, and a fully closed browser starts fresh".
  // Routing these to `localStorage` because they are merely non-portable
  // would break both clauses, so they declare the session tier explicitly.
  // `null` — not "" — is the default, because the readers distinguish
  // "nothing remembered" from a remembered empty query.
  lastPath: definePreference<string | null>({
    key: "nav.lastPath", // was: panel:lastPath:<project>
    scope: "project",
    default: null,
    codec: json<string | null>(),
    portable: false,
    browserStore: "session",
  }),
  /** Scope argument: "<project>:<section>", mirroring the old key exactly. */
  lastSectionFile: definePreference<string | null>({
    key: "nav.lastFile", // was: panel:lastFile:<project>:<section>
    scope: "project",
    default: null,
    codec: json<string | null>(),
    portable: false,
    browserStore: "session",
  }),
  lastReposQuery: definePreference<string | null>({
    key: "nav.lastReposQuery", // was: panel:lastReposQuery:<project>
    scope: "project",
    default: null,
    codec: json<string | null>(),
    portable: false,
    browserStore: "session",
  }),

  // ── Time ─────────────────────────────────────────────────────────────────
  // Both share the busy accumulator's `pavilio.time.` prefix and neither is the
  // accumulator: `pavilio.time.<project>` stays raw localStorage, undeclared.
  timeReport: definePreference<TimeReportPrefs>({
    key: "time.report", // was: pavilio.time.report.<project>
    scope: "project",
    default: { period: "this-week", format: "text", detail: "detailed" },
    codec: json<TimeReportPrefs>(),
    portable: true,
  }),
  timeFormResetAutoOnSave: definePreference({
    key: "time.form.resetAutoOnSave", // was: pavilio.time.form.<project>.resetAutoOnSave
    scope: "project",
    default: false,
    codec: bool,
    portable: true,
  }),
};

/** The whole table, for the registry's own invariants and the store's lookups. */
export const ALL_PREFERENCES: readonly PreferenceDef<unknown>[] =
  Object.values(preferences);
