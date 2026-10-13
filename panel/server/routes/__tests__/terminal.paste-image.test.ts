import {
  describe,
  it,
  expect,
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";
import { randomBytes } from "crypto";
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  promises as fsp,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir, userInfo } from "os";
import { basename, join } from "path";

const state = vi.hoisted(() => ({
  ids: [] as string[],
  owner: undefined as { uid: number; gid: number } | undefined,
}));

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir: "/tmp/unused" }),
}));
vi.mock("../../lib/terminal-manager", () => ({
  createSession: vi.fn(),
  listSessions: vi.fn(() => state.ids.map((id) => ({ id }))),
  destroySession: vi.fn(),
  updateSession: vi.fn(),
  // Mirrors the real contract: the target account for a known session,
  // `undefined` for an unknown id and on a host without POSIX uids.
  getSessionOwner: vi.fn((id: string) =>
    state.ids.includes(id) ? state.owner : undefined,
  ),
}));

import terminalRouter, { pasteDir, sweepOldPastes } from "../terminal";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/terminal", terminalRouter);
  return app;
}

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// The real, machine-shared paste directory. These tests must never read,
// write, rename or remove it: every test redirects the route into its own
// mkdtemp directory via PAVILIO_PASTE_DIR, so concurrent runs (two shells,
// two worktrees) cannot trample each other. The sentinel planted below is
// the one sanctioned exception, and it only proves the directory was left
// alone.
const SHARED_PASTE_DIR = join(tmpdir(), "pavilio-pastes");
const panel = userInfo();

let tmp: string;
const envBefore = process.env.PAVILIO_PASTE_DIR;

function pasteNames(): string[] {
  return existsSync(tmp) ? readdirSync(tmp).sort() : [];
}

beforeEach(() => {
  state.ids = ["sess-1"];
  // A different account than the panel process: the paste has to be handed
  // over before the session's pty can read it.
  state.owner = { uid: panel.uid + 1, gid: panel.gid + 1 };
  tmp = mkdtempSync(join(tmpdir(), "pavilio-paste-test-"));
  process.env.PAVILIO_PASTE_DIR = tmp;
});
afterEach(() => {
  vi.restoreAllMocks();
  if (envBefore === undefined) delete process.env.PAVILIO_PASTE_DIR;
  else process.env.PAVILIO_PASTE_DIR = envBefore;
  rmSync(tmp, { recursive: true, force: true });
});

// Plant a sentinel in the shared directory before any test runs; the last
// test asserts it survived untouched, mtime included. Skipped when the
// existing entry is a symlink, not a directory, or belongs to another uid —
// lstat (never following links, matching the production route's guard) so we
// cannot plant through a link into an unrelated directory we could not clean
// our sentinel up from.
let sentinel: string | undefined;
let sentinelMtimeMs: number | undefined;
beforeAll(() => {
  try {
    const st = lstatSync(SHARED_PASTE_DIR, { throwIfNoEntry: false });
    if (st && (st.isSymbolicLink() || !st.isDirectory() || st.uid !== panel.uid))
      return;
    // Match production's traversal-only mode, not the umask default, when
    // this run is the one creating the shared directory.
    mkdirSync(SHARED_PASTE_DIR, { recursive: true, mode: 0o711 });
    const name = `test-sentinel-${randomBytes(6).toString("hex")}`;
    const p = join(SHARED_PASTE_DIR, name);
    writeFileSync(p, "sentinel");
    sentinel = p;
    sentinelMtimeMs = statSync(p).mtimeMs;
  } catch {
    sentinel = undefined;
  }
});
afterAll(() => {
  if (sentinel) rmSync(sentinel, { force: true });
});

