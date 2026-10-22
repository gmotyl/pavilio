import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../lan", () => ({ isWsl: vi.fn(() => false) }));

import { detectHostPlatform } from "../host-platform";
import { isWsl } from "../lan";

const notWsl = () => false;
const isWslStub = () => true;

describe("detectHostPlatform", () => {
  it.each<[string, NodeJS.Platform, () => boolean, string]>([
    ["darwin on macOS", "darwin", notWsl, "darwin"],
    ["win32 on Windows", "win32", notWsl, "win32"],
    ["linux on a plain Linux host", "linux", notWsl, "linux"],
    ["wsl when the Linux host is a WSL distro", "linux", isWslStub, "wsl"],
    ["linux as the fallback on an unrecognized platform", "freebsd", notWsl, "linux"],
  ])("reports %s", (_label, platform, wsl, expected) => {
    expect(detectHostPlatform(platform, wsl)).toBe(expected);
  });
});

describe("detectHostPlatform defaults", () => {
  const realPlatform = process.platform;
  function stubPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
  }
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  });

  // Every other case injects both arguments, so the defaults — "read the real
  // host, and reuse `isWsl` rather than re-reading /proc" — rested on reading
  // the source. Exercise the no-argument call the route actually makes.
  it("uses process.platform and isWsl when called with no arguments", () => {
    stubPlatform("linux");
    vi.mocked(isWsl).mockReturnValue(true);
    expect(detectHostPlatform()).toBe("wsl");
    expect(isWsl).toHaveBeenCalled();

    vi.mocked(isWsl).mockReturnValue(false);
    expect(detectHostPlatform()).toBe("linux");

    stubPlatform("darwin");
    expect(detectHostPlatform()).toBe("darwin");
  });
});
