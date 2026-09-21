import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bool } from "../codecs";
import { ALL_PREFERENCES } from "../declarations";
import {
  PREFERENCE_PATCH_DEBOUNCE_MS,
  __resetPreferenceStoreForTests,
  readPreference,
  writePreference,
} from "../store";
import { definePreference, storageKey, type PreferenceDef } from "../types";

/**
 * The one test that must outlive any refactor of the store: a value naming a
 * LIVE SESSION must never reach `.pavilio/preferences.json`.
 *
 * That file is committed to a notes repo and carried to another machine, where
 * a session id names a session that does not exist — the focused terminal, the
 * session order, the grid's tiling, and the armed speech cell all have that
 * shape. The mirror-image failure is just as real: a portable value written
 * into `localStorage` instead never travels at all, and looks fine on the
 * machine that wrote it.
 *
 * WHY IT IS DRIVEN FROM `ALL_PREFERENCES`. A hand-written list of session-keyed
 * declarations guards only the ones someone remembered to add, and the entry
 * that gets forgotten is the one added under time pressure — exactly the case
 * this exists for. Every declaration in the registry is written through the
 * store here, and `FIXTURES` is asserted to cover the registry exactly, so a
 * declaration added later is covered automatically or turns this red on the
 * commit that adds it.
 *
 * WHY THE COUNTS ARE ASSERTED. A registry-driven loop that iterates nothing
 * passes. So does one over a registry that has accidentally become all one
 * tier. The count, and the floor on each of the three tiers, are what stop
 * this from being a test that can only pass.
 */

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

/** The document as `GET /api/preferences.js` injects it when nothing is stored. */
const BOOT_DOC: Record<string, unknown> = { version: 1 };

interface Fixture {
  /** A representative value of this declaration's own type. */
  value: unknown;
  /** Required for every `project`- or `repo`-scoped declaration. */
  scopeArg?: string;
}

/**
 * One representative value per declaration, keyed by the declaration's key.
 *
 * Written by hand, and deliberately so: the point is to push a REAL value of
 * each declaration's own shape through its own codec. Deriving the value from
 * the declared default would write the default back and could pass against a
 * store that does nothing at all.
 *
 * The scope argument matters as much as the value. `storageKey` throws on a
 * missing one, and a declaration whose write threw is a declaration this guard
 * never checked — which is why `FIXTURES` is asserted to cover the registry
 * exactly and why every write below is expected to land.
 */
const FIXTURES: Record<string, Fixture> = {
  // ── Shell ────────────────────────────────────────────────────────────────
  "shell.leftSidebar.expanded": { value: false },
  "shell.rightSidebar.expanded": { value: false },
  "shell.rightSidebar.section.expanded": { value: false, scopeArg: "skills" },
  "shell.project.expanded": { value: true, scopeArg: "pavilio" },
  "view.wide": { value: false, scopeArg: "viewer" },

  // ── File list and project lists ──────────────────────────────────────────
  "fileList.sort": { value: { sortKey: "name", sortDir: "asc" } },
  "fileList.sidebarCollapsed": { value: true },
  "projects.favorites": { value: ["pavilio", "vector"] },
  "repos.searchScope": { value: "commits" },
  "search.includeArchived": { value: false },

  // ── Git ──────────────────────────────────────────────────────────────────
  "git.viewMode": { value: "tree" },
  "git.commitsOpen": { value: false, scopeArg: "~/git/prv/pavilio" },
  "git.branchDiff.base": { value: "main", scopeArg: "~/git/prv/pavilio" },
  "git.branchDiff.open": { value: false, scopeArg: "~/git/prv/pavilio" },
  "git.worktree.expanded": { value: true, scopeArg: "~/git/prv/pavilio-prefs" },

  // ── Terminal ─────────────────────────────────────────────────────────────
  "terminal.drawer.open": { value: true },
  "terminal.drawer.side": { value: "right" },
  "terminal.drawer.width": { value: 520 },
  "terminal.maximized": { value: true, scopeArg: "pavilio" },

  // ── Machine local: values naming a live session ──────────────────────────
  "terminal.focus": { value: "sess-7f3a91c4", scopeArg: "pavilio" },
  "terminal.order": { value: ["sess-7f3a91c4", "sess-0b2e55d1"], scopeArg: "pavilio" },
  "terminal.grid": {
    value: [{ sessionId: "sess-7f3a91c4", x: 0, y: 0, w: 48, h: 48 }],
    scopeArg: "__all__",
  },

  // ── Speech ───────────────────────────────────────────────────────────────
  "speech.voice": { value: "en-GB-RyanNeural" },
  "speech.answerPane.autoOpen": { value: true },
  "speech.armedCell": { value: "sess-0b2e55d1" },

  // ── Navigation memory (the session tier) ─────────────────────────────────
  "nav.lastPath": { value: "/project/pavilio/notes?note=a.md", scopeArg: "pavilio" },
  "nav.lastFile": { value: "/abs/plan.md", scopeArg: "pavilio:plans" },
  "nav.lastReposQuery": { value: "preferences", scopeArg: "pavilio" },

  // ── Time ─────────────────────────────────────────────────────────────────
  "time.report": {
    value: { period: "last-week", format: "markdown", detail: "daily" },
    scopeArg: "pavilio",
  },
  "time.form.resetAutoOnSave": { value: true, scopeArg: "pavilio" },
};

