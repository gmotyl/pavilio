import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  FileText,
  ExternalLink,
  Copy,
  Check,
  ArrowLeft,
  GitFork,
  Search,
  X,
  Terminal,
} from "lucide-react";
import { useActiveFile } from "../explorer/useActiveFile";
import { useFileIndex } from "../explorer/useFileIndex";
import GitBranchDiff from "../git/GitBranchDiff";
import GitChanges from "../git/GitChanges";
import GitHistory from "../git/GitHistory";
import { useGitViewMode } from "../git/useGitViewMode";
import ImageDropZone from "../markdown/ImageDropZone";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import { useWebSocket } from "../realtime/useWebSocket";
import GrepResultRow from "../search/GrepResultRow";
import type { GrepResult } from "../search/grep";
import { useFloatingAction } from "../shell/Layout";
import { useLastPath } from "../shell/useLastPath";
import { useWideMode } from "../shell/useWideMode";
import WideToggle from "../shell/WideToggle";
import { useProjects } from "./useProjects";
import { TerminalToolbar } from "../terminal/TerminalToolbar";
import { TerminalLayoutGrid } from "../terminal/TerminalLayoutGrid";
import { TerminalShortcutBar } from "../terminal/TerminalShortcutBar";
import { TerminalMobileRail } from "../terminal/TerminalMobileRail";
import { TerminalSpine } from "../terminal/TerminalSpine";
import { TerminalSpineDrawer } from "../terminal/TerminalSpineDrawer";
import {
  useTerminalSessions,
  nextProjectName,
} from "../terminal/useTerminalSessions";
import type { CreateSessionOpts } from "../terminal/useTerminalSessions";
import { useTerminalMaximized } from "../terminal/useTerminalMaximized";
import { useAllTerminalSessions } from "../terminal/useAllTerminalSessions";
import type { TerminalHandle } from "../terminal/TerminalView";
import { Menu } from "lucide-react";

