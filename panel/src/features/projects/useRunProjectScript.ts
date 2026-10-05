import { useCallback, useState } from "react";
import { alerts } from "../alerts/store";
import type { ScriptEntry } from "./useWorkspaceScripts";

function lastNonEmptyLine(s: string | undefined | null): string {
  if (!s) return "";
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

export function useRunProjectScript(projectName: string) {
  const [pending, setPending] = useState<string | null>(null);

  const run = useCallback(
    async (entry: ScriptEntry) => {
      setPending(entry.id);
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectName)}/scripts/${encodeURIComponent(entry.id)}/run`,
          { method: "POST" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alerts.error(
            `${entry.label} failed: ${data?.error ?? `HTTP ${res.status}`}`,
          );
        } else if (data?.ok) {
          alerts.success(
            data.matched ? `${entry.label}: ${data.matched}` : `${entry.label} done`,
          );
        } else {
          alerts.error(
            `${entry.label} failed: ${lastNonEmptyLine(data?.output) || "exit non-zero"}`,
          );
        }
      } catch (e) {
        alerts.error(`${entry.label} failed: ${(e as Error).message}`);
      } finally {
        setPending(null);
      }
    },
    [projectName],
  );

  return { run, pending };
}
