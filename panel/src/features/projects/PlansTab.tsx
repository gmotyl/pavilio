import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import {
  clearLastSectionFile,
  writeLastSectionFile,
} from "../shell/lastPath";
import {
  usePlansTree,
  fetchPlanFile,
  isOpenSpecSource,
  type PlanArtifact,
  type PlanFile,
  type LegacyPlanSource,
  type OpenSpecPlanSource,
} from "./usePlansTree";
import { useFileListControls, filterAndSortFiles } from "./fileListControls";
import { useAutoSelectNewest } from "./useAutoSelectNewest";
import PathActions from "./PathActions";
import { usePeekTriggerProps } from "./peekTrigger";
import FileListSidebar, { type FileListSource } from "./FileListSidebar";
import FileRow from "./FileRow";

interface Props {
  projectName: string;
}

/** Human-readable label for one change artifact row. */
function artifactLabel(a: PlanArtifact): string {
  return a.kind === "spec" ? `spec: ${a.capability ?? "?"}` : a.kind;
}

/** Testid-safe key for one artifact within a (source, change) pair. */
function artifactKey(a: PlanArtifact): string {
  return a.kind === "spec" ? `spec-${a.capability ?? ""}` : a.kind;
}

function LegacyPlanRows({
  source,
  selectedPath,
  onOpen,
}: {
  source: LegacyPlanSource;
  selectedPath: string | null;
  onOpen: (absolutePath: string) => void;
}) {
  if (source.files.length === 0) {
    return (
      <p className="text-xs px-2 py-1" style={{ color: "var(--text-muted)" }}>
        (no plans)
      </p>
    );
  }
  return (
    <>
      {source.files.map((file) => (
        <FileRow
          key={file.absolutePath}
          testId={`plans-tab-file-${source.id}-${file.filename}`}
          label={file.filename}
          selected={selectedPath === file.absolutePath}
          title={file.absolutePath}
          onSelect={() => onOpen(file.absolutePath)}
        />
      ))}
    </>
  );
}

/** One coordinated change: children keyed by owning source, artifacts under each. */
interface ChangeGroupChild {
  sourceId: string;
  sourceLabel: string;
  artifacts: PlanArtifact[];
}
interface ChangeGroup {
  changeId: string;
  archived: boolean;
  archiveDate: string | null;
  children: ChangeGroupChild[];
}

function ChangeGroupRows({
  group,
  selectedPath,
  onOpen,
}: {
  group: ChangeGroup;
  selectedPath: string | null;
  onOpen: (absolutePath: string) => void;
}) {
  return (
    <>
      {group.children.map((child) => (
        <div key={child.sourceId} className="mb-1">
          <p
            data-testid={`plans-tab-change-src-${child.sourceId}-${group.changeId}`}
            className="text-[10px] uppercase tracking-widest px-2 pt-1 pb-0.5"
            style={{ color: "var(--text-tertiary)" }}
          >
            {child.sourceLabel}
          </p>
          {child.artifacts.map((a) => (
            <FileRow
              key={a.absolutePath}
              testId={`plans-tab-artifact-${child.sourceId}-${group.changeId}-${artifactKey(a)}`}
              label={artifactLabel(a)}
              selected={selectedPath === a.absolutePath}
              title={a.absolutePath}
              onSelect={() => onOpen(a.absolutePath)}
            />
          ))}
        </div>
      ))}
    </>
  );
}

/** Open-file header: the filename doubles as the hover-peek trigger (see PeekTriggerContext). */
function PlanDetailHeader({ path }: { path: string }) {
  const peek = usePeekTriggerProps();
  return (
    <div
      className="flex items-center gap-2 mb-4 pb-3"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <span
        {...peek}
        data-testid="file-list-peek-trigger"
        className="text-sm font-mono truncate flex-1 cursor-default"
        style={{ color: "var(--text-tertiary)" }}
      >
        {path.split("/").pop()}
      </span>
      <PathActions absolutePath={path} />
    </div>
  );
}

