import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { filterSkills, useSkills, type SkillEntry } from "./commandSource";

/** The keys the picker takes ahead of the composer while it is open. */
export type PickerKey = "ArrowUp" | "ArrowDown" | "Enter" | "Tab";

export interface CommandPickerHandle {
  /**
   * Offer the picker one of its keys. Returns true when the picker consumed
   * it, in which case the composer must not act on it as well.
   *
   * Enter is always consumed — an open picker never lets it send. With an
   * entry highlighted it picks; while the list is still loading it is a no-op
   * (an Enter that fell through then would send `/pav` the moment a slow list
   * had not arrived); with nothing to pick it closes the picker, so the NEXT
   * Enter sends the draft as typed. That, or Escape then Enter, is how `/clear`,
   * `/compact` and the other CLI built-ins still reach the CLI.
   *
   * Tab picks like Enter, but only when there is something to pick; otherwise
   * it is declined and stays the browser's.
   */
  handleKey: (key: PickerKey) => boolean;
}

export interface CommandPickerProps {
  /** The listbox's id — the field's `aria-controls`; options derive theirs from it. */
  id: string;
  /** What is typed after the leading `/`, as-is; `filterSkills` trims it. */
  query: string;
  /** An entry was chosen, by Enter, Tab or pointer. */
  onPick: (name: string) => void;
  /** Enter found nothing to pick: the picker asks to be closed. */
  onClose: () => void;
  /**
   * The highlighted option's element id, or null when nothing is highlighted —
   * the field's `aria-activedescendant`. Focus never leaves the field, so this
   * is how a screen reader is told which entry Enter would insert.
   */
  onActiveChange: (optionId: string | null) => void;
  /**
   * The list this open fetched, once it has arrived (not on a failed fetch).
   * The composer keeps the names so it can tell, at send time, a picked skill
   * from any other leading slash — the list itself is gone by then.
   */
  onSkillsLoaded?: (skills: readonly SkillEntry[]) => void;
  ref?: Ref<CommandPickerHandle>;
}

/**
 * The filtering list of workspace skills over the composer (Strand A, D1).
 *
 * ## Why it fetches on mount
 *
 * `useSkills` lives HERE, not in the composer, and the composer mounts this
 * component only while the picker is open. So every open is a fresh
 * `GET /api/skills`, and the server re-walks `skills/` per request — a skill
 * added to the workspace appears on the next open with no restart (D17, and
 * the "newly added skill appears" scenario). Lifting the hook into the
 * long-lived composer would fetch once per pane and go stale.
 *
 * ## Why it owns no keyboard listener
 *
 * Focus stays in the textarea for the whole interaction — the user is typing
 * the filter into the draft itself — so the composer's `onKeyDown` is where
 * every key arrives. It offers the picker's keys through {@link
 * CommandPickerHandle.handleKey} first, and only what the picker declines goes
 * on to the composer's own Enter/Escape handling. The picker is the one that
 * knows the list, so it is the one that decides what Enter means.
 *
 * ## Why the highlight wraps
 *
 * Up from the first entry goes to the last and Down from the last to the
 * first, so a short list never dead-ends a keypress. The highlight returns to
 * the first entry — the best ranked match, see `filterSkills` — whenever the
 * query changes, because the list it indexed into is a different list now.
 *
 * ## Why the best match is always highlighted
 *
 * An earlier rule left a whole-segment query (`/note` against `pavilio-note`)
 * unhighlighted so that Enter would send it as a CLI built-in. In practice that
 * sent the form when the user meant to pick. Now the ranking decides and Enter
 * in an open picker never sends; a literal command goes out with Escape, Enter.
 */
export function CommandPicker({
  id,
  query,
  onPick,
  onClose,
  onActiveChange,
  onSkillsLoaded,
  ref,
}: CommandPickerProps) {
  const { skills, loading, error } = useSkills();

  useEffect(() => {
    if (!loading && !error) onSkillsLoaded?.(skills);
  }, [skills, loading, error, onSkillsLoaded]);
  const matches = useMemo(() => filterSkills(skills, query), [skills, query]);
  // null: no arrow key yet for this query, so the highlight is the automatic one.
  const [active, setActive] = useState<number | null>(null);
  // Reset during render rather than in an effect, so no frame ever shows the
  // old index against the new list.
  const [seenQuery, setSeenQuery] = useState(query);
  if (seenQuery !== query) {
    setSeenQuery(query);
    setActive(null);
  }
  const index = matches.length === 0 ? -1 : Math.min(active ?? 0, matches.length - 1);
  const optionId = (i: number): string => `${id}-option-${i}`;
  const activeId = index >= 0 ? optionId(index) : null;

  useEffect(() => {
    onActiveChange(activeId);
    // Keep a highlight moved by the keyboard inside the scrolled list.
    // `scrollIntoView` is absent in jsdom, hence the optional call.
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, onActiveChange]);

  useImperativeHandle(
    ref,
    () => ({
      handleKey: (key) => {
        if (key === "Enter" || key === "Tab") {
          if (index >= 0) {
            onPick(matches[index].name);
            return true;
          }
          if (key === "Tab") return false;
          if (!loading) onClose();
          return true;
        }
        if (matches.length === 0) return true;
        const step = key === "ArrowDown" ? 1 : -1;
        setActive((index + step + matches.length) % matches.length);
        return true;
      },
    }),
    [index, loading, matches, onPick, onClose],
  );

  let status: string | null = null;
  if (loading && skills.length === 0) status = "Loading skills…";
  else if (error) status = "Could not load the workspace's skills.";
  else if (matches.length === 0) status = "No skill matches.";

  return (
    <div className="command-picker" data-testid="command-picker">
      <div className="command-picker-group" aria-hidden>
        workspace skills
        {!loading && !error ? ` · ${matches.length} of ${skills.length}` : null}
      </div>
      <ul id={id} className="command-picker-list" role="listbox" aria-label="Workspace skills">
        {matches.map((skill, i) => (
          <li
            key={skill.name}
            id={optionId(i)}
            className="command-picker-option"
            role="option"
            aria-selected={i === index}
            data-name={skill.name}
            // `mousedown`, not `click`, is what would move focus out of the
            // field. Preventing it keeps the focus — and the caret the pick
            // places — in the field, so the argument can be typed straight on.
            // (The picker does not close on blur; an outside press closes it.)
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(skill.name)}
          >
            <span className="command-picker-name">{skill.name}</span>
            {skill.description ? (
              <span className="command-picker-desc">{skill.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {status ? (
        <div className="command-picker-status" role="status">
          {status}
        </div>
      ) : null}
      <div className="command-picker-foot" aria-hidden>
        {index >= 0
          ? "↑↓ move · Enter insert · Esc close"
          : loading
            ? "↑↓ move · Esc close"
            : "↑↓ move · Enter close · Esc close"}
      </div>
    </div>
  );
}

export default CommandPicker;
