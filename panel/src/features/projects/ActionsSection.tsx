import { useState } from "react";
import { Pencil } from "lucide-react";
import { ActionModal } from "./ActionModal";
import { usePreference } from "../../preferences/usePreference";
import { preferences, type HomeAction } from "../../preferences/declarations";
import { alerts } from "../alerts/store";
import { actionBlocker, actionRunLine } from "./homeActions";
import { useLaunchRun } from "./useLaunchRun";
import { useProjects } from "./useProjects";
import { useCardDrag } from "./useCardDrag";
import { dropStyle } from "../shell/useSidebarDrag";
import { useIsMobile } from "../shell/useIsMobile";

function ActionCard({
  action,
  index,
  blocker,
  line,
  showProject,
  onEdit,
  dragProps,
}: {
  action: HomeAction;
  index: number;
  blocker: string | null;
  line: string | null;
  /** Print the project: another visible card shares this label and runner. */
  showProject: boolean;
  onEdit: (index: number) => void;
  dragProps: ReturnType<ReturnType<typeof useCardDrag>["cardProps"]>;
}) {
  // One hook per card: the launch hook is bound to a single project.
  const launch = useLaunchRun(action.project);
  const isShell = action.runner === "shell";

  const run = () => {
    if (blocker !== null || line === null) return;
    launch(line).catch((err: unknown) => {
      alerts.error(`Couldn't run ${action.label}`, {
        detail: err instanceof Error ? err.message : String(err),
      });
    });
  };

  return (
    <div
      data-testid={`action-card-${index}`}
      {...dragProps.card}
      className="group relative flex items-stretch rounded-[10px] border"
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
        ...dropStyle(
          dragProps.card["data-drop"],
          dragProps.card["data-dragging"] === "true",
        ),
      }}
    >
      {dragProps.card["data-card-key"] !== undefined && (
        <span
          data-testid="action-grip"
          aria-hidden="true"
          {...dragProps.grip}
          className="flex items-center px-1.5 text-[12px] select-none touch-none"
          style={{ color: "var(--text-muted)", cursor: "grab" }}
        >
          ⋮⋮
        </span>
      )}
      <button
        data-testid={`action-run-${index}`}
        type="button"
        title={`Run ${action.label} (${action.project})`}
        aria-label={`Run ${action.label}`}
        aria-disabled={blocker !== null}
        onClick={run}
        className={`flex-1 min-w-0 grid items-center text-left pl-3 pr-3 py-2 rounded-[10px] transition-colors ${
          blocker !== null ? "" : "hover:bg-[var(--bg-hover)]"
        } focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]`}
        style={{
          gridTemplateColumns: "16px 1fr",
          gap: "2px 8px",
          cursor: blocker !== null ? "not-allowed" : "pointer",
          opacity: blocker !== null ? 0.7 : 1,
        }}
      >
        <span
          className={
            isShell
              ? "font-mono text-[10px] text-center"
              : "text-[11px] text-center"
          }
          style={{ color: isShell ? "var(--text-muted)" : "var(--accent)" }}
        >
          {isShell ? "$_" : "▶"}
        </span>
        <span className="font-semibold text-[14px] wrap-anywhere">
          {action.label}
        </span>
        {showProject && (
          <span
            className="text-[12px]"
            style={{ gridColumn: "2 / -1", color: "var(--text-muted)" }}
          >
            {action.project}
          </span>
        )}
        {blocker !== null && (
          <span
            className="text-[12px]"
            style={{ gridColumn: "2 / -1", color: "var(--danger, #e5484d)" }}
          >
            {blocker}
          </span>
        )}
      </button>
      <button
        data-testid={`action-edit-${index}`}
        type="button"
        title={`Edit ${action.label}`}
        aria-label={`Edit ${action.label}`}
        onClick={() => onEdit(index)}
        className="absolute top-1 right-1 grid place-items-center w-[22px] h-[22px] rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-surface)] cursor-pointer transition-[opacity,background-color,color] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <Pencil size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The Home page's Actions block: one card per configured action plus a dashed
 * "+ New action" card. Never filtered by the group chips. Edit and
 * "+ New action" open the action modal; `onEdit` / `onNew` are optional
 * observers called as it opens.
 */
