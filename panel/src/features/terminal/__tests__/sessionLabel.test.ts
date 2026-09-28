/**
 * `sessionLabel` — the one rule every wide surface asks before it renders a
 * session's caption.
 *
 * A name is an IDENTIFIER: it is what the rename editor edits, what the
 * identity file stores, and what the default-name counter counts. A title is
 * volatile display state the process inside the PTY publishes about itself.
 * The precedence between them is derived from the name's SHAPE rather than
 * from a "was renamed" flag, because `POST /api/terminal/sessions` cannot
 * report one honestly: `createTerminalSession` sends `opts.name ||
 * nextProjectName(...)`, so the server receives a name on every create and has
 * no way to tell a typed one from a computed one.
 *
 * So the question this file pins is only ever: does the name still look like
 * the one the panel generated? If it does, the process may speak for the tile;
 * the moment a human has chosen a name, that choice outranks anything the
 * process publishes — including a title that arrives later.
 */
import { describe, expect, it } from "vitest";

import {
  isAutoName,
  sessionLabel,
  type SessionMeta,
} from "../useTerminalSessions";

function session(patch: Partial<SessionMeta> & Pick<SessionMeta, "project" | "name">): SessionMeta {
  return {
    id: "cell-a",
    cwd: `/srv/git/${patch.project}`,
    pid: 4242,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("sessionLabel", () => {
  it("an auto-named session with a title is labelled by its title", () => {
    const s = session({
      project: "pavilio",
      name: "pavilio-1",
      title: "Pavilio crash after changes",
    });

    expect(isAutoName(s)).toBe(true);
    expect(sessionLabel(s)).toBe("Pavilio crash after changes");
  });

  it("an auto-named session with no title is labelled by its name", () => {
    // The steady state of a fresh terminal: nothing inside it has said what it
    // is doing yet, so the generated name is all there is to show.
    const s = session({ project: "pavilio", name: "pavilio-1" });

    expect(sessionLabel(s)).toBe("pavilio-1");
  });

  it("a renamed session is labelled by its name even with a title", () => {
    const s = session({
      project: "pavilio",
      name: "deploy",
      title: "Pavilio crash after changes",
    });

    expect(isAutoName(s)).toBe(false);
    expect(sessionLabel(s)).toBe("deploy");
  });

  it("a later title does not override a chosen name", () => {
    // The ordering case: the rename happened first, and the process publishes
    // afterwards. A chosen name is not a default waiting to be improved on.
    const renamed = session({ project: "pavilio", name: "deploy" });
    expect(sessionLabel(renamed)).toBe("deploy");

    const withLaterTitle = { ...renamed, title: "Running the release script" };
    expect(sessionLabel(withLaterTitle)).toBe("deploy");
  });

  /**
   * The ACCEPTED edge case of deriving "manual" from the name's shape, asserted
   * here so the trade-off lives in a test rather than only in the design prose:
   * a session renamed by hand to exactly the generated shape re-enters the
   * auto-named set, and its title starts showing again. The same regex is
   * already the counter's test in `nextProjectName`, where a renamed session
   * dropping out of the numbering is established behaviour — so this is one
   * rule with one edge, not a new one.
   */
  it("renaming back to the generated shape restores the title", () => {
    const s = session({
      project: "pavilio",
      name: "pavilio-9",
      title: "Pavilio crash after changes",
    });

    expect(isAutoName(s)).toBe(true);
    expect(sessionLabel(s)).toBe("Pavilio crash after changes");
  });

  /**
   * A project name is a directory name, and `.` is legal in one. Interpolated
   * raw, `a.b` would match `axb-1` and a tile the user had deliberately named
   * would start showing a title again.
   */
  it("a project name with regex metacharacters is matched literally", () => {
    expect(isAutoName(session({ project: "a.b", name: "a.b-1" }))).toBe(true);
    expect(isAutoName(session({ project: "a.b", name: "axb-1" }))).toBe(false);
  });

  /**
   * The generated shape is `<project>-<n>` with a REAL number, anchored at both
   * ends. Each of the three cases below pins one part of that shape, because
   * each part is individually load-bearing and individually easy to lose: a
   * bare `<project>-` is not a generated name, a name that merely ENDS in the
   * shape is not one either, and neither is one that merely STARTS with it. The
   * last of the three is the lookalike `panel/server/lib/terminal-identity.ts`
   * names in its own doc comment, so this encodes a rule the codebase states.
   */
  it("a bare project prefix with no number is not a generated name", () => {
    expect(isAutoName(session({ project: "pavilio", name: "pavilio-" }))).toBe(
      false,
    );
  });

  it("a name that only ends in the generated shape is not a generated name", () => {
    expect(
      isAutoName(session({ project: "pavilio", name: "old-pavilio-1" })),
    ).toBe(false);
  });

  it("a name that only starts with the generated shape is not a generated name", () => {
    expect(
      isAutoName(session({ project: "pavilio", name: "pavilio-1-old" })),
    ).toBe(false);
  });

  /**
   * `sessionLabel` reads `session.title ?? session.name`, so an EMPTY title
   * would render as an empty caption. That it cannot happen is a SERVER
   * guarantee, not a client one: clearing a title is `delete session.title` in
   * `panel/server/lib/terminal-manager.ts` — the field goes ABSENT, never to
   * `""` — and a server test pins that, naming this very `??`.
   *
   * This test documents that coupling from the client side rather than
   * endorsing an empty label. It asserts today's behaviour so that loosening
   * the operator (to `||`, say) becomes a deliberate act with a failing test
   * attached, instead of a silent change to what the client would do if the
   * server ever did start sending `""`.
   */
  it("an empty title is the server's cleared signal, which never reaches the client", () => {
    const s = session({ project: "pavilio", name: "pavilio-1", title: "" });

    expect(isAutoName(s)).toBe(true);
    expect(sessionLabel(s)).toBe("");
  });
});
