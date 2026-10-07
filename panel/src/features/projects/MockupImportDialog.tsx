import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, FileCode, FileX } from "lucide-react";
import { useMockupImport, todayPrefix, type MockupImportRow } from "./useMockupImport";

interface Props {
  project: string;
  files: File[];
  onClose: () => void;
  /** Relative paths of the files that landed (may be empty when all failed). */
  onImported: (relativePaths: string[]) => void;
}

const MUTED = { color: "var(--text-muted)" };

function Thumb({ row }: { row: MockupImportRow }) {
  const box = "w-12 h-12 shrink-0 rounded flex items-center justify-center overflow-hidden";
  const boxStyle = { background: "var(--bg-base)", border: "1px solid var(--border-subtle)" };
  if (row.thumbUrl) {
    return (
      <div className={box} style={boxStyle}>
        <img
          data-testid="mockup-import-thumb"
          src={row.thumbUrl}
          alt=""
          className="max-w-full max-h-full object-contain"
        />
      </div>
    );
  }
  const Icon = row.rejected ? FileX : FileCode;
  return (
    <div className={box} style={{ ...boxStyle, color: "var(--text-muted)" }}>
      <Icon size={20} />
    </div>
  );
}

function Row({
  row,
  prefix,
  onSlug,
}: {
  row: MockupImportRow;
  prefix: string;
  onSlug: (slug: string) => void;
}) {
  return (
    <li
      data-testid="mockup-import-row"
      data-rejected={row.rejected ? "true" : undefined}
      className="flex items-start gap-3 py-2"
      style={{ borderTop: "1px solid var(--border-subtle)" }}
    >
      <Thumb row={row} />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] truncate" style={MUTED} title={row.file.name}>
          {row.file.name}
        </div>
        {row.rejected ? (
          <div
            data-testid="mockup-import-rejected"
            className="text-[12.5px] mt-1"
            style={{ color: "var(--red)" }}
          >
            Rejected — {row.rejected}
          </div>
        ) : (
          <>
            <label className="flex items-center mt-1 text-[12.5px] font-mono min-w-0">
              <span data-testid="mockup-import-prefix" style={MUTED}>
                {prefix}
              </span>
              <input
                data-testid="mockup-import-slug"
                aria-label={`Name for ${row.file.name}`}
                value={row.slug}
                onChange={(e) => onSlug(e.target.value)}
                className="min-w-0 flex-1 px-1 py-0.5 rounded outline-none"
                style={{
                  background: "var(--bg-base)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-subtle)",
                }}
              />
              <span data-testid="mockup-import-ext" style={MUTED}>
                {row.ext}
              </span>
            </label>
            {row.externalCount > 0 && (
              <div
                data-testid="mockup-import-warning-row"
                className="flex items-center gap-1 text-[12px] mt-1"
                style={{ color: "var(--yellow)" }}
              >
                <AlertTriangle size={12} className="shrink-0" />
                <span data-testid="mockup-import-warning">
                  {`Loads ${row.externalCount} external resource${
                    row.externalCount === 1 ? "" : "s"
                  } — they will not load offline`}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Review step between picking/dropping files and writing them: one row per
 * file with a thumbnail, the editable slug between the fixed date prefix and
 * the extension, and what will not be sent. Mounted per batch — key it by the
 * batch so a new drop starts fresh.
 */
export default function MockupImportDialog({ project, files, onClose, onImported }: Props) {
  const { rows, acceptedCount, setSlug, submit, submitting } = useMockupImport({
    project,
    files,
    onImported,
  });
  // Fixed for the dialog's lifetime; the server applies its own local date.
  const prefix = useMemo(() => todayPrefix(), []);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      data-testid="mockup-import-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
    >
      <div
        data-testid="mockup-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mockup-import-title"
        onClick={(e) => e.stopPropagation()}
        className="w-[90vw] max-w-[560px] max-h-[85vh] flex flex-col rounded-lg p-4"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)",
        }}
      >
        <h2 id="mockup-import-title" className="text-[14px] font-semibold mb-1">
          Import {files.length === 1 ? "mockup" : "mockups"}
        </h2>
        <p className="text-[12.5px] mb-2" style={{ color: "var(--text-secondary)" }}>
          Saved to <code className="font-mono">projects/{project}/mockups/</code>
        </p>
        <ul className="overflow-y-auto min-h-0 flex-1 mb-4">
          {rows.map((row, i) => (
            <Row key={i} row={row} prefix={prefix} onSlug={(slug) => setSlug(i, slug)} />
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="mockup-import-cancel"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12.5px]"
            style={{
              background: "var(--bg-base)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="mockup-import-confirm"
            onClick={() => void submit()}
            disabled={acceptedCount === 0 || submitting}
            className="px-3 py-1.5 rounded-md text-[12.5px] font-semibold disabled:opacity-50"
            style={{
              background: "var(--accent)",
              color: "white",
              border: "1px solid var(--accent)",
            }}
          >
            {submitting ? "Importing…" : `Import${acceptedCount > 1 ? ` ${acceptedCount}` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
