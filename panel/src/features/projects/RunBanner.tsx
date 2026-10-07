import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronDown, ChevronRight, Play } from "lucide-react";

import { preferences, type TerminalLauncher } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { resolveRunLoop, type RunLoopState } from "../agents/launcherRunLoop";
import {
  ObjectiveField,
  ObjectiveOverrideMarker,
  useObjectiveTemplate,
  type ObjectiveFieldHandle,
} from "./ObjectiveField";
import { resolveObjective, runLineParts, takesPrompt } from "./runPrompt";
import type { TaskListStatus } from "./taskList";

/**
 * The banner above a change's `tasks.md`. Once every box is checked it is the
 * DONE banner ({@link DoneBanner}): a check, the count and a full bar, and
 * nothing to run or collapse.
 *
 * While boxes are unchecked it is the run banner: how much is left, which CLI a run would start, and the objective it would
 * start with — shown RESOLVED, so what is read is what is sent.
 *
 * The objective is a saved field ({@link ObjectiveField}): an edit becomes
 * this project's objective when the box loses focus, and a Run while it still
 * has focus saves first and sends what was typed. The workspace default is
 * edited in Settings; the banner writes only the project's override.
 *
 * The launcher's line is drawn around the objective, dimmed and never
 * editable: `command [flag] '` and the rest of its RESOLVED run loop
 * (`resolveRunLoop`), so a list saved before the run loop existed, or one
 * holding PR #131's whole-line defaults, draws what it will send. It belongs
 * to the launcher entry, not to the template, and it redraws when the CLI
 * switch moves. A run loop with no `{prompt}` sends no objective, so the field
 * is disabled and says so rather than being dropped silently.
 *
 * The switch offers every launcher with a run loop — ready ones, and ones
 * whose run loop is a whole command line (it starts with the command's own
 * word). The latter is offered only so choosing it says what is wrong: the
 * warning takes the wrapper's place, and Run and ⌘↵ do nothing, since the
 * line would spawn the CLI inside its own argument.
 *
 * The switch remembers the last CLI picked, by name, for every change
 * (`plansRunLauncher`), so a run is not a question asked every time.
 *
 * Collapse is one remembered toggle for every change (`plansBannerExpanded`),
 * and the collapsed row keeps the count, the switch and Run, so a plan that is
 * only being read costs a single row and can still be started from it.
 *
 * This component does not spawn anything. `onRun` receives the chosen
 * launcher and the objective, composes the line and owns the session.
 */
export interface RunBannerProps {
  status: TaskListStatus;
  /** The project the Plans tab belongs to: the override's scope and `{project}`. */
  project: string;
  /**
   * The file's path as `{path}` — WORKSPACE-RELATIVE (e.g.
   * `projects/pavilio/plans/openspec/changes/<id>/tasks.md`), because the run
   * opens a new terminal at the workspace root and the agent reads it from
   * there; an absolute path would name the panel owner's tree, which a
   * project's own Linux account may not be able to read. `null` while it is
   * not known yet (the workspace root is still loading): the objective shows
   * the bare `{path}` placeholder and Run stays disabled, so the absolute path
   * never stands in for it.
   */
  path: string | null;
  /**
   * Called with the chosen launcher — always one whose run loop resolves
   * ready — and the objective to send. A returned promise disables Run until
   * it settles, so one click cannot start two sessions.
   */
  onRun: (run: { launcher: TerminalLauncher; objective: string }) => void | Promise<unknown>;
}

/** Why a whole-line launcher cannot run, in the banner and on its disabled Run. */
const BLOCKED_TEXT = "This launcher's run loop is a whole command line";

/** Past this many tasks one segment per task is thinner than the gap between them. */
const MAX_SEGMENTS = 48;

type Offered = { launcher: TerminalLauncher; state: Exclude<RunLoopState, { kind: "none" }> };

/**
 * The launchers the CLI switch offers, each with its resolved run loop: ready
 * ones and whole-line ones, never those not offered for runs.
 */
function offered(launchers: TerminalLauncher[]): Offered[] {
  return launchers.flatMap((launcher) => {
    const state = resolveRunLoop(launcher);
    return state.kind === "none" ? [] : [{ launcher, state }];
  });
}

/**
 * Which runnable launcher is checked. By NAME, so a reordered or shortened
 * list keeps the pick on the same CLI: this banner's own pick first (its
 * position when that still holds the same name), else the remembered name,
 * else — nothing picked, or the pick gone or no longer runnable — the first.
 */
