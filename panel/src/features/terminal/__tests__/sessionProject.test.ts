/**
 * `projectOfSession` — the lookup that turns a cell's session id into the
 * preference scope its answer pane and composer keep their heights under.
 *
 * Every other suite that touches those heights seeds the session store first,
 * because it is testing what a RESOLVED project does. This file is the other
 * half: what the function answers when the list cannot name a project, which is
 * the branch that decides whether a drag is persisted or dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectOfSession } from "../sessionProject";
import { refreshSessions } from "../sessionStore";
import type { SessionMeta } from "../useTerminalSessions";

function session(id: string, project: string): SessionMeta {
  return {
    id,
    name: id,
    project,
    cwd: `/srv/git/${project}`,
    pid: 4242,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Puts a session list in the tab's store the way a load does — through the
 * store's own fetch-and-publish, so this is the path the list really arrives
 * by rather than a hand-set module field. `test-setup.ts` clears the store
 * between tests, so every test here starts cold unless it says otherwise.
 */
async function seedSessions(sessions: unknown[]): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(sessions),
        }) as unknown as Promise<Response>,
    ),
  );
  await refreshSessions();
}

beforeEach(() => {
  // The blank-project cases below reach the store through a server that sent
  // one, and the warning that path logs is not this file's subject.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  // A stub left behind would answer the next file's session load.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("projectOfSession", () => {
  it("names the project of a session the list carries", async () => {
    await seedSessions([session("cell-a", "alpha"), session("cell-b", "beta")]);

    expect(projectOfSession("cell-a")).toBe("alpha");
    expect(projectOfSession("cell-b")).toBe("beta");
  });

  /**
   * A DECISION, not an implementation detail: a cell whose session the tab's
   * list does not carry has no scope, and the answer is the absence of one.
   *
   * The alternative — a placeholder name like `__unknown__` — is a key, and a
   * key can be written to: every unnameable cell in the tab would share one
   * number, stored under something nothing reads back once the project does
   * resolve. `null` is what `useScopedPreference` needs to hear in order to
   * read the declared default and persist nothing.
   *
   * This is reachable in the panel, not only here. `QuickTerminalModal`
   * fetches its own session list and mounts a full cell off it without ever
   * touching `sessionStore`; and before the store's first successful load — or
   * for the 8s after any failed one — its list is empty for every cell on
   * screen.
   */
  it("answers null for a session the list does not carry", async () => {
    await seedSessions([session("cell-a", "alpha")]);

    expect(projectOfSession("cell-from-the-quick-modal")).toBeNull();
  });

  it("answers null while the store is still cold", () => {
    // Nothing seeded: this is the window before the first load resolves, and
    // the state the store returns to after a failed one.
    expect(projectOfSession("cell-a")).toBeNull();
  });

  /**
   * A blank project is a MISSING project, not a project.
   *
   * `POST /api/terminal/sessions` destructures `project = ""` out of the
   * request body and stores what it got, so this is a shape the server hands
   * out. Keying on it would put every projectless session in the tab on one
   * `speech.answerPane.height@` and let the last drag win.
   */
  it("answers null for a session whose project is blank", async () => {
    await seedSessions([session("cell-a", "")]);

    expect(projectOfSession("cell-a")).toBeNull();
  });

  it("answers null for a session whose project is only whitespace", async () => {
    await seedSessions([session("cell-a", "   ")]);

    expect(projectOfSession("cell-a")).toBeNull();
  });

  /**
   * And the same judgement made the other way: a project with space around it
   * IS a project, and the scope is the trimmed name — so `"alpha"` and
   * `" alpha "` are one scope rather than two neighbouring keys whose heights
   * drift apart.
   */
  it("trims the name it answers with", async () => {
    await seedSessions([session("cell-a", "  alpha  ")]);

    expect(projectOfSession("cell-a")).toBe("alpha");
  });

  /**
   * The field is typed `string`, and the server validates nothing — a session
   * object with no `project` at all ships straight through `res.json()` into
   * the store. A bare `.trim()` here would be a TypeError during the pane's
   * render; the shared predicate makes it the same `null` as a blank.
   */
  it("answers null for a session with no project field at all", async () => {
    await seedSessions([
      { id: "cell-a", name: "cell-a", cwd: "/tmp", pid: 1, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    expect(projectOfSession("cell-a")).toBeNull();
  });
});
