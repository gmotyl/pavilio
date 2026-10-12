import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectsDir = "";
vi.mock("../config.js", () => ({ getConfig: () => ({ projectsDir }) }));

import { importLegacyColors } from "../lib/import-legacy-colors.js";
import { getPreferences, loadPreferences } from "../lib/preferences-store.js";
import { preferences } from "../../src/preferences/declarations";

const legacyFile = () => join(projectsDir, ".panel", "project-colors.json");
const writeLegacy = (body: unknown) => {
  mkdirSync(join(projectsDir, ".panel"), { recursive: true });
  writeFileSync(legacyFile(), typeof body === "string" ? body : JSON.stringify(body));
};

describe("import legacy colours", () => {
  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "legacy-colors-"));
    loadPreferences(join(projectsDir, "prefs.json")); // missing file → empty doc
  });
  afterEach(() => rmSync(projectsDir, { recursive: true, force: true }));

  it("uses the declared preference key", () => {
    expect(preferences.projectColor.key).toBe("project.color");
    expect(preferences.projectMark.key).toBe("project.mark");
  });

  it("fills only missing colours and never overwrites a stored one", () => {
    writeLegacy({ alpha: "#f0c674", beta: "#e06c75", bad: "red", constructor: "#abc" });
    loadPreferences(join(projectsDir, "prefs.json"));
    // beta already has a colour of its own.
    const doc = getPreferences();
    doc["project.color@beta"] = "#111111";

    expect(importLegacyColors()).toBe(2);
    expect(getPreferences()["project.color@alpha"]).toBe("#f0c674");
    expect(getPreferences()["project.color@beta"]).toBe("#111111");
    expect(getPreferences()["project.color@constructor"]).toBe("#abc");
    expect(getPreferences()["project.color@bad"]).toBeUndefined();

    // A later start changes nothing while the user keeps a colour of their own.
    getPreferences()["project.color@alpha"] = "#222222";
    expect(importLegacyColors()).toBe(0);
    expect(getPreferences()["project.color@alpha"]).toBe("#222222");

    // Known limit: a CLEARED colour is a missing one, so the next start fills it again.
    delete getPreferences()["project.color@alpha"];
    expect(importLegacyColors()).toBe(1);
    expect(getPreferences()["project.color@alpha"]).toBe("#f0c674");
  });

  it("the legacy colours file is left in place", () => {
    writeLegacy({ alpha: "#f0c674" });
    const before = readFileSync(legacyFile(), "utf-8");
    importLegacyColors();
    expect(existsSync(legacyFile())).toBe(true);
    expect(readFileSync(legacyFile(), "utf-8")).toBe(before);
  });

  it("does nothing when the file is absent, malformed or not an object", () => {
    expect(importLegacyColors()).toBe(0);
    writeLegacy("{nope");
    expect(importLegacyColors()).toBe(0);
    writeLegacy("[1,2]");
    expect(importLegacyColors()).toBe(0);
    expect(Object.keys(getPreferences())).toEqual(["version"]);
  });
});
