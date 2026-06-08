import { useAutoSyncStatus } from "./useAutoSyncStatus";

export function AutoSyncModal({ onClose }: { onClose: () => void }) {
  const { status, syncNow, refresh } = useAutoSyncStatus(3000);
  const s = status?.state ?? "idle";
  const color = s === "conflict" || s === "push-failed" ? "var(--red)" : "var(--text-secondary)";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="rounded-lg p-4 w-[320px] space-y-3" style={{ background: "var(--bg-elevated)" }} onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-medium">Auto-sync</div>
        <div className="text-[12px]" style={{ color }}>State: {s}{status?.detail ? ` — ${status.detail}` : ""}</div>
        <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          Last sync: {status?.lastSync ? new Date(status.lastSync).toLocaleTimeString() : "—"} · every {status?.intervalMinutes ?? 30} min · {status?.summary || "—"}
        </div>
        {s === "conflict" && (
          <div className="text-[12px]" style={{ color: "var(--red)" }}>
            Manual sync needed: resolve in a terminal (<code>git rebase</code> / merge), then Sync now.
          </div>
        )}
        <div className="flex gap-2">
          <button className="text-[12px] px-2 py-1 rounded-md" style={{ background: "var(--accent)", color: "#fff" }}
            onClick={async () => { await syncNow(); refresh(); }}>Sync now</button>
          <button className="text-[12px] px-2 py-1 rounded-md" style={{ color: "var(--text-muted)" }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
