import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { preferences, type TerminalLauncher } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";

/**
 * The launcher row's editor: one row per stored entry, plus a form that appends
 * a new one. It lives beside `VoiceSelect` and `AutoOpenAnswerToggle` because
 * the launcher list is the same kind of thing they are — one global choice with
 * no cell or surface to belong to.
 *
 * EVERY WRITE BUILDS A NEW ARRAY AND A NEW ENTRY. `readPreference` hands the
 * declared `DEFAULT_TERMINAL_LAUNCHERS` back BY REFERENCE when nothing is
 * stored, so an editor that pushed onto — or spliced out of — the value it read
 * would rewrite the defaults for the rest of the session.
 *
 * An entry needs both halves: the name is the pill's label and the command is
 * what the PTY receives, so a blank either side is not an entry. A rejected
 * edit puts the stored value back into the field rather than leaving the user
 * looking at text the panel did not keep.
 */

const inputStyle = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
} as const;

function LauncherRow({
  entry,
  index,
  onCommit,
  onRemove,
}: {
  entry: TerminalLauncher;
  index: number;
  onCommit: (next: TerminalLauncher) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(entry.name);
  const [command, setCommand] = useState(entry.command);

  /**
   * The stored entry can change under a row that is not being edited — another
   * tab's write, or a removal shifting every later row up one index — so the
   * drafts follow it. A rejected edit restores them directly instead: the entry
   * did not change there, so nothing would re-run this.
   */
  useEffect(() => {
    setName(entry.name);
    setCommand(entry.command);
  }, [entry.name, entry.command]);

  const commit = () => {
    const next = { name: name.trim(), command: command.trim() };
    if (!next.name || !next.command) {
      setName(entry.name);
      setCommand(entry.command);
      return;
    }
    if (next.name === entry.name && next.command === entry.command) return;
    onCommit(next);
  };

  return (
    <li className="flex items-center gap-2">
      <input
        aria-label="Launcher name"
        data-testid={`launcher-name-${index}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        className="text-sm px-2 py-1 rounded w-32"
        style={inputStyle}
        spellCheck={false}
      />
      <input
        aria-label="Launcher command"
        data-testid={`launcher-command-${index}`}
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        onBlur={commit}
        className="text-sm px-2 py-1 rounded flex-1 font-mono"
        style={inputStyle}
        spellCheck={false}
      />
      <button
        type="button"
        aria-label={`Remove ${entry.name}`}
        data-testid={`launcher-remove-${index}`}
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

export function LauncherSettings() {
  const [launchers, setLaunchers] = usePreference(preferences.terminalLaunchers);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");

  const add = () => {
    const entry = { name: newName.trim(), command: newCommand.trim() };
    if (!entry.name || !entry.command) return;
    setLaunchers((current) => [...current, entry]);
    setNewName("");
    setNewCommand("");
  };

  const commitAt = (index: number, next: TerminalLauncher) => {
    setLaunchers((current) => current.map((entry, i) => (i === index ? next : entry)));
  };

  const removeAt = (index: number) => {
    setLaunchers((current) => current.filter((_, i) => i !== index));
  };

  return (
    <div>
      <span className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>
        Terminal launchers
      </span>
      <ul className="space-y-1">
        {launchers.map((entry, index) => (
          // Index keys: two entries may carry the same name, and the list's
          // order is the user's, so position is the only stable identity.
          <LauncherRow
            key={index}
            entry={entry}
            index={index}
            onCommit={(next) => commitAt(index, next)}
            onRemove={() => removeAt(index)}
          />
        ))}
      </ul>
      <div className="flex items-center gap-2 mt-2">
        <input
          aria-label="New launcher name"
          data-testid="launcher-new-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="name"
          className="text-sm px-2 py-1 rounded w-32"
          style={inputStyle}
          spellCheck={false}
        />
        <input
          aria-label="New launcher command"
          data-testid="launcher-new-command"
          value={newCommand}
          onChange={(e) => setNewCommand(e.target.value)}
          placeholder="command"
          className="text-sm px-2 py-1 rounded flex-1 font-mono"
          style={inputStyle}
          spellCheck={false}
        />
        <button
          type="button"
          data-testid="launcher-add"
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
          Add launcher
        </button>
      </div>
      <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
        The pills on a cell that has not spoken yet. The name is the label; the
        command is sent to the terminal verbatim, with a trailing return.
      </p>
    </div>
  );
}
