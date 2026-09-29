import { useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight, Play } from "lucide-react";

import { preferences, type TerminalLauncher } from "../../preferences/declarations";
import { readOverridable } from "../../preferences/overridable";
import { usePreference, useScopedPreference } from "../../preferences/usePreference";
import { composeRunLine, resolveObjective, splitRunLoop } from "./runPrompt";
import type { TaskListStatus } from "./taskList";

/**
 * The banner above a change's `tasks.md` while it still has unchecked boxes:
 * how much is left, which CLI a run would start, and the objective it would
 * start with — shown RESOLVED, so what is read is what is sent.
 *
 * The objective is editable for one send and stored nowhere. The template it
 * was resolved from is a preference with its own editor; an edit here that
 * wrote back would turn a one-off tweak into every later run's default.
 *
 * The launcher's run loop is drawn around the objective, dimmed and never
 * editable: it belongs to the launcher entry, not to the template, and it
 * redraws when the CLI switch moves.
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
  // Subscribed for the re-render only; the value is read through
  // `readOverridable`, which owns the "project's, else the workspace's" rule.
  usePreference(preferences.taskPromptDefault);
  useScopedPreference(preferences.taskPromptOverride, project);
  const template = project
    ? readOverridable(preferences.taskPromptDefault, preferences.taskPromptOverride, project)
    : preferences.taskPromptDefault.default;

  const resolved = resolveObjective(template, { change: status.changeId, path, project });

  // The editable draft follows a CHANGED resolution — another file, another
  // template — and nothing else, so an edit survives re-renders and the fold.
  const [draft, setDraft] = useState(resolved);
  const [draftFor, setDraftFor] = useState(resolved);
  if (draftFor !== resolved) {
    setDraftFor(resolved);
    setDraft(resolved);
  }

  const options = runnable(launchers);
  const [remembered, setRemembered] = usePreference(preferences.plansRunLauncher);
  // This banner's own pick carries its position too, so of two launchers that
  // share a name the one clicked stays checked; the preference keeps the name.
  const [picked, setPicked] = useState<{ index: number; name: string } | null>(null);
  const pickedIndex = resolvePick(options, picked, remembered);
  const launcher = options[pickedIndex];
  const pick = (index: number) => {
    const name = options[index].name;
    setPicked({ index, name });
    setRemembered(name);
  };

  const [busy, setBusy] = useState(false);
  const canRun = Boolean(launcher) && draft.trim() !== "" && !busy;

  const run = () => {
    if (!canRun || !launcher) return;
    const result = onRun(composeRunLine(launcher.runLoop, draft));
    if (result && typeof (result as Promise<unknown>).finally === "function") {
      setBusy(true);
      void (result as Promise<unknown>).catch(() => undefined).finally(() => setBusy(false));
    }
  };

  const onObjectiveKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      run();
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
        <div className="run-banner-cli" role="radiogroup" aria-label="CLI">
          {options.map((entry, index) => (
            <button
              // Index keys: names may repeat, and position is the identity.
              key={index}
              type="button"
              role="radio"
              aria-checked={index === pickedIndex}
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

  const wrapper = launcher ? splitRunLoop(launcher.runLoop) : { before: "", after: "" };

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
        <textarea
          className="run-banner-objective"
          aria-label="Objective"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onObjectiveKey}
          rows={2}
          spellCheck={false}
        />
        <span
          className="run-banner-wrap"
          data-testid="run-banner-wrapper-after"
          aria-hidden="true"
        >
          {wrapper.after}
        </span>
      </div>
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
      <div className="run-banner-foot">
        editable for this send · ⌘↵ to run · opens a new terminal
      </div>
    </section>
  );
}
