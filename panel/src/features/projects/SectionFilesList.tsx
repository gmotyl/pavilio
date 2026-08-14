import type { FileEntry } from "../explorer/useFileIndex";
import { useFileDragSource, useFileDropTarget } from "../explorer/useFileDrag";
import FileRow from "./FileRow";
import { filterAndSortFiles, type SortKey, type SortDir } from "./fileListControls";

interface Props {
  projectName: string;
  section: string;
  rows: SectionRow[];
  filterActive: boolean;
  selectedPath: string | null;
  onSelect: (relativePath: string) => void;
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
  selected,
  onSelect,
}: {
  file: FileEntry;
  label: string;
  dateLabel?: string;
  monoLabel?: boolean;
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
}

/**
 * The one list a section renders. The sidebar's count badge and the rows both
 * derive from this, so they cannot drift: `qa` indexes .md/.txt/.json but only
 * shows one row per run.md, which used to make the badge overcount.
 */
export function sectionRows(section: string, files: FileEntry[]): SectionRow[] {
  if (section === "qa") {
    return files
      .filter((f) => f.relativePath.endsWith("/run.md"))
      .map((f) => {
        const parts = f.relativePath.split("/");
        return { file: f, label: parts[parts.length - 2], monoLabel: true };
      })
      .sort((a, b) => b.label.localeCompare(a.label));
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

  const rowList = (
    <div className="space-y-0.5">
      {rows.map(({ file, label, monoLabel }) => (
        <SectionFileRow
          key={file.relativePath}
          file={file}
          label={label}
          monoLabel={monoLabel}
          dateLabel={shortDate(file.modified, withYear)}
          selected={selectedPath === file.relativePath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );

  const emptyMessage = filterActive
    ? "No files match."
    : section === "qa"
      ? "No QA runs found."
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
