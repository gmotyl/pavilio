import { describe, it, expect } from "vitest";
import { detectHostMode } from "../useHostMode";

describe("detectHostMode", () => {
  it.each([
    ["localhost", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
    ["::1", "::1"],
    ["[::1]", "[::1]"],
    ["LOCALHOST (case-insensitive)", "LOCALHOST"],
  ])("returns 'local' for %s", (_label, hostname) => {
    expect(detectHostMode(hostname)).toBe("local");
  });

  it.each([
    ["an RFC1918 LAN IP", "192.168.10.45"],
    ["a Tailscale CGNAT IP", "100.70.41.116"],
    ["a *.ts.net hostname", "mac.foo.ts.net"],
  ])("returns 'remote' for %s", (_label, hostname) => {
    expect(detectHostMode(hostname)).toBe("remote");
  });
});
