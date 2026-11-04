import { describe, it, expect, vi } from "vitest";
import { getConfig } from "../../config";
import { machineHostname, machineId, sanitizeHostname } from "../hostname";

// Spy on getConfig so a single test can hand machineId() an override, while
// every other call still sees the real loaded config.
vi.mock("../../config", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../config")>();
  return { ...real, getConfig: vi.fn(real.getConfig) };
});

describe("sanitizeHostname", () => {
  it("lowercases and replaces non-alnum with -", () => {
    expect(sanitizeHostname("MacBook.local")).toBe("macbook-local");
  });
  it("strips trailing dashes", () => {
    expect(sanitizeHostname("greg-mac---")).toBe("greg-mac");
  });
  it("falls back to 'unknown' for empty input", () => {
    expect(sanitizeHostname("")).toBe("unknown");
  });
});

describe("machineId", () => {
  it("machineId falls back to the sanitized hostname", () => {
    vi.mocked(getConfig).mockReturnValueOnce({ ...getConfig(), machineId: undefined });
    expect(machineId()).toBe(machineHostname());
  });

  it("machineId honours and sanitizes the config override", () => {
    vi.mocked(getConfig).mockReturnValueOnce({ ...getConfig(), machineId: "HAL-9000" });
    expect(machineId()).toBe("hal-9000");
  });

  it("a blank config override falls back to the hostname", () => {
    vi.mocked(getConfig).mockReturnValueOnce({ ...getConfig(), machineId: "   " });
    expect(machineId()).toBe(machineHostname());
  });
});
