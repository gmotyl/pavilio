import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Copy } from "lucide-react";

import { preferences } from "../../preferences/declarations";
import { clearOverride, readOverridable, writeOverride } from "../../preferences/overridable";
import { readPreference } from "../../preferences/store";
import { usePreference, useScopedPreference } from "../../preferences/usePreference";
import { resolveObjective, templateOffset } from "./runPrompt";

/**
 * The run banner's objective box: a saved, per-project field over the
 * two-level `taskPrompt` preference (`../../preferences/overridable`).
 *
 * Idle, it shows the RESOLVED objective — what a run would send. Focused, it
 * shows the TEMPLATE, with `{change}`, `{path}` and `{project}` tinted. A
 * textarea cannot hold marked-up children, so the tint is a mirror layer drawn
 * behind a transparent-text textarea with the same font, padding and wrapping;
 * only the caret and the selection are the textarea's own. The mirror is
 * `aria-hidden`: assistive tech reads the one field, by its name — and, while
 * focused on the template, is told what it resolves to by a visually-hidden
 * preview the field is described by.
 *
 * Leaving the box saves it, and only when the text changed. Text equal to the
 * workspace default, or blank, CLEARS the project's override rather than
 * storing it, so the project keeps following later edits to the default.
 *
 * A Run while the box still has focus must not race the blur: the banner calls
 * {@link ObjectiveFieldHandle.commit}, which saves and hands back the objective
 * to send in the same turn.
 *
 * An edit belongs to the project it was STARTED in. The Plans tab is not keyed
 * by project, so the tab can move to another project while the box keeps
 * focus (back/forward, a programmatic navigate): the pending edit is then saved
 * to the project it was made in, and the box starts over on the new project's
 * template — a draft never crosses projects. Unmounting mid-edit saves too.
 */

/** The substitutions an objective template is resolved with. */
export interface ObjectiveVars {
  change: string;
  path: string;
  project: string;
}

export interface ObjectiveFieldHandle {
  /** Saves a pending edit, if any, and returns the resolved objective to send. */
  commit(): string;
}

export interface ObjectiveFieldProps {
  vars: ObjectiveVars;
  /** A run loop with no `{prompt}` sends no objective: the box is inert. */
  disabled?: boolean;
  /** An id describing why the box is disabled. */
  describedBy?: string;
  /** ⌘/Ctrl+Enter inside the box; the banner runs, which commits first. */
  onSubmit?: () => void;
}

const PLACEHOLDER = /(\{(?:change|path|project)\})/;

/** How long the "copied" acknowledgement stays up. */
const COPIED_MS = 1200;

/** The project's objective template, else the workspace's — read now, not from a render. */
function readTemplate(project: string): string {
  return project
    ? readOverridable(preferences.taskPromptDefault, preferences.taskPromptOverride, project)
    : readPreference(preferences.taskPromptDefault);
}

/**
 * The objective template in effect for `project`, re-rendering on a change to
 * either level. `readOverridable` owns the "project's, else the workspace's"
 * rule; the two hooks are here for the subscription.
 */
export function useObjectiveTemplate(project: string): string {
  usePreference(preferences.taskPromptDefault);
  useScopedPreference(preferences.taskPromptOverride, project);
  return readTemplate(project);
}

/**
 * Stores `text` as the project's objective — or clears the override when it
 * is the workspace default or blank. No project, no scope to store under: the
 * text is still what the caller sends.
 */
function save(project: string, text: string): void {
  if (!project) return;
  const clears = text.trim() === "" || text === readPreference(preferences.taskPromptDefault);
  if (!clears) {
    writeOverride(preferences.taskPromptOverride, text, project);
  } else if (readPreference(preferences.taskPromptOverride, project) !== null) {
    clearOverride(preferences.taskPromptOverride, project);
  }
}

/** The template with every placeholder wrapped in a `<mark>`, for the mirror layer. */
function marked(template: string): ReactNode[] {
  return template
    .split(PLACEHOLDER)
    .map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part));
}

