import { useAutoSyncStatus } from "./useAutoSyncStatus";
import { SyncConflictBanner } from "./SyncConflictBanner";

/**
 * Shown when git refused the merge because it would overwrite uncommitted
 * (or staged) files outside the data paths. Nothing was touched; the user
 * commits or discards those files, then syncs again.
 */
function SyncBlockedBanner({ files }: { files: string[] }) {
  return (
    <div
      data-testid="sync-blocked-banner"
      className="rounded-md px-3 py-2 text-xs"
      style={{ background: "var(--bg-hover)", border: "1px solid var(--red)" }}
    >
      <div className="font-medium mb-1" style={{ color: "var(--red)" }}>Blocked</div>
      <p style={{ color: "var(--text-secondary)" }}>
        Local changes to{" "}
        {files.map((f, i) => (
          <span key={f}>
            <code className="font-mono">{f}</code>
            {i < files.length - 1 ? ", " : ""}
          </span>
        ))}{" "}
        block the sync — commit or discard them
      </p>
      <p className="mt-1.5" style={{ color: "var(--text-muted)" }}>
        Staged files count too. Nothing was changed — sync again once they are resolved.
      </p>
    </div>
  );
}

export function AutoSyncModal({ onClose }: { onClose: () => void }) {
  const { status, syncNow, refresh } = useAutoSyncStatus(3000);
  const s = status?.state ?? "idle";
  const color = s === "conflict" || s === "push-failed" || s === "blocked" ? "var(--red)" : "var(--text-secondary)";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="rounded-lg p-4 w-[320px] space-y-3" style={{ background: "var(--bg-elevated)" }} onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-medium">Auto-sync</div>
        <div className="text-[12px]" style={{ color }}>State: {s}{status?.detail && s !== "blocked" ? ` — ${status.detail}` : ""}</div>
        <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          Last sync: {status?.lastSync ? new Date(status.lastSync).toLocaleTimeString() : "—"} · every {status?.intervalMinutes ?? 15} min · {status?.summary || "—"}
        </div>
        {s === "conflict" && (
          <SyncConflictBanner
            conflictFiles={status?.conflictFiles ?? []}
            conflictPrompt={status?.conflictPrompt ?? ""}
          />
        )}
        {s === "blocked" && <SyncBlockedBanner files={status?.blockedFiles ?? []} />}
        <div className="flex gap-2">
          <button data-testid="auto-sync-sync-now" className="text-[12px] px-2 py-1 rounded-md" style={{ background: "var(--accent)", color: "#fff" }}
            onClick={async () => { await syncNow(); refresh(); }}>Sync now</button>
          <button data-testid="auto-sync-close" className="text-[12px] px-2 py-1 rounded-md" style={{ color: "var(--text-muted)" }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