/** Does an artifact match the active filter? Searches repo, change, capability, filename. */
function artifactMatches(
  a: PlanArtifact,
  changeId: string,
  sourceLabel: string,
  q: string,
): boolean {
  if (!q) return true;
  const hay = [
    changeId,
    sourceLabel,
    a.capability ?? "",
    a.filename,
    a.kind,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export default function PlansTab({ projectName }: Props) {
  const { data, loading, error, refresh } = usePlansTree(projectName);
  // Selection lives in the `?file=` URL param (like notes/memo) so the
  // plans tab link built by useProjectTabs can restore the open plan.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPath = searchParams.get("file");
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const setSelectedPath = useCallback(
    (path: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (path) next.set("file", path);
          else next.delete("file");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Every openable item (legacy plan file or OpenSpec artifact), keyed by path,
  // so the detail pane can resolve basePath for whatever is selected.
  const filesByPath = useMemo(() => {
    const map = new Map<string, { relativeToProjectsDir: string | null }>();
    if (!data) return map;
    for (const source of data.sources) {
      if (isOpenSpecSource(source)) {
        for (const change of source.changes) {
          for (const a of change.artifacts) {
            map.set(a.absolutePath, { relativeToProjectsDir: a.relativeToProjectsDir });
          }
        }
      } else {
        for (const f of source.files) {
          map.set(f.absolutePath, { relativeToProjectsDir: f.relativeToProjectsDir });
        }
      }
    }
    return map;
  }, [data]);

  const selectedBasePath = selectedPath
    ? (filesByPath.get(selectedPath)?.relativeToProjectsDir ?? undefined)
    : undefined;

  // Load plan content when selection changes
  useEffect(() => {
    if (!selectedPath) {
      setFileContent(null);
      setFileError(null);
      return;
    }
    let cancelled = false;
    setFileContent(null);
    setFileError(null);
    fetchPlanFile(projectName, selectedPath)
      .then((r) => {
        if (!cancelled) setFileContent(r.content);
      })
      .catch((e) => {
        if (cancelled) return;
        setFileError(e instanceof Error ? e.message : String(e));
        clearLastSectionFile(projectName, "plans");
      });
    return () => {
      cancelled = true;
    };
  }, [projectName, selectedPath]);

  // Persist last-open plan so the tab link can restore it
  useEffect(() => {
    if (!projectName) return;
    if (selectedPath) writeLastSectionFile(projectName, "plans", selectedPath);
    else clearLastSectionFile(projectName, "plans");
  }, [projectName, selectedPath]);

  const onOpen = useCallback(
    (absolutePath: string) => setSelectedPath(absolutePath),
    [setSelectedPath],
  );

  const controls = useFileListControls();
  const q = controls.debouncedQuery.trim().toLowerCase();

  const legacySources = useMemo<LegacyPlanSource[]>(
    () => (data?.sources ?? []).filter((s): s is LegacyPlanSource => !isOpenSpecSource(s)),
    [data],
  );
  const openspecSources = useMemo<OpenSpecPlanSource[]>(
    () => (data?.sources ?? []).filter(isOpenSpecSource),
    [data],
  );

  // Coordinate the same change id across every OpenSpec source into one group.
  const changeGroups = useMemo<ChangeGroup[]>(() => {
    const byChange = new Map<string, ChangeGroup>();
    for (const src of openspecSources) {
      for (const change of src.changes) {
        let g = byChange.get(change.changeId);
        if (!g) {
          g = { changeId: change.changeId, archived: true, archiveDate: null, children: [] };
          byChange.set(change.changeId, g);
        }
        g.children.push({
          sourceId: src.id,
          sourceLabel: src.label,
          artifacts: change.artifacts,
        });
        // Active in ANY source keeps the coordinated change live.
        if (change.status === "active") g.archived = false;
        if (change.status === "archived" && change.archiveDate && !g.archiveDate) {
          g.archiveDate = change.archiveDate;
        }
      }
    }
    const groups = [...byChange.values()];
    // Active first, then archived; stable-sorted by change id within each band.
    groups.sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      return a.changeId.localeCompare(b.changeId);
    });
    return groups;
  }, [openspecSources]);

  const sortOpts = {
    getName: (f: PlanFile) => f.filename,
    getMtime: (f: PlanFile) => f.modified,
    query: controls.debouncedQuery,
    sortKey: controls.sortKey,
    sortDir: controls.sortDir,
  };

  // Auto-select the newest openable item (never an archived one).
  const candidates = useMemo(() => {
    const legacy = legacySources
      .filter((s) => !s.id.endsWith(":archived"))
      .flatMap((s) => filterAndSortFiles(s.files, sortOpts))
      .map((f) => ({ key: f.absolutePath, mtime: f.modified }));
    const artifacts = changeGroups
      .filter((g) => !g.archived)
      .flatMap((g) =>
        g.children.flatMap((c) =>
          c.artifacts
            .filter((a) => artifactMatches(a, g.changeId, c.sourceLabel, q))
            .map((a) => ({ key: a.absolutePath, mtime: a.modified })),
        ),
      );
    return [...legacy, ...artifacts];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacySources, changeGroups, controls.debouncedQuery, controls.sortKey, controls.sortDir]);
  useAutoSelectNewest({ candidates, selectedPath, onSelect: setSelectedPath });

  if (loading && !data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading plans…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--red)" }}>
        Failed to load plans: {error}
      </p>
    );
  }
  if (!data) return null;

  const legacyFileSources: FileListSource[] = legacySources.map((s) => {
    const files = filterAndSortFiles(s.files, sortOpts);
    const isArchived = s.id.endsWith(":archived");
    return {
      id: s.id,
      // Archived's label ("Archived") already comes from the server source.
      label: s.id === "project" ? "projects (current)" : s.label,
      count: files.length,
      hint:
        !isArchived && s.id !== "project" && s.id !== "claude"
          ? "(.kilo)"
          : undefined,
      // History: collapsed by default. Archiving is done by
      // /pavilio-archive-plan, not in the panel.
      defaultOpen: isArchived ? false : undefined,
      rows: (
        <LegacyPlanRows
          source={{ ...s, files }}
          selectedPath={selectedPath}
          onOpen={onOpen}
        />
      ),
    };
  });

  const changeSources: FileListSource[] = changeGroups.flatMap((g) => {
    // Apply the filter to each child's artifacts; drop empty children/groups.
    const children = g.children
      .map((c) => ({
        ...c,
        artifacts: c.artifacts.filter((a) =>
          artifactMatches(a, g.changeId, c.sourceLabel, q),
        ),
      }))
      .filter((c) => c.artifacts.length > 0);
    if (children.length === 0) return [];
    const count = children.reduce((n, c) => n + c.artifacts.length, 0);
    return [
      {
        id: `change:${g.changeId}`,
        label: g.changeId,
        count,
        hint: g.archived
          ? g.archiveDate
            ? `archived ${g.archiveDate}`
            : "archived"
          : undefined,
        // Archived changes are history — collapsed by default; active stay open.
        defaultOpen: g.archived ? false : undefined,
        rows: (
          <ChangeGroupRows
            group={{ ...g, children }}
            selectedPath={selectedPath}
            onOpen={onOpen}
          />
        ),
      },
    ];
  });

  const sources: FileListSource[] = [...legacyFileSources, ...changeSources];

  return (
    <FileListSidebar
      testId="plans-tab"
      title="Plans"
      icon={<ClipboardList size={16} style={{ color: "var(--accent)" }} />}
      sources={sources}
      controls={controls.controlsBar}
      onRefresh={refresh}
      detail={
        <>
          {!selectedPath && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Select a plan to view.
            </p>
          )}
          {selectedPath && <PlanDetailHeader path={selectedPath} />}
          {selectedPath && fileError && (
            <p className="text-sm" style={{ color: "var(--red)" }}>
              Failed to load file: {fileError}
            </p>
          )}
          {selectedPath && !fileError && fileContent === null && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Loading…
            </p>
          )}
          {fileContent !== null && (
            <MarkdownRenderer content={fileContent} basePath={selectedBasePath} />
          )}
        </>
      }
    />
  );
}