export const ObjectiveField = forwardRef<ObjectiveFieldHandle, ObjectiveFieldProps>(
  function ObjectiveField({ vars, disabled = false, describedBy, onSubmit }, ref) {
    const template = useObjectiveTemplate(vars.project);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(template);
    // What the draft is compared with to decide whether anything changed: the
    // template when focus arrived, or the text a Run last committed.
    const baseline = useRef(template);
    // The project the edit in progress belongs to, taken when focus arrived.
    // Saves go here, never to whatever project the latest render names.
    const editProject = useRef(vars.project);

    // The pending edit, saved; returns what it resolves to. Read through refs
    // and fresh preference reads, so a Run in the same event as a blur sends
    // the edit rather than a render's stale value.
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const editingRef = useRef(editing);
    editingRef.current = editing;

    const commitDraft = (): string => {
      if (editingRef.current && draftRef.current !== baseline.current) {
        const project = editProject.current;
        save(project, draftRef.current);
        // A cleared override reads back as the workspace default; the box
        // keeps showing what is now stored.
        const stored = readTemplate(project);
        baseline.current = stored;
        if (draftRef.current.trim() === "") {
          draftRef.current = stored;
          setDraft(stored);
        }
        return resolveObjective(stored, vars);
      }
      return resolveObjective(
        editingRef.current ? draftRef.current : readTemplate(vars.project),
        vars,
      );
    };

    useImperativeHandle(ref, () => ({ commit: commitDraft }));

    // The project moved under a focused box: the pending edit goes to the
    // project it was made in, and editing restarts on the new one's template.
    // A layout effect, so the old draft is never painted under the new project.
    useLayoutEffect(() => {
      if (!editingRef.current || editProject.current === vars.project) return;
      commitDraft();
      const next = readTemplate(vars.project);
      editProject.current = vars.project;
      baseline.current = next;
      draftRef.current = next;
      setDraft(next);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the project alone
    }, [vars.project]);

    // Unmounted mid-edit (the banner collapses, the change is closed): no blur
    // arrives, so the pending edit is saved here.
    const commitRef = useRef(commitDraft);
    commitRef.current = commitDraft;
    useEffect(
      () => () => {
        if (pendingStart.current) clearTimeout(pendingStart.current);
        commitRef.current();
      },
      [],
    );

    const textarea = useRef<HTMLTextAreaElement>(null);
    const overlay = useRef<HTMLDivElement>(null);
    // Where the caret goes once the template replaces the resolved text.
    const caret = useRef<[number, number] | null>(null);

    const latestVars = useRef(vars);
    latestVars.current = vars;
    // A press on the idle box: its focus is followed by the browser placing
    // the caret, hit-tested on the resolved text.
    const pressed = useRef(false);
    const pendingStart = useRef<ReturnType<typeof setTimeout> | null>(null);

    const beginEditing = () => {
      pendingStart.current = null;
      const box = textarea.current;
      if (!box || document.activeElement !== box) return;
      const current = latestVars.current;
      const start = readTemplate(current.project);
      editProject.current = current.project;
      baseline.current = start;
      // The selection sits on the resolved text; the same numbers name other
      // characters in the template, so map them across.
      caret.current = [
        templateOffset(start, current, box.selectionStart),
        templateOffset(start, current, box.selectionEnd),
      ];
      setDraft(start);
      setEditing(true);
    };

    const onFocus = () => {
      if (!pressed.current) {
        beginEditing();
        return;
      }
      // Chrome fires focus BEFORE it moves the caret to the click, and then
      // applies an offset measured on the resolved text to whatever the box
      // holds — clamped to the shorter template. So a press swaps only once
      // the browser has placed the caret.
      pressed.current = false;
      pendingStart.current = setTimeout(beginEditing, 0);
    };

    useLayoutEffect(() => {
      if (!editing || !caret.current) return;
      textarea.current?.setSelectionRange(...caret.current);
      caret.current = null;
    }, [editing]);

    const onBlur = () => {
      commitDraft();
      setEditing(false);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSubmit?.();
      }
    };

    const [copied, setCopied] = useState(false);
    useEffect(() => {
      if (!copied) return;
      const timer = setTimeout(() => setCopied(false), COPIED_MS);
      return () => clearTimeout(timer);
    }, [copied]);

    const copy = () => {
      // The resolved text in both states: while focused, of the draft.
      const text = resolveObjective(editing ? draft : template, vars);
      try {
        void navigator.clipboard
          .writeText(text)
          .then(() => setCopied(true))
          .catch(() => undefined);
      } catch {
        // No clipboard API (an insecure context): nothing to acknowledge.
      }
    };

    const shown = editing ? draft : resolveObjective(template, vars);
    const previewId = useId();
    const description =
      [describedBy, editing ? previewId : null].filter(Boolean).join(" ") || undefined;

    return (
      <div className="objective-field" data-editing={editing || undefined}>
        {editing && (
          <div
            ref={overlay}
            className="objective-field-overlay"
            data-testid="objective-overlay"
            aria-hidden="true"
          >
            {marked(draft)}
            {/* A trailing newline needs a line of its own to keep the heights equal. */}
            {draft.endsWith("\n") ? "​" : null}
          </div>
        )}
        <textarea
          ref={textarea}
          className="run-banner-objective"
          aria-label="Objective"
          value={shown}
          onMouseDown={() => {
            if (!editingRef.current) pressed.current = true;
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => setDraft(event.target.value)}
          // The box grows with its content, but should it ever scroll (no
          // field-sizing, a capped height), the mirror scrolls with it.
          onScroll={(event) => {
            if (overlay.current) overlay.current.scrollTop = event.currentTarget.scrollTop;
          }}
          onKeyDown={onKeyDown}
          rows={2}
          spellCheck={false}
          disabled={disabled}
          aria-describedby={description}
        />
        {editing && (
          // What the template being edited sends, for a screen reader: the
          // mirror is hidden from it and the value is the raw template.
          <span id={previewId} className="objective-field-preview">
            {resolveObjective(draft, vars)}
          </span>
        )}
        <button
          type="button"
          className="objective-field-copy"
          data-testid="objective-copy"
          aria-label="Copy objective"
          title="Copy objective"
          disabled={disabled}
          // Keeps focus in the field, so copying mid-edit neither saves nor
          // swaps the template for the resolved text.
          onMouseDown={(event) => event.preventDefault()}
          onClick={copy}
        >
          <Copy size={13} aria-hidden="true" />
        </button>
        <span className="objective-field-copied" role="status" data-on={copied || undefined}>
          {copied ? "copied" : ""}
        </span>
      </div>
    );
  },
);

/**
 * "project objective · reset to workspace default", while `project` has its
 * own objective. Reset CLEARS the override, so the project follows the
 * workspace default again.
 */
export function ObjectiveOverrideMarker({ project }: { project: string }) {
  const [own] = useScopedPreference(preferences.taskPromptOverride, project);
  if (!project || own === null) return null;
  return (
    <span className="objective-override" data-testid="objective-override-marker">
      project objective ·{" "}
      <button
        type="button"
        className="objective-override-reset"
        data-testid="objective-reset"
        onClick={() => clearOverride(preferences.taskPromptOverride, project)}
      >
        reset to workspace default
      </button>
    </span>
  );
}
