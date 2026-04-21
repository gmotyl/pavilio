import { describe, expect, it, vi } from "vitest";
import { shiftEnterHandler } from "../terminalInstances";

describe("shiftEnterHandler", () => {
  it("pastes '\\n' and returns false on Shift+Enter keydown", () => {
    const paste = vi.fn();
    const handler = shiftEnterHandler({ paste });

    const result = handler({ type: "keydown", key: "Enter", shiftKey: true });

    expect(paste).toHaveBeenCalledTimes(1);
    expect(paste).toHaveBeenCalledWith("\n");
    expect(result).toBe(false);
  });

  it("returns true and does not paste on plain Enter keydown", () => {
    const paste = vi.fn();
    const handler = shiftEnterHandler({ paste });

    const result = handler({ type: "keydown", key: "Enter", shiftKey: false });

    expect(paste).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("returns true on Shift+Enter keyup (only fires on keydown)", () => {
    const paste = vi.fn();
    const handler = shiftEnterHandler({ paste });

    const result = handler({ type: "keyup", key: "Enter", shiftKey: true });

    expect(paste).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("returns true on Shift+A keydown (non-Enter key)", () => {
    const paste = vi.fn();
    const handler = shiftEnterHandler({ paste });

    const result = handler({ type: "keydown", key: "A", shiftKey: true });

    expect(paste).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
