import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  utimesSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

let projectsDir = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));

import {
  PROJECT_COLOR_PRESETS,
  resolveProjectColors,
  setProjectColor,
} from "../project-colors";

const storeFile = () => join(projectsDir, ".panel", "project-colors.json");
const readStore = () => JSON.parse(readFileSync(storeFile(), "utf-8"));

describe("project-colors", () => {
  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "pcolors-"));
  });
  afterEach(() => rmSync(projectsDir, { recursive: true, force: true }));

  it("assigns an unused preset to a project with no entry", () => {
    const colors = resolveProjectColors(["alpha"]);
    expect(colors.alpha).toBe(PROJECT_COLOR_PRESETS[0].hex);
    expect(readStore().alpha).toBe(PROJECT_COLOR_PRESETS[0].hex);
  });

  it("returns the same colour on a re-read", () => {
    const first = resolveProjectColors(["alpha", "beta"]);
    const second = resolveProjectColors(["alpha", "beta"]);
    expect(second).toEqual(first);
    expect(second.beta).toBe(first.beta);
  });

  it("does not change existing colours when a new project appears", () => {
    const before = resolveProjectColors(["alpha", "beta"]);
    const after = resolveProjectColors(["alpha", "beta", "gamma"]);
    expect(after.alpha).toBe(before.alpha);
    expect(after.beta).toBe(before.beta);
    expect(after.gamma).toBe(PROJECT_COLOR_PRESETS[2].hex);
  });

  it("wraps around when every preset is taken", () => {
    const names = PROJECT_COLOR_PRESETS.map((_, i) => `p${String(i).padStart(2, "0")}`);
    const full = resolveProjectColors(names);
    expect(new Set(Object.values(full)).size).toBe(PROJECT_COLOR_PRESETS.length);

    const wrapped = resolveProjectColors([...names, "overflow"]);
    expect(wrapped.overflow).toBe(PROJECT_COLOR_PRESETS[0].hex);
    for (const name of names) expect(wrapped[name]).toBe(full[name]);

    // The wrap walks the palette from the size of the map, so the project
    // after the overflow takes the *second* preset — not the first again.
    // Without this, a per-call `index = 0` would be indistinguishable.
    const wrappedTwice = resolveProjectColors([...names, "overflow", "overflow2"]);
    expect(wrappedTwice.overflow2).toBe(PROJECT_COLOR_PRESETS[1].hex);
    expect(wrappedTwice.overflow).toBe(PROJECT_COLOR_PRESETS[0].hex);
  });

  it("assigns the same colours whatever order the projects arrive in", () => {
    const forward = ["alpha", "beta", "gamma", "delta"];
    const shuffled = ["gamma", "alpha", "delta", "beta"];

    const a = resolveProjectColors(shuffled);

    // A second, entirely fresh store — otherwise the first run's persisted
    // assignments would decide the second run's answer.
    rmSync(projectsDir, { recursive: true, force: true });
    projectsDir = mkdtempSync(join(tmpdir(), "pcolors-"));
    const b = resolveProjectColors(forward);

    expect({ ...a }).toEqual({ ...b });
  });

  it("ignores duplicate names in one call", () => {
    // Without de-duplication the second "alpha" would be assigned again over
    // the first, so alpha and beta would both slide one preset along.
    const colors = resolveProjectColors(["alpha", "alpha", "beta"]);
    expect(colors.alpha).toBe(PROJECT_COLOR_PRESETS[0].hex);
    expect(colors.beta).toBe(PROJECT_COLOR_PRESETS[1].hex);
    expect(Object.keys(readStore()).sort()).toEqual(["alpha", "beta"]);
  });

  it("keeps the valid entries when one is malformed", () => {
    mkdirSync(join(projectsDir, ".panel"), { recursive: true });
    writeFileSync(storeFile(), JSON.stringify({ good: "#abc", bad: "nope" }), "utf-8");

    const colors = resolveProjectColors(["good", "bad"]);

    // The bad entry is dropped and re-assigned; the good one is untouched.
    // Discarding the whole file instead would silently recolour every project.
    expect(colors.good).toBe("#abc");
    expect(colors.bad).toBe(PROJECT_COLOR_PRESETS[0].hex);
    expect(readStore().good).toBe("#abc");
  });

  it("assigns a colour to a project named after an Object prototype member", () => {
    const colors = resolveProjectColors(["constructor", "toString", "normal"]);

    const persisted = readStore();
    for (const name of ["constructor", "toString", "normal"]) {
      expect(typeof colors[name]).toBe("string");
      expect(colors[name]).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(Object.hasOwn(persisted, name)).toBe(true);
      expect(persisted[name]).toBe(colors[name]);
    }
    expect(new Set(Object.values(colors)).size).toBe(3);
  });

  it("leaves no temp file behind when the write fails", () => {
    mkdirSync(join(projectsDir, ".panel"), { recursive: true });
    // Occupying the temp path with a directory makes `writeFileSync` fail.
    const tmp = `${storeFile()}.tmp.${process.pid}`;
    mkdirSync(tmp, { recursive: true });

    expect(() => setProjectColor("alpha", "#abc")).toThrow();

    // `projects/` is auto-committed, so an orphaned temp file would be committed.
    expect(existsSync(tmp)).toBe(false);
  });

  it("does not rewrite the file when nothing is missing", () => {
    resolveProjectColors(["alpha", "beta"]);
    const old = new Date(Date.now() - 60_000);
    utimesSync(storeFile(), old, old);
    const before = statSync(storeFile()).mtimeMs;

    resolveProjectColors(["alpha", "beta"]);

    // This file is committed; a write on every read would be endless diff noise.
    expect(statSync(storeFile()).mtimeMs).toBe(before);
  });

  it("stores a valid custom hex", () => {
    resolveProjectColors(["alpha"]);
    setProjectColor("alpha", "#abc");
    expect(resolveProjectColors(["alpha"]).alpha).toBe("#abc");
    setProjectColor("alpha", "#00FF7f");
    expect(resolveProjectColors(["alpha"]).alpha).toBe("#00FF7f");
  });

  it("rejects an invalid hex without writing", () => {
    expect(() => setProjectColor("alpha", "red")).toThrow();
    expect(existsSync(storeFile())).toBe(false);

    resolveProjectColors(["alpha"]);
    const untouched = readFileSync(storeFile(), "utf-8");
    for (const bad of ["", "#", "#ab", "#abcd", "#12345", "#gggggg", "abcdef", "#abcdef "]) {
      expect(() => setProjectColor("alpha", bad)).toThrow();
    }
    expect(readFileSync(storeFile(), "utf-8")).toBe(untouched);
  });

  it("treats a malformed file as empty", () => {
    mkdirSync(join(projectsDir, ".panel"), { recursive: true });
    writeFileSync(storeFile(), "{ not json", "utf-8");
    expect(resolveProjectColors(["alpha"]).alpha).toBe(PROJECT_COLOR_PRESETS[0].hex);

    writeFileSync(storeFile(), "", "utf-8");
    expect(resolveProjectColors(["alpha"]).alpha).toBe(PROJECT_COLOR_PRESETS[0].hex);
  });
});
