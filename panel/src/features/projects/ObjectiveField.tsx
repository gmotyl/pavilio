import {
  forwardRef,
  useEffect,
  useImperativeHandle,
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
import { resolveObjective } from "./runPrompt";

/**
 * The run banner's objective box: a saved, per-project field over the
 * two-level `taskPrompt` preference (`../../preferences/overridable`).
 *
 * Idle, it shows the RESOLVED objective — what a run would send. Focused, it
 * shows the TEMPLATE, with `{change}`, `{path}` and `{project}` tinted. A
 * textarea cannot hold marked-up children, so the tint is a mirror layer drawn
 * behind a transparent-text textarea with the same font, padding and wrapping;
 * only the caret and the selection are the textarea's own. The mirror is
 * `aria-hidden`: assistive tech reads the one field, by its name.
 *
 * Leaving the box saves it, and only when the text changed. Text equal to the
 * workspace default, or blank, CLEARS the project's override rather than
 * storing it, so the project keeps following later edits to the default.
 *
 * A Run while the box still has focus must not race the blur: the banner calls
 * {@link ObjectiveFieldHandle.commit}, which saves and hands back the objective
 * to send in the same turn.
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

    // The pending edit, saved; returns what it resolves to. Read through refs
    // and fresh preference reads, so a Run in the same event as a blur sends
    // the edit rather than a render's stale value.
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const editingRef = useRef(editing);
    editingRef.current = editing;

    const commitDraft = (): string => {
      if (editingRef.current && draftRef.current !== baseline.current) {
        save(vars.project, draftRef.current);
        // A cleared override reads back as the workspace default; the box
        // keeps showing what is now stored.
        const stored = readTemplate(vars.project);
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

    const onFocus = () => {
      baseline.current = template;
      setDraft(template);
      setEditing(true);
    };

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

    return (
      <div className="objective-field" data-editing={editing || undefined}>
        {editing && (
          <div
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
          className="run-banner-objective"
          aria-label="Objective"
          value={shown}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          spellCheck={false}
          disabled={disabled}
          aria-describedby={describedBy}
        />
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
