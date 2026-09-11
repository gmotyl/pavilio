/*
 * opencode plugin: emit the agent's finished response to the panel.
 *
 * Watches for `session.idle` — opencode's "this session's turn is over" event —
 * asks the opencode server for that session's messages, takes the last
 * assistant message's prose, and POSTs `{ sessionId, text }` to
 * `POST /api/speech/utterance`, exactly as the Claude Code and codex emitters
 * do. The panel keeps it as the latest utterance for that cell and the browser
 * does the synthesis. Nothing is synthesized here.
 *
 * Installed by `scripts/install-speech-hook.mjs`, which symlinks this file into
 * `~/.config/opencode/plugins/`.
 *
 * ## Why this one has no transcript, no wait loop, and no `exit 0`
 *
 * The other two emitters are subprocesses spawned by a `Stop` hook: they read
 * the turn's answer out of a JSONL file the agent is still appending to, so
 * they poll for the record that marks the turn finished, and they hide every
 * failure behind `process.exit(0)`.
 *
 * This one runs *inside* the opencode process. That removes two problems and
 * creates one:
 *
 * - there is no file and no async-write race — `session.idle` means the turn is
 *   over, and `client.session.messages` answers from the server's own state, so
 *   there is nothing to wait for and no staleness check to get wrong;
 * - there is no process to exit. A throw here surfaces into the agent's own
 *   turn. So containment is not a convention in this file, it is the contract:
 *   the whole handler sits inside one `try`, and every path out of it resolves.
 *
 * Nothing is printed either — not even the single 401 line the subprocess
 * emitters are allowed. They write to a stderr the panel discards; this shares
 * stdout/stderr with opencode's TUI, where one stray line corrupts the frame.
 *
 * ## Which session — a subagent must not speak into its parent's cell
 *
 * opencode fires `session.idle` for child (subagent) sessions too, and those
 * run in the same process as their parent, hence in the same PTY, hence under
 * the same `PAVILIO_TERMINAL_ID`. Without a filter, every subagent that
 * finished would speak its own answer into the parent's cell — usually while
 * the parent is still working, and in a voice the listener has no way to
 * attribute.
 *
 * The discriminator is `Session.parentID`, which the SDK marks optional and
 * sets only on child sessions. It is read per event with `client.session.get`
 * rather than accumulated from `session.created` events, because the event
 * stream is not a reliable census: a session restored from disk, or one created
 * before this plugin loaded, never announces itself, and the failure mode of a
 * missed child is exactly the one above.
 *
 * ## Which cell, which panel, which auth
 *
 * Identical to `speak-response.mjs`, and for the same reasons:
 * `PAVILIO_TERMINAL_ID` is put into the PTY's environment by
 * `server/lib/terminal-manager.ts` and is the only thing binding an utterance
 * to a cell; `PAVILIO_PANEL_URL` carries the port the panel actually bound to,
 * which is not necessarily its configured one; `Authorization: Bearer
 * ${PANEL_TOKEN}` is attached only when that variable is present, which is what
 * `server/lib/auth.ts#hasValidToken` already accepts.
 *
 * The environment is read per event rather than captured when the plugin loads.
 * It costs nothing, and a plugin constructed once at opencode start would
 * otherwise freeze whatever the process happened to be launched with.
 *
 * ## Dependencies: none, deliberately
 *
 * Only the type-only import below, which is erased at compile time. The
 * installed copy of this file is a *symlink* into the pavilio checkout, and bun
 * resolves a symlinked module's imports from its real path — i.e. from a repo
 * that has no opencode packages installed. A single runtime import from
 * `@opencode-ai/*` would therefore fail to resolve and take the plugin, not
 * just the speech, down with it.
 *
 * Note that `panel/tsconfig.json` includes only `src`, so this file is not
 * typechecked by `tsc`. Its correctness is carried by
 * `__tests__/speak-response-opencode.test.ts` alone.
 */
import type { Plugin } from "@opencode-ai/plugin";

/**
 * The two calls this plugin makes, described structurally rather than borrowed
 * from the SDK. The real client type is far wider than what is used here, and
 * naming only the surface that is actually touched is also what keeps the
 * type-only import above honest.
 */
interface OpencodeClientLike {
  session: {
    get(options: { path: { id: string } }): Promise<unknown>;
    messages(options: { path: { id: string } }): Promise<unknown>;
  };
}

