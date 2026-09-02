import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  appendReconnectMetric,
  normalizeTrigger,
  type ReconnectTrigger,
} from "../reconnect-log";

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

  it("records an unrecognised trigger as manual", () => {
    // The endpoint hands whatever a client sent straight through; the log is
    // the last place that can keep the trigger column an enum instead of a
    // free-text field nobody can group by later.
    appendReconnectMetric({
      sessionId: "s1",
      trigger: "totally-made-up" as ReconnectTrigger,
    });
    const rec = JSON.parse(readFileSync(file(), "utf8").trim());
    expect(rec.trigger).toBe("manual");

    expect(normalizeTrigger("manual")).toBe("manual");
    expect(normalizeTrigger("disconnect")).toBe("disconnect");
    expect(normalizeTrigger("auto-blank")).toBe("auto-blank");
    expect(normalizeTrigger("Disconnect")).toBe("manual");
    expect(normalizeTrigger(undefined)).toBe("manual");
    expect(normalizeTrigger(7)).toBe("manual");
  });

  it("keeps the recognised triggers verbatim", () => {
    appendReconnectMetric({ sessionId: "a", trigger: "disconnect" });
    appendReconnectMetric({ sessionId: "b", trigger: "auto-blank" });
    const lines = readFileSync(file(), "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l).trigger)).toEqual([
      "disconnect",
      "auto-blank",
    ]);
  });

  it("leaves an absent trigger absent rather than defaulting it", () => {
    // Old lines have no trigger field at all; inventing one on write would
    // make an unattributed record look like a click.
    appendReconnectMetric({ sessionId: "a" });
    const rec = JSON.parse(readFileSync(file(), "utf8").trim());
    expect("trigger" in rec).toBe(false);
  });

  it("creates the log directory if it does not exist yet", () => {
    const nested = join(dir, "deeper");
    process.env.PANEL_AUTH_STATE_DIR = nested;
    expect(existsSync(nested)).toBe(false);
    appendReconnectMetric({ sessionId: "x" });
    expect(existsSync(join(nested, "terminal-reconnect.jsonl"))).toBe(true);
  });
});
