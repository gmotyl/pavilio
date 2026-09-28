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

// A runaway OSC (introducer emitted, terminator never) must not turn the
// carry buffer into an unbounded sink. The bound is deliberately far above
// any plausible title rather than "a title's worth of bytes": the buffer
// holds the *raw* sequence, and a title that overflows it can only be
// dropped whole — keeping a head and splicing it onto a later terminator
// would publish text the process never sent as a title. Set generously, a
// legitimate over-long title split across chunks still completes and is cut
// to MAX_TITLE_LENGTH by normalise(); only a genuinely runaway sequence
// (>4 KB with no terminator) is discarded, which is the malformed case the
// spec says to ignore.
const MAX_PENDING_LENGTH = 4096;

// ESC ] 0|1|2 ; <text> (BEL | ESC \). The body stops at BEL or ESC, so an
// ST terminator ends it just as a BEL does, and an unterminated introducer
// simply does not match. The `;` after the digit is what keeps OSC 10
// (`ESC ]10;`) out — there is no separate guard: `10;` cannot match `[012];`
// because the `0` is followed by `;` in the pattern but by `1` in the text.
// eslint-disable-next-line no-control-regex
const OSC_TITLE_RE = /\x1b\][012];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

// Leading decoration: a run of symbol characters followed by whitespace —
// the status glyph an agent animates in front of its title (`◐ `, `◑ `,
// `✳ `, all \p{So}) and the space after it. Deliberately narrow: `[` and `(`
// are \p{Ps}, so `[3] npm run dev` and `(base) conda env` keep their opening
// delimiter, and `~/projects/pavilio` keeps its tilde because no whitespace
// follows it.
const LEADING_DECORATION_RE = /^\p{S}+\s+/u;

// Control characters and newlines. Replaced by a space rather than removed
// outright so that words either side of them do not fuse together; the
// whitespace collapse below cleans up what that leaves behind.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x1f\x7f]/g;

export function createTitleState(): TitleState {
  return { pending: "" };
}

function normalise(raw: string): string {
  return raw
    .replace(LEADING_DECORATION_RE, "")
    .replace(CONTROL_RE, " ")
    .replace(/\s+/g, " ")
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
  // tail can hold one, and it can never need to reach further back than the
  // carry bound, so the scan window is capped the way the sibling
  // terminal-mode-state.ts caps its own — a 64 KB chunk with no escape in it
  // is then not copied and rescanned on every onData.
  const tail = combined.slice(
    Math.max(lastEnd, combined.length - MAX_PENDING_LENGTH),
  );
  // Carry from the last *introducer*, not the last ESC. An OSC terminated by
  // ST contains an interior ESC (the `ESC \` itself), so a chunk ending
  // mid-terminator has its last ESC inside the sequence, and carrying from
  // there would throw the introducer and the whole body away. The sibling
  // scanner can use a plain lastIndexOf("\x1b") because a CSI sequence
  // contains no ESC after its own introducer. A lone trailing ESC with no
  // introducer behind it is still carried: it may be the first byte of one.
  const introIdx = tail.lastIndexOf("\x1b]");
  const pending =
    introIdx >= 0 ? tail.slice(introIdx) : tail.endsWith("\x1b") ? "\x1b" : "";
  state.pending = pending.length > MAX_PENDING_LENGTH ? "" : pending;

  return last;
}