/**
 * Override for tests and for a panel that moved off its configured port.
 * Trailing slashes are stripped: `http://127.0.0.1:3012/` would otherwise build
 * a doubled slash the panel answers 404 to, which this plugin then swallows by
 * design — silence with nothing anywhere to explain it.
 */
function panelUrl(): string {
  return (process.env.PAVILIO_PANEL_URL ?? "http://127.0.0.1:3010").replace(/\/+$/, "");
}

/**
 * How long the POST gets before it is abandoned. Short on purpose: the panel is
 * on loopback, and the agent awaits its event handlers, so a wedged panel costs
 * this much and no more.
 */
const REQUEST_TIMEOUT_MS = 1000;

/**
 * The payload of a generated SDK call. The client returns
 * `{ data, error, request, response }`, but a thin or hand-rolled client — and
 * a future SDK major — may hand back the value itself; accepting both keeps a
 * client change from silently muting speech.
 */
function payloadOf(result: unknown): unknown {
  if (result !== null && typeof result === "object" && "data" in result) {
    return (result as { data: unknown }).data;
  }
  return result;
}

/**
 * Whether this session is a subagent's. Fail-closed on purpose: the caller
 * treats a session it cannot resolve as one not to post, because speaking a
 * subagent's answer into its parent's cell is worse than missing one answer.
 */
async function isChildSession(client: OpencodeClientLike, sessionID: string): Promise<boolean> {
  const info = payloadOf(await client.session.get({ path: { id: sessionID } })) as
    | { parentID?: unknown }
    | undefined;
  return typeof info?.parentID === "string" && info.parentID !== "";
}

/**
 * The prose of the session's last assistant message, or `""` when it has none.
 *
 * Only `type: "text"` parts count. A message also carries reasoning, tool calls
 * and their results, step markers and patches — none of which is something to
 * say out loud, and all of which routinely sit *after* the prose, so position
 * within the message cannot select the answer.
 *
 * Strictly the **last** assistant message, with no fallback to an earlier one:
 * a turn that ended without prose has nothing to say, and the answer above it
 * belongs to a turn the listener has already heard. A stale answer sounds
 * exactly like a fresh one.
 */
function lastAnswer(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { info?: { role?: unknown }; parts?: unknown } | undefined;
    if (message?.info?.role !== "assistant") continue;
    if (!Array.isArray(message.parts)) return "";
    return message.parts
      .filter(
        (part): part is { text: string } =>
          (part as { type?: unknown })?.type === "text" &&
          typeof (part as { text?: unknown })?.text === "string",
      )
      .map((part) => part.text)
      .join("\n\n")
      .trim();
  }
  return "";
}

async function post(sessionId: string, text: string): Promise<void> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Present only when the panel is token-protected; the value is never logged.
  if (process.env.PANEL_TOKEN) {
    headers.authorization = `Bearer ${process.env.PANEL_TOKEN}`;
  }

  await fetch(`${panelUrl()}/api/speech/utterance`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId, text }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export const PavilioSpeechPlugin: Plugin = async ({ client }) => ({
  event: async ({ event }) => {
    try {
      // Every other event — a part streaming in, a status change, a permission
      // prompt — is somebody else's business, and is dropped before anything is
      // asked of the server.
      if (event?.type !== "session.idle") return;
      const sessionID = (event.properties as { sessionID?: unknown })?.sessionID;
      if (typeof sessionID !== "string" || sessionID === "") return;

      // No cell to attribute the answer to: do nothing, and do not even ask the
      // server — an opencode started outside the panel must cost nothing.
      const cellId = process.env.PAVILIO_TERMINAL_ID;
      if (!cellId) return;

      const opencode = client as unknown as OpencodeClientLike;
      if (await isChildSession(opencode, sessionID)) return;

      const messages = payloadOf(await opencode.session.messages({ path: { id: sessionID } }));
      const text = lastAnswer(messages);
      if (text === "") return;

      await post(cellId, text);
    } catch {
      // Every failure is a non-event — a client that threw, a panel that is not
      // running, a POST that timed out. This handler runs inside the agent's
      // own process, so the one thing it must never do is let any of that reach
      // the turn.
    }
  },
});

export default PavilioSpeechPlugin;