describe("pasteDir", () => {
  it("pasteDir defaults to tmpdir/pavilio-pastes", () => {
    delete process.env.PAVILIO_PASTE_DIR;
    expect(pasteDir()).toBe(SHARED_PASTE_DIR);
  });

  it("pasteDir honours PAVILIO_PASTE_DIR", () => {
    // beforeEach pointed the env at this test's own temp directory.
    expect(pasteDir()).toBe(tmp);
  });
});

describe("sweepOldPastes", () => {
  it("sweeps expired pastes", async () => {
    const stale = join(tmp, "paste-0-stale.png");
    writeFileSync(stale, PNG);
    const old = (Date.now() - 25 * 60 * 60 * 1000) / 1000; // 25h ago
    utimesSync(stale, old, old);

    await sweepOldPastes(tmp);

    expect(existsSync(stale)).toBe(false);
  });

  it("keeps fresh pastes when sweeping", async () => {
    const stale = join(tmp, "paste-0-stale.png");
    writeFileSync(stale, PNG);
    const old = (Date.now() - 25 * 60 * 60 * 1000) / 1000; // 25h ago
    utimesSync(stale, old, old);
    const fresh = join(tmp, "paste-1-fresh.png");
    writeFileSync(fresh, PNG);

    await sweepOldPastes(tmp);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

describe("POST /api/terminal/paste-image", () => {
  it("saves a target-owned private image under a traversal-only directory", async () => {
    // A directory left behind by an older panel is private to the panel
    // account — the terminal user cannot even traverse into it.
    chmodSync(tmp, 0o700);
    const chown = vi.spyOn(fsp, "chown").mockResolvedValue(undefined);

    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(typeof res.body.path).toBe("string");
    expect(res.body.path.startsWith(tmp)).toBe(true);
    expect(res.body.path.endsWith(".png")).toBe(true);
    expect(readFileSync(res.body.path).equals(PNG)).toBe(true);
    // Private to its owner, and that owner is the session's account.
    expect(statSync(res.body.path).mode & 0o777).toBe(0o600);
    expect(chown).toHaveBeenCalledWith(
      res.body.path,
      state.owner!.uid,
      state.owner!.gid,
    );
    // Traversal-only: the terminal user reaches the random filename it was
    // handed, but cannot list anybody else's pastes.
    expect(statSync(tmp).mode & 0o777).toBe(0o711);
  });

  it("writes as the panel account when the session shares its identity", async () => {
    state.owner = { uid: panel.uid, gid: panel.gid };
    const chown = vi.spyOn(fsp, "chown");

    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(chown).not.toHaveBeenCalled();
    expect(statSync(res.body.path).mode & 0o777).toBe(0o600);
    expect(statSync(res.body.path).uid).toBe(panel.uid);
  });

  it("rejects missing and unknown sessions without output", async () => {
    const before = pasteNames();

    const missing = await request(makeApp())
      .post("/api/terminal/paste-image")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });
    expect(missing.status).toBe(400);

    const unknown = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-gone")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });
    expect(unknown.status).toBe(404);

    expect(pasteNames()).toEqual(before);
  });

  it("rejects a missing file", async () => {
    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1");
    expect(res.status).toBe(400);
  });

  it("rejects non-image uploads", async () => {
    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1")
      .attach("image", Buffer.from("hello"), {
        filename: "note.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
  });

  it("removes partial output after persistence failure", async () => {
    const before = pasteNames();
    vi.spyOn(fsp, "chown").mockRejectedValue(new Error("EPERM"));

    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });

    expect(res.status).toBe(500);
    expect(res.body.path).toBeUndefined();
    // A file the session could never read must not be left behind.
    expect(pasteNames()).toEqual(before);
  });

  it("names the paste with cryptographic entropy", async () => {
    vi.spyOn(fsp, "chown").mockResolvedValue(undefined);

    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    // Under a traversal-only directory the unguessable name is the only
    // thing keeping a paste from other local accounts for its whole life,
    // so it has to be fixed-length CSPRNG output — never `Math.random`,
    // whose state a terminal user can reconstruct from its own pastes.
    expect(basename(res.body.path)).toMatch(/^paste-\d+-[0-9a-f]{24}\.png$/);
  });

  it("creates the paste exclusively and private from birth", async () => {
    vi.spyOn(fsp, "chown").mockResolvedValue(undefined);
    const mkdir = vi.spyOn(fsp, "mkdir");
    const open = vi.spyOn(fsp, "open");
    const chmod = vi.spyOn(fsp, "chmod");

    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    // `mkdir` carries the mode itself: a first creation is never briefly
    // world-listable before the normalising chmod lands.
    expect(mkdir).toHaveBeenCalledWith(tmp, {
      recursive: true,
      mode: 0o711,
    });
    // `wx` refuses a pre-planted name or symlink instead of reusing it, and
    // the mode makes the file private from birth.
    expect(open).toHaveBeenCalledWith(res.body.path, "wx", 0o600);
    // No widen-then-narrow window: nothing re-modes the file afterwards.
    expect(chmod.mock.calls.filter((c) => c[0] === res.body.path)).toEqual([]);
  });

  it("refuses a paste directory that is a symlink", async () => {
    // Both the decoy and the symlink live inside this test's own temp
    // directory — nothing shared is ever replaced or stashed.
    const decoy = join(tmp, "decoy");
    const linked = join(tmp, "pastes");
    mkdirSync(decoy, { recursive: true });
    symlinkSync(decoy, linked);
    process.env.PAVILIO_PASTE_DIR = linked;

    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1")
      .attach("image", PNG, {
        filename: "paste.png",
        contentType: "image/png",
      });

    // /tmp is world-writable: a local user can pre-plant the path. Writing
    // into it would hand every paste to whoever owns the target.
    expect(res.status).toBe(500);
    expect(readdirSync(decoy)).toEqual([]);
  });

  // Only root can hand a directory to another account.
  it.skipIf(panel.uid !== 0)(
    "refuses a paste directory owned by another account",
    async () => {
      const foreign = join(tmp, "pastes");
      mkdirSync(foreign, { recursive: true });
      chmodSync(foreign, 0o700);
      chownSync(foreign, panel.uid + 1, panel.gid + 1);
      process.env.PAVILIO_PASTE_DIR = foreign;

      const res = await request(makeApp())
        .post("/api/terminal/paste-image")
        .field("sessionId", "sess-1")
        .attach("image", PNG, {
          filename: "paste.png",
          contentType: "image/png",
        });

      // The owner keeps rwx through any chmod the panel applies — it could
      // list every paste name and replace entries.
      expect(res.status).toBe(500);
      expect(readdirSync(foreign)).toEqual([]);
      // Untouched: the ownership check has to run *before* the normalising
      // chmod. A panel that re-modes first has already opened a directory
      // it does not own to everyone the 0711 lets in.
      expect(statSync(foreign).mode & 0o777).toBe(0o700);
    },
  );

  it("accepts the client ordering of image before sessionId", async () => {
    vi.spyOn(fsp, "chown").mockResolvedValue(undefined);

    // imagePaste.ts appends the file first and the session id second.
    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" })
      .field("sessionId", "sess-1");

    expect(res.status).toBe(200);
    expect(statSync(res.body.path).mode & 0o777).toBe(0o600);
  });
});

// Deliberately last in the file: the sentinel planted in beforeAll must have
// survived every test above with its mtime intact, proving nothing here ever
// read, wrote, renamed or removed the shared paste directory's contents.
describe("shared paste directory isolation", () => {
  it("never touches the shared paste directory", (ctx) => {
    // Planting skipped (directory owned by another uid): show the skip in
    // the run summary instead of passing vacuously.
    if (!sentinel) return ctx.skip();
    expect(existsSync(sentinel)).toBe(true);
    expect(statSync(sentinel).mtimeMs).toBe(sentinelMtimeMs);
  });
});
