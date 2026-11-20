import { useCallback, useEffect, useRef, useState } from "react";
import { usePreference } from "../../preferences/usePreference";
import { preferences, type HomeAction } from "../../preferences/declarations";
import { useProjects } from "./useProjects";

const FIELD_STYLE = {
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
};

/**
 * Add / edit / delete one Home action. `index` is the action being edited, or
 * `null` for a new one. Writes the whole `home.actions` list (starting from the
 * defaults when nothing is stored yet) and closes; Cancel, Esc and a backdrop
 * click close without writing.
 */
export function ActionModal({ index, onClose }: { index: number | null; onClose: () => void }) {
  const [actions, setActions] = usePreference(preferences.homeActions);
  const [launchers] = usePreference(preferences.terminalLaunchers);
  const projects = useProjects();
  const editing = index !== null ? (actions[index] ?? null) : null;
  const isNew = editing === null;

  const runners = [...launchers.map((l) => l.name), "shell"];
  const projectNames = projects.map((p) => p.name);

  const [label, setLabel] = useState(editing?.label ?? "");
  const [runner, setRunner] = useState(editing?.runner ?? runners[0]);
  const [text, setText] = useState(editing?.text ?? "");
  const [project, setProject] = useState(
    editing?.project ?? (projectNames.includes("workspace") ? "workspace" : (projectNames[0] ?? "")),
  );
  const dialogRef = useRef<HTMLDivElement>(null);

  // The stored project may be gone from the list; keep it selectable.
  const projectOptions =
    project !== "" && !projectNames.includes(project) ? [project, ...projectNames] : projectNames;
  const isShell = runner === "shell";
  const canSave = label.trim() !== "" && text.trim() !== "" && project !== "";

  const close = useCallback(() => onClose(), [onClose]);

  // Focus the label on open; hand focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
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
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  const save = () => {
    if (!canSave) return;
    const next: HomeAction = { label: label.trim(), runner, text: text.trim(), project };
    setActions(
      isNew || index === null
        ? [...actions, next]
        : actions.map((a, i) => (i === index ? next : a)),
    );
    onClose();
  };

  const remove = () => {
    if (index === null) return;
    setActions(actions.filter((_, i) => i !== index));
    onClose();
  };

  const btn = "rounded-md border px-2.5 py-0.5 text-[12px]";

  return (
    <div
      data-testid="action-modal-backdrop"
      onClick={close}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="action-modal-title"
        onClick={(e) => e.stopPropagation()}
        // Capped at the viewport minus a 16px gutter each side: fits at 390px.
        className="w-full max-w-[min(440px,calc(100vw-32px))] flex flex-col rounded-xl p-4 outline-none"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)",
        }}
      >
        <h2 id="action-modal-title" className="text-[15px] font-semibold mb-3">
          {isNew ? "New action" : "Edit action"}
        </h2>
        <div
          className="grid gap-x-2.5 gap-y-2 rounded-lg p-2.5 mb-2.5 grid-cols-1 sm:grid-cols-[auto_1fr]"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          <label htmlFor="action-label" className="text-[12px] self-center" style={{ color: "var(--text-muted)" }}>
            Label
          </label>
          <input
            id="action-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md px-2 py-1 text-[13px] min-w-0 w-full"
            style={FIELD_STYLE}
          />
          <span className="text-[12px] self-center" style={{ color: "var(--text-muted)" }}>
            Runs with
          </span>
          <div
            role="group"
            aria-label="Runs with"
            className="inline-flex flex-wrap rounded-md overflow-hidden self-start"
            style={{ border: "1px solid var(--border-subtle)" }}
          >
            {runners.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={runner === r}
                onClick={() => setRunner(r)}
                className="px-2.5 py-0.5 text-[12px]"
                style={{
                  background: runner === r ? "var(--bg-hover)" : "transparent",
                  color: runner === r ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <label htmlFor="action-text" className="text-[12px] self-center" style={{ color: "var(--text-muted)" }}>
            {isShell ? "Command" : "Prompt"}
          </label>
          <input
            id="action-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="rounded-md px-2 py-1 text-[12px] font-mono min-w-0 w-full"
            style={FIELD_STYLE}
          />
          <label htmlFor="action-project" className="text-[12px] self-center" style={{ color: "var(--text-muted)" }}>
            Project
          </label>
          <select
            id="action-project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="rounded-md px-2 py-1 text-[13px] min-w-0 w-full"
            style={FIELD_STYLE}
          >
            {projectOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <p data-testid="action-modal-hint" className="text-[12px] mb-3" style={{ color: "var(--text-muted)" }}>
          An agent action starts the CLI with this as its start prompt (no run loop — write{" "}
          <code>/goal …</code> yourself for one). With <b>shell</b> the field reads <b>Command</b> and
          is typed as is. Runs in a new terminal of the project.
        </p>
        <div className="flex gap-2">
          {!isNew && (
            <button
              type="button"
              onClick={remove}
              className={btn}
              style={{ color: "#ff8a8a", borderColor: "#5a2a2a" }}
            >
              Delete
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={close}
            className={btn}
            style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={save}
            className={btn}
            style={{
              background: "var(--bg-hover)",
              borderColor: "var(--border-subtle)",
              opacity: canSave ? 1 : 0.5,
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
