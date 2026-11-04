import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

const cfg = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("../../config.js", () => ({ getConfig: () => cfg.current }));

import { autoSyncSettings } from "../autoSyncConfig.js";

const REPO = "/ws";

function withPreferencesPath(preferencesPath: string | undefined) {
  cfg.current = { projectsDir: join(REPO, "projects"), machineId: "mac", preferencesPath };
}

describe("autoSyncSettings machinePaths", () => {
  beforeEach(() => withPreferencesPath(undefined));

  it("keeps a preferencesPath inside the repo, relative to it", () => {
    withPreferencesPath("/ws/.pavilio/preferences/mac.json");
    expect(autoSyncSettings().machinePaths).toEqual([".pavilio/preferences/mac.json", ".pavilio/voices/"]);
  });

  it("keeps a file whose name merely starts with two dots", () => {
    withPreferencesPath("/ws/..prefs.json");
    expect(autoSyncSettings().machinePaths).toEqual(["..prefs.json", ".pavilio/voices/"]);
  });

  it("drops a preferencesPath outside the repo", () => {
    for (const outside of ["/elsewhere/prefs.json", "/ws-other/prefs.json", "/", "../prefs.json", "/ws"]) {
      withPreferencesPath(outside);
      expect(autoSyncSettings().machinePaths, outside).toEqual([".pavilio/voices/"]);
    }
  });
});
