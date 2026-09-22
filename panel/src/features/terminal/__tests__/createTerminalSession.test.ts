import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTerminalSession } from "../createTerminalSession";
import { readTerminalFocus, writeTerminalFocus } from "../useTerminalSessions";

/**
 * `writeTerminalFocus` is spied on rather than stubbed out: every test but the
 * last one wants the real thing, and the last one needs it to throw. Spreading
 * the original module keeps `readTerminalFocus` — which those tests assert
 * through — the real implementation.
 */
vi.mock("../useTerminalSessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useTerminalSessions")>();
  return { ...actual, writeTerminalFocus: vi.fn(actual.writeTerminalFocus) };
});

describe("createTerminalSession", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(writeTerminalFocus).mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  it("posts, persists focus, and returns the created session", async () => {
    const created = { id: "s9", project: "vector", name: "vector-2" };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => created });
    const result = await createTerminalSession("vector", []);
    expect(result).toEqual(created);
    expect(readTerminalFocus("vector")).toBe("s9");
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.project).toBe("vector");
    expect(typeof body.name).toBe("string");
  });

  it("returns null on non-ok response without persisting focus", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const result = await createTerminalSession("vector", []);
    expect(result).toBeNull();
    expect(readTerminalFocus("vector")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network"));
    const result = await createTerminalSession("vector", []);
    expect(result).toBeNull();
  });

  it("still returns the session when remembering its focus throws", async () => {
    // The focus write used to sit INSIDE the try that guards the POST, so a
    // throw from it reported a session the server had already created as a
    // failure. The caller reads `null` as "creation failed": no navigation, no
    // focus broadcast, and a live terminal left behind with nothing pointing
    // at it. Losing the remembered focus costs a differently-selected tab.
    const created = { id: "s9", project: "vector", name: "vector-2" };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => created });
    vi.mocked(writeTerminalFocus).mockImplementationOnce(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await createTerminalSession("vector", []);

    expect(result).toEqual(created);
    expect(vi.mocked(writeTerminalFocus)).toHaveBeenCalledWith("vector", "s9");
    expect(warn).toHaveBeenCalled();
  });
});