function resolvePick(
  options: { name: string }[],
  picked: { index: number; name: string } | null,
  remembered: string | null,
): number {
  if (picked && options[picked.index]?.name === picked.name) return picked.index;
  const name = picked?.name ?? remembered;
  const at = name === null ? -1 : options.findIndex((entry) => entry.name === name);
  return at < 0 ? 0 : at;
}

export function RunBanner(props: RunBannerProps) {
  // Decided before any hook: the done banner reads no preference, so the
  // remembered collapse and CLI never touch it.
  if (props.status.remaining === 0) return <DoneBanner total={props.status.total} />;
  return <ActiveRunBanner {...props} />;
}

/** How many of the tasks are done: one segment per task, or one fill past {@link MAX_SEGMENTS}. */
function TaskProgress({ total, done }: { total: number; done: number }) {
  return (
    <div
      className="run-banner-progress"
      role="progressbar"
      aria-label="Tasks done"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      {total <= MAX_SEGMENTS ? (
        Array.from({ length: total }, (_, index) => (
          <i key={index} data-segment={index < done ? "done" : "open"} />
        ))
      ) : (
        <i className="run-banner-progress-fill" style={{ width: `${(done / total) * 100}%` }} />
      )}
    </div>
  );
}

/**
 * A finished change: the check and the count, and the bar full. It offers no
 * CLI, objective, Run or chevron — there is nothing left to run — and, having
 * no collapse, it is the same whether the run banner was last left open or not.
 */
function DoneBanner({ total }: { total: number }) {
  return (
    <section className="run-banner" data-done="" role="status" aria-label="Change done">
      <div className="run-banner-top">
        <CheckCircle2
          size={14}
          className="run-banner-done-icon"
          data-testid="run-banner-done-icon"
          aria-hidden="true"
        />
        <span className="run-banner-title">
          All {total} {total === 1 ? "task" : "tasks"} done
        </span>
      </div>
      <TaskProgress total={total} done={total} />
    </section>
  );
}

