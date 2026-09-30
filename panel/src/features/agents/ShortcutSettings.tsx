import { useState } from "react";
import { Plus, X } from "lucide-react";

import { preferences, type ComposerShortcut } from "../../preferences/declarations";
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
 */

type Drafts = { label: string; text: string };

function draftsOf(entry: ComposerShortcut): Drafts {
  return { label: entry.label, text: entry.text };
}

function sameDrafts(a: Drafts, b: Drafts): boolean {
  return a.label === b.label && a.text === b.text;
}

/**
 * Builds a row's next entry from its drafts, or `null` when a half is blank.
 * Only fields whose draft differs from `base` — the entry the drafts were last
 * filled from — are applied, on top of the CURRENT `entry`, so a field another
 * tab changed mid-edit keeps that change.
 */
function toRowEntry(
  entry: ComposerShortcut,
  base: ComposerShortcut,
  drafts: Drafts,
): ComposerShortcut | null {
  const label = drafts.label.trim();
  const text = drafts.text.trim();
  const next: ComposerShortcut = {
    label: label !== base.label ? label : entry.label,
    text: text !== base.text ? text : entry.text,
  };
  if (!next.label || !next.text) return null;
  return next;
}

const inputStyle = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
} as const;

function ShortcutRow({
  entry,
  index,
  onCommit,
  onRemove,
}: {
  entry: ComposerShortcut;
  index: number;
  onCommit: (next: ComposerShortcut) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(entry.label);
  const [text, setText] = useState(entry.text);
  const [base, setBase] = useState(entry);
  const [focused, setFocused] = useState(false);

  const restoreDrafts = (from: ComposerShortcut) => {
    setBase(from);
    setLabel(from.label);
    setText(from.text);
  };

  /**
   * The stored entry can change under the row — another tab's write, or a
   * removal shifting later rows up — so the drafts follow it, UNLESS the user
   * is mid-edit here (focus in the row and a draft differs from its base).
   * Adjusted during render so stale drafts never paint.
   */
  if (entry.label !== base.label || entry.text !== base.text) {
    const drafts = { label, text };
    const editing = focused && !sameDrafts(drafts, draftsOf(base));
    if (sameDrafts(drafts, draftsOf(entry))) setBase(entry);
    else if (!editing) restoreDrafts(entry);
  }

  const commit = () => {
    const next = toRowEntry(entry, base, { label, text });
    if (!next) {
      restoreDrafts(entry);
      return;
    }
    if (next.label === entry.label && next.text === entry.text) return;
    onCommit(next);
  };

  return (
    <li
      className="flex flex-wrap items-start gap-2"
      data-testid={`shortcut-row-${index}`}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <input
        aria-label={`Shortcut ${index + 1} label`}
        data-testid={`shortcut-label-${index}`}
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
    const entry: ComposerShortcut = { label: newLabel.trim(), text: newText.trim() };
    if (!entry.label || !entry.text) return;
    setShortcuts((current) => [...current, entry]);
    setNewLabel("");
    setNewText("");
  };

  const commitAt = (index: number, next: ComposerShortcut) => {
    setShortcuts((current) => current.map((entry, i) => (i === index ? next : entry)));
  };

  const removeAt = (index: number) => {
    setShortcuts((current) => current.filter((_, i) => i !== index));
  };

  return (
    <div>
      <span className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>
        Composer shortcuts
      </span>
      <ul className="space-y-1">
        {shortcuts.map((entry, index) => (
          // Index keys: two entries may share a label, and the order is the
          // user's, so position is the only stable identity.
          <ShortcutRow
            key={index}
            entry={entry}
            index={index}
            onCommit={(next) => commitAt(index, next)}
            onRemove={() => removeAt(index)}
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <input
          aria-label="New shortcut label"
          data-testid="shortcut-new-label"
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
