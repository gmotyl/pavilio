import { AlertTriangle } from "lucide-react";
import CopyIconButton from "../shell/CopyIconButton";

const MAX_SHOWN = 6;

interface Props {
  /** Paths left unmerged by the aborted rebase. */
  conflictFiles: string[];
  /** Ready-to-paste resolution instructions. */
  conflictPrompt: string;
}

/**
 * Shown when auto-sync aborts a rebase. Names what broke and hands over a prompt
 * that resolves it — the repo itself is already clean at HEAD.
 */
export function SyncConflictBanner({ conflictFiles, conflictPrompt }: Props) {
  if (conflictFiles.length === 0) return null;
  const shown = conflictFiles.slice(0, MAX_SHOWN);
  const hidden = conflictFiles.length - shown.length;

  return (
    <div
      data-testid="sync-conflict-banner"
      className="mb-4 rounded-md px-3 py-2 text-xs"
      style={{ background: "var(--bg-hover)", border: "1px solid var(--red)" }}
    >
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color: "var(--red)" }}>
        <AlertTriangle className="w-3.5 h-3.5" />
        <span className="font-medium">Sync conflict — {conflictFiles.length} files</span>
        <span className="ml-auto flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
          Copy prompt
          <CopyIconButton
            value={conflictPrompt}
            label="Copy conflict resolution prompt"
            data-testid="sync-conflict-copy-prompt"
          />
        </span>
      </div>
      <ul className="font-mono space-y-0.5" style={{ color: "var(--text-secondary)" }}>
        {shown.map((f) => (
          <li key={f}>{f}</li>
        ))}
        {hidden > 0 && <li style={{ color: "var(--text-muted)" }}>…and {hidden} more</li>}
      </ul>
      <p className="mt-1.5" style={{ color: "var(--text-muted)" }}>
        Repo is clean at HEAD — nothing is half-applied. Paste the prompt into an agent to resolve.
      </p>
    </div>
  );
}

export default SyncConflictBanner;
