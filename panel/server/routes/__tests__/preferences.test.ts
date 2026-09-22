import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

// The route's only side effect beyond the store is the WS fan-out.
const { broadcast } = vi.hoisted(() => ({ broadcast: vi.fn() }));
vi.mock("../../watcher", () => ({ broadcast }));

import preferencesRouter from "../preferences.js";
import {
  flushPreferences,
  getPreferences,
  loadPreferences,
  patchPreferences,
  _resetPreferencesForTests,
} from "../../lib/preferences-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(here, "../..");
const PANEL_DIR = resolve(SERVER_DIR, "..");

/**
 * The panel mounts this router under `/api` (not `/api/preferences`): the
 * script route is `/api/preferences.js`, and express's mount matching only
 * splits on `/`, so a `/api/preferences` prefix would never see it.
 */
function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", preferencesRouter);
  return app;
}

let dir = "";
const target = () => join(dir, "preferences.json");

beforeEach(() => {
  broadcast.mockClear();
  dir = mkdtempSync(join(tmpdir(), "pavilio-prefs-route-"));
  loadPreferences(target());
});

afterEach(() => {
  _resetPreferencesForTests();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

/**
 * Run the served script the way a browser would — as a standalone program with
 * a `window` to assign to — and hand back what it assigned. Evaluating it is
 * the point: a body that is not parseable JavaScript throws here.
 */
function evaluateScript(body: string): Record<string, unknown> {
  const window: Record<string, unknown> = {};
  runInNewContext(body, { window });
  return window;
}

describe("GET /api/preferences.js", () => {
  it("the script route returns parseable JavaScript assigning the global", async () => {
    patchPreferences({ "shell.leftSidebar.expanded": "false", "panes.left": "240" });

    const res = await request(makeApp()).get("/api/preferences.js");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/javascript\b/);

    const window = evaluateScript(res.text);
    expect(window.__PAVILIO_PREFS__).toEqual({
      version: 1,
      "shell.leftSidebar.expanded": "false",
      "panes.left": "240",
    });
  });

  it("the script route publishes the server home directory", async () => {
    const res = await request(makeApp()).get("/api/preferences.js");

    // The browser bundle has no `process`, so this global is the client's only
    // source for the home path — without it a `~`-spelled repo path and its
    // expanded form fork into two preference keys.
    const window = evaluateScript(res.text);
    expect(window.__PAVILIO_HOME__).toBe(homedir());
    expect(typeof window.__PAVILIO_HOME__).toBe("string");
  });

  it("an empty doc still yields a valid assignment", async () => {
    const res = await request(makeApp()).get("/api/preferences.js");

    expect(res.status).toBe(200);
    const window = evaluateScript(res.text);
    expect(window.__PAVILIO_PREFS__).toEqual({ version: 1 });
    expect(typeof window.__PAVILIO_PREFS__).toBe("object");
  });

  it("a value containing a closing script sequence is escaped and survives", async () => {
    // Three separate hazards, one round trip:
    //  - `</script>` ends an inline script element, whatever the JS parser thinks;
    //  - U+2028/U+2029 are legal raw inside a JSON string but are line
    //    terminators to a pre-ES2019 JS parser, so a raw one truncates the
    //    statement and the assignment silently becomes a syntax error;
    //  - `&` matters the moment this text is ever echoed into HTML.
    const nasty = '</script><script>window.pwned=1</script>';
    const separators = "a\u2028b\u2029c";
    const ampersand = "tom & jerry <tag>";
    patchPreferences({ nasty, separators, ampersand });

    const res = await request(makeApp()).get("/api/preferences.js");

    expect(res.status).toBe(200);
    // Nothing that can terminate a script element, and no raw JS line
    // terminator, survives into the body.
    expect(res.text.toLowerCase()).not.toContain("</script");
    // All three of `<`, `>` and `&` — not just `<`. The route escapes the pair
    // because this body is one server-render away from an inline context, and
    // `&` because `&lt;/script&gt;` is the same hazard one HTML-escape earlier.
    // Asserting on `<` alone lets "escape `<`, leave `>` and `&` raw" survive.
    expect(res.text).not.toContain("<");
    expect(res.text).not.toContain(">");
    expect(res.text).not.toContain("&");
    expect(res.text).not.toContain("\u2028");
    expect(res.text).not.toContain("\u2029");

    // And the values come back byte-identical, not merely "nothing crashed".
    const window = evaluateScript(res.text);
    const prefs = window.__PAVILIO_PREFS__ as Record<string, unknown>;
    expect(prefs.nasty).toBe(nasty);
    expect(prefs.separators).toBe(separators);
    expect(prefs.ampersand).toBe(ampersand);
    // The sandbox saw no second script element and nothing else was assigned.
    expect(window.pwned).toBeUndefined();
  });
});

describe("PATCH /api/preferences", () => {
  it("a successful patch broadcasts the changed keys", async () => {
    patchPreferences({ stale: "gone" });
    broadcast.mockClear();

    const res = await request(makeApp())
      .patch("/api/preferences")
      .send({ "shell.leftSidebar.expanded": "false", "panes.left": "240", stale: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(broadcast).toHaveBeenCalledTimes(1);
    const frame = broadcast.mock.calls[0][0] as { type: string; keys: string[] };
    expect(frame.type).toBe("preferences-change");
    // Exactly the keys the request named — which is what `keys` reports, not
    // the keys whose value actually differs: a deletion is a change too, and a
    // same-value patch still names its key. The only body that reports nothing
    // is one that names no keys at all, and that one is dropped entirely (see
    // the empty-patch case below).
    expect([...frame.keys].sort()).toEqual(
      ["panes.left", "shell.leftSidebar.expanded", "stale"].sort(),
    );

    expect(getPreferences()).toEqual({
      version: 1,
      "shell.leftSidebar.expanded": "false",
      "panes.left": "240",
    });
  });

  it("a non-object patch body is rejected and changes nothing", async () => {
    patchPreferences({ keep: "me" });
    broadcast.mockClear();
    const before = { ...getPreferences() };
    const app = makeApp();

    // An array IS an object in JS — it is rejected all the same, because a
    // preferences patch is a key/value map and `[…]` names no keys.
    const bodies: unknown[] = [["a", "b"], "a string", 42, null];
    for (const body of bodies) {
      const res = await request(app)
        .patch("/api/preferences")
        .set("Content-Type", "application/json")
        .send(JSON.stringify(body));
      expect(res.status, `body ${JSON.stringify(body)}`).toBe(400);
    }

    // No body at all: nothing parsed it, so the handler sees `undefined`.
    const absent = await request(app).patch("/api/preferences");
    expect(absent.status).toBe(400);

    expect(broadcast).not.toHaveBeenCalled();
    expect(getPreferences()).toEqual(before);
  });

  it("a patch that names no keys touches neither the store nor the tabs", async () => {
    // `PATCH {}` is a legal request with nothing in it. Handing it to the store
    // anyway marks the document dirty and schedules a byte-identical write, and
    // the broadcast wakes every open tab to re-read a list of no keys.
    const before = { ...getPreferences() };
    const app = makeApp();

    for (const body of [{}, { version: 2 }]) {
      const res = await request(app).patch("/api/preferences").send(body);
      // Still a success: the caller asked for nothing and got it.
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }

    expect(broadcast).not.toHaveBeenCalled();
    expect(getPreferences()).toEqual(before);

    // Nothing was ever marked dirty, so a flush — the shutdown path, and what
    // the 250 ms debounce would have fired — has nothing to commit and the
    // file is never created. A store call would have produced one here.
    await flushPreferences();
    expect(existsSync(target())).toBe(false);
  });

  it("pending writes are flushed on shutdown", async () => {
    // A real child process, a real signal, a real file on disk. The child
    // patches a preference and immediately signals itself — well inside the
    // 250 ms debounce, so the only thing that can put bytes on disk is the
    // shutdown flush.
    const withHandler = await runShutdownChild({ install: true });
    // 143 = 128 + SIGTERM, the code the handler exits with. Not a strong
    // signal on its own — the tsx launcher reports the same code for a child
    // killed by SIGTERM outright — but it does rule out the 120 ms failsafe
    // below, i.e. a handler that flushed and then never exited.
    expect(withHandler.code, withHandler.stderr).toBe(143);
    // The discriminating assertion: bytes on disk, before the debounce could
    // ever have produced them.
    expect(existsSync(withHandler.file)).toBe(true);
    expect(JSON.parse(readFileSync(withHandler.file, "utf8"))).toEqual({
      version: 1,
      "shell.leftSidebar.expanded": "false",
    });

    // The control: the same child without the handler installed. SIGTERM's
    // default action takes the process down with the write still pending, so
    // the file never appears — which is what makes the case above meaningful.
    const without = await runShutdownChild({ install: false });
    expect(without.code, without.stderr).not.toBe(9);
    expect(existsSync(without.file)).toBe(false);
  }, 30_000);
});

describe("boot wiring", () => {
  // Source-shape assertions, in the idiom of `speech.test.ts` and
  // `entry-points.contract.test.ts`: they read source order, which is
  // execution order only because both of these functions are straight-line
  // bodies. They catch the wiring being dropped or moved, not a call hidden
  // behind a condition.
  it("the panel loads preferences before it listens", () => {
    const source = readFileSync(join(SERVER_DIR, "panel-server.ts"), "utf8");
    const loadAt = source.search(/\bloadPreferences\s*\(/);
    const listenAt = source.search(/\bserver\s*\.\s*listen\s*\(/);
    expect(loadAt).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(-1);
    expect(loadAt).toBeLessThan(listenAt);
    // And the router is mounted under `/api`, where `/api/preferences.js` can
    // actually reach it.
    expect(source).toMatch(
      /app\s*\.\s*use\s*\(\s*["']\/api["']\s*,\s*preferencesRouter\s*\)/,
    );
  });

  it.each(startPanelEntries())(
    "%s installs the shutdown flush when it is loaded",
    async (entry) => {
      // Not a source grep: the module is actually imported and run, with the
      // server assembly, vite and the shutdown module replaced by spies, so
      // nothing binds a port. A call hidden behind a never-true condition
      // fails here, which is the weakness the source-shape tests above carry.
      vi.resetModules();

      const startPanel = vi.fn(async () => undefined);
      const findFreePort = vi.fn(async () => 24678);
      const installPreferenceFlush = vi.fn();
      const viteClose = vi.fn(async () => undefined);

      vi.doMock("../../panel-server.js", () => ({ startPanel, findFreePort }));
      vi.doMock("../../lib/shutdown.js", () => ({ installPreferenceFlush }));
      vi.doMock("vite", () => ({
        createServer: vi.fn(async () => ({ middlewares: vi.fn(), close: viteClose })),
      }));

      // Both entries end their failure path with process.exit(1). If a mock
      // above is wrong, that would take the test runner down instead of
      // failing — so intercept it and assert it never fired.
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await import(/* @vite-ignore */ `../../${entry}`);
        // An entry may install the flush after an await; what matters is that
        // it installs it, and that startPanel really was the thing it ran.
        await vi.waitFor(() => expect(installPreferenceFlush).toHaveBeenCalled());
        await vi.waitFor(() => expect(startPanel).toHaveBeenCalled());
        expect(exit).not.toHaveBeenCalled();
      } finally {
        exit.mockRestore();
        consoleError.mockRestore();
        vi.doUnmock("../../panel-server.js");
        vi.doUnmock("../../lib/shutdown.js");
        vi.doUnmock("vite");
        vi.resetModules();
      }
    },
  );

  it("installing the flush twice does not stack signal handlers", async () => {
    // Two entry points now call it, and an ESM module is shared between them —
    // so the idempotence the module documents is load-bearing, not decorative.
    vi.resetModules();
    const { installPreferenceFlush } = await import("../../lib/shutdown.js");

    const signals: NodeJS.Signals[] = ["SIGHUP", "SIGINT", "SIGTERM"];
    const before = new Map(signals.map((sig) => [sig, process.listeners(sig)]));
    try {
      installPreferenceFlush();
      installPreferenceFlush();
      for (const sig of signals) {
        expect(process.listeners(sig).length, sig).toBe(before.get(sig)!.length + 1);
      }
    } finally {
      // Leave the runner's own signal handling exactly as it was found.
      for (const sig of signals) {
        for (const listener of process.listeners(sig)) {
          if (!before.get(sig)!.includes(listener)) process.removeListener(sig, listener);
        }
      }
      vi.resetModules();
    }
  });
});

/**
 * Every non-test module under panel/server that imports `startPanel` from the
 * shared assembly — that is, every process entry point that brings a panel up.
 * Discovered rather than listed: a third entry point is covered the day it
 * lands, instead of the day someone remembers to add it here.
 *
 * The import clause is what is matched, not the bare word, so an aliased
 * import still counts and a comment mentioning startPanel does not.
 */
function startPanelEntries(): string[] {
  const entries: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const source = readFileSync(full, "utf8");
      const clause = source.match(
        /import\s*\{([^}]*)\}\s*from\s*["'][^"']*panel-server\.js["']/,
      );
      if (!clause) continue;
      const bound = clause[1].match(/\bstartPanel\b(?:\s+as\s+(\w+))?/);
      if (!bound) continue;
      const local = bound[1] ?? "startPanel";
      if (!new RegExp(`\\b${local}\\s*\\(`).test(source)) continue;
      entries.push(relative(SERVER_DIR, full));
    }
  };
  walk(SERVER_DIR);
  // A panel with no entry point at all would otherwise make this file pass by
  // testing nothing.
  expect(entries.length).toBeGreaterThanOrEqual(2);
  return entries;
}

interface ChildResult {
  code: number | null;
  signal: string | null;
  stderr: string;
  file: string;
}

/**
 * Spawn a throwaway node process that loads the preference store, optionally
 * installs the real shutdown handler, patches a preference and then sends
 * itself SIGTERM. Returns how it died and where its preferences file would be.
 */
function runShutdownChild(opts: { install: boolean }): Promise<ChildResult> {
  const childDir = mkdtempSync(join(tmpdir(), "pavilio-prefs-shutdown-"));
  const file = join(childDir, "preferences.json");
  const storeUrl = pathToFileURL(join(SERVER_DIR, "lib/preferences-store.ts")).href;
  const shutdownUrl = pathToFileURL(join(SERVER_DIR, "lib/shutdown.ts")).href;
  const scriptPath = join(childDir, "child.mts");

  writeFileSync(
    scriptPath,
    [
      `import { loadPreferences, patchPreferences } from ${JSON.stringify(storeUrl)};`,
      `import { installPreferenceFlush } from ${JSON.stringify(shutdownUrl)};`,
      ``,
      `loadPreferences(${JSON.stringify(file)});`,
      opts.install ? `installPreferenceFlush();` : `// no handler installed`,
      `patchPreferences({ "shell.leftSidebar.expanded": "false" });`,
      // Failsafe with a distinct code. It fires well before the store's 250 ms
      // debounce, so a handler that never exits cannot be rescued by the
      // debounce writing the file on its own.
      `setTimeout(() => process.exit(9), 120);`,
      `process.kill(process.pid, "SIGTERM");`,
      ``,
    ].join("\n"),
    "utf8",
  );

  const tsx = join(PANEL_DIR, "node_modules/.bin/tsx");
  return new Promise<ChildResult>((resolvePromise, reject) => {
    const child = spawn(tsx, [scriptPath], { cwd: PANEL_DIR, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("exit", (code, signal) => resolvePromise({ code, signal, stderr, file }));
  });
}
