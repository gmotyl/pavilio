import { useEffect, useState } from "react";

export interface ScriptEntry {
  id: string;
  label: string;
  description: string;
  script: string;
  outputMatch?: string;
  icon?: string;
  timeoutSec?: number;
}

export function useWorkspaceScripts(): { scripts: ScriptEntry[]; loading: boolean } {
  const [scripts, setScripts] = useState<ScriptEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scripts")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setScripts(Array.isArray(data?.scripts) ? data.scripts : []);
      })
      .catch(() => {
        if (!cancelled) setScripts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { scripts, loading };
}
