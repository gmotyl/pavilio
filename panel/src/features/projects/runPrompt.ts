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

type QuoteState = "bare" | "single" | "double";

/**
 * The objective, written so the shell hands it to the CLI as the text the
 * user saw, for whichever quoting the run loop put around `{prompt}`.
 *
 * Line breaks fold to spaces first: the line is typed into a PTY, where a
 * newline is a return, and a return inside an open quote leaves the shell at a
 * continuation prompt rather than starting the agent.
 */
function quoteFor(state: QuoteState, objective: string): string {
  const text = objective.replace(/\r?\n|\r/g, " ");
  if (state === "double") {
    // Inside "…" these four keep a meaning: `"` ends the string, `$` and a
    // backtick expand, `\` escapes. `!` is worse — an interactive bash or zsh
    // history-expands it, and a backslash before it stays in the text — so a
    // bang steps out into a single-quoted `'!'`, where it is inert in both.
    return text.replace(/(["\\$`])/g, "\\$1").replace(/!/g, `"'!'"`);
  }
  // Inside '…' nothing is special but the closing quote, spelt `'\''`.
  const single = text.replace(/'/g, `'\\''`);
  // A bare `{prompt}` gets a single-quoted word of its own, so the objective
  // stays one argument.
  return state === "single" ? single : `'${single}'`;
}

/** Substitutes `{prompt}` into the launcher's run loop. */
export function composeRunLine(runLoop: string, objective: string): string {
  // A small scan rather than a split: the escaping depends on the quote the
  // run loop has open AT the placeholder, which only a left-to-right read of
  // the shell's own quoting rules can tell.
  let out = "";
  let state: QuoteState = "bare";
  let i = 0;
  while (i < runLoop.length) {
    if (runLoop.startsWith(PROMPT, i)) {
      out += quoteFor(state, objective);
      i += PROMPT.length;
      continue;
    }
    const ch = runLoop[i];
    if (ch === "\\" && state !== "single") {
      // An escaped character is copied as-is and cannot open or close a quote.
      out += runLoop.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "'" && state !== "double") state = state === "single" ? "bare" : "single";
    else if (ch === '"' && state !== "single") state = state === "double" ? "bare" : "double";
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * The launcher's wrapper, cut at the first `{prompt}`, for drawing around the
 * editable objective. A run loop with no placeholder is all wrapper.
 */
export function splitRunLoop(runLoop: string): { before: string; after: string } {
  const at = runLoop.indexOf(PROMPT);
  if (at < 0) return { before: runLoop, after: "" };
  return { before: runLoop.slice(0, at), after: runLoop.slice(at + PROMPT.length) };
}
