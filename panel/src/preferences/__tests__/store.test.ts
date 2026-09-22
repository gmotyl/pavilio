import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bool, json, num, oneOf, str } from "../codecs";
import { definePreference } from "../types";
import {
  PREFERENCE_PATCH_DEBOUNCE_MS,
  __resetPreferenceStoreForTests,
  clearPreference,
  readPreference,
  subscribePreference,
  writePreference,
} from "../store";

/**
 * The store's own behavior, with no React in the picture: the read fallbacks,
 * the two browser tiers, the write interlock and the PATCH debounce.
 * `usePreference.test.tsx` covers the rendering half.
 *
 * Every fixture below is declared here rather than pulled from
 * `declarations.ts`: these tests pin the *store*, and a default changing in the
 * registry must not turn one of them red.
 */

type PrefGlobals = { __PAVILIO_PREFS__?: Record<string, unknown> };
const globals = globalThis as unknown as PrefGlobals;

const portableFlag = definePreference({
  key: "test.flag",
  scope: "global",
  default: true,
  codec: bool,
  portable: true,
});

const portableWidth = definePreference({
  key: "test.width",
  scope: "global",
  default: 240,
  codec: num,
  portable: true,
});

const portableSide = definePreference({
  key: "test.side",
  scope: "global",
  default: "left" as "left" | "right",
  codec: oneOf(["left", "right"] as const),
  portable: true,
});

const portableQuery = definePreference({
  key: "test.query",
  scope: "global",
  default: "",
  codec: str,
  portable: true,
});

const portableSort = definePreference<{ by: string; dir: string }>({
  key: "test.sort",
  scope: "global",
  default: { by: "date", dir: "desc" },
  codec: json<{ by: string; dir: string }>(),
  portable: true,
});

/**
 * A portable declaration whose codec speaks JSON but whose payload can be a
 * bare string. Nothing in the registry has this shape today — `terminal.focus`
 * and the three `nav.*` do, and they are non-portable — but flipping any of
 * them portable must not silently lose data.
 */
const portableNote = definePreference<string | null>({
  key: "test.note",
  scope: "global",
  default: null,
  codec: json<string | null>(),
  portable: true,
});

const localFlag = definePreference({
  key: "test.localFlag",
  scope: "global",
  default: false,
  codec: bool,
  portable: false,
});

const sessionPath = definePreference<string | null>({
  key: "test.lastPath",
  scope: "global",
  default: null,
  codec: json<string | null>(),
  portable: false,
  browserStore: "session",
});

/** A fetch spy that never resolves unless a test makes it. */
function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  globals.__PAVILIO_PREFS__ = { version: 1 };
});

afterEach(() => {
  delete globals.__PAVILIO_PREFS__;
  __resetPreferenceStoreForTests();
  vi.unstubAllGlobals();
});

