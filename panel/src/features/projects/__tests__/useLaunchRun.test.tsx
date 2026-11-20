import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

vi.mock("../startTaskRun", () => ({
  startTaskRun: vi.fn(async () => "new-1"),
}));

const drawer = vi.hoisted(() => ({ visible: false }));
vi.mock("../../terminal/useTerminalDrawer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../terminal/useTerminalDrawer")>()),
  useTerminalDrawerVisible: () => drawer.visible,
}));

vi.mock("../../terminal/useTerminalSessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../terminal/useTerminalSessions")>()),
  dispatchTerminalFocus: vi.fn(),
}));

import { useLaunchRun } from "../useLaunchRun";
import { startTaskRun } from "../startTaskRun";
import { dispatchTerminalFocus } from "../../terminal/useTerminalSessions";

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={["/home"]}>{children}</MemoryRouter>
);

function setup() {
  return renderHook(() => ({ launch: useLaunchRun("my proj"), path: useLocation().pathname }), {
    wrapper,
  });
}

describe("useLaunchRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drawer.visible = false;
  });

  it("focuses the new session and navigates only without a visible drawer", async () => {
    const { result, rerender } = setup();
    await act(() => result.current.launch("claude 'x'"));
    expect(startTaskRun).toHaveBeenCalledWith({ project: "my proj", runLine: "claude 'x'" });
    expect(dispatchTerminalFocus).toHaveBeenCalledWith("my proj", "new-1");
    expect(result.current.path).toBe("/project/my%20proj/iterm");

    drawer.visible = true;
    const second = setup();
    await act(() => second.result.current.launch("pnpm pull"));
    expect(dispatchTerminalFocus).toHaveBeenCalledTimes(2);
    expect(second.result.current.path).toBe("/home");
    rerender();
  });

  it("rejects with the error", async () => {
    vi.mocked(startTaskRun).mockRejectedValueOnce(new Error("boom"));
    const { result } = setup();
    await expect(result.current.launch("x")).rejects.toThrow("boom");
    expect(dispatchTerminalFocus).not.toHaveBeenCalled();
  });
});
