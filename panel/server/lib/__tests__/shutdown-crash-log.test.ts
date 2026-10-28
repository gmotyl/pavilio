import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flushPreferences = vi.fn(() => Promise.resolve());
vi.mock("../preferences-store.js", () => ({ flushPreferences: () => flushPreferences() }));

type Handler = (arg: unknown) => void;

// The real process handlers would outlive the test and swallow vitest's own
// failures, so process.on is captured instead of called.
describe("installCrashLog", () => {
  let handlers: Map<string, Handler>;
  let exit: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    flushPreferences.mockClear();
    handlers = new Map();
    vi.spyOn(process, "on").mockImplementation(((event: string, fn: Handler) => {
      handlers.set(event, fn);
      return process;
    }) as typeof process.on);
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { installCrashLog } = await import("../shutdown");
    installCrashLog();
  });
  afterEach(() => vi.restoreAllMocks());

  it("logs an uncaught exception with a timestamp, flushes, and exits 1", async () => {
    const err = new Error("ENOENT: scandir");
    handlers.get("uncaughtException")!(err);

    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[panel\] \d{4}-\d\d-\d\dT[\d:.]+Z uncaught exception — panel exiting:$/),
      err,
    );
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(flushPreferences).toHaveBeenCalledTimes(1);
  });

  it("treats an unhandled rejection the same way", async () => {
    handlers.get("unhandledRejection")!("boom");

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("unhandled rejection — panel exiting:"),
      "boom",
    );
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
