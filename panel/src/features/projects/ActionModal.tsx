import { useCallback, useEffect, useRef, useState } from "react";
import { usePreference } from "../../preferences/usePreference";
import { preferences, type HomeAction } from "../../preferences/declarations";
import { useProjects } from "./useProjects";

const FIELD_STYLE = {
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
};

const sameAction = (a: HomeAction, b: HomeAction) =>
  a.label === b.label && a.runner === b.runner && a.text === b.text && a.project === b.project;

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
  // The edited action is captured once at open: `home.actions` can change
  // underneath (second tab, drag reorder), so Save/Delete resolve its current
  // position by identity instead of trusting the opening index.
  const original = useRef<HomeAction | null>(index !== null ? (actions[index] ?? null) : null).current;
  const editing = original;
  // How many entries were identical to it at open (itself included). More than
  // one means a field match cannot tell them apart, and any change in that
  // count means the list moved underneath us.
  const twinCount = useRef(original === null ? 0 : actions.filter((a) => sameAction(a, original)).length).current;
  const hadTwin = twinCount > 1;
  const isNew = original === null;

  const runners = [...launchers.map((l) => l.name), "shell"];
  const projectNames = projects.map((p) => p.name);

  const [label, setLabel] = useState(editing?.label ?? "");
  const [text, setText] = useState(editing?.text ?? "");
  // `null` = untouched: the default is derived, so a project list that loads
  // after the modal opened still fills the field.
  const [pickedRunner, setPickedRunner] = useState<string | null>(null);
  const [pickedProject, setPickedProject] = useState<string | null>(null);
  const runner = pickedRunner ?? editing?.runner ?? runners[0];
  const project =
    pickedProject ??
    editing?.project ??
    (projectNames.includes("workspace") ? "workspace" : (projectNames[0] ?? ""));
  const dialogRef = useRef<HTMLDivElement>(null);

  // A stored runner / project may be gone from its list; keep it shown.
  const runnerOptions = runners.includes(runner) ? runners : [runner, ...runners];
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

  /** Where the edited action sits now; -1 when it is gone. */
  const currentIndex = () => {
    if (original === null) return -1;
    const same = (a: HomeAction) => sameAction(a, original);
    // With twins, a changed count of identical entries makes every slot suspect.
    if (hadTwin && actions.filter(same).length !== twinCount) return -1;
    // Prefer the opening position while it still holds the original, so one of
    // several identical actions keeps its own slot.
    const opened = index !== null ? actions[index] : undefined;
    if (opened && same(opened)) return index as number;
    // Moved: resolve by fields only when that is unambiguous, else fail closed.
    if (hadTwin) return -1;
    const hits = actions.flatMap((a, i) => (same(a) ? [i] : []));
    return hits.length === 1 ? hits[0] : -1;
  };

  // aria-modal: keep Tab / Shift+Tab cycling inside the dialog.
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const items = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>("input, select, button:not([disabled])") ?? [],
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const save = () => {
    if (!canSave) return;
    const next: HomeAction = { label: label.trim(), runner, text: text.trim(), project };
    if (isNew) setActions([...actions, next]);
    else {
      const at = currentIndex();
      if (at >= 0) setActions(actions.map((a, i) => (i === at ? next : a)));
    }
    onClose();
  };

  const remove = () => {
    const at = currentIndex();
    if (at >= 0) setActions(actions.filter((_, i) => i !== at));
    onClose();
  };

  const btn =
    "rounded-md border px-3 py-1 text-sm cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]";

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
        onKeyDown={trapTab}
        // Capped at the viewport minus a 16px gutter each side: fits at 390px.
        className="w-full max-w-[min(440px,calc(100vw-32px))] flex flex-col rounded-xl p-4 outline-none"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)",
        }}
      >
        <h2 id="action-modal-title" className="text-[17px] font-semibold mb-3">
          {isNew ? "New action" : "Edit action"}
        </h2>
        <div
          className="grid gap-x-2.5 gap-y-2 rounded-lg p-2.5 mb-2.5 grid-cols-1 sm:grid-cols-[auto_1fr]"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          <label htmlFor="action-label" className="text-sm self-center text-[var(--text-secondary)]">
            Label
          </label>
          <input
            id="action-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md px-2 py-1 text-[15px] min-w-0 w-full"
            style={FIELD_STYLE}
          />
          <span className="text-sm self-center text-[var(--text-secondary)]">
            Runs with
          </span>
          <div
            role="group"
            aria-label="Runs with"
            className="inline-flex flex-wrap rounded-md overflow-hidden self-start"
            style={{ border: "1px solid var(--border-subtle)" }}
          >
            {runnerOptions.map((r) => (
              <button
                key={r}
                data-testid={`action-modal-runner-${r}`}
                type="button"
                aria-pressed={runner === r}
                onClick={() => setPickedRunner(r)}
                className={`px-3 py-1 text-sm cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:-outline-offset-2 ${
                  runner === r
                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)] hover:bg-[var(--bg-active)]"
                    : "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <label htmlFor="action-text" className="text-sm self-center text-[var(--text-secondary)]">
            {isShell ? "Command" : "Prompt"}
          </label>
          <input
            id="action-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="rounded-md px-2 py-1 text-sm font-mono min-w-0 w-full"
            style={FIELD_STYLE}
          />
          <label htmlFor="action-project" className="text-sm self-center text-[var(--text-secondary)]">
            Project
          </label>
          <select
            id="action-project"
            value={project}
            onChange={(e) => setPickedProject(e.target.value)}
            className="rounded-md px-2 py-1 text-[15px] min-w-0 w-full"
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
              data-testid="action-modal-delete"
              type="button"
              onClick={remove}
              className={`${btn} hover:bg-[#3a1c1c] hover:border-[#8a3a3a]`}
              style={{ color: "#ff8a8a", borderColor: "#5a2a2a" }}
            >
              Delete
            </button>
          )}
          <span className="flex-1" />
          <button
            data-testid="action-modal-cancel"
            type="button"
            onClick={close}
            className={`${btn} text-[var(--text-primary)] border-[var(--border-default)] hover:bg-[var(--bg-hover)]`}
          >
            Cancel
          </button>
          <button
            data-testid="action-modal-save"
            type="button"
            disabled={!canSave}
            onClick={save}
            className={`${btn} bg-[var(--bg-hover)] border-[var(--border-default)] text-[var(--text-primary)] ${
              canSave ? "hover:bg-[var(--bg-active)]" : ""
            }`}
            style={{
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
