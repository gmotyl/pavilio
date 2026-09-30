/**
 * A leading `/<name>` and whatever follows it: the name is every
 * non-whitespace character after the slash, and the rest (if any) starts after
 * the first run of whitespace — a space, several, or a newline.
 */
const LEADING_COMMAND = /^\/(\S+)(?:\s+([\s\S]*))?$/;

/**
 * `/<name> <args>` -> `Read and follow the instructions in skills/<name>/SKILL.md exactly. ARGUMENTS: <args>`
 * Anything else is returned unchanged. The path is RELATIVE, per D16.
 *
 * ## What counts as a command
 *
 * Only a `/` at index 0 of the draft, followed by a name in `known`. Leading
 * whitespace before the slash makes it "not at the start", exactly as the
 * picker's own trigger does (it opens only on a `/` typed into an empty
 * draft), so an indented `/path` in a pasted snippet is never rewritten. A
 * name that is not a known skill is sent verbatim: it may be a TUI's own slash
 * command (`/clear`, `/model`) or just text.
 *
 * ## The arguments
 *
 * The first whitespace run after the name is the separator and is dropped;
 * the arguments are the rest, with trailing whitespace trimmed. Inner
 * whitespace — newlines included — is the user's and is kept as typed. With
 * nothing left the instruction ends in a bare `ARGUMENTS:`, with no trailing
 * space: the spec's "no stray separator".
 *
 * ## Why relative
 *
 * D16: the cell starts at the workspace root of whichever account it runs as
 * (`translateCwd`), so `skills/<name>/SKILL.md` resolves under that account's
 * own tree. An absolute path computed here would name the panel owner's.
 */
export function expandCommand(draft: string, known: ReadonlySet<string>): string {
  const match = LEADING_COMMAND.exec(draft);
  if (!match) return draft;
  const [, name, rest = ""] = match;
  if (!known.has(name)) return draft;
  const args = rest.trimEnd();
  const instruction = `Read and follow the instructions in skills/${name}/SKILL.md exactly. ARGUMENTS:`;
  return args === "" ? instruction : `${instruction} ${args}`;
}
