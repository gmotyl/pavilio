import { useCallback, useEffect, useMemo, useState } from "react";

export interface ArchivedProject {
  name: string;
  archivedAt: string;
}

export const archiveStorageKey = "panel-archived-projects";

function load(): ArchivedProject[] {
  try {
    const raw = localStorage.getItem(archiveStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is ArchivedProject =>
        x && typeof x.name === "string" && typeof x.archivedAt === "string",
    );
  } catch {
    return [];
  }
}

function save(list: ArchivedProject[]): void {
  try {
    localStorage.setItem(archiveStorageKey, JSON.stringify(list));
    window.dispatchEvent(new Event("panel-archived-projects-change"));
  } catch (err) {
    console.warn("[archive] save failed:", err);
  }
}

export function useArchivedProjects() {
  const [archived, setArchived] = useState<ArchivedProject[]>(() => load());

  // Cross-tab and cross-component sync
  useEffect(() => {
    const onChange = () => setArchived(load());
    window.addEventListener("panel-archived-projects-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("panel-archived-projects-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const archive = useCallback((name: string) => {
    const list = load();
    if (list.some((p) => p.name === name)) return;
    const next = [...list, { name, archivedAt: new Date().toISOString() }];
    save(next);
    setArchived(next);
  }, []);

  const restore = useCallback((name: string) => {
    const list = load();
    const next = list.filter((p) => p.name !== name);
    save(next);
    setArchived(next);
  }, []);

  const archivedNames = useMemo(
    () => new Set(archived.map((p) => p.name)),
    [archived],
  );

  const isArchived = useCallback(
    (name: string) => archivedNames.has(name),
    [archivedNames],
  );

  return { archived, archivedNames, archive, restore, isArchived };
}
