import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  promises as fsp,
  readdirSync,
  readFileSync,
  renameSync,
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

import terminalRouter from "../terminal";

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

const PASTE_DIR = join(tmpdir(), "pavilio-pastes");
const panel = userInfo();

function pasteNames(): string[] {
  return existsSync(PASTE_DIR) ? readdirSync(PASTE_DIR).sort() : [];
}

// The paste directory is a fixed absolute path, so a test that replaces it
// with a hostile one puts the real directory back afterwards.
const PASTE_DIR_STASH = `${PASTE_DIR}.test-stash`;
function pasteDirExists(): boolean {
  try {
    lstatSync(PASTE_DIR);
    return true;
  } catch {
    return false;
  }
}
function stashPasteDir() {
  if (pasteDirExists()) renameSync(PASTE_DIR, PASTE_DIR_STASH);
}
function restorePasteDir() {
  rmSync(PASTE_DIR, { recursive: true, force: true });
  if (existsSync(PASTE_DIR_STASH)) renameSync(PASTE_DIR_STASH, PASTE_DIR);
}

const created: string[] = [];
beforeEach(() => {
  state.ids = ["sess-1"];
  // A different account than the panel process: the paste has to be handed
  // over before the session's pty can read it.
  state.owner = { uid: panel.uid + 1, gid: panel.gid + 1 };
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const p of created.splice(0)) rmSync(p, { force: true });
});

describe("POST /api/terminal/paste-image", () => {
  it("saves a target-owned private image under a traversal-only directory", async () => {
    // A directory left behind by an older panel is private to the panel
    // account — the terminal user cannot even traverse into it.
    mkdirSync(PASTE_DIR, { recursive: true });
    chmodSync(PASTE_DIR, 0o700);
    const chown = vi.spyOn(fsp, "chown").mockResolvedValue(undefined);

    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(typeof res.body.path).toBe("string");
    created.push(res.body.path);
    expect(res.body.path.startsWith("/")).toBe(true);
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
    expect(statSync(PASTE_DIR).mode & 0o777).toBe(0o711);
  });

  it("writes as the panel account when the session shares its identity", async () => {
    state.owner = { uid: panel.uid, gid: panel.gid };
    const chown = vi.spyOn(fsp, "chown");

    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    created.push(res.body.path);
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

  it("sweeps expired pastes", async () => {
    mkdirSync(PASTE_DIR, { recursive: true });
    const stale = join(PASTE_DIR, "paste-0-stale.png");
    writeFileSync(stale, PNG);
    const old = (Date.now() - 25 * 60 * 60 * 1000) / 1000; // 25h ago
    utimesSync(stale, old, old);
    vi.spyOn(fsp, "chown").mockResolvedValue(undefined);

    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    created.push(res.body.path);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(res.body.path)).toBe(true);
  });


  it("names the paste with cryptographic entropy", async () => {
    vi.spyOn(fsp, "chown").mockResolvedValue(undefined);

    const res = await request(makeApp())
      .post("/api/terminal/paste-image")
      .field("sessionId", "sess-1")
      .attach("image", PNG, { filename: "paste.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    created.push(res.body.path);
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
    created.push(res.body.path);
    // `mkdir` carries the mode itself: a first creation is never briefly
    // world-listable before the normalising chmod lands.
    expect(mkdir).toHaveBeenCalledWith(PASTE_DIR, {
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
    stashPasteDir();
    const decoy = join(tmpdir(), "pavilio-pastes-decoy");
    mkdirSync(decoy, { recursive: true });
    symlinkSync(decoy, PASTE_DIR);
    try {
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
    } finally {
      restorePasteDir();
      rmSync(decoy, { recursive: true, force: true });
    }
  });

  // Only root can hand a directory to another account.
  it.skipIf(panel.uid !== 0)(
    "refuses a paste directory owned by another account",
    async () => {
      stashPasteDir();
      mkdirSync(PASTE_DIR, { recursive: true });
      chownSync(PASTE_DIR, panel.uid + 1, panel.gid + 1);
      try {
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
        expect(readdirSync(PASTE_DIR)).toEqual([]);
      } finally {
        restorePasteDir();
      }
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
    created.push(res.body.path);
    expect(statSync(res.body.path).mode & 0o777).toBe(0o600);
  });
});
