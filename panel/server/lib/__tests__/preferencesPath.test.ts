import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { WORKSPACE_ROOT } from "../../../panel.config";
import { loadConfig, mergeLocalConfig } from "../../config";
import { machineId } from "../hostname";
import { LEGACY_PREFERENCES, preferencesPathFor } from "../preferencesPath";
import { loadSpikesRoot } from "../projects/spikesRoot";
import { main } from "../wiki/cli";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prefs-path-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("preferencesPathFor", () => {
  it("resolver returns the per-machine path", () => {
    expect(preferencesPathFor("/ws", "spock")).toBe("/ws/.pavilio/preferences/spock.json");
    expect(preferencesPathFor("/ws/", "hal-9000")).toBe("/ws/.pavilio/preferences/hal-9000.json");
    expect(LEGACY_PREFERENCES).toBe(".pavilio/preferences.json");
  });

  it("wiki config and spikes root read the per-machine file", async () => {
    await loadConfig();
    const me = machineId();
    // The legacy document must no longer be read: give it different values.
    mkdirSync(join(dir, ".pavilio", "preferences"), { recursive: true });
    writeFileSync(
      join(dir, LEGACY_PREFERENCES),
      JSON.stringify({ "research.spikesRoot": "/legacy/spikes", "wiki.writerModel": "opus" }),
    );
    writeFileSync(
      preferencesPathFor(dir, me),
      JSON.stringify({
        "research.spikesRoot": "/per-machine/spikes",
        "wiki.writerModel": "sonnet",
        "wiki.sessionStartIngest": false,
      }),
    );

    expect(await loadSpikesRoot(dir)).toBe("/per-machine/spikes");

    let out = "";
    const code = await main(["config"], {
      stdout: { write: (s: string) => (out += s) },
      stderr: { write: () => {} },
      cwd: dir,
      env: {},
      workspaceRoot: dir,
    });
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({ sessionStartIngest: false, writerModel: "sonnet" });
  });

  it("a local preferencesPath override still wins", () => {
    // No override: the per-machine path under this panel's workspace.
    expect(mergeLocalConfig(undefined).preferencesPath).toBe(
      preferencesPathFor(WORKSPACE_ROOT, machineId()),
    );
    // A machineId override moves the file to that machine's name.
    expect(mergeLocalConfig({ machineId: "HAL 9000!" }).preferencesPath).toBe(
      preferencesPathFor(WORKSPACE_ROOT, "hal-9000"),
    );
    // An explicit preferencesPath wins over both.
    expect(
      mergeLocalConfig({ machineId: "hal", preferencesPath: "/custom/prefs.json" }).preferencesPath,
    ).toBe("/custom/prefs.json");
  });
});
