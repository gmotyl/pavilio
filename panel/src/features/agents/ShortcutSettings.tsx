import { useState } from "react";
import { Plus, X } from "lucide-react";

import {
  COMPOSER_SHORTCUT_LABEL_MAX,
  preferences,
  type ComposerShortcut,
} from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";

/**
 * The composer shortcuts' editor: one row per stored quick reply, plus a form
 * that appends a new one. Modelled on `LauncherSettings` — same rows, same
 * blur-commit, same validation — because it is the same kind of thing: one
 * global, ordered list with no cell or surface to belong to.
 *
 * EVERY WRITE BUILDS A NEW ARRAY AND A NEW ENTRY. `readPreference` hands the
 * declared `DEFAULT_COMPOSER_SHORTCUTS` back BY REFERENCE when nothing is
 * stored, so an editor that pushed onto — or spliced out of — the value it
 * read would rewrite the defaults for the rest of the session.
 *
 * An entry needs both halves: the label is the chip and the text is what the
 * terminal receives, so a blank either side is not an entry. A rejected edit
 * puts the stored value back into the field. Every control is named by its
 * row's 1-based position, since two shortcuts may share a label.
 *
 * A label is capped at `COMPOSER_SHORTCUT_LABEL_MAX`: the field will not take
 * more, and a value that got past it is cut on save, after trimming.
 */

/** A label as it is saved: trimmed, then cut to the cap. */
function toLabel(draft: string): string {
  return draft.trim().slice(0, COMPOSER_SHORTCUT_LABEL_MAX);
}

type Drafts = { label: string; text: string };

/**
 * Builds a row's next entry from its drafts, or `null` when a half is blank.
 * The drafts were filled from `entry` — every change of the stored list
 * refills them — so a label draft that still matches is untouched and keeps
 * the stored label as it is: an untouched hand-edited label longer than the
 * cap is not cut by a mere focus and blur. Edited is judged on the trimmed
 * draft, before the cap.
 */
function toRowEntry(entry: ComposerShortcut, drafts: Drafts): ComposerShortcut | null {
  const label = drafts.label.trim();
  const next: ComposerShortcut = {
    label: label !== entry.label ? toLabel(label) : entry.label,
    text: drafts.text.trim(),
  };
  if (!next.label || !next.text) return null;
  return next;
}

function sameShortcut(a: ComposerShortcut, b: ComposerShortcut): boolean {
  return a.label === b.label && a.text === b.text;
}

const inputStyle = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
} as const;

function ShortcutRow({
  entry,
  index,
  listKey,
  onCommit,
  onRemove,
}: {
  entry: ComposerShortcut;
  index: number;
  /** The whole stored list, serialized: it changes whenever the list does. */
  listKey: string;
  onCommit: (next: ComposerShortcut) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(entry.label);
  const [text, setText] = useState(entry.text);
  // The list the drafts were last filled from.
  const [syncedKey, setSyncedKey] = useState(listKey);

  const restoreDrafts = (from: ComposerShortcut) => {
    setLabel(from.label);
    setText(from.text);
  };

  /**
   * ANY change of the stored list — this tab's own commit or another tab's
   * write — puts every row's drafts back to the stored entry, a row being
   * edited included: its edit is dropped rather than risk landing on a
   * different shortcut, since rows are keyed by position. Compared by value:
   * the codec hands back a fresh array on every read. Adjusted during render,
   * so stale drafts never paint.
   */
  if (listKey !== syncedKey) {
    setSyncedKey(listKey);
    restoreDrafts(entry);
  }

  const commit = () => {
    const next = toRowEntry(entry, { label, text });
    if (!next) {
      restoreDrafts(entry);
      return;
    }
    if (sameShortcut(next, entry)) return;
    onCommit(next);
  };

  return (
    <li
      className="flex flex-wrap items-start gap-2"
      data-testid={`shortcut-row-${index}`}
    >
      <input
        aria-label={`Shortcut ${index + 1} label`}
        data-testid={`shortcut-label-${index}`}
        maxLength={COMPOSER_SHORTCUT_LABEL_MAX}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        className="text-sm px-2 py-1 rounded w-32 shrink-0"
        style={inputStyle}
        spellCheck={false}
      />
      <input
        aria-label={`Shortcut ${index + 1} text`}
        data-testid={`shortcut-text-${index}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        className="text-sm px-2 py-1 rounded grow basis-32 min-w-0 font-mono"
        style={inputStyle}
        spellCheck={false}
      />
      <button
        type="button"
        aria-label={`Remove shortcut ${index + 1}: ${entry.label}`}
        data-testid={`shortcut-remove-${index}`}
        onClick={onRemove}
        className="rounded p-1 transition-colors"
        style={{ color: "var(--text-muted)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <X size={13} />
      </button>
    </li>
  );
}

export function ShortcutSettings() {
  const [shortcuts, setShortcuts] = usePreference(preferences.composerShortcuts);
  const [newLabel, setNewLabel] = useState("");
  const [newText, setNewText] = useState("");

  const add = () => {
    const entry: ComposerShortcut = { label: toLabel(newLabel), text: newText.trim() };
    if (!entry.label || !entry.text) return;
    setShortcuts((current) => [...current, entry]);
    setNewLabel("");
    setNewText("");
  };

  const listKey = JSON.stringify(shortcuts);

  /**
   * Writes over the entry the row showed, and only while it is still at
   * `index`: a write that landed after the row last rendered drops the edit
   * rather than putting it onto whatever now sits there.
   */
  const commitAt = (index: number, shown: ComposerShortcut, next: ComposerShortcut) => {
    setShortcuts((current) =>
      current[index] !== undefined && sameShortcut(current[index], shown)
        ? current.map((entry, i) => (i === index ? next : entry))
        : current,
    );
  };

  const removeAt = (index: number, shown: ComposerShortcut) => {
    setShortcuts((current) =>
      current[index] !== undefined && sameShortcut(current[index], shown)
        ? current.filter((_, i) => i !== index)
        : current,
    );
  };

  return (
    <div>
      <span className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>
        Composer shortcuts
      </span>
      <ul className="space-y-1">
        {shortcuts.map((entry, index) => (
          <ShortcutRow
            key={index}
            entry={entry}
            index={index}
            listKey={listKey}
            onCommit={(next) => commitAt(index, entry, next)}
            onRemove={() => removeAt(index, entry)}
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <input
          aria-label="New shortcut label"
          data-testid="shortcut-new-label"
          maxLength={COMPOSER_SHORTCUT_LABEL_MAX}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="label"
          className="text-sm px-2 py-1 rounded w-32 shrink-0"
          style={inputStyle}
          spellCheck={false}
        />
        <input
          aria-label="New shortcut text"
          data-testid="shortcut-new-text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="text"
          className="text-sm px-2 py-1 rounded grow basis-32 min-w-0 font-mono"
          style={inputStyle}
          spellCheck={false}
        />
        <button
          type="button"
          data-testid="shortcut-add"
          onClick={add}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
          style={{ color: "var(--accent)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <Plus size={11} />
          Add shortcut
        </button>
      </div>
      <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }} data-testid="shortcut-help">
        Quick replies in the answer composer. The label is the chip; the text is
        sent to the terminal verbatim, followed by Enter. The draft is left
        alone. Every project shares this list.
      </p>
    </div>
  );
}
