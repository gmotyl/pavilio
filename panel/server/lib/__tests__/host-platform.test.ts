import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../lan", () => ({ isWsl: vi.fn(() => false) }));

import { detectHostPlatform } from "../host-platform";
import { isWsl } from "../lan";

const notWsl = () => false;
const isWslStub = () => true;

describe("detectHostPlatform", () => {
  it("reports darwin on macOS", () => {
    expect(detectHostPlatform("darwin", notWsl)).toBe("darwin");
  });

  it("reports win32 on Windows", () => {
    expect(detectHostPlatform("win32", notWsl)).toBe("win32");
  });

  it("reports linux on a plain Linux host", () => {
    expect(detectHostPlatform("linux", notWsl)).toBe("linux");
  });

  it("reports wsl when the Linux host is a WSL distro", () => {
    expect(detectHostPlatform("linux", isWslStub)).toBe("wsl");
  });

  it("falls back to linux on an unrecognized platform", () => {
    expect(detectHostPlatform("freebsd", notWsl)).toBe("linux");
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