describe("reading", () => {
  it("a portable value is read from the injected global", () => {
    globals.__PAVILIO_PREFS__ = { version: 1, "test.flag": false, "test.width": 320 };

    expect(readPreference(portableFlag)).toBe(false);
    expect(readPreference(portableWidth)).toBe(320);
  });

  it("an absent global falls back to the declared default", () => {
    delete globals.__PAVILIO_PREFS__;

    expect(() => readPreference(portableFlag)).not.toThrow();
    expect(readPreference(portableFlag)).toBe(true);
    expect(readPreference(portableWidth)).toBe(240);
    expect(readPreference(portableSort)).toEqual({ by: "date", dir: "desc" });
  });

  it("a value failing its codec falls back to the declared default", () => {
    globals.__PAVILIO_PREFS__ = {
      version: 1,
      "test.width": "not a number",
      "test.side": "sideways",
    };

    expect(readPreference(portableWidth)).toBe(240);
    expect(readPreference(portableSide)).toBe("left");
  });

  it("a boolean preference holding an accumulator object reads as its default", () => {
    // The shape `pavilio.time.form.<project>.resetAutoOnSave` was found in: a
    // busy-accumulator object under a key whose declaration says boolean.
    globals.__PAVILIO_PREFS__ = {
      version: 1,
      "test.flag": { running: false, elapsedMs: 1234, startedAt: null },
    };

    expect(readPreference(portableFlag)).toBe(true);
  });

  it("a non-portable value is read from localStorage without a network call", () => {
    const fetchMock = stubFetch();
    const getItem = vi.spyOn(localStorage, "getItem");
    localStorage.setItem("test.localFlag", "true");

    expect(readPreference(localFlag)).toBe(true);
    expect(getItem).toHaveBeenCalledWith("test.localFlag");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a session-backed preference never touches localStorage", () => {
    const localGet = vi.spyOn(localStorage, "getItem");
    const localSet = vi.spyOn(localStorage, "setItem");
    const sessionGet = vi.spyOn(sessionStorage, "getItem");
    const sessionSet = vi.spyOn(sessionStorage, "setItem");

    writePreference(sessionPath, "/notes/today.md");
    expect(readPreference(sessionPath)).toBe("/notes/today.md");

    expect(sessionSet).toHaveBeenCalledWith("test.lastPath", '"/notes/today.md"');
    expect(sessionGet).toHaveBeenCalledWith("test.lastPath");
    expect(localSet).not.toHaveBeenCalled();
    expect(localGet).not.toHaveBeenCalled();
  });

  it("a throwing localStorage falls back to the declared default", () => {
    // Private-mode Safari throws on access rather than returning null. Spy on
    // the instance, not `Storage.prototype` — test-setup.ts replaces the
    // instance outright, so a prototype spy is never reached.
    const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    expect(readPreference(localFlag)).toBe(false);
    expect(getItem).toHaveBeenCalledWith("test.localFlag");
  });
});

describe("clearing", () => {
  it("clearPreference restores the declared default", async () => {
    const fetchMock = stubFetch();

    writePreference(sessionPath, "/notes/today.md");
    writePreference(portableWidth, 320);
    expect(readPreference(sessionPath)).toBe("/notes/today.md");
    expect(readPreference(portableWidth)).toBe(320);

    clearPreference(sessionPath);
    clearPreference(portableWidth);

    expect(readPreference(sessionPath)).toBeNull();
    expect(readPreference(portableWidth)).toBe(240);

    // A cleared portable key is a null in the patch — the server's delete.
    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ "test.width": null });
  });
});

describe("the session tier under a browser that refuses storage", () => {
  /**
   * `lastPath.ts` no longer carries its own try/catch: the protection was
   * relocated here, into `readPreference`/`writePreference`. These are the
   * tests that actually exercise it.
   *
   * The spy goes on the `sessionStorage` INSTANCE, never on
   * `Storage.prototype`: `test-setup.ts` installs a plain object literal as
   * `sessionStorage`, which does not inherit from `Storage.prototype`, so a
   * prototype spy is never reached and the test passes vacuously. Each case
   * asserts the spy WAS called, so that trap cannot come back unnoticed.
   */
  it("a write that throws is swallowed and stores nothing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = vi
      .spyOn(globalThis.sessionStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });

    expect(() => writePreference(sessionPath, "/project/pavilio/notes")).not.toThrow();

    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
    expect(globalThis.sessionStorage.getItem(sessionPath.key)).toBeNull();
  });

  it("a read that throws answers the declared default", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const getItem = vi
      .spyOn(globalThis.sessionStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("disabled");
      });

    expect(readPreference(sessionPath)).toBeNull();

    expect(getItem).toHaveBeenCalledTimes(1);
    getItem.mockRestore();
  });

  it("a clear that throws is swallowed", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const removeItem = vi
      .spyOn(globalThis.sessionStorage, "removeItem")
      .mockImplementation(() => {
        throw new Error("disabled");
      });

    expect(() => clearPreference(sessionPath)).not.toThrow();

    expect(removeItem).toHaveBeenCalledTimes(1);
    removeItem.mockRestore();
  });
});