/**
 * The fixture for `def`, or a throw naming the declaration. Never a skip: a
 * declaration quietly passed over is precisely the hole this guard exists to
 * close, so the absence of a fixture has to be louder than a green.
 */
function fixtureFor(def: PreferenceDef<unknown>): Fixture {
  const fixture = FIXTURES[def.key];
  if (!fixture) throw new Error(`no fixture for declaration "${def.key}"`);
  return fixture;
}

/** The browser store a non-portable declaration is supposed to use. */
function expectedStore(def: PreferenceDef<unknown>): Storage {
  return def.browserStore === "session" ? sessionStorage : localStorage;
}

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * A fresh world: an empty-but-present injected document, both browser stores
 * cleared, no write still waiting on the debounce, and a fetch spy that has
 * seen nothing. Called before every declaration inside the loops, so one
 * declaration's PATCH can never be counted against the next one's.
 */
function resetWorld(): void {
  __resetPreferenceStoreForTests();
  localStorage.clear();
  sessionStorage.clear();
  globals.__PAVILIO_PREFS__ = { ...BOOT_DOC };
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
}

/** Every URL the page asked for since the last reset. */
function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
  vi.useFakeTimers();
  resetWorld();
});

afterEach(() => {
  delete globals.__PAVILIO_PREFS__;
  __resetPreferenceStoreForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

describe("the registry this guard is driven from", () => {
  it("covers every declaration, with a scope argument wherever one is needed", () => {
    const declared = ALL_PREFERENCES.map((def) => def.key).sort();
    const covered = Object.keys(FIXTURES).sort();

    // Both directions: a missing fixture is a declaration that would go
    // unchecked, and a stale one is a declaration that has been renamed or
    // removed while this file went on claiming to cover it.
    expect(covered).toEqual(declared);
    expect(new Set(declared).size).toBe(declared.length);

    // A `project`/`repo` declaration written with no scope argument throws in
    // `storageKey` — and a throw inside a loop reads as "the guard covered it"
    // only if nobody looks. Pin the pairing instead.
    const mismatched = ALL_PREFERENCES.filter((def) => {
      const hasArg = FIXTURES[def.key]?.scopeArg !== undefined;
      return def.scope === "global" ? hasArg : !hasArg;
    });
    expect(mismatched.map((def) => `${def.key} (${def.scope})`)).toEqual([]);
  });

  it("holds both tiers, at the size the portability table describes", () => {
    const portable = ALL_PREFERENCES.filter((def) => def.portable);
    const machineLocal = ALL_PREFERENCES.filter((def) => !def.portable);
    const sessionTier = machineLocal.filter((def) => def.browserStore === "session");

    // A loop over an empty registry asserts nothing, and neither does one over
    // a registry that has become all one tier.
    expect(ALL_PREFERENCES.length).toBe(30);
    expect(portable.length).toBe(23);
    expect(machineLocal.length).toBe(7);
    expect(sessionTier.length).toBe(3);
    // The portable arm of the union forbids `browserStore`; this says the
    // shipped table agrees with it, not merely that it type-checked.
    expect(portable.filter((def) => def.browserStore !== undefined)).toEqual([]);
  });

  it("writes a value each declaration's own codec round-trips", () => {
    // A fixture the codec mangles would still be "written", and the tier
    // assertions below would still pass — while proving nothing about a real
    // value. Every fixture has to survive its own serialize/parse pair.
    const broken = ALL_PREFERENCES.filter((def) => {
      const { value } = fixtureFor(def);
      try {
        return JSON.stringify(def.codec.parse(def.codec.serialize(value))) !== JSON.stringify(value);
      } catch {
        return true;
      }
    });

    expect(broken.map((def) => def.key)).toEqual([]);
  });
});

describe("the machine-local guard", () => {
  it("no non-portable preference ever reaches the server", () => {
    const machineLocal = ALL_PREFERENCES.filter((def) => !def.portable);
    expect(machineLocal.length).toBeGreaterThan(0);

    for (const def of machineLocal) {
      resetWorld();
      const { value, scopeArg } = fixtureFor(def);
      const key = storageKey(def, scopeArg);

      writePreference(def, value, scopeArg);
      // Well past the debounce: a PATCH that merely arrived late would still
      // be a session id on its way to a committed file.
      vi.advanceTimersByTime(PREFERENCE_PATCH_DEBOUNCE_MS * 10);

      // The write LANDED — otherwise "no PATCH was issued" is vacuously true
      // of a write that never happened.
      expect({ key, raw: expectedStore(def).getItem(key) }).toEqual({
        key,
        raw: def.codec.serialize(value),
      });
      expect(readPreference(def, scopeArg)).toEqual(value);

      // Nothing was sent, to `/api/preferences` or anywhere else.
      expect(requestedUrls()).toEqual([]);
      // And the document is byte-for-byte what it booted as: no key added, and
      // none of its existing ones touched.
      expect(globals.__PAVILIO_PREFS__).toEqual(BOOT_DOC);
    }
  });

  it("no portable preference is mirrored into localStorage", () => {
    const portable = ALL_PREFERENCES.filter((def) => def.portable);
    expect(portable.length).toBeGreaterThan(0);

    for (const def of portable) {
      resetWorld();
      const { value, scopeArg } = fixtureFor(def);
      const key = storageKey(def, scopeArg);

      writePreference(def, value, scopeArg);
      vi.advanceTimersByTime(PREFERENCE_PATCH_DEBOUNCE_MS * 10);

      // The document changed, and by exactly this one key.
      expect(Object.keys(globals.__PAVILIO_PREFS__ ?? {}).sort()).toEqual(
        ["version", key].sort(),
      );
      expect(readPreference(def, scopeArg)).toEqual(value);

      // Exactly one PATCH, to the preferences route, carrying exactly that key.
      expect(requestedUrls()).toEqual(["/api/preferences"]);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe("PATCH");
      expect(Object.keys(JSON.parse(String(init.body)) as Record<string, unknown>)).toEqual([key]);

      // Not one byte on this machine. `length`, not a spy: a mirror written
      // under any key at all is still a value that will not travel.
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    }
  });

  it("a session-tier preference reaches sessionStorage and neither localStorage nor the server", () => {
    // The narrower machine-local tier, asserted on its own rather than folded
    // into "non-portable": routing one of these to `localStorage` keeps it off
    // the server — so the test above stays green — while breaking the two
    // clauses panel-shell's spec makes normative, that a second tab keeps its
    // own bookmark and a closed browser starts fresh.
    const sessionTier = ALL_PREFERENCES.filter(
      (def) => !def.portable && def.browserStore === "session",
    );
    expect(sessionTier.length).toBeGreaterThan(0);

    for (const def of sessionTier) {
      resetWorld();
      const { value, scopeArg } = fixtureFor(def);
      const key = storageKey(def, scopeArg);

      writePreference(def, value, scopeArg);
      vi.advanceTimersByTime(PREFERENCE_PATCH_DEBOUNCE_MS * 10);

      expect(sessionStorage.getItem(key)).toBe(def.codec.serialize(value));
      expect(localStorage.length).toBe(0);
      expect(requestedUrls()).toEqual([]);
      expect(globals.__PAVILIO_PREFS__).toEqual(BOOT_DOC);
    }
  });

  it("the values that name a live session issue no PATCH, whatever their flag says", () => {
    // The two loops above trust `portable` to say which tier a declaration is
    // on, so flipping a flag merely moves a declaration from one loop to the
    // other and both stay green — the registry's own `portable.length` count
    // is what catches that, and `declarations.test.ts` pins the tier of every
    // key against a hand-transcribed copy of the portability table.
    //
    // This is the behavioural backstop for the values the whole change exists
    // to protect. They are named by KEY, not read off `portable`, so a flag
    // flipped on any of them fails here with the real symptom — a session id
    // on the wire to a file that gets committed.
    const SESSION_NAMING = [
      "terminal.focus",
      "terminal.order",
      "terminal.grid",
      "speech.armedCell",
      "nav.lastPath",
      "nav.lastFile",
      "nav.lastReposQuery",
    ];

    const found = ALL_PREFERENCES.filter((def) => SESSION_NAMING.includes(def.key));
    // Not a floor: every named key must still be a declaration, or this list
    // has gone stale and is guarding nothing.
    expect(found.map((def) => def.key).sort()).toEqual([...SESSION_NAMING].sort());

    const leaked: string[] = [];
    for (const def of found) {
      resetWorld();
      const { value, scopeArg } = fixtureFor(def);
      writePreference(def, value, scopeArg);
      vi.advanceTimersByTime(PREFERENCE_PATCH_DEBOUNCE_MS * 10);

      const urls = requestedUrls();
      const docKeys = Object.keys(globals.__PAVILIO_PREFS__ ?? {}).filter((k) => k !== "version");
      if (urls.length > 0 || docKeys.length > 0) {
        leaked.push(`${def.key} → ${JSON.stringify({ urls, docKeys })}`);
      }
    }

    expect(leaked).toEqual([]);
  });
});

describe("the type system refuses a declaration with no portability decision", () => {
  /**
   * A COMPILE-TIME assertion, pinned here so it cannot quietly lapse.
   *
   * `@ts-expect-error` is checked by `tsc --noEmit` (vitest strips types and
   * never sees it), and it fails when the error STOPS occurring. So loosening
   * `PreferenceDef` — dropping `portable` to optional, or collapsing the
   * two-arm union that makes `portable: true` forbid `browserStore` — breaks
   * the typecheck on these lines rather than silently widening what the
   * registry will accept.
   */
  it("rejects a missing `portable`, and `browserStore` on the portable arm", () => {
    // @ts-expect-error `portable` is required: a declaration with no portability decision.
    const noDecision = definePreference({
      key: "guard.noPortableField",
      scope: "global",
      default: false,
      codec: bool,
    });

    const portableWithBrowserStore = definePreference({
      key: "guard.portableWithBrowserStore",
      scope: "global",
      default: false,
      codec: bool,
      portable: true,
      // @ts-expect-error the portable arm declares `browserStore?: never`.
      browserStore: "session",
    });

    // The runtime half: whatever the compiler allows, every SHIPPED
    // declaration carries a real boolean decision.
    expect(ALL_PREFERENCES.filter((def) => typeof def.portable !== "boolean")).toEqual([]);
    expect([noDecision.key, portableWithBrowserStore.key]).toHaveLength(2);
  });
});
