import { refreshFileIndex, type FileEntry } from "../explorer/useFileIndex";
import { useFileDragSource, useFileDropTarget } from "../explorer/useFileDrag";
import FileRow, { type FileRowDelete } from "./FileRow";
import { filterAndSortFiles, type SortKey, type SortDir } from "./fileListControls";

interface Props {
  projectName: string;
  section: string;
  rows: SectionRow[];
  filterActive: boolean;
  selectedPath: string | null;
  /** Null clears the selection (the open QA file was deleted). */
  onSelect: (relativePath: string | null) => void;
}

/**
 * Component boundary so `useFileDragSource` runs once per mounted row rather
 * than inside the parent's map().
 */
function SectionFileRow({
  file,
  label,
  dateLabel,
  monoLabel,
  kind,
  deleteControl,
  selected,
  onSelect,
}: {
  file: FileEntry;
  label: string;
  dateLabel?: string;
  monoLabel?: boolean;
  kind?: string;
  deleteControl?: FileRowDelete;
  selected: boolean;
  onSelect: (relativePath: string) => void;
}) {
  const drag = useFileDragSource(file.relativePath);
  return (
    <FileRow
      testId={`section-files-file-${file.relativePath}`}
      label={label}
      dateLabel={dateLabel}
      monoLabel={monoLabel}
      kind={kind}
      deleteControl={deleteControl}
      selected={selected}
      title={file.relativePath}
      dragProps={drag}
      onSelect={() => onSelect(file.relativePath)}
    />
  );
}

/**
 * Compact strip above the rows that accepts file drops for this section. Keeps
 * the `section-files-header-*` testid the drop-to-move behaviour is keyed on.
 */
function SectionDropStrip({
  projectName,
  section,
}: {
  projectName: string;
  section: string;
}) {
  const { hover, dropHandlers } = useFileDropTarget(`${projectName}/${section}`);
  return (
    <div
      {...dropHandlers}
      data-testid={`section-files-header-${section}`}
      className="text-[10px] uppercase tracking-widest mb-1 px-2 py-1 rounded-md transition-colors"
      style={{
        color: "var(--text-tertiary)",
        background: hover
          ? "var(--accent-dim, var(--bg-active))"
          : "transparent",
        outline: hover ? "1px solid var(--accent)" : undefined,
      }}
    >
      {hover ? (
        <span className="normal-case font-normal opacity-70">
          drop to move here
        </span>
      ) : (
        section
      )}
    </div>
  );
}

/** qa rows are dated folders, so the folder name already carries the year. */
const shortDate = (modified: number, withYear: boolean) =>
  new Date(modified).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
  });

export interface SectionRow {
  file: FileEntry;
  label: string;
  monoLabel?: boolean;
  kind?: "review" | "run" | "story";
}

/**
 * The path, relative to `qa/`, that `DELETE /api/projects/:p/qa/*` removes for
 * this row: the story/review file, or a run row's whole `runs/<run>` folder.
 * The row must sit exactly at `<project>/qa/{stories,reviews}/<file>` or
 * `<project>/qa/runs/<run>/run.md` — a nested `qa/x/reviews/a.md` would
 * otherwise send `reviews/a.md` and remove a different file. Null otherwise.
 */
function qaDeletePath(projectName: string, row: SectionRow): string | null {
  const prefix = `${projectName}/qa/`;
  if (!row.file.relativePath.startsWith(prefix)) return null;
  const parts = row.file.relativePath.slice(prefix.length).split("/");
  if (row.kind === "run") {
    return parts.length === 3 && parts[0] === "runs" && parts[2] === "run.md"
      ? `runs/${parts[1]}`
      : null;
  }
  const dir = row.kind === "story" ? "stories" : row.kind === "review" ? "reviews" : null;
  return dir && parts.length === 2 && parts[0] === dir ? `${dir}/${parts[1]}` : null;
}

/**
 * Deletes one QA artifact and asks the file index to re-fetch. `onDeleted`
 * gets the removed path (relative to the projects dir) so an open file inside
 * it can be closed.
 */
