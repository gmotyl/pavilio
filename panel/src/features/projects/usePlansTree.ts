import { useCallback, useEffect, useState } from "react";
import { useWebSocket } from "../realtime/useWebSocket";

export interface PlanFile {
  source: string;
  filename: string;
  absolutePath: string;
  modified: number;
  /** Set when the file lives under projectsDir; null for external (.kilo / ~/.claude) files. */
  relativeToProjectsDir: string | null;
}

/** One legacy (flat) plans source: a directory of `.md` plan files. */
export interface LegacyPlanSource {
  id: string;
  label: string;
  absoluteRoot: string;
  files: PlanFile[];
}

/** One Markdown artifact of an OpenSpec change (proposal/design/tasks, or a delta spec). */
export interface PlanArtifact {
  kind: "proposal" | "design" | "tasks" | "spec";
  /** Capability name for delta specs; null for proposal/design/tasks. */
  capability: string | null;
  filename: string;
  absolutePath: string;
  modified: number;
  relativeToProjectsDir: string | null;
}

/** One change directory within a single OpenSpec source. */
export interface ChangeRecord {
  /** Stable change identifier — the change dir name, shared across sources. */
  changeId: string;
  source: string;
  /** active = under changes/; archived = under changes/archive/. Derived from directory. */
  status: "active" | "archived";
  archiveDate: string | null;
  artifacts: PlanArtifact[];
}

/** An OpenSpec plans source: a project store or a linked repo's `openspec/` tree. */
export interface OpenSpecPlanSource {
  id: string;
  label: string;
  kind: "openspec";
  mode: "native" | "store";
  openspecDir: string;
  changes: ChangeRecord[];
  /**
   * Set when repos.json configures this source but `openspecDir` does not exist
   * — almost always a wrong `openspec.root`. Rendered as a warning group so the
   * typo is visible instead of looking like an empty backend.
   */
  missing?: true;
}

export type PlanSource = LegacyPlanSource | OpenSpecPlanSource;

/** Narrow a plans source to its OpenSpec variant (carries `changes`, not `files`). */
export function isOpenSpecSource(s: PlanSource): s is OpenSpecPlanSource {
  return (s as OpenSpecPlanSource).kind === "openspec";
}

export interface PlansTreeResponse {
  project: string;
  sources: PlanSource[];
}

export function usePlansTree(projectName: string | undefined) {
  const { lastMessage } = useWebSocket();
  const [data, setData] = useState<PlansTreeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/plans-tree`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A plan an agent writes while this tab is open must appear without a reload.
  useEffect(() => {
    if (lastMessage?.type === "file-change") refresh();
  }, [lastMessage, refresh]);

  return { data, loading, error, refresh };
}

export async function fetchPlanFile(
  projectName: string,
  absolutePath: string,
): Promise<{ content: string }> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectName)}/plans/read?path=${encodeURIComponent(absolutePath)}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}
