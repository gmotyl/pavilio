import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import {
  DEFAULT_TERMINAL_LAUNCHERS,
  preferences,
  type TerminalLauncher,
} from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { fixWholeLine, resolveRunLoop } from "./launcherRunLoop";

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
 * EVERY CONTROL IS NAMED BY ITS ROW. A screen reader reads only the accessible
 * name, so three rows of "Launcher name" / "Launcher command" told a user which
 * field they were in and nothing about which launcher — and `Remove ${name}`
 * identified nothing at all when two entries shared a name, which the index
 * keys below say is legal. The row's 1-based position goes in every one of
 * them, remove button included; the position is what the user sees, so it is
 * what they are told.
 *
 * An entry needs both halves: the name is the pill's label and the command is
 * what the PTY receives, so a blank either side is not an entry. A rejected
 * edit puts the stored value back into the field rather than leaving the user
 * looking at text the panel did not keep.
 *
 * The prompt flag and the run loop are NOT required halves, and an ABSENT key
 * means something: "use this name's shipped default" (see `launcherRunLoop.ts`).
 * So a row only ever writes a key the user edited. A run loop the user clears
 * is stored as `""` — not offered for runs — and **restore default** removes
 * the key again; a flag the user clears is stored as `""` — positional. A
 * default shown in a field is its placeholder, never its value, so typing
 * replaces it and leaving it alone writes nothing — which is also why
 * clearing a defaulted field does nothing. Turning a default off is its own
 * control: **don't offer for runs** stores `runLoop: ""`, **positional**
 * stores `promptFlag: ""`, and **use default** removes the flag key.
 */

/**
 * Builds a fresh entry from the add form's drafts, or `null` when a required
 * half is blank. A blank flag or run loop is left off rather than stored as
 * `""`: a new entry the user gave none gets its name's defaults, if any.
 */
function toEntry(
  name: string,
  command: string,
  promptFlag: string,
  runLoop: string,
): TerminalLauncher | null {
  const entry: TerminalLauncher = { name: name.trim(), command: command.trim() };
  if (!entry.name || !entry.command) return null;
  const flag = promptFlag.trim();
  if (flag) entry.promptFlag = flag;
  const loop = runLoop.trim();
  if (loop) entry.runLoop = loop;
  return entry;
}

/** The shipped entry for a name, or undefined for a name the panel does not ship. */
function shippedFor(name: string): TerminalLauncher | undefined {
  return DEFAULT_TERMINAL_LAUNCHERS.find((entry) => entry.name === name);
}

/**
 * What the run-loop field holds for a stored entry. A run loop that resolves
 * to the shipped default — key absent, or one of the legacy whole lines — is
 * shown as the placeholder, so its value is empty.
 */
function runLoopDraftOf(entry: TerminalLauncher): string {
  const state = resolveRunLoop(entry);
  if (state.kind === "ready" && state.source === "default") return "";
  return entry.runLoop ?? "";
}

function promptFlagDraftOf(entry: TerminalLauncher): string {
  return entry.promptFlag ?? "";
}

/**
 * Builds a row's next entry from its drafts, or `null` when a required half is
 * blank. The optional keys are carried over exactly as stored unless their
 * field was edited, so an untouched field never grows a key.
 */
function toRowEntry(
  entry: TerminalLauncher,
  drafts: { name: string; command: string; promptFlag: string; runLoop: string },
): TerminalLauncher | null {
  const next: TerminalLauncher = { name: drafts.name.trim(), command: drafts.command.trim() };
  if (!next.name || !next.command) return null;
  const flag = drafts.promptFlag.trim();
  if (flag !== promptFlagDraftOf(entry).trim()) next.promptFlag = flag;
  else if (entry.promptFlag !== undefined) next.promptFlag = entry.promptFlag;
  const loop = drafts.runLoop.trim();
  if (loop !== runLoopDraftOf(entry).trim()) next.runLoop = loop;
  else if (entry.runLoop !== undefined) next.runLoop = entry.runLoop;
  return next;
}

function sameEntry(a: TerminalLauncher, b: TerminalLauncher): boolean {
  return (
    a.name === b.name &&
    a.command === b.command &&
    a.promptFlag === b.promptFlag &&
    a.runLoop === b.runLoop
  );
}

const inputStyle = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
} as const;

const linkButtonStyle = {
  color: "var(--accent)",
  background: "none",
  border: 0,
  padding: 0,
  textDecoration: "underline",
  cursor: "pointer",
  font: "inherit",
} as const;

