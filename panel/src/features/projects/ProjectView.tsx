import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useFileIndex } from "../explorer/useFileIndex";
import { useGitViewMode } from "../git/useGitViewMode";
import RepoBlock from "./RepoBlock";
import ProjectSearchBar from "./ProjectSearchBar";
import FileViewer from "./FileViewer";
import SectionFilesList from "./SectionFilesList";
import { ProjectTabsBar, ProjectTabsMenu } from "./ProjectTabs";
import { useProjectTabs } from "./useProjectTabs";
import { useProjectSearch } from "./useProjectSearch";
import { useRepoSearch } from "./useRepoSearch";
import { useFileViewer } from "./useFileViewer";
import { useITermShortcuts } from "./useITermShortcuts";
import { useCommitsOpenMap } from "./useCommitsOpenMap";
import { useRepoOpenFile } from "./useRepoOpenFile";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import { useBreadcrumbActions } from "../shell/Breadcrumbs";
import { useLastPath } from "../shell/useLastPath";
import { useScrollContainer } from "../shell/Layout";
import { useReposTabMemory } from "../shell/useReposTabMemory";
import { useWideMode } from "../shell/useWideMode";
import WideToggle from "../shell/WideToggle";
import { useProjects } from "./useProjects";
import { useTabScrollMemory } from "./useTabScrollMemory";
import {
  useTerminalSessions,
  nextProjectName,
} from "../terminal/useTerminalSessions";
import type { CreateSessionOpts } from "../terminal/useTerminalSessions";
import { useTerminalMaximized } from "../terminal/useTerminalMaximized";
import { useAllTerminalSessions } from "../terminal/useAllTerminalSessions";
import type { TerminalHandle } from "../terminal/TerminalView";
import TerminalsSurface from "../terminal/TerminalsSurface";

