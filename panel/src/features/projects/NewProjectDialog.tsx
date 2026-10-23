import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  isValidProjectSlug,
  slugifyProjectTitle,
} from "../../../server/lib/projects/slug";
import { refreshProjects } from "./useProjects";

/** What the panel creates; `knowledge` is never offered (the workspace has exactly one). */
export type NewProjectKind = "project" | "research";

interface Props {
  /** Preselected by the header the dialog was opened from. */
  initialKind: NewProjectKind;
  onClose: () => void;
  /** `useArchivedProjects().restore`: resolves to an error message, or null on success. */
  restore: (name: string) => Promise<string | null>;
}

/** The answer shown under the form after a refused create. */
type Failure =
  | { kind: "exists"; name: string }
  | { kind: "archived"; name: string }
  | { kind: "error"; message: string };

const FIELD_STYLE = {
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
};
const ERROR_STYLE = { color: "var(--red)" };

function slugError(slug: string): string | null {
  if (slug === "") return "Folder name is empty — use letters or digits";
  if (slug === "archived") return "\"archived\" is reserved for the archive folder";
  return isValidProjectSlug(slug) ? null : "Not a valid folder name";
}

/**
 * The "new" dialog behind the **new** button on the Projects and Research
 * headers: a Project / Research switch, a Title with its live folder slug, a
 * Topic for research, and every `POST /api/projects` answer handled in place.
 */
export default function NewProjectDialog({ initialKind, onClose, restore }: Props) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<NewProjectKind>(initialKind);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  // Errors wait for the field to be edited, so a fresh dialog opens quiet.
  const [titleDirty, setTitleDirty] = useState(false);
  const [topicDirty, setTopicDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  });

  const slug = slugifyProjectTitle(title);
  const titleError = slugError(slug);
  const topicError =
    kind === "research" && topic.trim() === "" ? "A topic is required for research" : null;
  const canCreate = !titleError && !topicError && !busy;

  const requestClose = useCallback(() => {
    if (!busyRef.current) onClose();
  }, [onClose]);

  const open = (name: string) => {
    refreshProjects();
    onClose();
    navigate(`/project/${encodeURIComponent(name)}/iterm`);
  };

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "research" ? { title, kind, topic: topic.trim() } : { title, kind },
        ),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 201 && typeof body?.name === "string") {
        open(body.name);
        return;
      }
      if (res.status === 409 && (body?.reason === "exists" || body?.reason === "archived")) {
        setFailure({ kind: body.reason, name: body.name ?? slug });
      } else {
        setFailure({ kind: "error", message: body?.error ?? `Create failed (${res.status})` });
      }
    } catch (e) {
      setFailure({ kind: "error", message: e instanceof Error ? e.message : "Create failed" });
    } finally {
      setBusy(false);
    }
  };

  const restoreInstead = async (name: string) => {
    setBusy(true);
    const error = await restore(name);
    setBusy(false);
    if (error) setFailure({ kind: "error", message: error });
    else open(name);
  };

  // Focus the title on open; hand focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>('[data-testid="new-project-title"]')?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Window capture phase, so the modal owns Escape before a terminal pane sees it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      requestClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [requestClose]);

  const kindButton = (value: NewProjectKind, label: string) => (
    <button
      type="button"
      data-testid={`new-project-kind-${value}`}
      aria-pressed={kind === value}
      onClick={() => setKind(value)}
      className="flex-1 px-3 py-1 rounded text-[12.5px]"
      style={{
        background: kind === value ? "var(--bg-active)" : "transparent",
        color: kind === value ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      data-testid="new-project-backdrop"
      onClick={requestClose}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
    >
      <div
        ref={dialogRef}
        data-testid="new-project-dialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="new-project-heading"
        onClick={(e) => e.stopPropagation()}
        className="w-[90vw] max-w-[440px] flex flex-col gap-3 rounded-lg p-4 outline-none"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)",
        }}
      >
        <h2 id="new-project-heading" className="text-[14px] font-semibold">
          New {kind === "research" ? "research" : "project"}
        </h2>
        <div
          role="group"
          aria-label="Kind"
          className="flex gap-1 p-0.5 rounded-md"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          {kindButton("project", "Project")}
          {kindButton("research", "Research")}
        </div>
        <label className="flex flex-col gap-1 text-[12.5px]">
          <span style={{ color: "var(--text-secondary)" }}>Title</span>
          <input
            data-testid="new-project-title"
            value={title}
            required
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleDirty(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            className="px-2 py-1 rounded outline-none"
            style={FIELD_STYLE}
          />
          <span
            data-testid="new-project-folder"
            className="font-mono text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            {`folder: ${slug}`}
          </span>
          {titleDirty && titleError && (
            <span data-testid="new-project-title-error" className="text-[12px]" style={ERROR_STYLE}>
              {titleError}
            </span>
          )}
        </label>
        {kind === "research" && (
          <label className="flex flex-col gap-1 text-[12.5px]">
            <span style={{ color: "var(--text-secondary)" }}>Topic</span>
            <input
              data-testid="new-project-topic"
              value={topic}
              required
              onChange={(e) => {
                setTopic(e.target.value);
                setTopicDirty(true);
              }}
              className="px-2 py-1 rounded outline-none"
              style={FIELD_STYLE}
            />
            {topicDirty && topicError && (
              <span data-testid="new-project-topic-error" className="text-[12px]" style={ERROR_STYLE}>
                {topicError}
              </span>
            )}
          </label>
        )}
        {failure && (
          <div data-testid="new-project-error" className="text-[12.5px]" style={ERROR_STYLE}>
            {failure.kind === "error" && failure.message}
            {failure.kind === "exists" && (
              <>
                <code className="font-mono">{failure.name}</code> already exists —{" "}
                <Link
                  data-testid="new-project-exists-link"
                  to={`/project/${encodeURIComponent(failure.name)}`}
                  onClick={onClose}
                  className="underline"
                >
                  open it
                </Link>
              </>
            )}
            {failure.kind === "archived" && (
              <>
                <code className="font-mono">{failure.name}</code> is archived.{" "}
                <button
                  type="button"
                  data-testid="new-project-restore"
                  disabled={busy}
                  onClick={() => void restoreInstead(failure.name)}
                  className="underline disabled:opacity-50"
                >
                  Restore instead
                </button>
              </>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="new-project-cancel"
            onClick={requestClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-[12.5px] disabled:opacity-50"
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
            data-testid="new-project-create"
            onClick={() => void create()}
            disabled={!canCreate}
            aria-busy={busy}
            className="px-3 py-1.5 rounded-md text-[12.5px] font-semibold disabled:opacity-50"
            style={{ background: "var(--accent)", color: "white", border: "1px solid var(--accent)" }}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
