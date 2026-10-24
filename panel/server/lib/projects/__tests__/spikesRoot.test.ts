import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { loadSpikesRoot, readSpikesRoot, SPIKES_ROOT_DEFAULT } from "../spikesRoot";

let dir = "";
let prefsPath = "";

function writePrefs(doc: unknown) {
  writeFileSync(prefsPath, typeof doc === "string" ? doc : JSON.stringify(doc));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "spikes-root-"));
  prefsPath = join(dir, "preferences.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readSpikesRoot", () => {
  it("readSpikesRoot falls back to the default for missing, blank, wrong-type and malformed", () => {
    expect(SPIKES_ROOT_DEFAULT).toBe("~/git/prv/spikes");
    // Missing file.
    expect(readSpikesRoot(join(dir, "missing.json"))).toBe("~/git/prv/spikes");
    // Key absent.
    writePrefs({ version: 1, "view.wide": true });
    expect(readSpikesRoot(prefsPath)).toBe("~/git/prv/spikes");
    // Blank names nothing.
    writePrefs({ version: 1, "research.spikesRoot": "   " });
    expect(readSpikesRoot(prefsPath)).toBe("~/git/prv/spikes");
    // Wrong type.
    writePrefs({ version: 1, "research.spikesRoot": 42 });
    expect(() => readSpikesRoot(prefsPath)).not.toThrow();
    expect(readSpikesRoot(prefsPath)).toBe("~/git/prv/spikes");
    // Malformed JSON and a non-object document.
    writePrefs("{ not json");
    expect(readSpikesRoot(prefsPath)).toBe("~/git/prv/spikes");
    writePrefs([1, 2, 3]);
    expect(readSpikesRoot(prefsPath)).toBe("~/git/prv/spikes");
  });

  it("readSpikesRoot returns a configured root with ~ kept", () => {
    writePrefs({ version: 1, "research.spikesRoot": "  ~/code/spikes  " });
    expect(readSpikesRoot(prefsPath)).toBe("~/code/spikes");
  });

  it("loadSpikesRoot reads a foreign workspace's .pavilio/preferences.json", async () => {
    mkdirSync(join(dir, ".pavilio"));
    writeFileSync(
      join(dir, ".pavilio", "preferences.json"),
      JSON.stringify({ version: 1, "research.spikesRoot": "/srv/spikes" }),
    );
    expect(await loadSpikesRoot(dir)).toBe("/srv/spikes");
  });
});
