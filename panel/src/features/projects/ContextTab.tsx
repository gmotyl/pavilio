import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen } from "lucide-react";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import {
  useProjectContext,
  fetchContextFile,
  type AdrFile,
  type ContextFile,
  type SpecFile,
  type OpenSpecSpecFile,
} from "./useProjectContext";
import FileListSidebar, { type FileListSource } from "./FileListSidebar";
import FileRow from "./FileRow";
import { useFileListControls, filterAndSortFiles } from "./fileListControls";
import { useAutoSelectNewest } from "./useAutoSelectNewest";

interface Props {
  projectName: string;
}

function adrLabel(a: AdrFile): string {
  return a.adrNumber !== null
    ? `${String(a.adrNumber).padStart(4, "0")} — ${a.slug.replace(/-/g, " ")}`
    : a.filename;
}

function SourceRows({
  contexts,
  adrs,
  specs,
  openspecSpecs,
  selectedPath,
  onSelect,
}: {
  contexts: ContextFile[];
  adrs: AdrFile[];
  specs: SpecFile[];
  openspecSpecs: OpenSpecSpecFile[];
  selectedPath: string | null;
  onSelect: (absolutePath: string) => void;
}) {
  if (
    contexts.length === 0 &&
    adrs.length === 0 &&
    specs.length === 0 &&
    openspecSpecs.length === 0
  ) {
    return (
      <p className="text-xs px-2 py-1" style={{ color: "var(--text-muted)" }}>
        (no context or decisions)
      </p>
    );
  }
  return (
    <>
      {contexts.map((c) => (
        <FileRow
          key={c.absolutePath}
          testId={`context-tab-file-${c.source}-${c.filename}`}
          label={c.filename}
          title={c.absolutePath}
          selected={selectedPath === c.absolutePath}
          onSelect={() => onSelect(c.absolutePath)}
        />
      ))}
      {specs.length > 0 && (
        <p
          className="text-[10px] uppercase tracking-widest px-2 pt-2 pb-0.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          Specs
        </p>
      )}
      {specs.map((s) => (
        <FileRow
          key={s.absolutePath}
          testId={`context-tab-spec-${s.source}-${s.filename}`}
          label={s.filename}
          title={s.absolutePath}
          selected={selectedPath === s.absolutePath}
          onSelect={() => onSelect(s.absolutePath)}
        />
      ))}
      {openspecSpecs.length > 0 && (
        <p
          className="text-[10px] uppercase tracking-widest px-2 pt-2 pb-0.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          Specs
        </p>
      )}
      {openspecSpecs.map((s) => (
        <FileRow
          key={s.absolutePath}
          testId={`context-tab-openspec-${s.source}-${s.capability}`}
          label={s.capability}
          title={s.absolutePath}
          selected={selectedPath === s.absolutePath}
          onSelect={() => onSelect(s.absolutePath)}
        />
      ))}
      {adrs.length > 0 && (
        <p
          className="text-[10px] uppercase tracking-widest px-2 pt-2 pb-0.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          Decisions
        </p>
      )}
      {adrs.map((a) => (
        <FileRow
          key={a.absolutePath}
          testId={`context-tab-adr-${a.source}-${a.filename}`}
          label={adrLabel(a)}
          title={a.absolutePath}
          selected={selectedPath === a.absolutePath}
          onSelect={() => onSelect(a.absolutePath)}
        />
      ))}
    </>
  );
}

