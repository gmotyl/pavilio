import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectTailscale, __testing } from "../tailscale";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock("node:fs", async (orig) => ({
  ...(await orig<typeof import("node:fs")>()),
  existsSync: vi.fn(),
}));

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

const execMock = vi.mocked(execFile);
const existsMock = vi.mocked(existsSync);

function mockExecOnce(stdout: string, stderr = "", err: Error | null = null) {
  execMock.mockImplementationOnce(((_cmd: string, _args: string[], cb: Function) => {
    cb(err, stdout, stderr);
  }) as never);
}

describe("detectTailscale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __testing.resetBinaryCache();
  });

  it("returns not_installed when no tailscale binary found", async () => {
    existsMock.mockReturnValue(false);
    execMock.mockImplementationOnce(((_c: string, _a: string[], cb: Function) => {
      cb(new Error("not found"), "", "");
    }) as never);
    const res = await detectTailscale(3010);
    expect(res.state).toBe("not_installed");
  });

  it("returns not_logged_in when status reports NeedsLogin", async () => {
    existsMock.mockImplementation((p) => String(p).includes("Applications"));
    mockExecOnce(JSON.stringify({ BackendState: "NeedsLogin" }));
    const res = await detectTailscale(3010);
    expect(res.state).toBe("not_logged_in");
  });

  it("returns off when logged in but no serve config", async () => {
    existsMock.mockImplementation((p) => String(p).includes("Applications"));
    mockExecOnce(
      JSON.stringify({
        BackendState: "Running",
        Self: { DNSName: "mac.tail-abcd.ts.net." },
      })
    );
    mockExecOnce(JSON.stringify({}));
    const res = await detectTailscale(3010);
    expect(res).toMatchObject({ state: "off", selfHost: "mac.tail-abcd.ts.net" });
  });

  it("returns on when serve config points at our port", async () => {
    existsMock.mockImplementation((p) => String(p).includes("Applications"));
    mockExecOnce(
      JSON.stringify({
        BackendState: "Running",
        Self: { DNSName: "mac.tail-abcd.ts.net." },
      })
    );
    mockExecOnce(
      JSON.stringify({
        TCP: { "443": { HTTPS: true } },
        Web: { "mac.tail-abcd.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3010" } } } },
      })
    );
    const res = await detectTailscale(3010);
    expect(res).toMatchObject({
      state: "on",
      selfHost: "mac.tail-abcd.ts.net",
      url: "https://mac.tail-abcd.ts.net",
    });
  });
});
