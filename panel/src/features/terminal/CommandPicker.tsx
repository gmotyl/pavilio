import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { filterSkills, useSkills, type SkillEntry } from "./commandSource";

/** The keys the picker takes ahead of the composer while it is open. */
export type PickerKey = "ArrowUp" | "ArrowDown" | "Enter";

export interface CommandPickerHandle {
  /**
   * Offer the picker one of its keys. Returns true when the picker consumed
   * it, in which case the composer must not act on it as well.
   *
   * Enter is consumed when an entry is highlighted (it picks) and while the
   * list is still loading (a no-op: an Enter that fell through then would send
   * `/pav` the moment a slow list had not arrived). Once the list is in — or
   * failed to come — and NOTHING is highlighted, Enter is declined and the
   * composer sends the draft as typed: that is how `/clear`, `/compact`, `/resume`
   * and the other CLI built-ins still reach the CLI (see {@link highlightFor}).
   */
  handleKey: (key: PickerKey) => boolean;
}

export interface CommandPickerProps {
  /** The listbox's id — the field's `aria-controls`; options derive theirs from it. */
  id: string;
  /** What is typed after the leading `/`, as-is; `filterSkills` trims it. */
  query: string;
  /** An entry was chosen, by Enter or by pointer. */
  onPick: (name: string) => void;
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
 * Which entry the picker highlights by itself for `query`, or -1 for none.
 *
 * With `t` the trimmed, lowercased query and `n` a lowercased name split on
 * `-` into segments, an entry is highlighted when
 *
 * - `n` starts with `t` — so a name typed in full always highlights, or
 * - some segment starts with `t` and is longer than it — a STRICT prefix of a
 *   segment (`/gri` for `pavilio-grill`).
 *
 * The first listed entry that qualifies wins. A query that equals a whole
 * segment but not the start of the name (`/compact` against
 * `pavilio-compact`, `/question` against `pavilio-question`) is NOT
 * highlighted: that is what a CLI built-in looks like, so Enter sends it and
 * `/compact`, `/resume`, `/clear` still reach the CLI. The price: a bare
 * segment such as `/question` sends too — type more of the name, or arrow onto
 * the entry, to pick it. An entry listed only because its description (or a
 * mid-segment substring) matches is shown but never highlighted.
 *
 * A bare `/` (empty query) highlights the first entry: the whole list is a
 * match, and `/` then Enter keeps picking the top skill. A literal `/` is
 * still sent with Escape, then Enter.
 */
export function highlightFor(matches: readonly SkillEntry[], query: string): number {
  const t = query.trim().toLowerCase();
  if (!t) return matches.length > 0 ? 0 : -1;
  return matches.findIndex((s) => {
    const n = s.name.toLowerCase();
    return n.startsWith(t) || n.split("-").some((seg) => seg !== t && seg.startsWith(t));
  });
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
 * first, so a short list never dead-ends a keypress. With nothing highlighted,
 * Down lands on the first entry and Up on the last — any entry, a
 * description-only match included, and Enter then picks it. The highlight
 * returns to {@link highlightFor}'s choice whenever the query changes, because
 * the list it indexed into is a different list now.
 */
export function CommandPicker({
  id,
  query,
  onPick,
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
  const index =
    matches.length === 0
      ? -1
      : active === null
        ? highlightFor(matches, query)
        : Math.min(active, matches.length - 1);
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
        if (key === "Enter") {
          if (index >= 0) {
            onPick(matches[index].name);
            return true;
          }
          return loading;
        }
        if (matches.length === 0) return true;
        const step = key === "ArrowDown" ? 1 : -1;
        // From no highlight, Down is the first entry and Up the last.
        const from = index >= 0 ? index : step === 1 ? -1 : 0;
        setActive((from + step + matches.length) % matches.length);
        return true;
      },
    }),
    [index, loading, matches, onPick],
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
            : "↑↓ move · Enter send · Esc close"}
      </div>
    </div>
  );
}

export default CommandPicker;
