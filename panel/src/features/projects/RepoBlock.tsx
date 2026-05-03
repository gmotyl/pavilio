import type { ReactNode } from "react";
import { GitFork } from "lucide-react";
import GitBranchDiff from "../git/GitBranchDiff";
import GitChanges from "../git/GitChanges";
import GitHistory from "../git/GitHistory";
import GitWorktrees from "../git/GitWorktrees";
import type { GitViewMode } from "../git/useGitViewMode";

export interface RepoOpenFile {
  repo: string;
  file: string;
  scope: string;
  highlight: string;
}

interface Props {
  repo: { name: string; path: string };
  viewMode: GitViewMode;
  onViewModeChange: (mode: GitViewMode) => void;
  wideToggle: ReactNode;
  repoOpenFile: RepoOpenFile | null;
  onSetRepoOpenFile: (next: RepoOpenFile | null) => void;
  branchFile: string | null;
  onBranchFileChange: (file: string | null) => void;
  activeSha: string | null;
  activeFile: string | null;
  onActiveShaChange: (sha: string | null) => void;
  onActiveFileChange: (file: string | null) => void;
  commitsOpen: boolean;
  onCommitsOpenChange: (open: boolean) => void;
  showListSidebar: boolean;
}

export function RepoBlock({
  repo,
  viewMode,
  onViewModeChange,
  wideToggle,
  repoOpenFile,
  onSetRepoOpenFile,
  branchFile,
  onBranchFileChange,
  activeSha,
  activeFile,
  onActiveShaChange,
  onActiveFileChange,
  commitsOpen,
  onCommitsOpenChange,
  showListSidebar,
}: Props) {
  const matchesScope = (scope: string) =>
    repoOpenFile?.repo === repo.path && repoOpenFile.scope === scope;

  const openFileFor = (scope: string) =>
    matchesScope(scope) ? repoOpenFile!.file : null;

  const highlightFor = (scope: string) =>
    matchesScope(scope) ? repoOpenFile!.highlight : undefined;

  const onOpenFileChange =
    (scope: string) => (file: string | null) =>
      onSetRepoOpenFile(
        file
          ? {
              repo: repo.path,
              file,
              scope: repoOpenFile?.scope ?? scope,
              highlight: repoOpenFile?.highlight ?? "",
            }
          : null,
      );

  return (
    <div
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
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        extraActions={wideToggle}
        showListSidebar
        openFile={openFileFor("changed")}
        highlight={highlightFor("changed")}
        onOpenFileChange={onOpenFileChange("changed")}
      />

      <div
        className="mt-4 pt-4"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <GitBranchDiff
          repo={repo.path}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          showListSidebar
          openFile={openFileFor("branch-diff")}
          highlight={highlightFor("branch-diff")}
          activeFile={branchFile}
          onActiveFileChange={onBranchFileChange}
        />
      </div>

      <div
        className="mt-4 pt-4"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <GitWorktrees
          repo={repo.path}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
        />
      </div>

      <div
        className="mt-4 pt-4"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <GitHistory
          repo={repo.path}
          viewMode={viewMode}
          showListSidebar={showListSidebar}
          commitsOpen={commitsOpen}
          onCommitsOpenChange={onCommitsOpenChange}
          activeSha={activeSha}
          activeFile={activeFile}
          onActiveShaChange={onActiveShaChange}
          onActiveFileChange={onActiveFileChange}
        />
      </div>
    </div>
  );
}

export default RepoBlock;
