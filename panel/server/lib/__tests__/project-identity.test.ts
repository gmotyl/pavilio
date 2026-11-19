import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root = "";
vi.mock("../../config.js", () => ({ getConfig: () => ({ projectsDir: root }) }));

import { readIdentity, writeIdentity } from "../project-identity.js";
import {
  _resetPreferencesForTests,
  adoptProjectIdentity,
  flushPreferences,
  getPreferences,
  loadPreferences,
  patchPreferences,
  replacePreferences,
} from "../preferences-store.js";

const machineFile = () => join(root, "machine.json");
const idFile = (p: string) => join(root, p, "identity.json");
const machineText = () => readFileSync(machineFile(), "utf8");

describe("project identity", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pavilio-identity-"));
    mkdirSync(join(root, "alpha"));
    mkdirSync(join(root, "beta"));
    _resetPreferencesForTests();
  });
  afterEach(() => {
    _resetPreferencesForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("writeIdentity: sorted keys, null deletes, empty removes the file, unknown project is a no-op", () => {
    expect(writeIdentity("alpha", { mark: "image:mark.webp", color: "#61afef" })).toBe(true);
    expect(readFileSync(idFile("alpha"), "utf8")).toBe(
      '{\n  "color": "#61afef",\n  "mark": "image:mark.webp"\n}\n',
    );
    writeIdentity("alpha", { color: null });
    expect(readIdentity("alpha")).toEqual({ mark: "image:mark.webp" });
    writeIdentity("alpha", { mark: null });
    expect(existsSync(idFile("alpha"))).toBe(false);
    expect(writeIdentity("nope", { color: "#fff" })).toBe(false);
    expect(writeIdentity("../x", { color: "#fff" })).toBe(false);
  });

  it("routes identity patches to identity.json, not the machine file", async () => {
    loadPreferences(machineFile());
    patchPreferences({ "project.color@alpha": "#111111", "project.mark@alpha": "image:mark.webp", theme: "dark" });
    expect(readIdentity("alpha")).toEqual({ color: "#111111", mark: "image:mark.webp" });
    expect(getPreferences()["project.color@alpha"]).toBe("#111111");
    await flushPreferences();
    expect(machineText()).toContain('"theme"');
    expect(machineText()).not.toContain("project.");

    patchPreferences({ "project.color@alpha": null });
    expect(readIdentity("alpha")).toEqual({ mark: "image:mark.webp" });
    expect(getPreferences()["project.color@alpha"]).toBeUndefined();
  });

  it("boot migration: legacy machine keys move to identity.json and leave the machine file", async () => {
    writeFileSync(machineFile(), JSON.stringify({ version: 1, theme: "dark", "project.color@beta": "#222222" }));
    loadPreferences(machineFile());
    adoptProjectIdentity();
    expect(readIdentity("beta")).toEqual({ color: "#222222" });
    await flushPreferences();
    expect(machineText()).not.toContain("project.");
    expect(machineText()).toContain('"theme"');
    expect(getPreferences()["project.color@beta"]).toBe("#222222");
  });

  it("identity.json alone is readable through the doc", () => {
    writeIdentity("alpha", { color: "#333333" });
    loadPreferences(machineFile());
    adoptProjectIdentity();
    expect(getPreferences()["project.color@alpha"]).toBe("#333333");
  });

  it("identity.json wins over a conflicting machine value", async () => {
    writeIdentity("alpha", { color: "#aaaaaa" });
    writeFileSync(
      machineFile(),
      JSON.stringify({ version: 1, "project.color@alpha": "#bbbbbb", "project.mark@alpha": "image:m.webp" }),
    );
    loadPreferences(machineFile());
    adoptProjectIdentity();
    expect(getPreferences()["project.color@alpha"]).toBe("#aaaaaa");
    // Fields identity.json lacks still migrate.
    expect(readIdentity("alpha")).toEqual({ color: "#aaaaaa", mark: "image:m.webp" });
    await flushPreferences();
    expect(machineText()).not.toContain("project.");
  });

  it("replacePreferences (copy-from) keeps identity keys out of the machine file and identity.json wins", async () => {
    writeIdentity("alpha", { color: "#aaaaaa" });
    loadPreferences(machineFile());
    await replacePreferences({
      version: 1,
      theme: "light",
      "project.color@alpha": "#cccccc",
      "project.color@beta": "#dddddd",
    });
    expect(machineText()).not.toContain("project.");
    expect(readIdentity("alpha")).toEqual({ color: "#aaaaaa" });
    expect(readIdentity("beta")).toEqual({ color: "#dddddd" });
    expect(getPreferences()["project.color@alpha"]).toBe("#aaaaaa");
  });
});