export function ActionsSection({
  onEdit = () => {},
  onNew = () => {},
  project,
}: {
  onEdit?: (index: number) => void;
  onNew?: () => void;
  /** Show only this project's actions (no drag, New defaults to it); hidden when it has none. */
  project?: string;
}) {
  const [actions, setActions] = usePreference(preferences.homeActions);
  const isMobile = useIsMobile();
  // Content-based keys (a repeat gets an occurrence suffix) stay with their
  // card across a reorder, unlike an index.
  const seen = new Map<string, number>();
  const keys = actions.map((a) => {
    const base = `${a.label}|${a.project}|${a.runner}|${a.text}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}#${n}`;
  });
  const { cardProps } = useCardDrag({
    keys,
    disabled: isMobile || project !== undefined,
    onReorder: (next) => setActions(next.map((k) => actions[keys.indexOf(k)])),
  });
  // `undefined` = closed, `null` = new action, a number = editing that index.
  const [modal, setModal] = useState<number | null | undefined>(undefined);
  // The modal belongs to one project: a project change drops it (store-previous-
  // value-during-render, so no frame shows the draft against the new project).
  const [modalProject, setModalProject] = useState(project);
  if (modalProject !== project) {
    setModalProject(project);
    setModal(undefined);
  }
  const [launchers] = usePreference(preferences.terminalLaunchers);
  const projects = useProjects();
  // An empty list means projects are still loading (or the fetch failed): the
  // project check would flag every card, so it is skipped and a launch is left
  // to succeed or raise its own error alert. Runner checks still apply.
  const names = new Set(
    projects.length === 0
      ? actions.map((a) => a.project)
      : projects.map((p) => p.name),
  );

  // Cards keep their index in the FULL list: edit/delete resolve against it.
  const visible = actions
    .map((action, i) => ({ action, i }))
    .filter(
      ({ action }) => project === undefined || action.project === project,
    );
  // An open modal outlives its cards: another tab may remove the last action
  // while a draft is being typed.
  const modalEl = modal !== undefined && (
    <ActionModal
      index={modal}
      defaultProject={project}
      onClose={() => setModal(undefined)}
    />
  );
  const hideCards = project !== undefined && visible.length === 0;
  // Cards that would look identical (same label and runner) in different
  // projects name their project; everywhere else it is redundant.
  // The label is compared as rendered: HTML collapses runs of ASCII
  // whitespace only (a full-width space stays visible), and a single
  // non-breaking space looks like an ordinary one (runs of it do not collapse).
  const lookOf = (a: HomeAction) =>
    `${a.label
      .replace(/[ \t\r\n\f]+/g, " ")
      .replace(/^ | $/g, "")
      .replace(/\u00a0/g, " ")}|${a.runner}`;
  const projectsByLook = new Map<string, Set<string>>();
  for (const { action } of visible) {
    const look = lookOf(action);
    const set = projectsByLook.get(look) ?? new Set<string>();
    set.add(action.project);
    projectsByLook.set(look, set);
  }
  const ambiguous = (a: HomeAction) =>
    (projectsByLook.get(lookOf(a))?.size ?? 0) > 1;

  // The modal is a sibling of the section (not inside it) so hiding the cards
  // never remounts it.
  return (
    <>
      {!hideCards && (
        <section data-testid="actions-section" className="mb-6">
          <div
            data-testid="actions-section-head"
            className="flex items-center gap-2 mb-2 text-[13px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-tertiary)" }}
          >
            Actions
            <span
              className="rounded-full px-2 text-[11px] font-normal"
              style={{ background: "var(--bg-hover)" }}
            >
              {visible.length}
            </span>
            <span
              className="flex-1 border-t"
              style={{ borderColor: "var(--border-subtle)" }}
            />
          </div>
          {/* auto-fill with a 210px floor: one column at 390px, more as room grows. */}
          <div
            data-testid="actions-grid"
            className="grid gap-2.5"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
            }}
          >
            {visible.map(({ action, i }) => (
              <ActionCard
                key={keys[i]}
                dragProps={cardProps(keys[i])}
                action={action}
                index={i}
                blocker={actionBlocker(action, launchers, names)}
                line={actionRunLine(action, launchers)}
                showProject={ambiguous(action)}
                onEdit={(i) => {
                  setModal(i);
                  onEdit(i);
                }}
              />
            ))}
            <button
              data-testid="actions-new"
              type="button"
              onClick={() => {
                setModal(null);
                onNew();
              }}
              className="rounded-[10px] border border-dashed border-[var(--border-subtle)] text-sm px-3 py-2.5 cursor-pointer transition-colors text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              style={{ minHeight: 58 }}
            >
              + New action
            </button>
          </div>
        </section>
      )}
      {modalEl}
    </>
  );
}
