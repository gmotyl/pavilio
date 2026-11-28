import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeApp } from "../../test-kit";

vi.mock("../../watcher", () => ({ broadcast: vi.fn() }));

// Records socket creation and sends; no packet ever leaves the test.
const udp = vi.hoisted(() => ({ created: 0, sends: 0 }));
vi.mock("node:dgram", () => {
  const createSocket = () => {
    udp.created++;
    return {
      send: (_b: Buffer, _p: number, _h: string, cb: (err: Error | null) => void) => {
        udp.sends++;
        cb(null);
      },
      on: () => {},
      close: () => {},
      unref: () => {},
    };
  };
  return { default: { createSocket }, createSocket };
});

import preferencesRouter from "../preferences.js";
import activityLedRouter from "../activityLed.js";
import {
  _setActivityLedForTests,
  startPanelActivityLed,
  stopPanelActivityLed,
} from "../../lib/activityLed/instance.js";
import { loadPreferences, patchPreferences, _resetPreferencesForTests } from "../../lib/preferences-store.js";

const fakeLed = () => ({ settingsChanged: vi.fn(), test: vi.fn(), stop: vi.fn() });

let dir = "";
beforeEach(() => {
  udp.created = 0;
  udp.sends = 0;
  dir = mkdtempSync(join(tmpdir(), "pavilio-activity-led-route-"));
  loadPreferences(join(dir, "preferences.json"));
});

afterEach(() => {
  _setActivityLedForTests(null);
  stopPanelActivityLed();
  _resetPreferencesForTests();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("activity LED routes", () => {
  it("preferences patch with activityLed notifies the module", async () => {
    const led = fakeLed();
    _setActivityLedForTests(led);
    const res = await request(makeApp(preferencesRouter))
      .patch("/api/preferences")
      .send({ activityLed: { enabled: true } });
    expect(res.status).toBe(200);
    expect(led.settingsChanged).toHaveBeenCalledTimes(1);
  });

  it("preferences patch without activityLed does not notify", async () => {
    const led = fakeLed();
    _setActivityLedForTests(led);
    const res = await request(makeApp(preferencesRouter))
      .patch("/api/preferences")
      .send({ "panes.left": "240" });
    expect(res.status).toBe(200);
    expect(led.settingsChanged).not.toHaveBeenCalled();
  });

  it("test route triggers one test report", async () => {
    const led = fakeLed();
    _setActivityLedForTests(led);
    const res = await request(makeApp(activityLedRouter)).post("/api/activity-led/test");
    expect(res.status).toBe(204);
    expect(led.test).toHaveBeenCalledTimes(1);
  });

  it("startup without an activityLed preference opens no socket and sends nothing", () => {
    startPanelActivityLed();
    expect(udp.created).toBe(0);
    expect(udp.sends).toBe(0);
  });

  it("startup with activityLed enabled sends over one lazily created socket", () => {
    patchPreferences({ activityLed: { enabled: true } });
    startPanelActivityLed();
    expect(udp.created).toBe(1);
    expect(udp.sends).toBe(1);
  });
});
