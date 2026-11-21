import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root = "";
vi.mock("../../config.js", () => ({ getConfig: () => ({ projectsDir: root }) }));

import { readAllIdentities, readIdentity, writeIdentity } from "../project-identity.js";
import {
  _resetPreferencesForTests,
  adoptProjectIdentity,
  flushPreferences,
  getPreferences,
  lastPatchFailedKeys,
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
    expect(writeIdentity("alpha", { mark: "image:mark.webp", color: "#61afef" })).toBe("ok");
    expect(readFileSync(idFile("alpha"), "utf8")).toBe(
      '{\n  "color": "#61afef",\n  "mark": "image:mark.webp"\n}\n',
    );
    writeIdentity("alpha", { color: null });
    expect(readIdentity("alpha")).toEqual({ mark: "image:mark.webp" });
    writeIdentity("alpha", { mark: null });
    expect(existsSync(idFile("alpha"))).toBe(false);
    expect(writeIdentity("nope", { color: "#fff" })).toBe("missing");
    expect(writeIdentity("../x", { color: "#fff" })).toBe("missing");
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

  it("a project dir symlinked outside projectsDir is neither written nor read", () => {
    const outside = mkdtempSync(join(tmpdir(), "pavilio-identity-outside-"));
    try {
      writeFileSync(join(outside, "identity.json"), '{"color":"#999999"}\n');
      symlinkSync(outside, join(root, "escape"));
      expect(writeIdentity("escape", { color: "#123456" })).toBe("missing");
      expect(readFileSync(join(outside, "identity.json"), "utf8")).toBe('{"color":"#999999"}\n');
      expect(readIdentity("escape")).toEqual({});
      expect(readAllIdentities().escape).toBeUndefined();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("a project named __proto__ is an ordinary entry and survives boot adoption", async () => {
    mkdirSync(join(root, "__proto__"));
    writeIdentity("__proto__", { color: "#444444" });
    expect(Object.keys(readAllIdentities())).toContain("__proto__");
    writeFileSync(machineFile(), JSON.stringify({ version: 1, "project.mark@__proto__": "image:m.webp" }));
    loadPreferences(machineFile());
    adoptProjectIdentity();
    expect(getPreferences()["project.color@__proto__"]).toBe("#444444");
    expect(readIdentity("__proto__")).toEqual({ color: "#444444", mark: "image:m.webp" });
  });

  // A non-empty directory where identity.json should be makes rename and rm fail.
  const blockIdentity = (p: string) => mkdirSync(join(idFile(p), "x"), { recursive: true });

  it("a failed PATCH identity write or delete is reported, never parked in the machine file", async () => {
    blockIdentity("alpha");
    loadPreferences(machineFile());
    patchPreferences({ "project.color@alpha": "#555555" });
    expect(lastPatchFailedKeys()).toEqual(["project.color@alpha"]);
    await flushPreferences();
    expect(machineText()).not.toContain("project.");

    patchPreferences({ "project.color@alpha": null });
    expect(lastPatchFailedKeys()).toEqual(["project.color@alpha"]);
    patchPreferences({ theme: "dark" });
    expect(lastPatchFailedKeys()).toEqual([]);
    // A missing project is memory-only by design, not a failure.
    patchPreferences({ "project.color@nope": "#666666" });
    expect(lastPatchFailedKeys()).toEqual([]);
  });

  it("an empty string removes the identity field", () => {
    writeIdentity("alpha", { color: "#111111", mark: "image:m.webp" });
    loadPreferences(machineFile());
    patchPreferences({ "project.mark@alpha": "" });
    expect(lastPatchFailedKeys()).toEqual([]);
    expect(readIdentity("alpha")).toEqual({ color: "#111111" });
  });

  it("boot migration: a failed write is retained and retried; a missing project is dropped", async () => {
    blockIdentity("alpha");
    writeFileSync(
      machineFile(),
      JSON.stringify({ version: 1, "project.color@alpha": "#555555", "project.color@gone": "#777777" }),
    );
    loadPreferences(machineFile());
    adoptProjectIdentity();
    await flushPreferences();
    expect(machineText()).toContain('"project.color@alpha": "#555555"');
    expect(machineText()).not.toContain("project.color@gone");

    rmSync(idFile("alpha"), { recursive: true, force: true });
    _resetPreferencesForTests();
    loadPreferences(machineFile());
    adoptProjectIdentity();
    expect(readIdentity("alpha")).toEqual({ color: "#555555" });
    await flushPreferences();
    expect(machineText()).not.toContain("project.");
  });

  it("a project whose name starts with dots is inside projectsDir and adopted at boot", async () => {
    mkdirSync(join(root, "..notes"));
    expect(writeIdentity("..notes", { color: "#888888" })).toBe("ok");
    expect(readIdentity("..notes")).toEqual({ color: "#888888" });
    // The shared value wins over a legacy machine value, and is visible after boot.
    writeFileSync(machineFile(), JSON.stringify({ version: 1, "project.color@..notes": "#999999" }));
    loadPreferences(machineFile());
    adoptProjectIdentity();
    expect(getPreferences()["project.color@..notes"]).toBe("#888888");
    expect(readIdentity("..notes")).toEqual({ color: "#888888" });
    await flushPreferences();
    expect(machineText()).not.toContain("project.");
  });

  it("a lookup error is a failure, not a missing project: legacy values are kept for the next boot", async () => {
    // A self-referential symlink: stat fails with ELOOP, not ENOENT.
    symlinkSync("loop", join(root, "loop"));
    expect(writeIdentity("loop", { color: "#abcdef" })).toBe("failed");
    writeFileSync(machineFile(), JSON.stringify({ version: 1, "project.color@loop": "#abcdef" }));
    loadPreferences(machineFile());
    adoptProjectIdentity();
    await flushPreferences();
    expect(machineText()).toContain('"project.color@loop": "#abcdef"');
    // A refused edit — set, clear or delete — leaves the retained value intact.
    for (const value of ["#fedcba", "", null]) {
      patchPreferences({ "project.color@loop": value, theme: "dark" });
      expect(lastPatchFailedKeys()).toEqual(["project.color@loop"]);
      expect(getPreferences()["project.color@loop"]).toBe("#abcdef");
      await flushPreferences();
      expect(machineText()).toContain('"project.color@loop": "#abcdef"');
    }
    expect(getPreferences().theme).toBe("dark");
  });
});
