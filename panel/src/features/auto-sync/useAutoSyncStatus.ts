import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "../../lib/toast";
import { attentionTransition, effectiveState } from "./attention";

export interface AutoSyncStatus {
  enabled: boolean;
  state: "idle" | "syncing" | "synced" | "offline" | "conflict" | "push-failed" | "busy";
  stale?: boolean;
  lastSync: string | null;
  detail: string;
  summary: string;
  intervalMinutes: number;
}

const ATTENTION_TEXT: Record<string, string> = {
  conflict: "Auto-sync: rebase conflict — repo needs manual attention",
  "push-failed": "Auto-sync: push failed — repo needs manual attention",
  stale: "Auto-sync: no successful sync for a long time — check the panel",
};

export function useAutoSyncStatus(pollMs = 15000) {
  const [status, setStatus] = useState<AutoSyncStatus | null>(null);
  const prevState = useRef<string | null>(null);

  const call = useCallback(async (url: string, init?: RequestInit) => {
    try {
      const res = await fetch(url, init);
      if (!res.ok) return;
      const next = (await res.json()) as AutoSyncStatus;
      const entered = attentionTransition(prevState.current, next);
      if (entered) toast.error(`${ATTENTION_TEXT[entered]}${next.detail ? ` (${next.detail})` : ""}`);
      prevState.current = effectiveState(next);
      setStatus(next);
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
