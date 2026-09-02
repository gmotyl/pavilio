import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { namesDir, writeName, removeName } from "../terminal-identity";

let dir = "";
const UUID = "11111111-1111-4111-8111-111111111111";

describe("terminal-identity", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "term-id-"));
    process.env.PANEL_AUTH_STATE_DIR = dir;
  });
  afterEach(() => {
    delete process.env.PANEL_AUTH_STATE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("writeName creates the terminals directory and writes the name", () => {
    expect(existsSync(namesDir())).toBe(false);
    writeName(UUID, "alokai-1");
    expect(existsSync(namesDir())).toBe(true);
    expect(readFileSync(join(namesDir(), UUID), "utf8")).toBe("alokai-1\n");
  });

  it("writeName overwrites a previous name rather than appending", () => {
    writeName(UUID, "alokai-1");
    writeName(UUID, "alokai-2");
    expect(readFileSync(join(namesDir(), UUID), "utf8")).toBe("alokai-2\n");
  });

  it("removeName deletes the file and tolerates a missing one", () => {
    writeName(UUID, "alokai-1");
    removeName(UUID);
    expect(existsSync(join(namesDir(), UUID))).toBe(false);
    expect(() => removeName(UUID)).not.toThrow();
  });

  it("writeName rejects a non-uuid id without touching the filesystem", () => {
    writeName("../escape", "evil");
    writeName("", "evil");
    expect(existsSync(namesDir())).toBe(false);
    expect(existsSync(join(dir, "escape"))).toBe(false);
  });

  it("writeName swallows filesystem errors", () => {
    // Point the state dir at a plain file so mkdirSync(".../terminals") can
    // never succeed (ENOTDIR) — the write must still not throw.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a dir");
    process.env.PANEL_AUTH_STATE_DIR = blocker;
    expect(() => writeName(UUID, "alokai-1")).not.toThrow();
  });
});
