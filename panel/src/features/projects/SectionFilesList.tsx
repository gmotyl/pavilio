import { FileText, X } from "lucide-react";
import type { FileEntry } from "../explorer/useFileIndex";

interface Props {
  projectName: string;
  section: string;
  files: FileEntry[];
  currentPlans?: string[];
  onSelect: (relativePath: string) => void;
}

function PlansBanner({
  projectName,
  plans,
  onSelect,
}: {
  projectName: string;
  plans: string[];
  onSelect: (relativePath: string) => void;
}) {
  return (
    <div
      className="mb-4 rounded-lg p-3"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--accent)",
        borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
      }}
    >
      <h3
        className="text-[11px] font-semibold uppercase tracking-widest mb-2"
        style={{ color: "var(--accent)" }}
      >
        Active Plans
      </h3>
      <div className="space-y-0.5">
        {plans.map((planFile) => {
          const fileName = planFile.split("/").pop() ?? planFile;
          const relativePath = `${projectName}/plans/${fileName}`;
          const label = planFile
            .replace(/\.md$/, "")
            .replace(/^\d{4}-\d{2}-\d{2}-/, "")
            .replace(/-/g, " ");
          return (
            <div key={planFile} className="flex items-center gap-1">
              <button
                onClick={() => onSelect(relativePath)}
                className="flex items-center gap-3 flex-1 px-3 py-1.5 rounded-md text-left transition-colors"
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--bg-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <FileText
                  size={14}
                  className="shrink-0"
                  style={{ color: "var(--accent)" }}
                />
                <span
                  className="text-sm truncate flex-1 capitalize"
                  style={{ color: "var(--text-primary)" }}
                >
                  {label}
                </span>
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  await fetch(
                    `/api/projects/${projectName}/plans/current/${encodeURIComponent(planFile)}`,
                    { method: "DELETE" },
                  );
                }}
                className="shrink-0 p-1 rounded transition-colors"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--red)";
                  e.currentTarget.style.background = "var(--red-dim)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.background = "transparent";
                }}
                title="Close plan (remove from active)"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FileButton({
  file,
  label,
  dateLabel,
  monoLabel,
  onSelect,
}: {
  file: FileEntry;
  label: string;
  dateLabel: string;
  monoLabel?: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(file.relativePath)}
      className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-left transition-colors"
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--bg-hover)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = "transparent")
      }
    >
      <FileText
        size={14}
        className="shrink-0"
        style={{ color: "var(--text-tertiary)" }}
      />
      <span
        className={`text-sm truncate flex-1 ${monoLabel ? "font-mono" : ""}`}
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </span>
      <span
        className="text-[11px]"
        style={{ color: "var(--text-muted)" }}
      >
        {dateLabel}
      </span>
    </button>
  );
}

export function SectionFilesList({
  projectName,
  section,
  files,
  currentPlans,
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

    return (
      <div>
        <h2
          className="text-[11px] font-semibold uppercase tracking-widest mb-3"
          style={{ color: "var(--text-tertiary)" }}
        >
          QA Runs ({runs.length})
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No QA runs found.
          </p>
        ) : (
          <div className="space-y-0.5">
            {runs.map(({ file, folderName }) => (
              <FileButton
                key={file.relativePath}
                file={file}
                label={folderName}
                monoLabel
                dateLabel={new Date(file.modified).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {section === "plans" && currentPlans && currentPlans.length > 0 && (
        <PlansBanner
          projectName={projectName}
          plans={currentPlans}
          onSelect={onSelect}
        />
      )}
      <h2
        className="text-[11px] font-semibold uppercase tracking-widest mb-3"
        style={{ color: "var(--text-tertiary)" }}
      >
        {section} ({files.length} files)
      </h2>
      {files.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No files in this section.
        </p>
      ) : (
        <div className="space-y-0.5">
          {files.map((file) => {
            const fileName =
              file.relativePath.split("/").pop() ?? file.relativePath;
            const date = new Date(file.modified).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            return (
              <FileButton
                key={file.relativePath}
                file={file}
                label={fileName}
                dateLabel={date}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SectionFilesList;
