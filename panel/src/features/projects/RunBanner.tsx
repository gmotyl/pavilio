import { useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Play } from "lucide-react";

import { preferences, type TerminalLauncher } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { resolveRunLoop } from "../agents/launcherRunLoop";
import {
  ObjectiveField,
  ObjectiveOverrideMarker,
  useObjectiveTemplate,
  type ObjectiveFieldHandle,
} from "./ObjectiveField";
import { composeRunLine, resolveObjective, runLineParts, takesPrompt } from "./runPrompt";
import type { TaskListStatus } from "./taskList";

/**
 * The banner above a change's `tasks.md` while it still has unchecked boxes:
 * how much is left, which CLI a run would start, and the objective it would
 * start with — shown RESOLVED, so what is read is what is sent.
 *
 * The objective is a saved field ({@link ObjectiveField}): an edit becomes
 * this project's objective when the box loses focus, and a Run while it still
 * has focus saves first and sends what was typed. The workspace default is
 * edited in Settings; the banner writes only the project's override.
 *
 * The launcher's run loop is drawn around the objective, dimmed and never
 * editable: it belongs to the launcher entry, not to the template, and it
 * redraws when the CLI switch moves. A run loop with no `{prompt}` sends no
 * objective, so the field is disabled and says so rather than being dropped
 * silently.
 *
 * The switch remembers the last CLI picked, by name, for every change
 * (`plansRunLauncher`), so a run is not a question asked every time.
 *
 * Collapse is one remembered toggle for every change (`plansBannerExpanded`),
 * and the collapsed row keeps the count, the switch and Run, so a plan that is
 * only being read costs a single row and can still be started from it.
 *
 * This component composes the line; it does not spawn anything. `onRun`
 * receives the whole run line and owns the session.
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
   * project's own Linux account may not be able to read.
   */
  path: string;
  /**
   * Called with the composed run line. A returned promise disables Run until
   * it settles, so one click cannot start two sessions.
   */
  onRun: (runLine: string) => void | Promise<unknown>;
}

/** Past this many tasks one segment per task is thinner than the gap between them. */
const MAX_SEGMENTS = 48;

/** The launchers a run can use: those whose run loop is not blank. */
function runnable(launchers: TerminalLauncher[]): (TerminalLauncher & { runLoop: string })[] {
  return launchers.filter(
    (entry): entry is TerminalLauncher & { runLoop: string } => Boolean(entry.runLoop?.trim()),
  );
}

/**
 * The command, flag and run loop a launcher's line is built from: its resolved
 * run loop when it has one ready, else its raw fields. A stopgap until the
 * banner offers only resolved launchers.
 */
function lineFields(launcher: TerminalLauncher & { runLoop: string }) {
  const state = resolveRunLoop(launcher);
  return state.kind === "ready"
    ? { command: launcher.command, promptFlag: state.promptFlag, runLoop: state.runLoop }
    : {
        command: launcher.command,
        promptFlag: launcher.promptFlag ?? "",
        runLoop: launcher.runLoop,
      };
}

/**
 * Which runnable launcher is checked. By NAME, so a reordered or shortened
 * list keeps the pick on the same CLI: this banner's own pick first (its
 * position when that still holds the same name), else the remembered name,
 * else — nothing picked, or the pick gone or no longer runnable — the first.
 */
function resolvePick(
  options: TerminalLauncher[],
  picked: { index: number; name: string } | null,
  remembered: string | null,
): number {
  if (picked && options[picked.index]?.name === picked.name) return picked.index;
  const name = picked?.name ?? remembered;
  const at = name === null ? -1 : options.findIndex((entry) => entry.name === name);
  return at < 0 ? 0 : at;
}

export function RunBanner({ status, project, path, onRun }: RunBannerProps) {
  const [launchers] = usePreference(preferences.terminalLaunchers);
  const [expanded, setExpanded] = usePreference(preferences.plansBannerExpanded);
  const template = useObjectiveTemplate(project);
  const vars = { change: status.changeId, path, project };
  const resolved = resolveObjective(template, vars);
  // Mounted only while expanded; collapsed, the stored objective is sent.
  const field = useRef<ObjectiveFieldHandle>(null);

  const options = runnable(launchers);
  const [remembered, setRemembered] = usePreference(preferences.plansRunLauncher);
  // This banner's own pick carries its position too, so of two launchers that
  // share a name the one clicked stays checked; the preference keeps the name.
  const [picked, setPicked] = useState<{ index: number; name: string } | null>(null);
  const pickedIndex = resolvePick(options, picked, remembered);
  const launcher = options[pickedIndex];
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
  // A run loop with nowhere to put the objective sends it nowhere, so the
  // field neither gates Run nor pretends to be part of the line.
  const fields = launcher ? lineFields(launcher) : null;
  const usesObjective = fields ? takesPrompt(fields.runLoop) : true;
  // A blank edit is not blank to send: saving it clears the override, and the
  // workspace default is what runs. So only the stored objective gates Run.
  const canRun = Boolean(launcher) && (!usesObjective || resolved.trim() !== "") && !busy;

  const run = () => {
    if (!canRun || !fields) return;
    // Save a focused edit first, and send what it resolves to — not this
    // render's `resolved`, which predates the save.
    const objective = field.current?.commit() ?? resolved;
    if (usesObjective && objective.trim() === "") return;
    const result = onRun(
      composeRunLine(fields.command, fields.promptFlag, fields.runLoop, objective),
    );
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

  const wrapper = fields
    ? runLineParts(fields.command, fields.promptFlag, fields.runLoop)
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
        {/* The launcher's, not the template's: drawn, never editable, and
            hidden from assistive tech, which reads the field by its name. */}
        <span
          className="run-banner-wrap"
          data-testid="run-banner-wrapper-before"
          aria-hidden="true"
        >
          {wrapper.before}
        </span>
        <ObjectiveField
          ref={field}
          vars={vars}
          onSubmit={run}
          disabled={!usesObjective}
          describedBy={usesObjective ? undefined : noPromptNote}
        />
        <span
          className="run-banner-wrap"
          data-testid="run-banner-wrapper-after"
          aria-hidden="true"
        >
          {wrapper.after}
        </span>
      </div>
      {!usesObjective && (
        <div className="run-banner-note" id={noPromptNote}>
          This launcher's run loop takes no prompt
        </div>
      )}
      <div
        className="run-banner-progress"
        role="progressbar"
        aria-label="Tasks done"
        aria-valuemin={0}
        aria-valuemax={status.total}
        aria-valuenow={done}
      >
        {status.total <= MAX_SEGMENTS ? (
          Array.from({ length: status.total }, (_, index) => (
            <i key={index} data-segment={index < done ? "done" : "open"} />
          ))
        ) : (
          <i
            className="run-banner-progress-fill"
            style={{ width: `${(done / status.total) * 100}%` }}
          />
        )}
      </div>
      <div className="run-banner-foot" data-testid="run-banner-foot">
        {/* A disabled objective is neither editable nor reached by ⌘↵. */}
        <span>
          {usesObjective
            ? "saved for this project · ⌘↵ to run · opens a new terminal"
            : "opens a new terminal"}
        </span>
        <ObjectiveOverrideMarker project={project} />
      </div>
    </section>
  );
}