export default function ProjectView() {
  const { name, section } = useParams<{ name: string; section?: string }>();
  useLastPath(name);
  const [content, setContent] = useState<string | null>(null);
  const [absolutePath, setAbsolutePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const files = useFileIndex();
  const projects = useProjects();
  const { lastMessage } = useWebSocket();
  const { setActiveFile } = useActiveFile();

  const navTo = useNavigate();
  const project = projects.find((p) => p.name === name);
  const hasRepos = (project?.repos?.length ?? 0) > 0;

  const terminal = useTerminalSessions(name || "");
  const allTerminals = useAllTerminalSessions();
  const { sessions: allSessions } = allTerminals;
  const [maximized, toggleMaximized, setMaximized] = useTerminalMaximized(
    name || "",
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);

  const terminalHandlesRef = useRef<Map<string, TerminalHandle>>(new Map());

  // Create a session in ANY project and navigate if different from current.
  const createTerminal = useCallback(
    async (opts: CreateSessionOpts = {}) => {
      const targetProject = opts.project ?? name ?? "";
      console.info("[terminal] createTerminal called", {
        opts,
        targetProject,
        currentProject: name,
      });
      if (!targetProject) {
        console.warn("[terminal] createTerminal: no targetProject resolved");
        return;
      }
      if (targetProject === (name || "")) {
        await terminal.createSession(opts);
        return;
      }
      // Cross-project: derive name from the target project's existing sessions.
      const targetSessions = allSessions.filter(
        (s) => s.project === targetProject,
      );
      const derivedName =
        opts.name || nextProjectName(targetProject, targetSessions);
      try {
        const res = await fetch("/api/terminal/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: opts.cwd,
            name: derivedName,
            project: targetProject,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.warn(
            `[terminal] cross-project create returned ${res.status} ${text}`,
          );
          return;
        }
        const created = await res.json();
        console.info("[terminal] cross-project session created", created);
        try {
          localStorage.setItem(
            `panel-terminal-focus-${targetProject}`,
            created.id,
          );
        } catch (err) {
          console.warn("[terminal] persist focus for new project:", err);
        }
        navTo(`/project/${targetProject}/iterm`);
      } catch (err) {
        console.warn("[terminal] cross-project create failed:", err);
      }
    },
    [name, terminal, navTo, allSessions],
  );

  // Keyboard shortcuts — only active while in the iTerm tab
  useEffect(() => {
    if (section !== "iterm") return;

    const handler = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (isEditable) return;

      // Cmd/Ctrl + Shift + Enter → toggle maximize
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !e.altKey &&
        (e.key === "Enter" || e.code === "Enter")
      ) {
        e.preventDefault();
        setMaximized(!maximized);
        return;
      }

      // Cmd/Ctrl + 1..9 → focus terminal at that 1-based index
      // Cmd/Ctrl + 0    → clear focus (show all)
      // Cmd/Ctrl + `    → cycle to next session
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        // Use e.code for digits so Shift-less numeric keys match on all layouts.
        const digitMatch = /^Digit([0-9])$/.exec(e.code);
        if (digitMatch) {
          const digit = Number(digitMatch[1]);
          e.preventDefault();
          if (digit === 0) {
            terminal.setFocusedId(null);
          } else {
            const target = terminal.sessions[digit - 1];
            if (target) terminal.setFocusedId(target.id);
          }
          return;
        }
        if (e.key === "`" || e.code === "Backquote") {
          e.preventDefault();
          const ids = terminal.sessions.map((s) => s.id);
          if (ids.length === 0) return;
          const currentIdx = terminal.focusedId
            ? ids.indexOf(terminal.focusedId)
            : -1;
          const nextIdx = (currentIdx + 1) % ids.length;
          terminal.setFocusedId(ids[nextIdx]);
          return;
        }
      }

      // Ctrl+Shift+1..6 → navigate to iTerm tab of project 1..6
      // Use e.code because Shift changes e.key to "!", "@", "#", etc.
      if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey) {
        const digitMatch = /^Digit([1-6])$/.exec(e.code);
        if (digitMatch) {
          const digit = Number(digitMatch[1]);
          e.preventDefault();
          const proj = projects[digit - 1];
          if (proj) navTo(`/project/${proj.name}/iterm`);
          return;
        }
      }

      // Escape → exit maximize (when not inside an input)
      if (e.key === "Escape" && maximized) {
        e.preventDefault();
        setMaximized(false);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    section,
    terminal.sessions,
    terminal.focusedId,
    terminal.setFocusedId,
    projects,
    navTo,
    maximized,
    setMaximized,
  ]);

  const [wide, toggleWide] = useWideMode(section || "overview");

  const [gitViewMode, setGitViewMode] = useGitViewMode();

  const wideToggle = <WideToggle wide={wide} onToggle={toggleWide} />;

  useFloatingAction(wideToggle, [wide, toggleWide]);

  const COMMITS_OPEN_KEY = "panel-commits-open";
  const [commitsOpenMap, setCommitsOpenMap] = useState<Record<string, boolean>>(
    () => {
      try {
        return JSON.parse(localStorage.getItem(COMMITS_OPEN_KEY) || "{}");
      } catch {
        return {};
      }
    },
  );
  const getCommitsOpen = (repoPath: string) =>
    commitsOpenMap[repoPath] !== false;
  const handleCommitsOpenChange = (repoPath: string, open: boolean) => {
    const next = { ...commitsOpenMap, [repoPath]: open };
    setCommitsOpenMap(next);
    try {
      localStorage.setItem(COMMITS_OPEN_KEY, JSON.stringify(next));
    } catch {}
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GrepResult[]>([]);
  const [searchActive, setSearchActive] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Repos search: trigger opening a specific file diff in a child component (URL-backed)
  const repoOpenFile = (() => {
    const repo = searchParams.get("repo");
    const file = searchParams.get("file");
    if (!repo || !file) return null;
    return {
      repo,
      file,
      scope: searchParams.get("scope") ?? "",
      highlight: searchParams.get("highlight") ?? "",
    };
  })();

  const setRepoOpenFile = useCallback(
    (
      next:
        | { repo: string; file: string; scope: string; highlight: string }
        | null,
    ) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next) {
          params.set("repo", next.repo);
          params.set("file", next.file);
          if (next.highlight) params.set("highlight", next.highlight);
          else params.delete("highlight");
          if (next.scope) params.set("scope", next.scope);
          else params.delete("scope");
        } else {
          params.delete("repo");
          params.delete("file");
          params.delete("highlight");
          params.delete("scope");
        }
        return params;
      });
    },
    [setSearchParams],
  );
  const [searchSelectedIdx, setSearchSelectedIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearchQuery("");
    setSearchResults([]);
    setSearchActive(false);
  }, [name]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && name) {
        e.preventDefault();
        setSearchActive(true);
        setTimeout(() => searchInputRef.current?.focus(), 10);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [name]);

  const isReposSearch = section === "repos";
  type RepoSearchScope = "changed" | "branch-diff" | "commits";
  const SCOPE_KEY = "panel-repo-search-scope";
  const [repoSearchScope, setRepoSearchScope] = useState<RepoSearchScope>(
    () => {
      return (localStorage.getItem(SCOPE_KEY) as RepoSearchScope) || "changed";
    },
  );
  const handleScopeChange = (scope: RepoSearchScope) => {
    setRepoSearchScope(scope);
    localStorage.setItem(SCOPE_KEY, scope);
  };

  // Fetch repo files for search — triggered by scope/repos changes
  const [repoFiles, setRepoFiles] = useState<
    {
      status: string;
      path: string;
      repo: string;
      repoName: string;
      source: RepoSearchScope;
    }[]
  >([]);
  const repoPathsKey = project?.repos?.map((r) => r.path).join(",") ?? "";
  useEffect(() => {
    if (!isReposSearch || !project?.repos?.length) {
      setRepoFiles([]);
      return;
    }
    let cancelled = false;
    const repos = project.repos;
    (async () => {
      const all: typeof repoFiles = [];
      await Promise.all(
        repos.map(async (repo) => {
          const qs = `repo=${encodeURIComponent(repo.path)}`;
          // Changed files
          if (repoSearchScope === "changed") {
            try {
              const res = await fetch(`/api/git/status?${qs}`);
              if (res.ok) {
                const files: { status: string; path: string }[] =
                  await res.json();
                all.push(
                  ...files.map((f) => ({
                    ...f,
                    repo: repo.path,
                    repoName: repo.name,
                    source: "changed" as const,
                  })),
                );
              }
            } catch {}
          }
          // Branch diff files
          if (repoSearchScope === "branch-diff") {
            const base = localStorage.getItem(
              `panel-branch-diff-base-${repo.path}`,
            );
            if (base) {
              try {
                const res = await fetch(
                  `/api/git/branch-diff-files?base=${encodeURIComponent(base)}&${qs}`,
                );
                if (res.ok) {
                  const data = await res.json();
                  all.push(
                    ...(data.files || []).map(
                      (f: { status: string; path: string }) => ({
                        ...f,
                        repo: repo.path,
                        repoName: repo.name,
                        source: "branch-diff" as const,
                      }),
                    ),
                  );
                }
              } catch {}
            }
          }
          // Recent commits — file paths from last N commits
          if (repoSearchScope === "commits") {
            try {
              const logRes = await fetch(`/api/git/log?limit=10&${qs}`);
              if (logRes.ok) {
                const commits: { sha: string; message: string }[] =
                  await logRes.json();
                const seen = new Set<string>();
                await Promise.all(
                  commits.map(async (c) => {
                    try {
                      const cfRes = await fetch(
                        `/api/git/commit-files?sha=${c.sha}&${qs}`,
                      );
                      if (cfRes.ok) {
                        const cf: { status: string; path: string }[] =
                          await cfRes.json();
                        for (const f of cf) {
                          if (!seen.has(f.path)) {
                            seen.add(f.path);
                            all.push({
                              ...f,
                              repo: repo.path,
                              repoName: repo.name,
                              source: "commits" as const,
                            });
                          }
                        }
                      }
                    } catch {}
                  }),
                );
              }
            } catch {}
          }
        }),
      );
      if (!cancelled) setRepoFiles(all);
    })();
    return () => {
      cancelled = true;
    };
  }, [isReposSearch, repoPathsKey, repoSearchScope]);

  // Repos tab: grep within scoped files
  const [repoGrepResults, setRepoGrepResults] = useState<GrepResult[]>([]);
  const [repoGrepLoading, setRepoGrepLoading] = useState(false);
  useEffect(() => {
    if (!isReposSearch || searchQuery.length < 2 || repoFiles.length === 0) {
      setRepoGrepResults([]);
      return;
    }
    setRepoGrepLoading(true);
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const allResults: GrepResult[] = [];
        // Group files by repo
        const byRepo = new Map<string, string[]>();
        for (const f of repoFiles) {
          if (!byRepo.has(f.repo)) byRepo.set(f.repo, []);
          byRepo.get(f.repo)!.push(f.path);
        }
        await Promise.all(
          [...byRepo.entries()].map(async ([repo, files]) => {
            const url = `/api/git/grep?q=${encodeURIComponent(searchQuery)}&repo=${encodeURIComponent(repo)}&files=${encodeURIComponent(files.join(","))}`;
            const res = await fetch(url, { signal: abort.signal });
            if (res.ok) {
              const results: GrepResult[] = await res.json();
              allResults.push(...results.map((r) => ({ ...r, project: repo })));
            }
          }),
        );
        if (!abort.signal.aborted) setRepoGrepResults(allResults);
      } catch (e: any) {
        if (e.name !== "AbortError") setRepoGrepResults([]);
      } finally {
        if (!abort.signal.aborted) setRepoGrepLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [isReposSearch, searchQuery, repoFiles]);

  useEffect(() => {
    if (isReposSearch) return;
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search/grep?q=${encodeURIComponent(searchQuery)}&project=${encodeURIComponent(name!)}`,
          { signal: abort.signal },
        );
        if (res.ok) setSearchResults(await res.json());
        else setSearchResults([]);
      } catch (e: any) {
        if (e.name !== "AbortError") setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [searchQuery, name, isReposSearch]);

  useEffect(() => {
    setSearchSelectedIdx(0);
  }, [searchQuery]);

  const openSearchResult = useCallback(
    (path: string) => {
      navTo(`/view/${path}`);
    },
    [navTo],
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setSearchActive(false);
        setSearchQuery("");
        setSearchResults([]);
        return;
      }
      const count = searchResults.length;
      if (!count) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSearchSelectedIdx((i) => (i + 1) % count);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSearchSelectedIdx((i) => (i - 1 + count) % count);
      } else if (e.key === "Enter") {
        const r = searchResults[searchSelectedIdx];
        if (r) openSearchResult(r.relativePath);
      }
    },
    [searchResults, searchSelectedIdx, openSearchResult],
  );

  const selectedFile = searchParams.get("file");
  const [fileContent, setFileContent] = useState("");
  const [fileAbsPath, setFileAbsPath] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const setSelectedFile = useCallback(
    (path: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (path) next.set("file", path);
          else next.delete("file");
          return next;
        },
      );
      setActiveFile(path);
    },
    [setSearchParams, setActiveFile],
  );

  useEffect(() => {
    if (!name || section) return;
    setContent(null);
    setError(null);
    fetch(`/api/files/read/${name}/PROJECT.md`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Not found (${res.status})`);
        const data = await res.json();
        setContent(data.content);
        setAbsolutePath(data.absolutePath || "");
      })
      .catch((err) => setError(err.message));
  }, [name, section]);

  useEffect(() => {
    if (!selectedFile) return;
    setFileLoading(true);
    fetch(`/api/files/read/${selectedFile}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setFileContent(data.content);
          setFileAbsPath(data.absolutePath || "");
        } else {
          setSelectedFile(null);
        }
      })
      .finally(() => setFileLoading(false));
  }, [selectedFile, setSelectedFile]);

  useEffect(() => {
    if (!selectedFile || lastMessage?.type !== "file-change") return;
    const changedPath = lastMessage.path as string;
    if (changedPath?.includes(selectedFile)) {
      fetch(`/api/files/read/${selectedFile}`).then(async (res) => {
        if (res.ok) setFileContent((await res.json()).content);
      });
    }
  }, [lastMessage, selectedFile]);

  const sectionFiles =
    section && section !== "repos" && section !== "iterm"
      ? files
          .filter((f) => {
            if (
              f.project !== name ||
              f.relativePath.split("/")[1] !== section
            ) {
              return false;
            }

            if (section === "notes") {
              return f.relativePath.endsWith(".md");
            }

            return true;
          })
          .sort((a, b) => b.modified - a.modified)
      : [];

  const sections = ["iterm", "plans", "notes", "memo", "progress", "qa"];
  if (hasRepos) sections.push("repos");

  const openInVSCode = (path: string) =>
    window.open(`vscode://file/${path}`, "_self");

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isMarkdown = (p: string) => p.endsWith(".md");
  const isJson = (p: string) => p.endsWith(".json");

  return (
    <div className={`p-6 ${wide ? "" : "max-w-5xl"}`}>
      {/* Desktop-only big title */}
      <h1 className="hidden md:block text-2xl font-semibold mb-4 capitalize">
        {name}
      </h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 text-sm relative items-center">
        {(() => {
          const nonIterm = sections.filter((s) => s !== "iterm");
          const tabs = [
            { label: "iterm", to: `/project/${name}/iterm`, active: section === "iterm" },
            { label: "Overview", to: `/project/${name}`, active: !section },
            ...nonIterm.map((s) => ({
              label: s,
              to: `/project/${name}/${s}`,
              active: section === s,
            })),
          ];
          const activeTab = tabs.find((t) => t.active) || tabs[0];
          return (
            <>
              {/* Mobile: hamburger + current-tab + project name — one row */}
              <div className="flex md:hidden items-center relative flex-1 min-w-0 gap-2">
                <button
                  type="button"
                  onClick={() => setTabMenuOpen((o) => !o)}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors shrink-0"
                  style={{
                    background: "var(--bg-base)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <Menu size={13} />
                  <span className="capitalize text-[12px]">
                    {activeTab.label === "iterm" ? "iTerm" : activeTab.label}
                  </span>
                </button>
                <h1
                  className="text-[15px] font-semibold capitalize truncate min-w-0"
                  style={{ color: "var(--text-primary)" }}
                >
                  {name}
                </h1>
                {tabMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      style={{ background: "transparent" }}
                      onClick={() => setTabMenuOpen(false)}
                    />
                    <div
                      className="absolute left-0 top-full z-40 mt-1 min-w-[180px] rounded-md py-1 shadow-lg"
                      style={{
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      {tabs.map((tab) => (
                        <Link
                          key={tab.label}
                          to={tab.to}
                          onClick={() => setTabMenuOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 capitalize transition-colors"
                          style={{
                            background: tab.active
                              ? "var(--bg-active)"
                              : "transparent",
                            color: tab.active
                              ? "var(--text-primary)"
                              : "var(--text-secondary)",
                          }}
                        >
                          {tab.label === "iterm" && <Terminal size={12} />}
                          {tab.label === "iterm" ? "iTerm" : tab.label}
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Desktop: inline tabs */}
              <div className="hidden md:flex gap-1">
                {tabs.map((tab) => (
                  <Link
                    key={tab.label}
                    to={tab.to}
                    className="px-3 py-1.5 rounded-md capitalize transition-colors flex items-center gap-1.5"
                    style={{
                      background: tab.active
                        ? "var(--bg-active)"
                        : "transparent",
                      color: tab.active
                        ? "var(--text-primary)"
                        : "var(--text-tertiary)",
                    }}
                    onMouseEnter={(e) => {
                      if (!tab.active)
                        e.currentTarget.style.background = "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (!tab.active)
                        e.currentTarget.style.background = tab.active
                          ? "var(--bg-active)"
                          : "transparent";
                    }}
                  >
                    {tab.label === "iterm" && <Terminal size={12} />}
                    {tab.label === "iterm" ? "iTerm" : tab.label}
                  </Link>
                ))}
              </div>
            </>
          );
        })()}
        {/* Search toggle */}
        <button
          onClick={() => {
            setSearchActive((a) => !a);
            setTimeout(() => searchInputRef.current?.focus(), 10);
          }}
          className="ml-auto px-2 py-1.5 rounded-md transition-colors"
          style={{
            color: searchActive ? "var(--accent)" : "var(--text-tertiary)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
          title="Search in project (Cmd+F)"
        >
          <Search size={14} />
        </button>
      </div>

      {/* Project search bar */}
      {searchActive && (
        <div className="mb-4">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{
              background: "var(--bg-base)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <Search size={14} style={{ color: "var(--accent)" }} />
            {isReposSearch && (
              <div
                className="flex rounded overflow-hidden shrink-0"
                style={{ border: "1px solid var(--border-subtle)" }}
              >
                {(
                  [
                    ["changed", "Changed"],
                    ["branch-diff", "Branch diff"],
                    ["commits", "Commits"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => handleScopeChange(key)}
                    className="text-[10px] px-1.5 py-0.5 transition-colors"
                    style={{
                      background:
                        repoSearchScope === key
                          ? "color-mix(in srgb, var(--accent) 20%, transparent)"
                          : "transparent",
                      color:
                        repoSearchScope === key
                          ? "var(--accent)"
                          : "var(--text-muted)",
                      borderRight:
                        key !== "commits"
                          ? "1px solid var(--border-subtle)"
                          : "none",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={isReposSearch ? undefined : handleSearchKeyDown}
              placeholder={
                isReposSearch
                  ? `Search in ${repoFiles.length} ${repoSearchScope === "changed" ? "changed" : repoSearchScope === "branch-diff" ? "diff" : "commit"} files...`
                  : `Search in ${name}...`
              }
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--text-primary)" }}
              spellCheck={false}
              autoComplete="off"
            />
            {searchQuery && !isReposSearch && (
              <span
                className="text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                {searchResults.length} results
              </span>
            )}
            {searchQuery && isReposSearch && !repoGrepLoading && (
              <span
                className="text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                {repoGrepResults.length} results
              </span>
            )}
            {searchQuery && isReposSearch && repoGrepLoading && (
              <span
                className="text-[11px] animate-pulse"
                style={{ color: "var(--text-muted)" }}
              >
                searching...
              </span>
            )}
            <button
              onClick={() => {
                setSearchActive(false);
                setSearchQuery("");
                setSearchResults([]);
              }}
              className="text-[11px] px-1.5 py-0.5 rounded"
              style={{ color: "var(--text-muted)" }}
            >
              ESC
            </button>
          </div>
          {!isReposSearch && searchLoading && (
            <div
              className="mt-2 text-xs animate-pulse"
              style={{ color: "var(--text-tertiary)" }}
            >
              Searching...
            </div>
          )}
          {!isReposSearch &&
            !searchLoading &&
            searchQuery.length >= 2 &&
            searchResults.length > 0 && (
              <div
                className="mt-2 rounded-lg overflow-hidden"
                style={{
                  border: "1px solid var(--border-subtle)",
                  maxHeight: "50vh",
                  overflowY: "auto",
                }}
              >
                {searchResults.map((result, i) => (
                  <GrepResultRow
                    key={result.relativePath}
                    result={result}
                    query={searchQuery}
                    isSelected={i === searchSelectedIdx}
                    onClick={() => openSearchResult(result.relativePath)}
                    onMouseEnter={() => setSearchSelectedIdx(i)}
                  />
                ))}
              </div>
            )}
          {!isReposSearch &&
            !searchLoading &&
            searchQuery.length >= 2 &&
            searchResults.length === 0 && (
              <div
                className="mt-2 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                No matches found
              </div>
            )}
          {isReposSearch && repoFiles.length === 0 && (
            <div
              className="mt-2 text-xs animate-pulse"
              style={{ color: "var(--text-tertiary)" }}
            >
              Loading file list...
            </div>
          )}
          {isReposSearch &&
            !repoGrepLoading &&
            searchQuery.length >= 2 &&
            repoGrepResults.length > 0 && (
              <div
                className="mt-2 rounded-lg overflow-hidden"
                style={{
                  border: "1px solid var(--border-subtle)",
                  maxHeight: "50vh",
                  overflowY: "auto",
                }}
              >
                {repoGrepResults.map((result, i) => (
                  <GrepResultRow
                    key={`${result.relativePath}-${i}`}
                    result={result}
                    query={searchQuery}
                    isSelected={false}
                    onClick={() => {
                      setRepoOpenFile({
                        repo: result.project,
                        file: result.relativePath,
                        scope: repoSearchScope,
                        highlight: searchQuery,
                      });
                      setSearchActive(false);
                      setSearchQuery("");
                    }}
                    onMouseEnter={() => {}}
                  />
                ))}
              </div>
            )}
          {isReposSearch &&
            !repoGrepLoading &&
            searchQuery.length >= 2 &&
            repoGrepResults.length === 0 &&
            repoFiles.length > 0 && (
              <div
                className="mt-2 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                No matches in {repoFiles.length} {repoSearchScope} files
              </div>
            )}
        </div>
      )}

      {/* Repos tab */}
      {section === "repos" && project?.repos && (
        <div className="space-y-6">
          {project.repos.map((repo) => (
            <div
              key={repo.path}
              className="rounded-lg p-4"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <GitFork size={14} style={{ color: "var(--accent)" }} />
                <span className="text-sm font-semibold">{repo.name}</span>
                <span
                  className="text-[11px] font-mono"
                  style={{ color: "var(--text-muted)" }}
                >
                  {repo.path}
                </span>
              </div>
              <GitChanges
                repo={repo.path}
                showCommit
                viewMode={gitViewMode}
                onViewModeChange={setGitViewMode}
                extraActions={wideToggle}
                openFile={
                  repoOpenFile?.repo === repo.path &&
                  repoOpenFile.scope === "changed"
                    ? repoOpenFile.file
                    : null
                }
                highlight={
                  repoOpenFile?.repo === repo.path &&
                  repoOpenFile.scope === "changed"
                    ? repoOpenFile.highlight
                    : undefined
                }
                onOpenFileChange={(file) =>
                  setRepoOpenFile(
                    file
                      ? {
                          repo: repo.path,
                          file,
                          scope: repoOpenFile?.scope ?? "",
                          highlight: repoOpenFile?.highlight ?? "",
                        }
                      : null,
                  )
                }
              />
              <div
                className="mt-4 pt-4"
                style={{ borderTop: "1px solid var(--border-subtle)" }}
              >
                <GitBranchDiff
                  repo={repo.path}
                  viewMode={gitViewMode}
                  openFile={
                    repoOpenFile?.repo === repo.path &&
                    repoOpenFile.scope === "branch-diff"
                      ? repoOpenFile.file
                      : null
                  }
                  highlight={
                    repoOpenFile?.repo === repo.path &&
                    repoOpenFile.scope === "branch-diff"
                      ? repoOpenFile.highlight
                      : undefined
                  }
                />
              </div>
              <div
                className="mt-4 pt-4"
                style={{ borderTop: "1px solid var(--border-subtle)" }}
              >
                <GitHistory
                  repo={repo.path}
                  viewMode={gitViewMode}
                  commitsOpen={getCommitsOpen(repo.path)}
                  onCommitsOpenChange={(open) =>
                    handleCommitsOpenChange(repo.path, open)
                  }
                  activeSha={searchParams.get("sha")}
                  activeFile={searchParams.get("gitfile")}
                  onActiveShaChange={(sha) =>
                    setSearchParams((prev) => {
                      const p = new URLSearchParams(prev);
                      if (sha) p.set("sha", sha);
                      else {
                        p.delete("sha");
                        p.delete("gitfile");
                      }
                      return p;
                    })
                  }
                  onActiveFileChange={(file) =>
                    setSearchParams((prev) => {
                      const p = new URLSearchParams(prev);
                      if (file) p.set("gitfile", file);
                      else p.delete("gitfile");
                      return p;
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* iTerm tab */}
      {section === "iterm" && (
        <div
          className="flex flex-col h-[calc(100dvh-5rem)] md:h-[calc(100dvh-10rem)] relative"
          style={{
            margin: "-1.5rem",
            marginTop: 0,
            touchAction: "pan-y",
            overscrollBehaviorX: "contain",
          }}
        >
          {/* Desktop toolbar */}
          <div className="hidden md:block">
            <TerminalToolbar
              sessions={terminal.sessions}
              focusedId={terminal.focusedId}
              maximized={maximized}
              currentProject={name || ""}
              projects={projects}
              onFocus={terminal.setFocusedId}
              onCreate={(opts) => {
                void createTerminal(opts || {});
              }}
              onDelete={terminal.deleteSession}
              onColorChange={(id, color) =>
                terminal.updateSession(id, { color })
              }
              onRename={(id, n) => terminal.updateSession(id, { name: n })}
              onToggleMaximize={toggleMaximized}
            />
          </div>

          {/* Mobile color-dot rail */}
          <div className="md:hidden">
            <TerminalMobileRail
              sessions={terminal.sessions}
              focusedId={terminal.focusedId}
              currentProject={name || ""}
              onFocus={terminal.setFocusedId}
              onCreate={(opts) => {
                void createTerminal(opts || {});
              }}
              onOpenDrawer={() => setDrawerOpen(true)}
            />
          </div>

          {/* Terminal area: spine (mobile) + grid */}
          <div className="flex-1 min-h-0 flex relative">
            <div className="md:hidden">
              <TerminalSpine
                sessions={terminal.sessions}
                focusedId={terminal.focusedId}
                onFocus={terminal.setFocusedId}
                onOpenDrawer={() => setDrawerOpen(true)}
              />
            </div>
            <div className="flex-1 min-w-0 p-1">
              <TerminalLayoutGrid
                sessions={terminal.sessions}
                focusedId={terminal.focusedId}
                maximized={maximized}
                onFocus={terminal.setFocusedId}
                onExit={terminal.deleteSession}
                onToggleMaximize={toggleMaximized}
                onReady={(sessionId, handle) => {
                  terminalHandlesRef.current.set(sessionId, handle);
                }}
              />
            </div>

            {/* Cross-project drawer (mobile-first, desktop-compatible) */}
            {drawerOpen && (
              <TerminalSpineDrawer
                sessions={allTerminals.sessions}
                focusedId={terminal.focusedId}
                currentProject={name || ""}
                projects={projects}
                onFocus={(sessionId, sessionProject) => {
                  try {
                    localStorage.setItem(
                      `panel-terminal-focus-${sessionProject}`,
                      sessionId,
                    );
                  } catch {
                    // ignore
                  }
                  if (sessionProject === name) {
                    terminal.setFocusedId(sessionId);
                  } else {
                    navTo(`/project/${sessionProject}/iterm`);
                  }
                  setDrawerOpen(false);
                }}
                onCreate={(opts) => {
                  void createTerminal(opts);
                }}
                onClose={() => setDrawerOpen(false)}
              />
            )}
          </div>

          {/* Mobile shortcut bar */}
          <TerminalShortcutBar
            onSend={(data) => {
              const targetId = terminal.focusedId ?? terminal.sessions[0]?.id;
              if (!targetId) return;
              const handle = terminalHandlesRef.current.get(targetId);
              handle?.send(data);
              // Re-focus the xterm on the next frame so subsequent taps on
              // the on-screen keyboard still go into the terminal.
              requestAnimationFrame(() => handle?.focus());
            }}
            onToggleKeyboard={() => {
              const targetId = terminal.focusedId ?? terminal.sessions[0]?.id;
              if (targetId) terminalHandlesRef.current.get(targetId)?.focus();
            }}
          />
        </div>
      )}

      {/* File section listing */}
      {section && section !== "repos" && section !== "iterm" && !selectedFile && (
        <div>
          {/* Current Plans banner */}
          {section === "plans" &&
            project?.currentPlans &&
            project.currentPlans.length > 0 && (
              <div
                className="mb-4 rounded-lg p-3"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--accent)",
                  borderColor:
                    "color-mix(in srgb, var(--accent) 40%, transparent)",
                }}
              >
                <h3
                  className="text-[11px] font-semibold uppercase tracking-widest mb-2"
                  style={{ color: "var(--accent)" }}
                >
                  Active Plans
                </h3>
                <div className="space-y-0.5">
                  {project.currentPlans.map((planFile) => {
                    const fileName = planFile.split("/").pop() ?? planFile;
                    const relativePath = `${name}/plans/${fileName}`;
                    const label = planFile
                      .replace(/\.md$/, "")
                      .replace(/^\d{4}-\d{2}-\d{2}-/, "")
                      .replace(/-/g, " ");
                    return (
                      <div key={planFile} className="flex items-center gap-1">
                        <button
                          onClick={() => setSelectedFile(relativePath)}
                          className="flex items-center gap-3 flex-1 px-3 py-1.5 rounded-md text-left transition-colors"
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background =
                              "var(--bg-hover)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          <FileText
                            size={14}
                            className="shrink-0"
                            style={{ color: "var(--accent)" }}
                          />
                          <span
                            className="text-sm truncate flex-1 capitalize"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {label}
                          </span>
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            await fetch(
                              `/api/projects/${name}/plans/current/${encodeURIComponent(planFile)}`,
                              { method: "DELETE" },
                            );
                          }}
                          className="shrink-0 p-1 rounded transition-colors"
                          style={{ color: "var(--text-muted)" }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--red)";
                            e.currentTarget.style.background = "var(--red-dim)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = "var(--text-muted)";
                            e.currentTarget.style.background = "transparent";
                          }}
                          title="Close plan (remove from active)"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          {section === "qa" ? (
            (() => {
              const runs = sectionFiles
                .filter((f) => f.relativePath.endsWith("/run.md"))
                .map((f) => {
                  const parts = f.relativePath.split("/");
                  const folderName = parts[parts.length - 2];
                  return { file: f, folderName };
                })
                .sort((a, b) => b.folderName.localeCompare(a.folderName));

              return (
                <>
                  <h2
                    className="text-[11px] font-semibold uppercase tracking-widest mb-3"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    QA Runs ({runs.length})
                  </h2>
                  {runs.length === 0 ? (
                    <p
                      className="text-sm"
                      style={{ color: "var(--text-muted)" }}
                    >
                      No QA runs found.
                    </p>
                  ) : (
                    <div className="space-y-0.5">
                      {runs.map(({ file, folderName }) => (
                        <button
                          key={file.relativePath}
                          onClick={() => setSelectedFile(file.relativePath)}
                          className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-left transition-colors"
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background =
                              "var(--bg-hover)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "transparent")
                          }
                        >
                          <FileText
                            size={14}
                            className="shrink-0"
                            style={{ color: "var(--text-tertiary)" }}
                          />
                          <span
                            className="text-sm truncate flex-1 font-mono"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {folderName}
                          </span>
                          <span
                            className="text-[11px]"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {new Date(file.modified).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric" },
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()
          ) : (
            <>
              <h2
                className="text-[11px] font-semibold uppercase tracking-widest mb-3"
                style={{ color: "var(--text-tertiary)" }}
              >
                {section} ({sectionFiles.length} files)
              </h2>
              {sectionFiles.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  No files in this section.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {sectionFiles.map((file) => {
                    const fileName =
                      file.relativePath.split("/").pop() ?? file.relativePath;
                    const date = new Date(file.modified).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", year: "numeric" },
                    );
                    return (
                      <button
                        key={file.relativePath}
                        onClick={() => setSelectedFile(file.relativePath)}
                        className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-left transition-colors"
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "var(--bg-hover)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        <FileText
                          size={14}
                          className="shrink-0"
                          style={{ color: "var(--text-tertiary)" }}
                        />
                        <span
                          className="text-sm truncate flex-1"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {fileName}
                        </span>
                        <span
                          className="text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {date}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Inline file viewer */}
      {section && section !== "repos" && section !== "iterm" && selectedFile && (
        <div>
          <div
            className="flex items-center gap-2 mb-4 pb-3"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <button
              onClick={() => setSelectedFile(null)}
              className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <ArrowLeft size={14} />
              Back
            </button>
            <span
              className="text-sm font-mono truncate flex-1"
              style={{ color: "var(--text-tertiary)" }}
            >
              {selectedFile.split("/").pop()}
            </span>
            {fileAbsPath && (
              <>
                <button
                  onClick={() => openInVSCode(fileAbsPath)}
                  className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text-primary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }}
                >
                  <ExternalLink className="w-3.5 h-3.5" /> VS Code
                </button>
                <button
                  onClick={() => copyPath(fileAbsPath)}
                  className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors"
                  style={{
                    color: copied ? "var(--green)" : "var(--text-secondary)",
                  }}
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copied ? "Copied" : "Path"}
                </button>
              </>
            )}
          </div>
          {fileLoading ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Loading...
            </p>
          ) : (
            <ImageDropZone targetMarkdown={selectedFile}>
              {isMarkdown(selectedFile) ? (
                <MarkdownRenderer
                  content={fileContent}
                  basePath={selectedFile}
                />
              ) : isJson(selectedFile) ? (
                <pre
                  className="text-sm font-mono p-4 rounded-lg overflow-auto"
                  style={{ background: "var(--bg-surface)" }}
                >
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(fileContent), null, 2);
                    } catch {
                      return fileContent;
                    }
                  })()}
                </pre>
              ) : (
                <pre
                  className="text-sm font-mono whitespace-pre-wrap"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {fileContent}
                </pre>
              )}
            </ImageDropZone>
          )}
        </div>
      )}

      {/* Overview */}
      {!section && (
        <>
          {absolutePath && (
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => openInVSCode(absolutePath)}
                className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open in VS Code
              </button>
            </div>
          )}
          {error && (
            <p className="text-sm" style={{ color: "var(--red)" }}>
              Failed to load PROJECT.md: {error}
            </p>
          )}
          {!error && content === null && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Loading...
            </p>
          )}
          {content !== null && (
            <MarkdownRenderer
              content={content}
              basePath={`${name}/PROJECT.md`}
            />
          )}
        </>
      )}
    </div>
  );
}
