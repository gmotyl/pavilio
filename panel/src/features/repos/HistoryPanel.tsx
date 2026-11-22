import { useGitLog, type Commit } from "../git/useGitHistory";

interface Props {
  /** Repo or worktree directory. */
  root: string;
  /** Commit whose files the tree shows. */
  sha: string | null;
  onPick: (commit: Commit) => void;
}

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Recent commits; picking one shows its files in the tree. */
export default function HistoryPanel({ root, sha, onPick }: Props) {
  const commits = useGitLog(root);
  return (
    <aside className="cv-rail cv-panel" aria-label="History" data-testid="code-history-panel">
      <h4>History</h4>
      {commits.length === 0 ? (
        <p className="cv-rail-empty">No commits.</p>
      ) : (
        commits.map((c) => (
          <button
            key={c.sha}
            type="button"
            className="cv-hist-row"
            data-testid={`history-commit-${c.sha}`}
            aria-current={c.sha === sha ? "true" : undefined}
            title={`${c.message}\n${c.author}`}
            onClick={() => onPick(c)}
          >
            <span className="cv-hist-sha">{c.shortSha}</span>
            <span className="cv-ol-nm">{c.message}</span>
            <span className="cv-ol-ln">{ago(c.date)}</span>
          </button>
        ))
      )}
    </aside>
  );
}
