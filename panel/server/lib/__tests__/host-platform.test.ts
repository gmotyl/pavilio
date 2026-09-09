import { describe, it, expect } from "vitest";
import { detectHostPlatform } from "../host-platform";

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
