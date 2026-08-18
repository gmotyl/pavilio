import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { appendReconnectMetric } from "../reconnect-log";

let dir = "";

describe("appendReconnectMetric", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "recon-"));
    process.env.PANEL_AUTH_STATE_DIR = dir;
  });
  afterEach(() => {
    delete process.env.PANEL_AUTH_STATE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  const file = () => join(dir, "terminal-reconnect.jsonl");

  it("appends one JSON line stamped with a server ts", () => {
    appendReconnectMetric({ sessionId: "s1", stale: true, trigger: "manual" });
    const lines = readFileSync(file(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.sessionId).toBe("s1");
    expect(rec.stale).toBe(true);
    expect(rec.trigger).toBe("manual");
    expect(typeof rec.ts).toBe("string");
    expect(Number.isNaN(Date.parse(rec.ts))).toBe(false);
  });

  it("appends without clobbering earlier lines", () => {
    appendReconnectMetric({ sessionId: "a" });
    appendReconnectMetric({ sessionId: "b" });
    const lines = readFileSync(file(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).sessionId).toBe("a");
    expect(JSON.parse(lines[1]).sessionId).toBe("b");
  });

  it("creates the log directory if it does not exist yet", () => {
    const nested = join(dir, "deeper");
    process.env.PANEL_AUTH_STATE_DIR = nested;
    expect(existsSync(nested)).toBe(false);
    appendReconnectMetric({ sessionId: "x" });
    expect(existsSync(join(nested, "terminal-reconnect.jsonl"))).toBe(true);
  });
});