function ActiveRunBanner({ status, project, path, onRun }: RunBannerProps) {
  const [launchers] = usePreference(preferences.terminalLaunchers);
  const [expanded, setExpanded] = usePreference(preferences.plansBannerExpanded);
  const template = useObjectiveTemplate(project);
  const vars = { change: status.changeId, path: path ?? "{path}", project };
  const resolved = resolveObjective(template, vars);
  // Mounted only while expanded; collapsed, the stored objective is sent.
  const field = useRef<ObjectiveFieldHandle>(null);

  const entries = offered(launchers);
  const options = entries.map((entry) => entry.launcher);
  const [remembered, setRemembered] = usePreference(preferences.plansRunLauncher);
  // This banner's own pick carries its position too, so of two launchers that
  // share a name the one clicked stays checked; the preference keeps the name.
  const [picked, setPicked] = useState<{ index: number; name: string } | null>(null);
  const pickedIndex = resolvePick(options, picked, remembered);
  const launcher = options[pickedIndex];
  const state = entries[pickedIndex]?.state;
  const ready = state?.kind === "ready" ? state : null;
  const blocked = state?.kind === "wholeLine";
  const pick = (index: number) => {
    // The pressed one again changes nothing, so it writes nothing: with no CLI
    // remembered yet it would otherwise store the default nobody chose.
    if (index === pickedIndex) return;
    const name = options[index].name;
    setPicked({ index, name });
    setRemembered(name);
  };

  const [busy, setBusy] = useState(false);
  const noPromptNote = useId();
  const blockedNote = useId();
  // A run loop with nowhere to put the objective sends it nowhere, so the
  // field neither gates Run nor pretends to be part of the line.
  const usesObjective = ready ? takesPrompt(ready.runLoop) : true;
  // A blank edit is not blank to send: saving it clears the override, and the
  // workspace default is what runs. So only the stored objective gates Run.
  const canRun =
    Boolean(ready) && path !== null && (!usesObjective || resolved.trim() !== "") && !busy;

  const run = () => {
    if (!canRun || !launcher) return;
    // Save a focused edit first, and send what it resolves to — not this
    // render's `resolved`, which predates the save.
    const objective = field.current?.commit() ?? resolved;
    if (usesObjective && objective.trim() === "") return;
    const result = onRun({ launcher, objective });
    if (result && typeof (result as Promise<unknown>).finally === "function") {
      setBusy(true);
      void (result as Promise<unknown>).catch(() => undefined).finally(() => setBusy(false));
    }
  };

  const done = status.total - status.remaining;
  const title = expanded
    ? `${status.remaining} of ${status.total} tasks left`
    : `${status.remaining} of ${status.total} left`;

  const chevron = (
    <button
      type="button"
      className="run-banner-chevron"
      data-testid="run-banner-chevron"
      aria-label={expanded ? "Collapse run banner" : "Expand run banner"}
      aria-expanded={expanded}
      onClick={() => setExpanded((open) => !open)}
    >
      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
  );

  const controls = (
    <>
      {options.length > 0 ? (
        // Toggle buttons, as the panel's other one-of-n switches are
        // (MockupFrame's widths, the colour presets): each is a Tab stop and
        // Enter/Space picks it, and the pick reaches assistive tech through
        // `aria-pressed` rather than colour alone.
        <div className="run-banner-cli" role="group" aria-label="CLI">
          {options.map((entry, index) => (
            <button
              // Index keys: names may repeat.
              key={index}
              type="button"
              data-testid={`run-banner-cli-${index}`}
              aria-pressed={index === pickedIndex}
              data-on={index === pickedIndex || undefined}
              onClick={() => pick(index)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : (
        <span className="run-banner-none">No launcher has a run loop — add one in Settings</span>
      )}
      <button
        type="button"
        className="run-banner-run"
        data-testid="run-banner-run"
        disabled={!canRun}
        title={blocked ? BLOCKED_TEXT : undefined}
        aria-describedby={blocked && expanded ? blockedNote : undefined}
        onClick={run}
      >
        <Play size={11} aria-hidden="true" />
        Run
      </button>
    </>
  );

  if (!expanded) {
    return (
      <section className="run-banner" data-collapsed="" aria-label="Run this change">
        {chevron}
        <span className="run-banner-title">{title}</span>
        <span className="run-banner-grow" />
        {controls}
      </section>
    );
  }

  const wrapper = ready
    ? runLineParts(launcher.command, ready.promptFlag, ready.runLoop)
    : { before: "", after: "" };

  return (
    <section className="run-banner" aria-label="Run this change">
      <div className="run-banner-top">
        {chevron}
        <span className="run-banner-title">{title}</span>
        <span className="run-banner-grow" />
        {controls}
      </div>
      <div className="run-banner-prompt" data-testid="run-banner-prompt">
        {/* A whole-line run loop draws no line: it would not be the one sent,
            since none is. What is wrong, and where to fix it, stands instead. */}
        {blocked && (
          <div className="run-banner-blocked" data-testid="run-banner-blocked" id={blockedNote}>
            {BLOCKED_TEXT} — fix it in{" "}
            <Link to="/settings" className="run-banner-blocked-link">
              Settings
            </Link>
          </div>
        )}
        {/* The launcher's, not the template's: drawn, never editable, and
            hidden from assistive tech, which reads the field by its name. */}
        {!blocked && (
          <span
            className="run-banner-wrap"
            data-testid="run-banner-wrapper-before"
            aria-hidden="true"
          >
            {wrapper.before}
          </span>
        )}
        <ObjectiveField
          ref={field}
          vars={vars}
          onSubmit={run}
          disabled={!usesObjective}
          describedBy={usesObjective ? undefined : noPromptNote}
        />
        {!blocked && (
          <span
            className="run-banner-wrap"
            data-testid="run-banner-wrapper-after"
            aria-hidden="true"
          >
            {wrapper.after}
          </span>
        )}
      </div>
      {!usesObjective && (
        <div className="run-banner-note" id={noPromptNote}>
          This launcher's run loop takes no prompt
        </div>
      )}
      <TaskProgress total={status.total} done={done} />
      <div className="run-banner-foot" data-testid="run-banner-foot">
        {/* A disabled objective is neither editable nor reached by ⌘↵; a
            blocked launcher's objective is still saved, but runs nowhere. */}
        <span>
          {blocked
            ? "saved for this project"
            : usesObjective
              ? "saved for this project · ⌘↵ to run · opens a new terminal"
              : "opens a new terminal"}
        </span>
        <ObjectiveOverrideMarker project={project} />
      </div>
    </section>
  );
}
