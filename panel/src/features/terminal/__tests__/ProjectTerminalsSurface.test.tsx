import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const surfaceProps = vi.fn();
vi.mock("../TerminalsSurface", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    surfaceProps(props);
    return <div data-testid="surface">{String(props.currentProject)}</div>;
  },
  TerminalsSurface: (props: Record<string, unknown>) => {
    surfaceProps(props);
    return <div data-testid="surface">{String(props.currentProject)}</div>;
  },
}));
vi.mock("../useTerminalSessions", async (orig) => ({
  ...(await orig<typeof import("../useTerminalSessions")>()),
  useTerminalSessions: () => ({
    sessions: [{ id: "s1", project: "vector", name: "dev" }],
    focusedId: "s1",
    setFocusedId: () => {},
    createSession: async () => {},
    deleteSession: () => {},
    updateSession: () => {},
    reorder: () => {},
    tiles: [{ sessionId: "s1", x: 0, y: 0, w: 12, h: 12 }],
    placeTiles: () => {},
    applyPreset: () => {},
  }),
}));
vi.mock("../useAllTerminalSessions", () => ({
  useAllTerminalSessions: () => ({ sessions: [], refresh: () => {} }),
}));
vi.mock("../useTerminalMaximized", () => ({
  useTerminalMaximized: () => [false, () => {}, () => {}],
}));
vi.mock("../../projects/useProjects", () => ({
  useProjects: () => [{ name: "vector", repos: [] }],
}));
vi.mock("../../projects/useITermShortcuts", () => ({
  useITermShortcuts: vi.fn(),
}));

import ProjectTerminalsSurface from "../ProjectTerminalsSurface";
import { useITermShortcuts } from "../../projects/useITermShortcuts";

describe("ProjectTerminalsSurface", () => {
  it("passes the project's sessions to TerminalsSurface", () => {
    render(
      <MemoryRouter>
        <ProjectTerminalsSurface projectName="vector" active />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("surface")).toHaveTextContent("vector");
    const props = surfaceProps.mock.calls.at(-1)?.[0];
    expect(props.currentProject).toBe("vector");
    expect(props.sessions).toHaveLength(1);
  });

  it("wires useTerminalSessions's tiling and callbacks into TerminalsSurface", () => {
    render(
      <MemoryRouter>
        <ProjectTerminalsSurface projectName="vector" active />
      </MemoryRouter>,
    );
    const props = surfaceProps.mock.calls.at(-1)?.[0];
    expect(props.tiles).toEqual([{ sessionId: "s1", x: 0, y: 0, w: 12, h: 12 }]);
    expect(typeof props.onPlace).toBe("function");
    expect(typeof props.onApplyPreset).toBe("function");
  });

  it("enables iterm shortcuts only when active", () => {
    render(
      <MemoryRouter>
        <ProjectTerminalsSurface projectName="vector" active={false} />
      </MemoryRouter>,
    );
    const call = (useITermShortcuts as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(call.active).toBe(false);
  });
});
