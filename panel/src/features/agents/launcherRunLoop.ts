/**
 * A launcher's EFFECTIVE run loop: the start-prompt text a task run hands its
 * CLI, and the flag (if any) that precedes it.
 *
 * What is stored is not always what runs. A list saved before the run-loop
 * column existed has no `runLoop` key; the list PR #131 shipped stored whole
 * shell lines (`claude "/goal {prompt}"`), which the panel now builds itself;
 * and a user may have written their own whole line. This module is the one
 * place those cases are told apart, on read only — nothing is written back.
 */
import {
  DEFAULT_TERMINAL_LAUNCHERS,
  type TerminalLauncher,
} from "../../preferences/declarations";

export type RunLoopState =
  | { kind: "ready"; runLoop: string; promptFlag: string; source: "stored" | "default" }
  | { kind: "none" } // not offered for runs
  | { kind: "wholeLine"; stored: string }; // starts with its own command word — never spawned

/**
 * The whole-line run loops PR #131 shipped, by launcher name. A stored one
 * is the old default written back by an editor, not a choice, so it reads as
 * the key being absent. Matched exactly and only under its own name.
 */
const LEGACY_WHOLE_LINES: Record<string, string> = {
  claude: 'claude "/goal {prompt}"',
  codex: 'codex "/goal {prompt}"',
  opencode: 'opencode --prompt "{prompt}"',
};

/** The shipped entry for a name, or undefined for a name the panel does not ship. */
function shipped(name: string): TerminalLauncher | undefined {
  return DEFAULT_TERMINAL_LAUNCHERS.find((entry) => entry.name === name);
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * Whether a run loop is a whole shell line rather than start-prompt text:
 * after leading whitespace it begins with the launcher command's FIRST word,
 * followed by whitespace. So for command `codex --no-daemon`, both
 * `codex --no-daemon "/goal {prompt}"` and `codex --continue` are whole lines,
 * while `codexify {prompt}` (a longer word) and a bare `codex` (nothing
 * after it — text the CLI would simply receive) are not.
 */
function isWholeLine(command: string, runLoop: string): boolean {
  const [first] = words(command);
  if (!first) return false;
  const text = runLoop.trimStart();
  return text.startsWith(first) && /^\s/.test(text.slice(first.length));
}

export function resolveRunLoop(launcher: TerminalLauncher): RunLoopState {
  const fallback = shipped(launcher.name);
  const promptFlag =
    launcher.promptFlag !== undefined
      ? launcher.promptFlag.trim()
      : (fallback?.promptFlag ?? "").trim();

  const stored = launcher.runLoop;
  if (stored === undefined || stored === LEGACY_WHOLE_LINES[launcher.name]) {
    if (!fallback?.runLoop) return { kind: "none" };
    // A legacy whole line carried its own flag (`opencode --prompt "…"`), so a
    // blank flag stored beside it is not a choice of positional: the shipped
    // flag still applies. A non-blank stored flag is the user's and wins.
    const flag =
      stored !== undefined && !promptFlag ? (fallback.promptFlag ?? "").trim() : promptFlag;
    return { kind: "ready", runLoop: fallback.runLoop, promptFlag: flag, source: "default" };
  }
  if (!stored.trim()) return { kind: "none" };
  if (isWholeLine(launcher.command, stored)) return { kind: "wholeLine", stored };
  return { kind: "ready", runLoop: stored, promptFlag, source: "stored" };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One surrounding layer of `"…"` or `'…'`, if both ends carry the same one. */
function unquote(text: string): string {
  const open = text[0];
  if (text.length >= 2 && (open === '"' || open === "'") && text.endsWith(open)) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Turns a whole-line run loop into start-prompt text: strips the command word(s)
 * — the full command when the line starts with it (whitespace-insensitive),
 * else only its first word — then one layer of quotes. A leading `--prompt` or
 * `-p` with text after it moves into `promptFlag`. Any other entry comes back
 * as an equal copy. Always a new object; the argument is never touched.
 */
export function fixWholeLine(launcher: TerminalLauncher): TerminalLauncher {
  const next: TerminalLauncher = { ...launcher };
  const stored = launcher.runLoop;
  if (stored === undefined || resolveRunLoop(launcher).kind !== "wholeLine") return next;

  const text = stored.trim();
  const commandWords = words(launcher.command);
  const full = new RegExp(`^${commandWords.map(escapeRegExp).join("\\s+")}(?=\\s|$)`);
  let rest = (full.test(text) ? text.replace(full, "") : text.replace(/^\S+/, "")).trim();

  const flagged = /^(--prompt|-p)\s+(\S[\s\S]*)$/.exec(rest);
  if (flagged) {
    next.promptFlag = flagged[1];
    rest = flagged[2];
  }
  next.runLoop = unquote(rest.trim());
  return next;
}
