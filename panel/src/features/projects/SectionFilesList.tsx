import type { FileEntry } from "../explorer/useFileIndex";
import { useFileDragSource, useFileDropTarget } from "../explorer/useFileDrag";
import FileRow from "./FileRow";

interface Props {
  projectName: string;
  section: string;
  files: FileEntry[];
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

const shortDate = (modified: number) =>
  new Date(modified).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

export function SectionFilesList({
  projectName,
  section,
  files,
  selectedPath,
  onSelect,
}: Props) {
  if (section === "qa") {
    const runs = files
      .filter((f) => f.relativePath.endsWith("/run.md"))
      .map((f) => {
        const parts = f.relativePath.split("/");
        const folderName = parts[parts.length - 2];
        return { file: f, folderName };
      })
      .sort((a, b) => b.folderName.localeCompare(a.folderName));

    if (runs.length === 0) {
      return (
        <p className="text-xs px-2 py-1" style={{ color: "var(--text-muted)" }}>
          No QA runs found.
        </p>
      );
    }

    return (
      <div className="space-y-0.5">
        {runs.map(({ file, folderName }) => (
          <SectionFileRow
            key={file.relativePath}
            file={file}
            label={folderName}
            monoLabel
            dateLabel={shortDate(file.modified)}
            selected={selectedPath === file.relativePath}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <SectionDropStrip projectName={projectName} section={section} />
      {files.length === 0 ? (
        <p className="text-xs px-2 py-1" style={{ color: "var(--text-muted)" }}>
          No files in this section.
        </p>
      ) : (
        <div className="space-y-0.5">
          {files.map((file) => (
            <SectionFileRow
              key={file.relativePath}
              file={file}
              label={file.relativePath.split("/").pop() ?? file.relativePath}
              dateLabel={shortDate(file.modified)}
              selected={selectedPath === file.relativePath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default SectionFilesList;
