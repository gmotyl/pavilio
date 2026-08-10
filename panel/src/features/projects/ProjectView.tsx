import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useFileIndex } from "../explorer/useFileIndex";
import { useGitViewMode } from "../git/useGitViewMode";
import RepoBlock from "./RepoBlock";
import ProjectSearchBar from "./ProjectSearchBar";
import FileViewer from "./FileViewer";
import SectionFilesList, { sectionRows } from "./SectionFilesList";
import FileListSidebar from "./FileListSidebar";
import ContextTab from "./ContextTab";
import PlansTab from "./PlansTab";
import ReviewRules from "../qa/ReviewRules";
import { SPECIAL_SECTIONS } from "./sections";
import ScriptButton from "./ScriptButton";
import { useWorkspaceScripts } from "./useWorkspaceScripts";
import { ProjectTabsBar, ProjectTabsMenu } from "./ProjectTabs";
import { useProjectTabs } from "./useProjectTabs";
import { useProjectSearch } from "./useProjectSearch";
import { useRepoSearch } from "./useRepoSearch";
import { useFileViewer } from "./useFileViewer";
import { useCommitsOpenMap } from "./useCommitsOpenMap";
import { useRepoOpenFile } from "./useRepoOpenFile";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import { useBreadcrumbActions } from "../shell/Breadcrumbs";
import { useLastPath } from "../shell/useLastPath";
import { useFloatingAction, useScrollContainer } from "../shell/Layout";
import { useReposTabMemory } from "../shell/useReposTabMemory";
import { useWideMode } from "../shell/useWideMode";
import WideToggle from "../shell/WideToggle";
import { openInVSCode } from "../../lib/vscode";
import { useProjects } from "./useProjects";
import { useTabScrollMemory } from "./useTabScrollMemory";
import ProjectTerminalsSurface from "../terminal/ProjectTerminalsSurface";
import { TimeTrackingLink } from "../time/TimeTrackingLink";
import { useProjectTodayMinutes } from "../time/TimeTrackingProvider";

/** Sidebar headings read like the sibling tabs ("Plans", "Context"). */
const sectionTitle = (section: string) =>
  section === "qa" ? "QA" : section.charAt(0).toUpperCase() + section.slice(1);

export default function ProjectView() {
  const { name, section } = useParams<{ name: string; section?: string }>();
  const { todayMinutes } = useProjectTodayMinutes(name ?? "");
  useLastPath(name);
  const [content, setContent] = useState<string | null>(null);
  const [absolutePath, setAbsolutePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const files = useFileIndex();
  const projects = useProjects();

  const navTo = useNavigate();
  const project = projects.find((p) => p.name === name);
  const hasRepos = (project?.repos?.length ?? 0) > 0;

  // Per-tab scroll memory
  const scrollContainerRef = useScrollContainer();
  useTabScrollMemory(name, section, scrollContainerRef ?? { current: null });

  const [wide, toggleWide] = useWideMode(section || "overview");
  const [gitViewMode, setGitViewMode] = useGitViewMode();
  const wideToggle = <WideToggle wide={wide} onToggle={toggleWide} />;

  // RepoBlock renders its own inline WideToggle in the GitChanges header on
  // the repos tab, so skip the floating one there to avoid two toggles on
  // screen. Every other tab gets it as a floating action — same mechanism
  // MarkdownViewer uses, which is reliably visible in both wide and compact.
  useFloatingAction(
    section !== "repos" ? wideToggle : null,
    [section, wide, toggleWide],
  );

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
    enabled: false, // notes search handled by QuickFinder; hook only drives repos-tab overlay
    onOpenResult: openSearchResult,
  });

  const onToggleSearch = useCallback(() => {
    if (isReposSearch) search.toggle();
    else window.dispatchEvent(new Event("pavilio:open-quick-finder"));
  }, [isReposSearch, search.toggle]);

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
  const { scripts } = useWorkspaceScripts();

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
    section && !SPECIAL_SECTIONS.has(section)
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

  return (
    <div className="relative">
    <div className={`p-6 ${wide ? "" : "max-w-5xl"}`}>
      {/* Desktop-only big title */}
      <div className="hidden md:flex items-center mb-4">
        <h1 className="text-2xl font-semibold capitalize">
          {name}
        </h1>
        <TimeTrackingLink
          minutes={todayMinutes}
          to={`/project/${name}/time`}
        />
      </div>

      <ProjectTabsBar
        tabs={tabs}
        searchActive={isReposSearch && search.active}
        onToggleSearch={onToggleSearch}
      />

      {isReposSearch && search.active && (
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
              liveHighlight={
                search.active && search.query.trim().length >= 2
                  ? search.query.trim()
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* iTerm tab */}
      {section === "iterm" && (
        <ProjectTerminalsSurface projectName={name || ""} active />
      )}

      {/* Context tab — aggregates CONTEXT.md and ADRs from project + linked repos */}
      {section === "context" && (
        <ContextTab projectName={name || ""} />
      )}

      {/* Plans tab — foldable tree across project plans + .kilo/plans + ~/.claude/plans */}
      {section === "plans" && (
        <PlansTab projectName={name || ""} currentPlans={project?.currentPlans} />
      )}

      {/* File sections (notes, memo, progress, qa) — list beside the viewer */}
      {section && !SPECIAL_SECTIONS.has(section) && (
        <FileListSidebar
          testId="section-files"
          title={sectionTitle(section)}
          sources={[
            {
              id: section,
              label: sectionTitle(section),
              // Same helper the rows come from, so the badge counts what renders.
              count: sectionRows(section, sectionFiles).length,
              rows: (
                <SectionFilesList
                  projectName={name || ""}
                  section={section}
                  files={sectionFiles}
                  selectedPath={selectedFile}
                  onSelect={setSelectedFile}
                />
              ),
            },
          ]}
          aboveList={section === "qa" ? <ReviewRules project={name || ""} /> : null}
          detail={
            selectedFile ? (
              <FileViewer
                filePath={selectedFile}
                content={fileViewer.content}
                absolutePath={fileViewer.absolutePath}
                loading={fileViewer.loading}
              />
            ) : (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Select a file to view.
              </p>
            )
          }
        />
      )}

      {/* Overview */}
      {!section && (
        <>
          {(absolutePath || scripts.length > 0) && (
            <div className="flex flex-wrap gap-2 mb-4 items-center">
              {absolutePath && (
                <button
                  data-testid="project-view-vscode"
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
              )}
              {name && scripts.map((entry) => (
                <ScriptButton key={entry.id} entry={entry} projectName={name} />
              ))}
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
    </div>
  );
}
