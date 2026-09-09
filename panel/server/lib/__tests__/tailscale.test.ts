import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// `resolveBinary` reads `process.platform` at call time, so the platform is the
// one knob these tests turn. The suite runs on Linux, so every test that wants
// today's macOS candidate-path behaviour has to say so explicitly.
// Both module-level caches have to go between tests: the resolved binary and
// the per-port detection snapshot.
function resetCaches() {
  __testing.resetBinaryCache();
  __testing.resetSnapshotCache();
}

const realPlatform = process.platform;
function stubPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}
afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
});

describe("enableServe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCaches();
    stubPlatform("darwin");
    existsMock.mockImplementation((p) => String(p).includes("Applications"));
  });

  it("runs tailscale serve with correct args and returns on state", async () => {
    mockExecOnce(""); // the serve command itself
    mockExecOnce(
      JSON.stringify({ BackendState: "Running", Self: { DNSName: "mac.foo.ts.net." } })
    );
    mockExecOnce(
      JSON.stringify({
        Web: { "mac.foo.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3010" } } } },
      })
    );
    const { enableServe } = await import("../tailscale");
    const res = await enableServe(3010);
    expect(res.state).toBe("on");
    expect(execMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("Tailscale"),
      ["serve", "--bg", "--https=443", "http://127.0.0.1:3010"],
      expect.any(Function)
    );
  });

  it("maps HTTPS-not-enabled stderr to hint", async () => {
    execMock.mockImplementationOnce(((_c: string, _a: string[], cb: Function) => {
      cb(new Error("exit 1"), "", "HTTPS is not enabled for this tailnet");
    }) as never);
    const { enableServe } = await import("../tailscale");
    const res = await enableServe(3010);
    expect(res).toMatchObject({ state: "error", hint: "https_not_enabled" });
  });
});

describe("disableServe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCaches();
    stubPlatform("darwin");
    existsMock.mockImplementation((p) => String(p).includes("Applications"));
  });

  it("runs serve reset then returns off state", async () => {
    mockExecOnce(""); // reset
    mockExecOnce(
      JSON.stringify({ BackendState: "Running", Self: { DNSName: "mac.foo.ts.net." } })
    );
    mockExecOnce(JSON.stringify({}));
    const { disableServe } = await import("../tailscale");
    const res = await disableServe(3010);
    expect(res.state).toBe("off");
    expect(execMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("Tailscale"),
      ["serve", "reset"],
      expect.any(Function)
    );
  });
});

describe("detectTailscale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCaches();
    stubPlatform("darwin");
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

describe("detectTailscale daemon_down", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCaches();
    stubPlatform("darwin");
    existsMock.mockImplementation((p) => String(p).includes("Applications"));
  });

  it("flags a stopped daemon with the daemon_down hint", async () => {
    mockExecOnce("", "", new Error("failed to connect to local tailscaled; is tailscaled running?"));
    const res = await detectTailscale(3010);
    expect(res).toMatchObject({ state: "error", hint: "daemon_down" });
  });

  it("flags a stopped daemon reported only on stderr", async () => {
    // Mixed case on purpose: the match must be case-insensitive, and the CLI
    // puts this wording on stderr while the error itself is only "exit 1".
    mockExecOnce("", "Failed to connect to local Tailscaled", new Error("exit 1"));
    const res = await detectTailscale(3010);
    expect(res).toMatchObject({ state: "error", hint: "daemon_down" });
  });

  it("carries the CLI text alongside the daemon_down sentence", async () => {
    // The CLI prints the same connect-failure wording when the daemon IS up but
    // its socket is not readable by this user (the `tailscale set --operator`
    // case). The friendly sentence is wrong there, so the CLI's own words are
    // the only evidence that tells the two situations apart — keep them.
    mockExecOnce(
      "",
      "failed to connect to local tailscaled; permission denied on /var/run/tailscale/tailscaled.sock",
      new Error("exit 1")
    );
    const res = await detectTailscale(3010);
    expect(res).toMatchObject({ state: "error", hint: "daemon_down" });
    const { error } = res as { error: string };
    expect(error).toMatch(
      /^tailscaled is not running on this host\. Start it, then try again\./
    );
    expect(error).toContain("permission denied on /var/run/tailscale/tailscaled.sock");
  });

  it("logs the underlying daemon failure", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExecOnce("", "failed to connect to local tailscaled", new Error("exit 1"));
    await detectTailscale(3010);
    expect(errorLog).toHaveBeenCalledWith("[tailscale] status failed", {
      msg: "exit 1",
      stderr: "failed to connect to local tailscaled",
    });
    errorLog.mockRestore();
  });

  it("leaves an unrelated status failure without a hint", async () => {
    mockExecOnce("", "", new Error("boom"));
    const res = await detectTailscale(3010);
    expect(res.state).toBe("error");
    expect(res).not.toHaveProperty("hint");
    expect((res as { error: string }).error).toContain("tailscale status failed: boom");
  });
});

