# The server runs a headless terminal per session to replay the screen on reconnect

When a browser tab closes and the panel reopens, the client xterm instances
are gone and their buffers with them. The PTY on the server is still alive,
but a long-running shell or TUI never re-emits the bytes that drew its
current screen — those were streamed once and are not stored. The result is
the symptom that started this investigation: reopen the panel and every
terminal is blank until the user resizes the window.

Two mechanisms already existed to paper over this on **reconnect** (see
[[Preamble]] and [[Nudge]]): the server replays the TUI's DEC private mode
state, then fires a double SIGWINCH so a well-behaved TUI repaints itself.
Both are heuristics. The nudge depends on the TUI debouncing resize events
in a way that still produces a repaint (Ink/Claude Code can coalesce the two
signals into a no-op), and **neither does anything for a plain shell** — a
zsh prompt with scrollback has no repaint mechanism, and the server keeps no
output history, so that content is simply lost to a fresh client.

We decided the server will maintain a headless `@xterm/headless` terminal per
session, fed every PTY output chunk alongside the existing
[[Preamble]] scan. On attach, after the client sends its first `resize`
(so the headless terminal is serialized at the client's exact dimensions),
the server emits a serialized screen + scrollback snapshot
(`@xterm/addon-serialize`) prefixed with a full reset (`\x1bc`) before
streaming live bytes. This restores the exact screen and scrollback for
**both** TUIs and plain shells — the same approach ttyd, code-server, and
VS Code's terminal use for reconnect. This is [[Replay]].

## Considered options

- **Patch the nudge** — add a real delay between the two SIGWINCH resizes
  and/or have the client retry a nudge if no output arrives shortly after
  the socket opens. Smaller change, but still a heuristic that depends on
  every TUI being well-behaved, and it can never restore plain-shell
  scrollback because the bytes are gone.

- **Headless-xterm replay** *(chosen)* — the server becomes the source of
  truth for each session's screen. Works for TUIs and shells alike, and is
  the established pattern for terminal reconnect. Cost: two dependencies
  (`@xterm/headless`, `@xterm/addon-serialize`), a few MB of memory per
  session for the 5000-line scrollback mirror, and CPU to feed every chunk
  into the headless emulator.

## Consequences

- The [[Preamble]] and [[Nudge]] stay in place for now. `addon-serialize`
  reliably round-trips buffer contents, cursor, and cell attributes, but its
  coverage of every DEC private mode (mouse tracking `?1000h`, bracketed
  paste) is not something we want to bet the hard-won scroll/click fix on.
  The preamble is idempotent and tiny; the nudge is now largely redundant but
  harmless. A follow-up can remove them once replay is proven in practice.

- Replay must wait for the client's first `resize` before serializing.
  Serializing at stale dimensions would reflow the restored screen at the
  wrong width. This adds one round-trip of latency to the first paint on
  reconnect, which is acceptable.

- The replay is prefixed with `\x1bc` (full reset). A reconnecting client may
  attach an xterm that is not empty (e.g. a same-session re-attach that kept
  its buffer); without the reset, replay would paint on top of existing
  content and double up.

- Server memory now scales with `(number of live sessions × scrollback)`.
  With the current 5000-line scrollback this is a few MB per session — fine
  for a single-user local panel, worth revisiting if session counts grow.
