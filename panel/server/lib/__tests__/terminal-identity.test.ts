import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  namesDir,
  writeName,
  removeName,
  sweepNames,
  nextSessionName,
} from "../terminal-identity";

let dir = "";
const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const UUID3 = "33333333-3333-4333-8333-333333333333";

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

  it("removeName rejects a non-uuid id without touching the filesystem", () => {
    // "../escape" resolves (via namesDir()/../escape) to a path sibling to
    // namesDir() — this file must survive untouched if the id is rejected
    // before ever reaching rmSync.
    const escapee = join(dir, "escape");
    writeFileSync(escapee, "should survive");
    removeName("../escape");
    removeName("");
    expect(existsSync(escapee)).toBe(true);
    expect(existsSync(namesDir())).toBe(false);
  });

  it("removeName swallows filesystem errors", () => {
    // Same "point the state dir at a file" trick as writeName's error test:
    // namesDir() then resolves under a plain file, so rmSync's own lstat
    // fails with ENOTDIR instead of the missing-file ENOENT that
    // {force:true} already tolerates.
    writeName(UUID, "alokai-1");
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a dir");
    process.env.PANEL_AUTH_STATE_DIR = blocker;
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

  it("sweepNames deletes orphan files and spares live ids", () => {
    writeName(UUID, "alokai-1");
    writeName(UUID2, "alokai-2");
    writeName(UUID3, "alokai-3");
    sweepNames([UUID]);
    expect(existsSync(join(namesDir(), UUID))).toBe(true);
    expect(existsSync(join(namesDir(), UUID2))).toBe(false);
    expect(existsSync(join(namesDir(), UUID3))).toBe(false);
  });

  it("sweepNames leaves non-uuid filenames untouched", () => {
    writeName(UUID, "alokai-1");
    writeFileSync(join(namesDir(), "README"), "not a session");
    sweepNames([]);
    expect(existsSync(join(namesDir(), "README"))).toBe(true);
    expect(existsSync(join(namesDir(), UUID))).toBe(false);
  });

  it("sweepNames tolerates a missing terminals directory", () => {
    expect(existsSync(namesDir())).toBe(false);
    expect(() => sweepNames([UUID])).not.toThrow();
    expect(existsSync(namesDir())).toBe(false);
  });

  it("sweepNames swallows filesystem errors", () => {
    // Make namesDir() itself a plain file rather than a directory: the
    // `existsSync` early-return check still passes (the path exists), but
    // `readdirSync` on it throws ENOTDIR — a real throw from inside the
    // scan, not the missing-directory case above.
    writeFileSync(join(dir, "terminals"), "not a dir");
    expect(existsSync(namesDir())).toBe(true);
    expect(() => sweepNames([])).not.toThrow();
  });

  it("nextSessionName numbers the first session in a project 1", () => {
    expect(nextSessionName("alokai", [])).toBe("alokai-1");
  });

  it("nextSessionName skips gaps left by closed sessions", () => {
    expect(nextSessionName("alokai", ["alokai-1", "alokai-3"])).toBe(
      "alokai-4",
    );
  });

  it("nextSessionName counts only the given project", () => {
    expect(nextSessionName("alokai", ["motyl-1", "motyl-2"])).toBe(
      "alokai-1",
    );
  });

  it("nextSessionName ignores renamed and prefix-lookalike names", () => {
    expect(nextSessionName("alokai", ["alokai-1", "deploy-watch"])).toBe(
      "alokai-2",
    );
    expect(
      nextSessionName("alokai", ["alokai-1", "alokai-1-old", "alokai-x"]),
    ).toBe("alokai-2");
  });

  it("namesDir resolves under an explicit homeDir when PANEL_AUTH_STATE_DIR is unset", () => {
    delete process.env.PANEL_AUTH_STATE_DIR;
    const otherHome = mkdtempSync(join(tmpdir(), "term-id-home-"));
    try {
      expect(namesDir(otherHome)).toBe(join(otherHome, ".panel", "terminals"));
    } finally {
      rmSync(otherHome, { recursive: true, force: true });
    }
  });

  it("namesDir still prefers PANEL_AUTH_STATE_DIR over an explicit homeDir", () => {
    const otherHome = mkdtempSync(join(tmpdir(), "term-id-home-"));
    try {
      expect(namesDir(otherHome)).toBe(join(dir, "terminals"));
    } finally {
      rmSync(otherHome, { recursive: true, force: true });
    }
  });

  it("writeName writes under the given homeDir's terminals folder", () => {
    delete process.env.PANEL_AUTH_STATE_DIR;
    const otherHome = mkdtempSync(join(tmpdir(), "term-id-home-"));
    try {
      writeName(UUID, "alokai-1", otherHome);
      expect(
        readFileSync(join(otherHome, ".panel", "terminals", UUID), "utf8"),
      ).toBe("alokai-1\n");
    } finally {
      rmSync(otherHome, { recursive: true, force: true });
    }
  });

  it("removeName removes from the given homeDir's terminals folder", () => {
    delete process.env.PANEL_AUTH_STATE_DIR;
    const otherHome = mkdtempSync(join(tmpdir(), "term-id-home-"));
    try {
      writeName(UUID, "alokai-1", otherHome);
      const filePath = join(otherHome, ".panel", "terminals", UUID);
      expect(existsSync(filePath)).toBe(true);
      removeName(UUID, otherHome);
      expect(existsSync(filePath)).toBe(false);
    } finally {
      rmSync(otherHome, { recursive: true, force: true });
    }
  });
});
