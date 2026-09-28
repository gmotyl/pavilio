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
// carry buffer into an unbounded sink. Anything longer than this is a
// malformed sequence, and is dropped rather than partially applied.
const MAX_PENDING_LENGTH = 256;

// ESC ] 0|1|2 ; <text> (BEL | ESC \). The body stops at BEL or ESC, so an
// ST terminator ends it just as a BEL does, and an unterminated introducer
// simply does not match.
// eslint-disable-next-line no-control-regex
const OSC_TITLE_RE = /\x1b\][012];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

// Leading decoration: a run of characters that are neither letters nor
// digits (status glyphs, bullets, and the whitespace that follows them).
const LEADING_DECORATION_RE = /^[^\p{L}\p{N}]+/u;

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

  // Carry a trailing partial sequence into the next chunk. Everything before
  // the last ESC has been fully parsed, so it is dropped.
  const tail = combined.slice(lastEnd);
  const escIdx = tail.lastIndexOf("\x1b");
  const pending = escIdx >= 0 ? tail.slice(escIdx) : "";
  state.pending = pending.length > MAX_PENDING_LENGTH ? "" : pending;

  return last;
}