function qaDeleteControl(
  projectName: string,
  row: SectionRow,
  onDeleted: (removed: string) => void,
): FileRowDelete | undefined {
  const path = qaDeletePath(projectName, row);
  if (!path) return undefined;
  return {
    name: path,
    confirmLabel: row.kind === "run" ? "Delete run?" : "Delete?",
    run: async () => {
      const url = `/api/projects/${encodeURIComponent(projectName)}/qa/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      refreshFileIndex();
      onDeleted(`${projectName}/qa/${path}`);
    },
  };
}

/**
 * The one list a section renders. The sidebar's count badge and the rows both
 * derive from this, so they cannot drift: `qa` indexes .md/.txt/.json but only
 * shows one row per run.md, which used to make the badge overcount.
 */
export function sectionRows(section: string, files: FileEntry[]): SectionRow[] {
  if (section === "qa") {
    const runRows: SectionRow[] = files
      .filter((f) => f.relativePath.endsWith("/run.md"))
      .map((f) => {
        const parts = f.relativePath.split("/");
        return {
          file: f,
          label: parts[parts.length - 2],
          monoLabel: true,
          kind: "run",
        };
      });
    const reviewRows: SectionRow[] = files
      .filter((f) => {
        const parts = f.relativePath.split("/");
        return (
          parts[parts.length - 2] === "reviews" && f.relativePath.endsWith(".md")
        );
      })
      .map((f) => {
        const base = f.relativePath.split("/").pop() ?? f.relativePath;
        const label = base
          .replace(/\.md$/, "")
          .replace(/^\d{4}-\d{2}-\d{2}_CODE_REVIEW_/, "");
        return { file: f, label, monoLabel: true, kind: "review" };
      });
    // `stories/` also holds the `.gitignore` the skill writes; only .md rows.
    const storyRows: SectionRow[] = files
      .filter((f) => {
        const parts = f.relativePath.split("/");
        const base = parts[parts.length - 1];
        // Direct children of qa/stories/ only — the delete route takes no other.
        return (
          parts[parts.length - 2] === "stories" &&
          parts[parts.length - 3] === "qa" &&
          base.endsWith(".md") &&
          !base.startsWith(".")
        );
      })
      .map((f) => {
        const base = f.relativePath.split("/").pop() ?? f.relativePath;
        return { file: f, label: base.replace(/\.md$/, ""), monoLabel: true, kind: "story" };
      });
    return [...storyRows, ...reviewRows, ...runRows].sort(
      (a, b) => b.file.modified - a.file.modified,
    );
  }
  return files.map((f) => ({
    file: f,
    label: f.relativePath.split("/").pop() ?? f.relativePath,
  }));
}

export function visibleSectionRows(
  section: string,
  files: FileEntry[],
  controls: { query: string; sortKey: SortKey; sortDir: SortDir },
): SectionRow[] {
  return filterAndSortFiles(sectionRows(section, files), {
    getName: (r) => r.label,
    getMtime: (r) => r.file.modified,
    query: controls.query,
    sortKey: controls.sortKey,
    sortDir: controls.sortDir,
  });
}

export function SectionFilesList({
  projectName,
  section,
  rows,
  filterActive,
  selectedPath,
  onSelect,
}: Props) {
  const withYear = section !== "qa";
  // A deleted row that is open (or, for a run, holds the open file) closes it.
  const onDeleted = (removed: string) => {
    if (selectedPath === removed || selectedPath?.startsWith(`${removed}/`)) onSelect(null);
  };

  const rowList = (
    <div className="space-y-0.5">
      {rows.map((row) => (
        <SectionFileRow
          key={row.file.relativePath}
          file={row.file}
          label={row.label}
          monoLabel={row.monoLabel}
          kind={row.kind}
          deleteControl={
            section === "qa" ? qaDeleteControl(projectName, row, onDeleted) : undefined
          }
          dateLabel={shortDate(row.file.modified, withYear)}
          selected={selectedPath === row.file.relativePath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );

  const emptyMessage = filterActive
    ? "No files match."
    : section === "qa"
      ? "No QA reviews or runs found."
      : "No files in this section.";

  if (section === "qa") {
    if (rows.length === 0) {
      return (
        <p className="text-xs px-2 py-1" style={{ color: "var(--text-muted)" }}>
          {emptyMessage}
        </p>
      );
    }
    return rowList;
  }

  return (
    <div>
      <SectionDropStrip projectName={projectName} section={section} />
      {rows.length === 0 ? (
        <p className="text-xs px-2 py-1" style={{ color: "var(--text-muted)" }}>
          {emptyMessage}
        </p>
      ) : (
        rowList
      )}
    </div>
  );
}

export default SectionFilesList;
