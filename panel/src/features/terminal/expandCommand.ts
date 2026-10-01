/**
 * A `/token`: a slash that starts the draft or follows whitespace, and every
 * non-whitespace character after it. The lead (start or the one whitespace
 * character) is captured so the replacement can put it back unchanged.
 */
const SLASH_TOKEN = /(^|\s)\/(\S+)/g;

/**
 * Punctuation a sentence may put right after a token (`use /pavilio-note.`).
 * It is stripped off the END of the token before the known-name lookup and
 * kept, as typed, after the replacement — except that when it starts with `.`
 * the instruction's own final `.` is dropped, so the full stop is not doubled.
 */
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

const instruction = (name: string): string =>
  `Read and follow the instructions in skills/${name}/SKILL.md exactly.`;

/**
 * Every known `/<name>` that starts the draft or follows whitespace is replaced
 * in place with `Read and follow the instructions in skills/<name>/SKILL.md exactly.`
 * Anything else is unchanged. The path is RELATIVE, per D16.
 *
 * ## What counts as a command
 *
 * A token is a `/` at index 0 or right after whitespace (a space, a tab, a
 * newline), running to the next whitespace or the end of the draft. So a `/`
 * inside a word or path (`projects/pavilio-grill`, `a/b`, `(/x`) is never a
 * token, and `/pavilio-grill/SKILL.md` is one token whose name is not a skill.
 * The name is the token minus its slash, matched against `known` exactly; if
 * that misses, trailing `.,;:!?)` are stripped and the rest is tried, the
 * punctuation then following the instruction as typed. A kept run that starts
 * with `.` takes the place of the instruction's own full stop (`/pavilio-note.`
 * -> `… exactly.`, `/pavilio-note...` -> `… exactly...`); any other run follows
 * it (`/pavilio-note,` -> `… exactly.,`). A name that is not a known skill is sent verbatim: it may be
 * a TUI's own slash command (`/clear`, `/model`) or just text.
 *
 * ## In place
 *
 * Only the token itself is replaced; the text before and after it — the
 * whitespace included — stays where it is, so nothing is trimmed and no
 * separator is added. There is no `ARGUMENTS:` form: one rule for every
 * position (design F7).
 *
 * ## Why relative
 *
 * D16: the cell starts at the workspace root of whichever account it runs as
 * (`translateCwd`), so `skills/<name>/SKILL.md` resolves under that account's
 * own tree. An absolute path computed here would name the panel owner's.
 */
export function expandCommand(draft: string, known: ReadonlySet<string>): string {
  if (known.size === 0) return draft;
  return draft.replace(SLASH_TOKEN, (whole, lead: string, word: string) => {
    if (known.has(word)) return `${lead}${instruction(word)}`;
    const punctuation = TRAILING_PUNCTUATION.exec(word)?.[0];
    if (punctuation === undefined) return whole;
    const name = word.slice(0, word.length - punctuation.length);
    if (name === "" || !known.has(name)) return whole;
    const expanded = instruction(name);
    const body = punctuation.startsWith(".") ? expanded.slice(0, -1) : expanded;
    return `${lead}${body}${punctuation}`;
  });
}
