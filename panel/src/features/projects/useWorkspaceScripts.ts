import { useEffect, useState } from "react";

// Keep in sync with panel/server/routes/scripts.ts
export interface ScriptEntry {
  id: string;
  label: string;
  description: string;
  script: string;
  outputMatch?: string;
  icon?: string;
  timeoutSec?: number;
  /**
   * Optional argv passed to the script. Defaults to [projectName].
   * Strings may contain placeholders: {project}, {exportsDir}, {repo}
   * which are substituted at run time.
   */
  args?: string[];
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
