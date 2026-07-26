import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTerminalSession } from "../createTerminalSession";

describe("createTerminalSession", () => {
  beforeEach(() => localStorage.clear());

  it("posts, persists focus, and returns the created session", async () => {
    const created = { id: "s9", project: "vector", name: "vector-2" };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => created });
    const result = await createTerminalSession("vector", []);
    expect(result).toEqual(created);
    expect(localStorage.getItem("panel-terminal-focus-vector")).toBe("s9");
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.project).toBe("vector");
    expect(typeof body.name).toBe("string");
  });

  it("returns null on non-ok response without persisting focus", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const result = await createTerminalSession("vector", []);
    expect(result).toBeNull();
    expect(localStorage.getItem("panel-terminal-focus-vector")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network"));
    const result = await createTerminalSession("vector", []);
    expect(result).toBeNull();
  });
});
