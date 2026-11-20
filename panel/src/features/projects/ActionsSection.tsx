import { useState } from "react";
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

/** The runner pill text: a shell action reads `sh`, an agent action its launcher name. */
function runnerPill(a: HomeAction): string {
  return a.runner === "shell" ? "sh" : a.runner;
}

function ActionCard({
  action,
  index,
  blocker,
  line,
  onEdit,
  dragProps,
}: {
  action: HomeAction;
  index: number;
  blocker: string | null;
  line: string | null;
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
      className="flex items-stretch rounded-[10px] border"
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
        ...dropStyle(dragProps.card["data-drop"], dragProps.card["data-dragging"] === "true"),
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
        type="button"
        title={`Run ${action.label}`}
        aria-label={`Run ${action.label}`}
        aria-disabled={blocker !== null}
        onClick={run}
        className="flex-1 min-w-0 grid items-center text-left px-3 py-2.5"
        style={{
          gridTemplateColumns: "16px 1fr auto",
          gap: "2px 8px",
          cursor: blocker !== null ? "not-allowed" : "pointer",
          opacity: blocker !== null ? 0.7 : 1,
        }}
      >
        <span
          className={isShell ? "font-mono text-[10px] text-center" : "text-[11px] text-center"}
          style={{ color: isShell ? "var(--text-muted)" : "var(--accent)" }}
        >
          {isShell ? "$_" : "▶"}
        </span>
        <span className="font-semibold text-[14px] truncate">{action.label}</span>
        <span
          className="font-mono text-[10px] px-1.5 rounded-full"
          style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}
        >
          {runnerPill(action)}
        </span>
        <span
          className="text-[12px]"
          style={{ gridColumn: "2 / -1", color: "var(--text-muted)" }}
        >
          {action.project}
        </span>
        {blocker !== null && (
          <span className="text-[12px]" style={{ gridColumn: "2 / -1", color: "var(--danger, #e5484d)" }}>
            {blocker}
          </span>
        )}
      </button>
      <button
        type="button"
        title={`Edit ${action.label}`}
        aria-label={`Edit ${action.label}`}
        onClick={() => onEdit(index)}
        className="text-[12px] px-2.5 border-l"
        style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)" }}
      >
        Edit
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
}: {
  onEdit?: (index: number) => void;
  onNew?: () => void;
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
    disabled: isMobile,
    onReorder: (next) => setActions(next.map((k) => actions[keys.indexOf(k)])),
  });
  // `undefined` = closed, `null` = new action, a number = editing that index.
  const [modal, setModal] = useState<number | null | undefined>(undefined);
  const [launchers] = usePreference(preferences.terminalLaunchers);
  const projects = useProjects();
  // An empty list means projects are still loading (or the fetch failed): the
  // project check would flag every card, so it is skipped and a launch is left
  // to succeed or raise its own error alert. Runner checks still apply.
  const names = new Set(
    projects.length === 0 ? actions.map((a) => a.project) : projects.map((p) => p.name),
  );

  return (
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
          {actions.length}
        </span>
        <span className="flex-1 border-t" style={{ borderColor: "var(--border-subtle)" }} />
      </div>
      {/* auto-fill with a 210px floor: one column at 390px, more as room grows. */}
      <div
        data-testid="actions-grid"
        className="grid gap-2.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}
      >
        {actions.map((action, i) => (
          <ActionCard
            key={keys[i]}
            dragProps={cardProps(keys[i])}
            action={action}
            index={i}
            blocker={actionBlocker(action, launchers, names)}
            line={actionRunLine(action, launchers)}
            onEdit={(i) => {
              setModal(i);
              onEdit(i);
            }}
          />
        ))}
        <button
          type="button"
          onClick={() => {
            setModal(null);
            onNew();
          }}
          className="rounded-[10px] border border-dashed text-[13px] px-3 py-2.5"
          style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)", minHeight: 58 }}
        >
          + New action
        </button>
      </div>
      {modal !== undefined && <ActionModal index={modal} onClose={() => setModal(undefined)} />}
    </section>
  );
}
