import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const surfaceProps = vi.fn();
vi.mock("../../features/terminal/TerminalsSurface", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    surfaceProps(props);
    return <div data-testid="surface" />;
  },
  TerminalsSurface: (props: Record<string, unknown>) => {
    surfaceProps(props);
    return <div data-testid="surface" />;
  },
}));

const placeTiles = vi.fn();
const applyPreset = vi.fn();
const tiles = [{ sessionId: "s1", x: 0, y: 0, w: 12, h: 12 }];

vi.mock("../../features/terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: () => ({
    sessions: [{ id: "s1", project: "vector", name: "dev" }],
    refresh: async () => {},
    reorder: () => {},
    tiles,
    placeTiles,
    applyPreset,
  }),
}));
vi.mock("../../features/terminal/useTerminalMaximized", () => ({
  useTerminalMaximized: () => [false, () => {}, () => {}],
}));
vi.mock("../../features/projects/useProjects", () => ({
  useProjects: () => [{ name: "vector", repos: [] }],
}));

import TerminalsPage from "../TerminalsPage";

function renderPage() {
  surfaceProps.mockClear();
  render(
    <MemoryRouter>
      <TerminalsPage />
    </MemoryRouter>,
  );
  return surfaceProps.mock.calls[0][0] as Record<string, unknown>;
}

describe("TerminalsPage", () => {
  it("passes the tiling props to TerminalsSurface", () => {
    const props = renderPage();
    expect(props.tiles).toEqual(tiles);
    for (const name of ["onPlace", "onApplyPreset"]) {
      expect(typeof props[name]).toBe("function");
    }
  });

  it("forwards placement and preset choices to the hook", () => {
    const props = renderPage();
    const layout = [{ sessionId: "s1", x: 0, y: 0, w: 12, h: 12 }];
    const preset = { label: "1 terminal", slots: [{ x: 0, y: 0, w: 12, h: 12 }] };

    (props.onPlace as (l: unknown) => void)(layout);
    (props.onApplyPreset as (p: unknown) => void)(preset);

    expect(placeTiles).toHaveBeenCalledWith(layout);
    expect(applyPreset).toHaveBeenCalledWith(preset);
  });
});
