import { useEffect, useState, useCallback } from "react";

export interface AutoSyncStatus {
  enabled: boolean;
  state: "idle" | "syncing" | "synced" | "offline" | "conflict" | "push-failed" | "busy";
  lastSync: string | null;
  detail: string;
  summary: string;
  intervalMinutes: number;
}

export function useAutoSyncStatus(pollMs = 15000) {
  const [status, setStatus] = useState<AutoSyncStatus | null>(null);

  const call = useCallback(async (url: string, init?: RequestInit) => {
    try {
      const res = await fetch(url, init);
      if (!res.ok) return;
      setStatus((await res.json()) as AutoSyncStatus);
    } catch (e) {
      console.error("[auto-sync]", e);
    }
  }, []);

  const refresh = useCallback(() => call("/api/auto-sync/status"), [call]);
  const enable = useCallback(() => call("/api/auto-sync/enable", { method: "POST" }), [call]);
  const disable = useCallback(() => call("/api/auto-sync/disable", { method: "POST" }), [call]);
  const syncNow = useCallback(() => call("/api/auto-sync/now", { method: "POST" }), [call]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return { status, refresh, enable, disable, syncNow };
}