export default function ProjectView() {
  const { name, section } = useParams<{ name: string; section?: string }>();
  useLastPath(name);
  const [content, setContent] = useState<string | null>(null);
  const [absolutePath, setAbsolutePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const files = useFileIndex();
  const projects = useProjects();

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

  const terminalHandlesRef = useRef<Map<string, TerminalHandle>>(new Map());

  // Per-tab scroll memory
  const scrollContainerRef = useScrollContainer();
  useTabScrollMemory(name, section, scrollContainerRef ?? { current: null });

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

  useITermShortcuts({
    active: section === "iterm",
    sessions: terminal.sessions,
    focusedId: terminal.focusedId,
    setFocusedId: terminal.setFocusedId,
    projects,
    navTo,
    maximized,
    setMaximized,
  });

  const [wide, toggleWide] = useWideMode(section || "overview");
  const [gitViewMode, setGitViewMode] = useGitViewMode();
  const wideToggle = <WideToggle wide={wide} onToggle={toggleWide} />;

  const commitsOpen = useCommitsOpenMap();

  const [searchParams, setSearchParams] = useSearchParams();
  useReposTabMemory(name, section, searchParams);

  const isReposSearch = section === "repos";

  const openSearchResult = useCallback(
    (path: string) => {
      navTo(`/view/${path}`);
    },
    [navTo],
  );

  const search = useProjectSearch({
    project: name,
    enabled: !isReposSearch,
    onOpenResult: openSearchResult,
  });

  const repoSearch = useRepoSearch({
    active: isReposSearch,
    repos: project?.repos,
    query: search.query,
  });

  const { repoOpenFile, setRepoOpenFile } = useRepoOpenFile({
    searchParams,
    setSearchParams,
  });

  const fileViewer = useFileViewer({ project: name, section });
  const { selectedFile, setSelectedFile } = fileViewer;

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

  const { tabs, activeTab } = useProjectTabs({
    projectName: name,
    section,
    hasRepos,
  });

  useBreadcrumbActions(
    <ProjectTabsMenu tabs={tabs} activeTab={activeTab} />,
    [name, section, hasRepos],
  );

  const openInVSCode = (path: string) =>
    window.open(`vscode://file/${path}`, "_self");

  return (
    <div className="relative">
    <div className={`p-6 ${wide ? "" : "max-w-5xl"}`}>
      {/* Desktop-only big title */}
      <h1 className="hidden md:block text-2xl font-semibold mb-4 capitalize">
        {name}
      </h1>

      <ProjectTabsBar
        tabs={tabs}
        searchActive={search.active}
        onToggleSearch={search.toggle}
      />

      {search.active && (
        <ProjectSearchBar
          projectName={name}
          query={search.query}
          onQueryChange={search.setQuery}
          onClose={search.close}
          inputRef={search.inputRef}
          isReposSearch={isReposSearch}
          results={search.results}
          loading={search.loading}
          selectedIdx={search.selectedIdx}
          onSelectedIdxChange={search.setSelectedIdx}
          onOpenResult={openSearchResult}
          onKeyDown={search.handleKeyDown}
          repoScope={repoSearch.scope}
          onRepoScopeChange={repoSearch.setScope}
          repoFilesCount={repoSearch.files.length}
          repoGrepResults={repoSearch.grepResults}
          repoGrepLoading={repoSearch.grepLoading}
          onOpenRepoResult={(result) => {
            setRepoOpenFile({
              repo: result.project,
              file: result.relativePath,
              scope: repoSearch.scope,
              highlight: search.query,
            });
            search.close();
          }}
        />
      )}

      {/* Repos tab */}
      {section === "repos" && project?.repos && (
        <div className="space-y-6">
          {project.repos.map((repo) => (
            <RepoBlock
              key={repo.path}
              repo={repo}
              viewMode={gitViewMode}
              onViewModeChange={setGitViewMode}
              wideToggle={wideToggle}
              repoOpenFile={repoOpenFile}
              onSetRepoOpenFile={setRepoOpenFile}
              branchFile={searchParams.get("branchfile")}
              onBranchFileChange={(file) =>
                setSearchParams(
                  (prev) => {
                    const p = new URLSearchParams(prev);
                    if (file) p.set("branchfile", file);
                    else p.delete("branchfile");
                    return p;
                  },
                  { replace: true },
                )
              }
              activeSha={searchParams.get("sha")}
              activeFile={searchParams.get("gitfile")}
              onActiveShaChange={(sha) =>
                setSearchParams(
                  (prev) => {
                    const p = new URLSearchParams(prev);
                    if (sha) p.set("sha", sha);
                    else {
                      p.delete("sha");
                      p.delete("gitfile");
                    }
                    return p;
                  },
                  { replace: true },
                )
              }
              onActiveFileChange={(file) =>
                setSearchParams(
                  (prev) => {
                    const p = new URLSearchParams(prev);
                    if (file) p.set("gitfile", file);
                    else p.delete("gitfile");
                    return p;
                  },
                  { replace: true },
                )
              }
              commitsOpen={commitsOpen.isOpen(repo.path)}
              onCommitsOpenChange={(open) =>
                commitsOpen.setOpen(repo.path, open)
              }
              showListSidebar={wide}
            />
          ))}
        </div>
      )}

      {/* iTerm tab */}
      {section === "iterm" && (
        <TerminalsSurface
          currentProject={name || ""}
          projects={projects}
          repos={project?.repos}
          sessions={terminal.sessions}
          focusedId={terminal.focusedId}
          onFocus={terminal.setFocusedId}
          onDeleteSession={terminal.deleteSession}
          onUpdateSession={terminal.updateSession}
          allSessions={allTerminals.sessions}
          maximized={maximized}
          onToggleMaximize={toggleMaximized}
          drawerOpen={drawerOpen}
          onSetDrawerOpen={setDrawerOpen}
          terminalHandlesRef={terminalHandlesRef}
          onCreateTerminal={(opts) => {
            void createTerminal(opts || {});
          }}
          onNavTo={navTo}
          onReorder={terminal.reorder}
          onSwap={terminal.swapOrder}
        />
      )}

      {/* File section listing */}
      {section && section !== "repos" && section !== "iterm" && !selectedFile && (
        <SectionFilesList
          projectName={name || ""}
          section={section}
          files={sectionFiles}
          currentPlans={project?.currentPlans}
          onSelect={setSelectedFile}
        />
      )}

      {/* Inline file viewer */}
      {section && section !== "repos" && section !== "iterm" && selectedFile && (
        <FileViewer
          filePath={selectedFile}
          content={fileViewer.content}
          absolutePath={fileViewer.absolutePath}
          loading={fileViewer.loading}
          onBack={() => setSelectedFile(null)}
        />
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
      <div
        className="hidden md:block absolute top-0 bottom-0 pointer-events-none"
        style={
          wide
            ? { right: "1.5rem" }
            : { left: "min(64rem, 100%)", marginLeft: "0.5rem" }
        }
      >
        <div className="sticky bottom-4 mt-20 pointer-events-auto">
          {wideToggle}
        </div>
      </div>
    </div>
  );
}
