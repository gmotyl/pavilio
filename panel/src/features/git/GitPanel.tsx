import { RefreshCw } from "lucide-react";
import GitChanges from "./GitChanges";
import { useAutoSyncStatus } from "../auto-sync/useAutoSyncStatus";
import { SyncConflictBanner } from "../auto-sync/SyncConflictBanner";

const ATTENTION = new Set(["conflict", "push-failed"]);

export default function GitPanel() {
  // Same hook the sidebar uses, so this control reflects background ticks too —
  // not just clicks. A tick used to be able to fail with nothing shown here.
  const { status, syncNow, refresh } = useAutoSyncStatus();
  const state = status?.state ?? "idle";
  const syncing = state === "syncing";
  const attention = ATTENTION.has(state);

  const onSync = async () => {
    await syncNow();
    refresh();
  };

  const lastSync = status?.lastSync ? new Date(status.lastSync).toLocaleTimeString() : "—";
  const trailing =
    attention || state === "offline" ? status?.detail || state : status?.summary || "—";

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Changes</h1>
        <button
          data-testid="git-sync"
          onClick={onSync}
          disabled={syncing}
          title={status?.detail || "Commit project data, rebase on the remote, push"}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
          style={{
            color: attention ? "var(--red)" : "var(--text-secondary)",
            background: "var(--bg-hover)",
          }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync"}
        </button>
      </div>

      <p
        data-testid="git-sync-status"
        className="mb-4 text-xs"
        style={{ color: attention ? "var(--red)" : "var(--text-muted)" }}
      >
        {state} · {lastSync} · {trailing}
      </p>

      {status && (
        <SyncConflictBanner
          conflictFiles={status.conflictFiles ?? []}
          conflictPrompt={status.conflictPrompt ?? ""}
        />
      )}

      <GitChanges showCommit advancedCommit />
    </div>
  );
}
