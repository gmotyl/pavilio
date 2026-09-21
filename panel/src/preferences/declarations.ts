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
 * Every import here is type-only on purpose. The registry sits underneath the
 * features, so pulling a feature module in at runtime would invert that — and
 * would close a cycle the moment those features start reading the registry.
 */
import { bool, json, num, str } from "./codecs";
import { definePreference, type PreferenceCodec, type PreferenceDef } from "./types";

import type { SortDir, SortKey } from "../features/projects/fileListControls";
import type { RepoSearchScope } from "../features/projects/useRepoSearch";
import type { GitViewMode } from "../features/git/useGitViewMode";
import type { DrawerSide } from "../features/terminal/useTerminalDrawer";
import type { TileLayout } from "../features/terminal/tileLayout";
import type { Period } from "../features/time/periodRange";
import type { ReportDetail, ReportFormat } from "../features/time/reportFormatters";

/**
 * A string codec narrowed to a small union. `str` accepts anything, so an
 * unknown stored value would be handed back typed as a member it is not;
 * throwing instead lets the store fall back to the declared default.
 */
function oneOf<T extends string>(values: readonly T[]): PreferenceCodec<T> {
  return {
    parse(raw) {
      if ((values as readonly string[]).includes(raw)) return raw as T;
      throw new Error(`not one of ${values.join("|")}: ${raw}`);
    },
    serialize(value) {
      return value;
    },
  };
}

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
  /** One global map keyed by repo path, exactly as the hook stores it today. */
  commitsOpen: definePreference<Record<string, boolean>>({
    key: "git.commitsOpen", // was: panel-commits-open
    scope: "global",
    default: {},
    codec: json<Record<string, boolean>>(),
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
   * unknown id at the boundary. The default is voices.ts's
   * DEFAULT_SPEECH_VOICE, duplicated rather than imported — a value import
   * would close a cycle once voices.ts reads the registry.
   */
  speechVoice: definePreference({
    key: "speech.voice", // was: panel-speech-voice
    scope: "global",
    default: "en-US-AndrewMultilingualNeural",
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
  // Stored in sessionStorage today, and machine local for the same reason: it
  // is where this browser was, not a choice the user made. `null` — not "" —
  // is the default, because the readers distinguish "nothing remembered" from
  // a remembered empty query.
  lastPath: definePreference<string | null>({
    key: "nav.lastPath", // was: panel:lastPath:<project>
    scope: "project",
    default: null,
    codec: json<string | null>(),
    portable: false,
  }),
  /** Scope argument: "<project>:<section>", mirroring the old key exactly. */
  lastSectionFile: definePreference<string | null>({
    key: "nav.lastFile", // was: panel:lastFile:<project>:<section>
    scope: "project",
    default: null,
    codec: json<string | null>(),
    portable: false,
  }),
  lastReposQuery: definePreference<string | null>({
    key: "nav.lastReposQuery", // was: panel:lastReposQuery:<project>
    scope: "project",
    default: null,
    codec: json<string | null>(),
    portable: false,
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
