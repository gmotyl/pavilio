import { describe, expect, it } from "vitest";
import { shouldNotify } from "../shouldNotify";

/** A transition that should fire; each test flips exactly one input. */
const firing = {
  previous: "busy",
  next: "attention",
  documentVisible: false,
  enabled: true,
  permission: "granted",
} as const;

describe("shouldNotify", () => {
  it("fires on entering attention while hidden", () => {
    expect(shouldNotify(firing)).toBe(true);
    expect(shouldNotify({ ...firing, previous: "idle" })).toBe(true);
  });

  it("stays silent while the panel is visible", () => {
    expect(shouldNotify({ ...firing, documentVisible: true })).toBe(false);
  });

  it("stays silent when attention is merely republished", () => {
    expect(shouldNotify({ ...firing, previous: "attention" })).toBe(false);
  });

  it("stays silent for busy and for idle", () => {
    expect(shouldNotify({ ...firing, next: "busy" })).toBe(false);
    expect(shouldNotify({ ...firing, previous: "attention", next: "idle" })).toBe(false);
  });

  it("stays silent when notifications are switched off", () => {
    expect(shouldNotify({ ...firing, enabled: false })).toBe(false);
  });

  it("stays silent without granted permission", () => {
    expect(shouldNotify({ ...firing, permission: "denied" })).toBe(false);
    expect(shouldNotify({ ...firing, permission: "default" })).toBe(false);
  });

  it("fires for a session first seen in attention", () => {
    expect(shouldNotify({ ...firing, previous: undefined })).toBe(true);
  });
});
