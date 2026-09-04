import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let projectsDir = "";

vi.mock("../../config", () => ({
  getConfig: () => ({ projectsDir }),
}));

import {
  getDefaultUser,
  setDefaultUser,
  getAllDefaultUsers,
} from "../project-default-user";

const storeFile = () => join(projectsDir, ".panel", "project-default-users.json");
const readStore = () => JSON.parse(readFileSync(storeFile(), "utf-8"));

describe("project-default-user", () => {
  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "pdefaultuser-"));
  });
  afterEach(() => rmSync(projectsDir, { recursive: true, force: true }));

  it("getDefaultUser returns undefined for a project with no entry", () => {
    expect(getDefaultUser("alpha")).toBeUndefined();
  });

  it("setDefaultUser persists and getDefaultUser reads it back", () => {
    setDefaultUser("alpha", "greg");
    expect(getDefaultUser("alpha")).toBe("greg");
    expect(readStore().alpha).toBe("greg");
  });

  it("malformed store file reads as an empty map", () => {
    mkdirSync(join(projectsDir, ".panel"), { recursive: true });
    writeFileSync(storeFile(), "{ not json", "utf-8");

    expect(getDefaultUser("alpha")).toBeUndefined();
    expect(getAllDefaultUsers(["alpha"])).toEqual({});
  });

  it("a non-string entry is dropped without discarding the rest of the file", () => {
    mkdirSync(join(projectsDir, ".panel"), { recursive: true });
    writeFileSync(
      storeFile(),
      JSON.stringify({ good: "greg", bad: 42 }),
      "utf-8",
    );

    expect(getDefaultUser("good")).toBe("greg");
    expect(getDefaultUser("bad")).toBeUndefined();
    expect(getAllDefaultUsers(["good", "bad"])).toEqual({ good: "greg" });
  });

  it("getAllDefaultUsers excludes entries for unknown projects", () => {
    setDefaultUser("alpha", "greg");
    setDefaultUser("beta", "greg-ip");

    expect(getAllDefaultUsers(["alpha"])).toEqual({ alpha: "greg" });
    expect(getAllDefaultUsers(["alpha", "beta", "gamma"])).toEqual({
      alpha: "greg",
      beta: "greg-ip",
    });
    // The stale entry stays on disk even though it was narrowed out above.
    expect(readStore().beta).toBe("greg-ip");
  });
});