export default function ContextTab({ projectName }: Props) {
  const { data, loading, error, refresh } = useProjectContext(projectName);
  // Selection lives in `?file=` (absolute path) so a context file can be
  // deep-linked and restored, same as plans/notes.
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

  // basePath drives relative-link/image resolution in MarkdownRenderer. The renderer
  // resolves against the projectsDir-rooted /view/ and /api/files/raw/ endpoints, so
  // we only pass a basePath when the file actually lives under projectsDir (i.e.
  // project-local CONTEXT.md or ADRs). For linked-repo files we leave basePath
  // undefined — relative refs won't rewrite, but the markdown still renders.
  const selectedBasePath = useMemo(() => {
    if (!data || !selectedPath) return undefined;
    const hit = [
      ...data.contexts,
      ...data.adrs,
      ...(data.specs ?? []),
      ...(data.openspecSpecs ?? []),
    ].find((f) => f.absolutePath === selectedPath);
    return hit?.relativeToProjectsDir ?? undefined;
  }, [data, selectedPath]);

  useEffect(() => {
    if (!selectedPath) {
      setFileContent(null);
      setFileError(null);
      return;
    }
    let cancelled = false;
    setFileContent(null);
    setFileError(null);
    fetchContextFile(projectName, selectedPath)
      .then((r) => {
        if (!cancelled) setFileContent(r.content);
      })
      .catch((e) => {
        if (!cancelled) setFileError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectName, selectedPath]);

  const grouped = useMemo(() => {
    if (!data) return null;
    const bySource = new Map<
      string,
      {
        contexts: ContextFile[];
        adrs: AdrFile[];
        specs: SpecFile[];
        openspecSpecs: OpenSpecSpecFile[];
      }
    >();
    for (const s of data.sources)
      bySource.set(s.id, { contexts: [], adrs: [], specs: [], openspecSpecs: [] });
    for (const c of data.contexts) bySource.get(c.source)?.contexts.push(c);
    for (const a of data.adrs) bySource.get(a.source)?.adrs.push(a);
    for (const sp of data.specs ?? []) bySource.get(sp.source)?.specs.push(sp);
    for (const os of data.openspecSpecs ?? [])
      bySource.get(os.source)?.openspecSpecs.push(os);
    return bySource;
  }, [data]);

  const controls = useFileListControls();

  const autoSelectCandidates = useMemo(() => {
    if (!data) return [];
    const q = controls.debouncedQuery.trim().toLowerCase();
    const match = (name: string) => !q || name.toLowerCase().includes(q);
    const items = [
      ...data.contexts.filter((c) => match(c.filename)),
      ...(data.specs ?? []).filter((s) => match(s.filename)),
      ...(data.openspecSpecs ?? []).filter((s) => match(s.capability)),
      ...data.adrs.filter((a) => match(adrLabel(a))),
    ];
    return items.map((f) => ({ key: f.absolutePath, mtime: f.modified }));
  }, [data, controls.debouncedQuery]);

  useAutoSelectNewest({
    candidates: autoSelectCandidates,
    selectedPath,
    onSelect: setSelectedPath,
  });

  if (loading && !data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading context…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--red)" }}>
        Failed to load context: {error}
      </p>
    );
  }
  if (!data || !grouped) return null;

  const anyFile =
    data.contexts.length > 0 ||
    data.adrs.length > 0 ||
    (data.specs ?? []).length > 0 ||
    (data.openspecSpecs ?? []).length > 0;

  const applyBucket = <T extends { filename: string; modified: number }>(
    items: T[],
    getName: (i: T) => string,
  ) =>
    filterAndSortFiles(items, {
      getName,
      getMtime: (i) => i.modified,
      query: controls.debouncedQuery,
      sortKey: controls.sortKey,
      sortDir: controls.sortDir,
    });

  const sources: FileListSource[] = !anyFile
    ? []
    : data.sources.flatMap((s) => {
        const bucket = grouped.get(s.id);
        if (!bucket) return [];
        const contexts = applyBucket(bucket.contexts, (c) => c.filename);
        const specs = applyBucket(bucket.specs, (sp) => sp.filename);
        const openspecSpecs = applyBucket(bucket.openspecSpecs, (os) => os.capability);
        const adrs = applyBucket(bucket.adrs, (a) => adrLabel(a));
        const count = contexts.length + specs.length + openspecSpecs.length + adrs.length;
        if (controls.debouncedQuery.trim() && count === 0) {
          return []; // hide a source with no matches under an active filter
        }
        return [
          {
            id: s.id,
            label: s.label,
            count,
            hint: s.id !== "project" ? "(linked repo)" : undefined,
            renderHeader:
              s.id === "project"
                ? undefined
                : (header) => <div title={s.absoluteRoot}>{header}</div>,
            rows: (
              <SourceRows
                contexts={contexts}
                adrs={adrs}
                specs={specs}
                openspecSpecs={openspecSpecs}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
              />
            ),
          },
        ];
      });

  return (
    <FileListSidebar
      testId="context-tab"
      title="Context"
      icon={<BookOpen size={16} style={{ color: "var(--accent)" }} />}
      sources={sources}
      onRefresh={refresh}
      controls={controls.controlsBar}
      aboveList={
        !anyFile ? (
          <div
            className="rounded-md p-4 text-sm"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            No context or decisions recorded yet. See <code>AGENTS.md</code> →
            <em> Domain Context &amp; Decisions</em> for the convention.
          </div>
        ) : undefined
      }
      detail={
        <>
          {!selectedPath && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Select a file to view.
            </p>
          )}
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
