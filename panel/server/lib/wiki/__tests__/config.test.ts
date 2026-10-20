import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { readWikiConfig, WIKI_CONFIG_DEFAULTS } from "../config";

let dir = "";
let prefsPath = "";

function writePrefs(doc: unknown) {
  writeFileSync(prefsPath, typeof doc === "string" ? doc : JSON.stringify(doc));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wiki-config-"));
  prefsPath = join(dir, "preferences.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readWikiConfig", () => {
  it("defaults when keys are absent", () => {
    writePrefs({ version: 1, "view.wide": true });
    expect(readWikiConfig(prefsPath)).toEqual({ sessionStartIngest: true, writerModel: "haiku" });
    // A missing file and a corrupt one are the same "nothing configured".
    expect(readWikiConfig(join(dir, "missing.json"))).toEqual(WIKI_CONFIG_DEFAULTS);
    writePrefs("{ not json");
    expect(readWikiConfig(prefsPath)).toEqual(WIKI_CONFIG_DEFAULTS);
    writePrefs([1, 2, 3]);
    expect(readWikiConfig(prefsPath)).toEqual(WIKI_CONFIG_DEFAULTS);
  });

  it("reads sessionStartIngest false", () => {
    writePrefs({ version: 1, "wiki.sessionStartIngest": false, "wiki.writerModel": "sonnet" });
    expect(readWikiConfig(prefsPath)).toEqual({ sessionStartIngest: false, writerModel: "sonnet" });
  });

  it("falls back on wrong types", () => {
    writePrefs({ version: 1, "wiki.sessionStartIngest": "false", "wiki.writerModel": 42 });
    expect(() => readWikiConfig(prefsPath)).not.toThrow();
    expect(readWikiConfig(prefsPath)).toEqual({ sessionStartIngest: true, writerModel: "haiku" });
    // A blank model names nothing, so it is treated like a missing one.
    writePrefs({ version: 1, "wiki.sessionStartIngest": null, "wiki.writerModel": "  " });
    expect(readWikiConfig(prefsPath)).toEqual({ sessionStartIngest: true, writerModel: "haiku" });
  });
});
