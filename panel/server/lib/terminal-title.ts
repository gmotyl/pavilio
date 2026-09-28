// Reads the window title a process publishes on its own PTY by scanning the
// outgoing byte stream for OSC title sequences (`ESC ] 0|1|2 ; <text> BEL`,
// or terminated by ST — `ESC \`). Agents such as Claude Code and opencode
// keep that title in step with what they are doing, so it is the only place
// the panel can learn what a terminal is busy with without inspecting output.
//
// Normalisation happens here, once, so no consumer ever repeats it: the value
// a caller receives is already safe to store, to put in JSON, and to render
// into a `title=` attribute.

export interface TitleState {
  /** Trailing bytes of an OSC sequence that spanned a chunk boundary. */
  pending: string;
}

/** Longest stored title. */
export const MAX_TITLE_LENGTH = 120;

// Width of the tail window kept for the next chunk, and therefore the bound
// on the carry buffer: `pending` is always a suffix of that window, so it can
// never exceed this. A runaway OSC (introducer emitted, terminator never) is
// dropped whole rather than head-truncated — once the window slides past the
// introducer, the bytes already seen go with it. Dropping whole is the point:
// a retained head could later be spliced onto a terminator belonging to a
// *different* sequence, publishing title A's head against title B's
// terminator. The bound is deliberately far above any plausible title rather
// than "a title's worth of bytes", because the buffer holds the *raw*
// sequence: a legitimate over-long title split across chunks still completes
// and is cut to MAX_TITLE_LENGTH by normalise(); only a genuinely runaway
// sequence (>4 KB with no terminator) is discarded, which is the malformed
// case the spec says to ignore.
const MAX_PENDING_LENGTH = 4096;

// ESC ] 0|1|2 ; <text> (BEL | ESC \). The body stops at BEL or ESC, so an
// ST terminator ends it just as a BEL does, and an unterminated introducer
// simply does not match. The `;` after the digit is what keeps OSC 10
// (`ESC ]10;`) out — there is no separate guard: `10;` cannot match `[012];`
// because the `0` is followed by `;` in the pattern but by `1` in the text.
// eslint-disable-next-line no-control-regex
const OSC_TITLE_RE = /\x1b\][012];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

// Leading decoration: a run of "other symbol" characters followed by
// whitespace — the status glyph an agent animates in front of its title
// (`◐ `, `◑ `, `✳ `, all \p{So}) and the space after it. Deliberately narrow
// on both sides. \p{So} rather than the whole of \p{S}, so ordinary titles do
// not lose their first character: `$` and `€` are \p{Sc}, `~` `+` `=` `<` `>`
// `|` are \p{Sm}, `^` and a backtick are \p{Sk} — none of them are decoration,
// while every glyph agents actually animate (plus 🔴 → ★ ✓ ©) is \p{So}. And
// `[` and `(` are \p{Ps}, so `[3] npm run dev` and `(base) conda env` keep
// their opening delimiter.
const LEADING_DECORATION_RE = /^\p{So}+\s+/u;

// An OSC terminator: BEL, or ST (`ESC \`). Non-global so it carries no
// lastIndex state between calls.
// eslint-disable-next-line no-control-regex
const TERMINATOR_RE = /\x07|\x1b\\/;

// Control characters and newlines. Replaced by a space rather than removed
// outright so that words either side of them do not fuse together; the
// whitespace collapse below cleans up what that leaves behind.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x1f\x7f]/g;

export function createTitleState(): TitleState {
  return { pending: "" };
}

// The decoration strip runs *after* the control fold and the whitespace
// collapse/trim, not before: a title padded with one leading space would
// otherwise defeat it entirely, and the animated glyph would flip through as
// a new title twice a second — the exact republish the strip exists to
// prevent. The second trim removes what the strip's own trailing `\s+` does
// not, e.g. a title that was nothing but decoration. Truncation stays last so
// the cut applies to the text that is actually stored.
function normalise(raw: string): string {
  return raw
    .replace(CONTROL_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEADING_DECORATION_RE, "")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
}

/** The LAST complete title in this chunk, normalised; `null` if the chunk held none. */
export function scanTitle(chunk: string, state: TitleState): string | null {
  const combined = state.pending + chunk;
  let last: string | null = null;
  let lastEnd = 0;
  OSC_TITLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  // Only the last title in a chunk matters — the earlier ones were already
  // superseded before any client could have seen them.
  while ((match = OSC_TITLE_RE.exec(combined)) !== null) {
    last = normalise(match[1]);
    lastEnd = match.index + match[0].length;
  }

  // Carry a trailing partial sequence into the next chunk. Only the unparsed
  // tail can hold one, and it can never need to reach further back than
  // MAX_PENDING_LENGTH, so the scan window is capped the way the sibling
  // terminal-mode-state.ts caps its own — a 64 KB chunk with no escape in it
  // is then not copied and rescanned on every onData. This window is also the
  // carry bound: `pending` below is always a suffix of `tail`, so no separate
  // length check is needed (and one here would be unreachable).
  const tail = combined.slice(
    Math.max(lastEnd, combined.length - MAX_PENDING_LENGTH),
  );
  // Carry from the last *introducer*, not the last ESC. An OSC terminated by
  // ST contains an interior ESC (the `ESC \` itself), so a chunk ending
  // mid-terminator has its last ESC inside the sequence, and carrying from
  // there would throw the introducer and the whole body away. The sibling
  // scanner can use a plain lastIndexOf("\x1b") because a CSI sequence
  // contains no ESC after its own introducer.
  //
  // Carry only from an introducer that is still *open*. `lastEnd` advances
  // past titles only, so a complete non-title OSC — `ESC ]7;` (cwd) and
  // `ESC ]133;` (shell integration marks) stream constantly — stays in the
  // tail and would otherwise pin the carry forever, dragging ordinary output
  // along to be recopied and rescanned on every chunk. If a terminator
  // follows the introducer, that sequence is finished and nothing behind it
  // is worth keeping. A lone trailing ESC is still carried: it may be the
  // first byte of the next introducer.
  const introIdx = tail.lastIndexOf("\x1b]");
  const open = introIdx >= 0 && !TERMINATOR_RE.test(tail.slice(introIdx + 2));
  state.pending = open
    ? tail.slice(introIdx)
    : tail.endsWith("\x1b")
      ? "\x1b"
      : "";

  return last;
}