const NOT_OFFERED = "not offered for runs";

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
  const [promptFlag, setPromptFlag] = useState(promptFlagDraftOf(entry));
  const [runLoop, setRunLoop] = useState(runLoopDraftOf(entry));

  const restoreDrafts = () => {
    setName(entry.name);
    setCommand(entry.command);
    setPromptFlag(promptFlagDraftOf(entry));
    setRunLoop(runLoopDraftOf(entry));
  };

  /**
   * The stored entry can change under a row that is not being edited — another
   * tab's write, or a removal shifting every later row up one index — so the
   * drafts follow it. A rejected edit restores them directly instead: the entry
   * did not change there, so nothing would re-run this.
   */
  useEffect(restoreDrafts, [entry.name, entry.command, entry.promptFlag, entry.runLoop]);

  const commit = () => {
    const next = toRowEntry(entry, { name, command, promptFlag, runLoop });
    if (!next) {
      restoreDrafts();
      return;
    }
    if (sameEntry(next, entry)) return;
    onCommit(next);
  };

  /** Removes the run-loop key, so the name's shipped default applies again. */
  const restoreDefault = () => {
    const next = { ...entry };
    delete next.runLoop;
    onCommit(next);
  };

  /**
   * Stores `runLoop: ""` — not offered for runs. A defaulted run loop is only a
   * placeholder, so clearing the field is "not edited" and writes nothing; this
   * is the one-step way to turn the shipped default off.
   */
  const disableRunLoop = () => onCommit({ ...entry, runLoop: "" });

  /** Stores `promptFlag: ""` — positional — over a defaulted flag. */
  const positionalFlag = () => onCommit({ ...entry, promptFlag: "" });

  /** Removes the prompt-flag key, so the name's shipped flag applies again. */
  const defaultFlag = () => {
    const next = { ...entry };
    delete next.promptFlag;
    onCommit(next);
  };

  // Read off the STORED entry, not the drafts: the markers describe what a run
  // would do now, and an uncommitted draft does nothing yet.
  const state = resolveRunLoop(entry);
  const shipped = shippedFor(entry.name);
  const isDefault = state.kind === "ready" && state.source === "default";
  const canRestore = state.kind === "none" && entry.runLoop !== undefined && Boolean(shipped?.runLoop);
  const runLoopPlaceholder = isDefault ? state.runLoop : state.kind === "none" ? NOT_OFFERED : "";
  const effectiveFlag =
    state.kind === "ready"
      ? state.promptFlag
      : entry.promptFlag === undefined
        ? (shipped?.promptFlag ?? "")
        : "";
  const promptFlagPlaceholder = effectiveFlag || "positional";
  // The flag field shows a default only when no flag is stored. A stored one —
  // "" included — is the user's, and there is a default to go back to only
  // when the name ships a flag that differs from it.
  const flagIsDefaulted = entry.promptFlag === undefined && Boolean(effectiveFlag);
  const canDefaultFlag =
    entry.promptFlag !== undefined &&
    Boolean(shipped?.promptFlag) &&
    entry.promptFlag.trim() !== shipped?.promptFlag;

  return (
    <li className="flex flex-wrap items-start gap-2" data-testid={`launcher-row-${index}`}>
      <input
        aria-label={`Launcher ${index + 1} name`}
        data-testid={`launcher-name-${index}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        className="text-sm px-2 py-1 rounded w-32 shrink-0"
        style={inputStyle}
        spellCheck={false}
      />
      <input
        aria-label={`Launcher ${index + 1} command`}
        data-testid={`launcher-command-${index}`}
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        onBlur={commit}
        className="text-sm px-2 py-1 rounded grow basis-32 min-w-0 font-mono"
        style={inputStyle}
        spellCheck={false}
      />
      <div className="w-32 shrink-0" data-testid={`launcher-prompt-flag-cell-${index}`}>
        <input
          aria-label={`Launcher ${index + 1} prompt flag`}
          data-testid={`launcher-prompt-flag-${index}`}
          value={promptFlag}
          onChange={(e) => setPromptFlag(e.target.value)}
          onBlur={commit}
          placeholder={promptFlagPlaceholder}
          className="text-sm px-2 py-1 rounded w-full font-mono"
          style={flagIsDefaulted ? { ...inputStyle, borderStyle: "dashed" } : inputStyle}
          spellCheck={false}
        />
        {flagIsDefaulted && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            <button
              type="button"
              data-testid={`launcher-positional-flag-${index}`}
              aria-label={`Make the prompt positional for launcher ${index + 1}`}
              onClick={positionalFlag}
              style={linkButtonStyle}
            >
              positional
            </button>
          </p>
        )}
        {canDefaultFlag && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            <button
              type="button"
              data-testid={`launcher-default-flag-${index}`}
              aria-label={`Use the default prompt flag for launcher ${index + 1}`}
              onClick={defaultFlag}
              style={linkButtonStyle}
            >
              use default
            </button>
          </p>
        )}
      </div>
      <div className="grow basis-64 min-w-0" data-testid={`launcher-run-loop-cell-${index}`}>
        <input
          aria-label={`Launcher ${index + 1} run loop`}
          data-testid={`launcher-run-loop-${index}`}
          value={runLoop}
          onChange={(e) => setRunLoop(e.target.value)}
          onBlur={commit}
          placeholder={runLoopPlaceholder}
          className="text-sm px-2 py-1 rounded w-full font-mono"
          style={
            state.kind === "wholeLine"
              ? { ...inputStyle, borderColor: "var(--red)" }
              : isDefault
                ? { ...inputStyle, borderStyle: "dashed" }
                : inputStyle
          }
          spellCheck={false}
        />
        {isDefault && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            <span>shipped default</span>
            {" · "}
            <button
              type="button"
              data-testid={`launcher-disable-run-loop-${index}`}
              aria-label={`Don't offer launcher ${index + 1} for runs`}
              onClick={disableRunLoop}
              style={linkButtonStyle}
            >
              don&apos;t offer for runs
            </button>
          </p>
        )}
        {state.kind === "none" && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            <span>{NOT_OFFERED}</span>
            {canRestore && (
              <>
                {" · "}
                <button
                  type="button"
                  data-testid={`launcher-restore-run-loop-${index}`}
                  aria-label={`Restore default run loop for launcher ${index + 1}`}
                  onClick={restoreDefault}
                  style={linkButtonStyle}
                >
                  restore default
                </button>
              </>
            )}
          </p>
        )}
        {state.kind === "wholeLine" && (
          <p
            className="text-xs mt-0.5"
            role="alert"
            style={{ color: "var(--red)" }}
          >
            This looks like a whole command line — the command is added for you.{" "}
            <button
              type="button"
              data-testid={`launcher-fix-run-loop-${index}`}
              aria-label={`Fix run loop for launcher ${index + 1}`}
              onClick={() => onCommit(fixWholeLine(entry))}
              style={linkButtonStyle}
            >
              Fix
            </button>
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label={`Remove launcher ${index + 1}: ${entry.name}`}
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
  const [newPromptFlag, setNewPromptFlag] = useState("");
  const [newRunLoop, setNewRunLoop] = useState("");

  const add = () => {
    const entry = toEntry(newName, newCommand, newPromptFlag, newRunLoop);
    if (!entry) return;
    setLaunchers((current) => [...current, entry]);
    setNewName("");
    setNewCommand("");
    setNewPromptFlag("");
    setNewRunLoop("");
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
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <input
          aria-label="New launcher name"
          data-testid="launcher-new-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="name"
          className="text-sm px-2 py-1 rounded w-32 shrink-0"
          style={inputStyle}
          spellCheck={false}
        />
        <input
          aria-label="New launcher command"
          data-testid="launcher-new-command"
          value={newCommand}
          onChange={(e) => setNewCommand(e.target.value)}
          placeholder="command"
          className="text-sm px-2 py-1 rounded grow basis-32 min-w-0 font-mono"
          style={inputStyle}
          spellCheck={false}
        />
        <input
          aria-label="New launcher prompt flag"
          data-testid="launcher-new-prompt-flag"
          value={newPromptFlag}
          onChange={(e) => setNewPromptFlag(e.target.value)}
          placeholder="prompt flag"
          className="text-sm px-2 py-1 rounded w-32 shrink-0 font-mono"
          style={inputStyle}
          spellCheck={false}
        />
        <input
          aria-label="New launcher run loop"
          data-testid="launcher-new-run-loop"
          value={newRunLoop}
          onChange={(e) => setNewRunLoop(e.target.value)}
          placeholder="run loop, e.g. /goal {prompt}"
          className="text-sm px-2 py-1 rounded grow basis-64 min-w-0 font-mono"
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
        command is sent to the terminal verbatim, with a trailing return. The
        run loop is the text the CLI receives when a task run starts, with{" "}
        <code>{"{prompt}"}</code> standing for the objective — plain text, no
        quotes or shell syntax. The prompt flag is how the command takes that
        text: leave it blank when the prompt is a plain argument. A dashed field
        is the shipped default; clear a run loop, or choose{" "}
        <em>don&apos;t offer for runs</em>, and that launcher is not offered for a
        run.
      </p>
    </div>
  );
}