describe("the machine-local tier says something when it cannot store", () => {
  /**
   * Task 8 removed seven `console.warn` diagnostics from the terminal hooks
   * and the store replaced none, so a private-mode browser dropped every
   * machine-local write in total silence. These pin the one replacement.
   */
  it("a write that throws warns once, naming the key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    writePreference(localFlag, true);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(localFlag.key);
    expect(String(warn.mock.calls[0][0])).toContain("browser storage is unavailable");
  });

  it("a read that throws warns too", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis.localStorage, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });

    expect(readPreference(localFlag)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns once per tab, not once per call", () => {
    // `readPreference` runs on every mount of every consumer; an un-latched
    // warning in a browser that refuses storage would be a flood.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis.localStorage, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    vi.spyOn(globalThis.localStorage, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });

    for (let i = 0; i < 20; i += 1) {
      readPreference(localFlag);
      writePreference(localFlag, true);
    }

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a healthy store says nothing at all", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    writePreference(localFlag, true);
    expect(readPreference(localFlag)).toBe(true);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("writing", () => {
  it("a write is visible to the next read before the network resolves", () => {
    // A fetch that never settles: whatever the next read returns cannot have
    // come from the server.
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    writePreference(portableWidth, 512);
    writePreference(portableSort, { by: "name", dir: "asc" });

    expect(readPreference(portableWidth)).toBe(512);
    expect(readPreference(portableSort)).toEqual({ by: "name", dir: "asc" });
  });

  it("writes inside the debounce window collapse into one PATCH", async () => {
    // Real timers on purpose. Under fake timers the debounce can never fire
    // unless a test advances them, so "not sent yet" holds for *any* debounce
    // length and the assertion below proves nothing.
    const fetchMock = stubFetch();

    writePreference(portableFlag, false);
    writePreference(portableWidth, 320);
    writePreference(portableSide, "right");

    // One macrotask: long enough for a zero-length debounce to have fired,
    // far short of the real window.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/preferences");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      "test.flag": false,
      "test.width": 320,
      "test.side": "right",
    });
  });

  it("a portable write stores the value in its JSON shape, not as text", async () => {
    // The file is hand-readable and hand-seeded: `"shell.leftSidebar.width":
    // 240`, never `"240"`. A string-valued preference stays a string.
    const fetchMock = stubFetch();

    writePreference(portableWidth, 320);
    writePreference(portableSort, { by: "name", dir: "asc" });
    writePreference(portableQuery, "true");

    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      "test.width": 320,
      "test.sort": { by: "name", dir: "asc" },
      "test.query": "true",
    });
    // And it round-trips: a `str` preference holding "true" is still a string.
    expect(readPreference(portableQuery)).toBe("true");
  });

  it("a portable json preference round-trips a bare string", () => {
    // The value shape the document stores has to be decided by the CODEC, not
    // by the declared default. Keying off the default instead loses this
    // exactly: `"hello"` stored unquoted, then `JSON.parse("hello")` throwing
    // on the way back and the read answering `null` — a silent data loss with
    // no warning anywhere.
    stubFetch();

    writePreference(portableNote, "hello");

    expect(readPreference(portableNote)).toBe("hello");
  });

  it("a non-finite number is refused rather than written as text", async () => {
    // `String(NaN)` is not JSON, so the fallback would put the literal text
    // "NaN" into the hand-readable workspace file under a `num` key — where it
    // reads back as the default anyway, having displaced nothing but clarity.
    const fetchMock = stubFetch();
    globals.__PAVILIO_PREFS__ = { version: 1, "test.width": 320 };

    writePreference(portableWidth, Number.NaN);
    writePreference(portableWidth, Number.POSITIVE_INFINITY);

    expect(globals.__PAVILIO_PREFS__["test.width"]).toBe(320);
    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a session with no injected global never PATCHes", async () => {
    // The blocking script 401'd, so nothing is known about the stored file.
    // Writing defaults over it would be data loss, not degradation.
    delete globals.__PAVILIO_PREFS__;
    const fetchMock = stubFetch();

    writePreference(portableFlag, false);
    writePreference(portableWidth, 320);
    clearPreference(portableSide);

    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));

    expect(fetchMock).not.toHaveBeenCalled();
    // And the read still answers with the declared default, not the write.
    expect(readPreference(portableFlag)).toBe(true);
  });

  it("an empty document is a document — writes work normally", async () => {
    // `{ version: 1 }` is a legitimately empty file, not an absent global.
    globals.__PAVILIO_PREFS__ = { version: 1 };
    const fetchMock = stubFetch();

    writePreference(portableFlag, false);
    expect(readPreference(portableFlag)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("writing the value already stored is a no-op — no PATCH, no notify", async () => {
    // The migration turned every write into a network PATCH, so a caller that
    // re-asserts what is already there (a mount effect, a controlled input
    // echoing its own value) now costs a round trip and a file write. The
    // comparison is on the STORED representation, so a structurally equal
    // object does not count as a change either.
    const fetchMock = stubFetch();
    globals.__PAVILIO_PREFS__ = {
      version: 1,
      "test.width": 320,
      "test.sort": { by: "name", dir: "asc" },
    };
    const heard: string[] = [];
    subscribePreference(portableWidth, undefined, () => heard.push("width"));
    subscribePreference(portableSort, undefined, () => heard.push("sort"));

    writePreference(portableWidth, 320);
    writePreference(portableSort, { by: "name", dir: "asc" });

    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(heard).toEqual([]);
  });

  it("a genuine change still PATCHes exactly once", async () => {
    const fetchMock = stubFetch();
    globals.__PAVILIO_PREFS__ = { version: 1, "test.width": 320 };

    writePreference(portableWidth, 320);
    writePreference(portableWidth, 512);

    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ "test.width": 512 });
  });

  it("re-writing the same value after clearPreference still PATCHes", async () => {
    // The unchanged-value skip compares against what the DOCUMENT holds, not
    // against the declared default: a cleared key is absent, so putting the
    // same value back is a real change the server has to hear about.
    const fetchMock = stubFetch();
    globals.__PAVILIO_PREFS__ = { version: 1, "test.width": 320 };

    clearPreference(portableWidth);
    writePreference(portableWidth, 320);

    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      "test.width": 320,
    });
  });

  it("a write of a DIFFERENT key flushes a failed PATCH's stranded retry", async () => {
    // A failed PATCH puts its keys back in `pendingKeys` but arms NO timer, so
    // the debt sits there until something else calls `queuePatch`. A write of
    // another key is that something: it arms the timer, and the flush re-reads
    // the document, so the stranded key rides out alongside it.
    //
    // This is the WEAKER of the two claims, and naming it honestly matters: the
    // test used to be called "the unchanged-value skip does not swallow a
    // failed PATCH's retry", which is not what it proves — it passes because of
    // the `portableSide` write two lines down. The narrower truth is pinned by
    // the test below.
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    writePreference(portableWidth, 512);
    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same value again: skipped as a write, and it arms nothing. The write of
    // `test.side` is what actually re-arms the timer.
    writePreference(portableWidth, 512);
    writePreference(portableSide, "right");
    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({
      "test.width": 512,
      "test.side": "right",
    });
  });

  it("identical re-writes after a failed PATCH strand the retry; a changed value rescues it", async () => {
    // The behaviour the store's comment used to deny. `writePreference`'s
    // unchanged-value skip returns BEFORE `queuePatch`, and `flushPatch`'s
    // `.catch` arms no timer of its own — so nothing at all is scheduled and
    // the dirty key waits. Six identical re-writes leave the fetch count at
    // one; a CHANGED value of the same key is what finally arms a timer.
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    writePreference(portableWidth, 512);
    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 6; i += 1) writePreference(portableWidth, 512);
    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));

    // Still stranded — no second request at all.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A changed value of the SAME key queues, and takes the debt with it.
    writePreference(portableWidth, 513);
    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({
      "test.width": 513,
    });
  });

  it("a non-portable write of the value already stored touches no storage", () => {
    const setItem = vi.spyOn(globalThis.localStorage, "setItem");
    writePreference(localFlag, true);
    expect(setItem).toHaveBeenCalledTimes(1);

    setItem.mockClear();
    writePreference(localFlag, true);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("a failed PATCH keeps the value the user chose", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    writePreference(portableWidth, 512);
    await new Promise((resolve) => setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS + 60));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readPreference(portableWidth)).toBe(512);
    expect(warn).toHaveBeenCalled();
  });
});