describe("resolveBinary platform scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCaches();
  });

  it("skips the macOS candidate paths on a non-darwin host", async () => {
    stubPlatform("linux");
    // Would resolve every candidate path if they were probed at all.
    existsMock.mockReturnValue(true);
    mockExecOnce("/usr/bin/tailscale\n"); // which tailscale
    mockExecOnce(JSON.stringify({ BackendState: "NeedsLogin" }));
    const res = await detectTailscale(3010);
    expect(res.state).toBe("not_logged_in");
    expect(existsMock).not.toHaveBeenCalled();
    expect(execMock).toHaveBeenNthCalledWith(1, "which", ["tailscale"], expect.any(Function));
  });

  it("still probes the macOS candidate paths on darwin", async () => {
    stubPlatform("darwin");
    existsMock.mockImplementation((p) => String(p).includes("Applications"));
    mockExecOnce(JSON.stringify({ BackendState: "NeedsLogin" }));
    const res = await detectTailscale(3010);
    expect(res.state).toBe("not_logged_in");
    expect(existsMock).toHaveBeenCalledWith("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
    expect(execMock).toHaveBeenNthCalledWith(
      1,
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      ["status", "--json"],
      expect.any(Function)
    );
  });

  it("resolves the binary from which on a Linux host", async () => {
    stubPlatform("linux");
    existsMock.mockReturnValue(false);
    mockExecOnce("/usr/bin/tailscale\n"); // which tailscale
    mockExecOnce(JSON.stringify({ BackendState: "NeedsLogin" }));
    mockExecOnce(JSON.stringify({ BackendState: "NeedsLogin" }));
    // Two different ports so a later per-port state cache cannot absorb the
    // second call — the point here is that `which` runs only once.
    expect((await detectTailscale(3010)).state).toBe("not_logged_in");
    expect((await detectTailscale(3011)).state).toBe("not_logged_in");
    expect(execMock).toHaveBeenCalledTimes(3);
    expect(execMock.mock.calls.filter((c) => c[0] === "which")).toHaveLength(1);
    expect(execMock).toHaveBeenNthCalledWith(
      2,
      "/usr/bin/tailscale",
      ["status", "--json"],
      expect.any(Function)
    );
  });
});

describe("detectTailscale TTL cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCaches();
    stubPlatform("darwin");
    existsMock.mockImplementation((p) => String(p).includes("Applications"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // One full probe: `status --json` then `serve status --json`, no serve config.
  function mockOffProbe() {
    mockExecOnce(
      JSON.stringify({ BackendState: "Running", Self: { DNSName: "host.foo.ts.net." } })
    );
    mockExecOnce(JSON.stringify({}));
  }

  it("runs the CLI once for repeated calls inside the TTL", async () => {
    mockOffProbe();
    const first = await detectTailscale(3010);
    const second = await detectTailscale(3010);
    expect(first).toMatchObject({ state: "off", selfHost: "host.foo.ts.net" });
    expect(second).toEqual(first);
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("re-runs the CLI when fresh is requested", async () => {
    mockOffProbe();
    await detectTailscale(3010);
    mockOffProbe();
    expect((await detectTailscale(3010, { fresh: true })).state).toBe("off");
    expect(execMock).toHaveBeenCalledTimes(4);
  });

  it("re-runs the CLI after the TTL elapses", async () => {
    vi.useFakeTimers();
    mockOffProbe();
    await detectTailscale(3010);
    vi.advanceTimersByTime(2600);
    mockOffProbe();
    expect((await detectTailscale(3010)).state).toBe("off");
    expect(execMock).toHaveBeenCalledTimes(4);
  });

  it("does not reuse a snapshot across ports", async () => {
    mockOffProbe();
    await detectTailscale(3010);
    mockOffProbe();
    expect((await detectTailscale(3011)).state).toBe("off");
    expect(execMock).toHaveBeenCalledTimes(4);
  });

  it("invalidates the snapshot after enabling serve", async () => {
    mockOffProbe();
    expect((await detectTailscale(3010)).state).toBe("off");
    mockExecOnce(""); // the serve command itself
    mockExecOnce(
      JSON.stringify({ BackendState: "Running", Self: { DNSName: "host.foo.ts.net." } })
    );
    mockExecOnce(
      JSON.stringify({
        Web: { "host.foo.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3010" } } } },
      })
    );
    const { enableServe } = await import("../tailscale");
    // Would still report the stale `off` snapshot if enabling did not invalidate.
    expect(await enableServe(3010)).toMatchObject({ state: "on" });
  });

  it("caches a not_installed result for the TTL", async () => {
    stubPlatform("linux");
    existsMock.mockReturnValue(false);
    mockExecOnce("", "", new Error("not found")); // which tailscale
    expect((await detectTailscale(3010)).state).toBe("not_installed");
    expect((await detectTailscale(3010)).state).toBe("not_installed");
    expect(execMock).toHaveBeenCalledTimes(1);
  });
});
