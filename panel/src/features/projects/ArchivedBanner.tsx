import { useState } from "react";
import { Archive, RotateCcw } from "lucide-react";
import { useArchivedProjects } from "./useArchivedProjects";
import { formatArchivedDay } from "./archiveGroups";
import { refreshProjects } from "./useProjects";

interface Props {
  project: string;
  /** ISO timestamp from the detail endpoint; the banner shows its local day. */
  archivedAt: string | undefined;
  /** Called after a successful restore, so the view can refetch the project. */
  onRestored: () => void;
}

/**
 * The amber strip above an archived project's tabs: when it was archived, that
 * the view is read-only, and the one write it allows — Restore to sidebar.
 * Mounted only for archived projects, so its archive fetch costs nothing on a
 * live project.
 */
export default function ArchivedBanner({ project, archivedAt, onRestored }: Props) {
  const { restore, error } = useArchivedProjects();
  const [busy, setBusy] = useState(false);

  const onRestore = async () => {
    setBusy(true);
    const failure = await restore(project);
    setBusy(false);
    // A failed restore keeps the banner; the hook's error explains why.
    if (failure !== null) return;
    // The sidebar's list and this view's detail both pick the project up again.
    refreshProjects();
    onRestored();
  };

  return (
    <div
      data-testid="archived-banner"
      role="status"
      className="flex flex-wrap items-center gap-2 px-3 py-2 mb-4 rounded-md text-[13px]"
      style={{
        color: "var(--yellow)",
        background: "var(--yellow-dim)",
        border: "1px solid color-mix(in srgb, var(--yellow) 35%, transparent)",
      }}
    >
      <Archive size={14} className="flex-none" />
      <span className="min-w-0">
        Archived {archivedAt ? formatArchivedDay(archivedAt) : "—"} · read-only — no edits, no
        terminals start here
      </span>
      <button
        type="button"
        onClick={onRestore}
        disabled={busy}
        className="ml-auto flex flex-none items-center gap-1.5 px-3 py-1 rounded text-[12px]"
        style={{
          color: "var(--text-primary)",
          border: "1px solid var(--yellow)",
          background: "transparent",
        }}
      >
        <RotateCcw size={12} />
        <span>Restore to sidebar</span>
      </button>
      {error && (
        <p
          role="alert"
          className="basis-full text-[12px]"
          style={{ color: "var(--red)" }}
        >
          Could not restore: {error}
        </p>
      )}
    </div>
  );
}
