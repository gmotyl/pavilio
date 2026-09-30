/**
 * The two string steps between a stored objective template and the line a
 * fresh terminal receives.
 *
 * The template is the OBJECTIVE only — no `/goal`, no quotes. Those belong to
 * the launcher's run loop, which wraps the objective at `{prompt}`. So there
 * are two substitutions, owned by two different things: the template's
 * variables (this change, this file, this project) and the launcher's wrapper.
 */

const PROMPT = "{prompt}";

/** Substitutes `{change}`, `{path}` and `{project}` into the stored objective template. */
export function resolveObjective(
  template: string,
  vars: { change: string; path: string; project: string },
): string {
  // A replacer function, not a replacement string: a `$&` or `$1` inside a
  // path would otherwise be read as a pattern. Unknown names are left alone.
  return template.replace(/\{(change|path|project)\}/g, (_, name: keyof typeof vars) => vars[name]);
}

/**
 * Maps an offset in the RESOLVED objective to the same place in its template,
 * for a caret that has to survive the box swapping one for the other. The
 * template is a run of literal text and placeholders; each placeholder expands
 * to its value. Literal text maps one to one, shifted by what the placeholders
 * before it grew or shrank by. An offset strictly inside a placeholder's value
 * — or at its end — maps to the end of the placeholder's token, since the
 * value has no counterpart position in the token; right before a value is
 * right before its token.
 */
export function templateOffset(
  template: string,
  vars: { change: string; path: string; project: string },
  resolvedOffset: number,
): number {
  let resolved = 0;
  let at = 0;
  for (const match of template.matchAll(/\{(change|path|project)\}/g)) {
    const literal = match.index - at;
    if (resolvedOffset <= resolved + literal) return at + (resolvedOffset - resolved);
    resolved += literal;
    at = match.index;
    const value = vars[match[1] as keyof typeof vars].length;
    if (resolvedOffset <= resolved + value) return at + match[0].length;
    resolved += value;
    at += match[0].length;
  }
  return Math.min(template.length, at + (resolvedOffset - resolved));
}

/**
 * Folds line breaks and every other control character to spaces. The line is
 * typed into a PTY, where each is a keystroke: a newline is a return, and a
 * return inside an open quote leaves the shell at a continuation prompt rather
 * than starting the agent; a tab asks for completion; ESC, ^C, ^D and DEL edit
 * or abort the line being typed.
 */
function fold(text: string): string {
  return text.replace(/\r\n|[\u0000-\u001f\u007f]/g, " ");
}

/**
 * Text written inside a single-quoted shell word. Inside '…' nothing is
 * special but the closing quote, spelt `'\''` — not `$`, not a backtick, and
 * not `!`, which an interactive bash or zsh leaves alone there.
 */
function inSingleQuotes(text: string): string {
  return fold(text).replace(/'/g, `'\\''`);
}

/** `command [promptFlag] '` — everything the line holds before the start prompt's text. */
function head(command: string, promptFlag: string): string {
  return `${[command.trim(), promptFlag.trim()].filter(Boolean).join(" ")} '`;
}

/**
 * `command [promptFlag] '<runLoop with objective>'` — the start prompt
 * single-quoted as one argument after control characters fold to spaces.
 * Every `{prompt}` is filled with the same objective; a run loop without one
 * is still sent, as one quoted argument of its own.
 */
export function composeRunLine(
  command: string,
  promptFlag: string,
  runLoop: string,
  objective: string,
): string {
  const segments = runLoop.split(PROMPT).map(inSingleQuotes);
  return `${head(command, promptFlag)}${segments.join(inSingleQuotes(objective))}'`;
}

/** Whether the launcher's run loop has anywhere to put the objective. */
export function takesPrompt(runLoop: string): boolean {
  return runLoop.includes(PROMPT);
}

/** How a `{prompt}` after the first is drawn: the send fills it with the same objective. */
export const OBJECTIVE_MARKER = "«objective»";

/**
 * The composed line around the editable objective, for drawing: `before` +
 * the objective + `after` is exactly what {@link composeRunLine} sends for an
 * objective with nothing to escape, because both are built from the same
 * head and the same escaped run-loop segments. A run loop with no placeholder
 * is all wrapper. A later `{prompt}` is drawn as {@link OBJECTIVE_MARKER},
 * since the send fills every one and the drawing must not show a placeholder
 * the sent line will not contain.
 */
export function runLineParts(
  command: string,
  promptFlag: string,
  runLoop: string,
): { before: string; after: string } {
  const [first, ...rest] = runLoop.split(PROMPT).map(inSingleQuotes);
  const lead = `${head(command, promptFlag)}${first}`;
  if (rest.length === 0) return { before: `${lead}'`, after: "" };
  return { before: lead, after: `${rest.join(OBJECTIVE_MARKER)}'` };
}
