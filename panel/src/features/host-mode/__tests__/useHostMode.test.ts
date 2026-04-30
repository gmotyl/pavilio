import { describe, it, expect } from "vitest";
import { detectHostMode } from "../useHostMode";

describe("detectHostMode", () => {
  it("returns 'local' for localhost", () => {
    expect(detectHostMode("localhost")).toBe("local");
  });

  it("returns 'local' for 127.0.0.1", () => {
    expect(detectHostMode("127.0.0.1")).toBe("local");
  });

  it("returns 'local' for ::1", () => {
    expect(detectHostMode("::1")).toBe("local");
  });

  it("returns 'local' for [::1]", () => {
    expect(detectHostMode("[::1]")).toBe("local");
  });

  it("is case-insensitive on hostname", () => {
    expect(detectHostMode("LOCALHOST")).toBe("local");
  });

  it("returns 'remote' for an RFC1918 LAN IP", () => {
    expect(detectHostMode("192.168.10.45")).toBe("remote");
  });

  it("returns 'remote' for a Tailscale CGNAT IP", () => {
    expect(detectHostMode("100.70.41.116")).toBe("remote");
  });

  it("returns 'remote' for a *.ts.net hostname", () => {
    expect(detectHostMode("mac.foo.ts.net")).toBe("remote");
  });
});
