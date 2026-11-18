import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flushPreferences = vi.fn(() => Promise.resolve());
vi.mock("../preferences-store.js", () => ({ flushPreferences: () => flushPreferences() }));

const SCHEDULE = { hupToTermMs: null, termToKillMs: 500, afterKillMs: 0 };
const closeAllSessions = vi.fn((_schedule: unknown) => Promise.resolve());
vi.mock("../terminal-manager.js", () => ({
  SHUTDOWN_SCHEDULE: SCHEDULE,
  closeAllSessions: (schedule: unknown) => closeAllSessions(schedule),
}));

type Handler = (arg: unknown) => void;

// process.on is captured and process.exit stubbed so nothing real is signalled;
// timers are fake so the 1 s fallback can be stepped through.
describe("shutdown closes terminal sessions", () => {
  let handlers: Map<string, Handler>;
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    flushPreferences.mockReset();
    flushPreferences.mockImplementation(() => Promise.resolve());
    closeAllSessions.mockReset();
    closeAllSessions.mockImplementation(() => Promise.resolve());
    handlers = new Map();
    vi.spyOn(process, "on").mockImplementation(((event: string, fn: Handler) => {
      handlers.set(event, fn);
      return process;
    }) as typeof process.on);
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { installPreferenceFlush, installCrashLog } = await import("../shutdown");
    installPreferenceFlush();
    installCrashLog();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a termination signal closes all sessions before exiting", async () => {
    let finish!: () => void;
    closeAllSessions.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    handlers.get("SIGTERM")!(undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect(closeAllSessions).toHaveBeenCalledWith(SCHEDULE);
    expect(flushPreferences).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(143);
  });

  it("a crash closes all sessions before exiting", async () => {
    let finish!: () => void;
    closeAllSessions.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    handlers.get("uncaughtException")!(new Error("boom"));
    await vi.advanceTimersByTimeAsync(0);

    expect(closeAllSessions).toHaveBeenCalledWith(SCHEDULE);
    expect(exit).not.toHaveBeenCalled();

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exit is not delayed past the timeout by a hanging close", async () => {
    closeAllSessions.mockImplementation(() => new Promise(() => {}));
    handlers.get("SIGINT")!(undefined);

    await vi.advanceTimersByTimeAsync(999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(130);
  });

  it("a rejected close still lets the process exit", async () => {
    closeAllSessions.mockImplementation(() => Promise.reject(new Error("kill failed")));
    handlers.get("SIGHUP")!(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledWith(129);
  });
});
