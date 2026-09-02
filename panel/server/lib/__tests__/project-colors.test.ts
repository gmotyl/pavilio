import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
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
