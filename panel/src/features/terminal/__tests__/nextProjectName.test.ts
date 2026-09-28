/**
 * `nextProjectName` — the counter that names every terminal the panel creates.
 *
 * It is the other half of the rule `sessionLabel.test.ts` pins. Both ask the
 * same question of a name — is this still the shape `<project>-<n>` that the
 * panel generates? — through the same `escapeForRegExp`, and they must never
 * answer it differently: the counter decides which suffixes are taken, and
 * `isAutoName` decides whether a title may speak for the tile. A name the
 * counter skips but the label treats as generated (or the reverse) is the two
 * halves disagreeing about what "auto-named" means.
 *
 * So the cases here are deliberately the counter's mirror of that file: the
 * numbering itself, the project scoping the numbering happens inside, the
 * lookalikes that must not be counted, and a project whose name carries regex
 * metacharacters — `.` and `+` are legal in a directory name, and a raw
 * interpolation would let `axb-1` consume the number `a.b-1` deserves.
 */
import { describe, expect, it } from "vitest";

import { nextProjectName, type SessionMeta } from "../useTerminalSessions";

function session(
  patch: Partial<SessionMeta> & Pick<SessionMeta, "project" | "name">,
): SessionMeta {
  return {
    id: `cell-${patch.name}`,
    cwd: `/srv/git/${patch.project}`,
    pid: 4242,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("nextProjectName", () => {
  it("returns the first suffix when the project has no sessions", () => {
    expect(nextProjectName("pavilio", [])).toBe("pavilio-1");
  });

  it("counts the suffixes already in use and returns the next one", () => {
    const existing = [
      session({ project: "pavilio", name: "pavilio-1" }),
      session({ project: "pavilio", name: "pavilio-2" }),
    ];

    expect(nextProjectName("pavilio", existing)).toBe("pavilio-3");
  });

  it("fills the lowest free suffix rather than appending past the highest", () => {
    // Closing the middle terminal of three frees its number; the next create
    // takes it back. This is what makes the counter a set of used numbers
    // rather than a running maximum.
    const existing = [
      session({ project: "pavilio", name: "pavilio-1" }),
      session({ project: "pavilio", name: "pavilio-3" }),
    ];

    expect(nextProjectName("pavilio", existing)).toBe("pavilio-2");
  });

  it("ignores sessions belonging to a different project", () => {
    // The session list the hook holds is not always one project's: the
    // cross-project surfaces poll every session there is, so the project
    // filter is what keeps one project's numbering out of another's.
    const existing = [
      session({ project: "motyl", name: "motyl-1" }),
      session({ project: "motyl", name: "motyl-2" }),
    ];

    expect(nextProjectName("pavilio", existing)).toBe("pavilio-1");
  });

  it("scopes the numbering to the project even when the names collide", () => {
    // A renamed session in another project can carry this project's generated
    // shape verbatim. It is still not one of this project's terminals, so it
    // must not consume a number here.
    const existing = [session({ project: "motyl", name: "pavilio-1" })];

    expect(nextProjectName("pavilio", existing)).toBe("pavilio-1");
  });

  it("does not count names that only look like the generated shape", () => {
    // Each of these is a name a human could have typed, and none of them is
    // `<project>-<n>`: one continues past the number, one has no number at
    // all, and one is the bare prefix. Counting any of them would skip a free
    // suffix — and each corresponds to one part of the anchored `\d+` pattern
    // that `isAutoName` shares.
    const existing = [
      session({ project: "pavilio", name: "pavilio-1-old" }),
      session({ project: "pavilio", name: "pavilio-x" }),
      session({ project: "pavilio", name: "pavilio-" }),
      session({ project: "pavilio", name: "old-pavilio-1" }),
    ];

    expect(nextProjectName("pavilio", existing)).toBe("pavilio-1");
  });

  it("matches a project with regex metacharacters literally", () => {
    // A project name is a directory name, so `.` is legal in one. Interpolated
    // raw into the counter's regex it becomes "any character", and the two
    // assertions below are the two ways that goes wrong: a real `a.b-1` must
    // still be counted, and the unrelated `axb-1` must not be.
    expect(
      nextProjectName("a.b", [session({ project: "a.b", name: "a.b-1" })]),
    ).toBe("a.b-2");

    expect(
      nextProjectName("a.b", [session({ project: "a.b", name: "axb-1" })]),
    ).toBe("a.b-1");
  });
});
