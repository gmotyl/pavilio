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

const mergeColumn = vi.fn();
const joinColumn = vi.fn();
const splitColumn = vi.fn();
const applyPreset = vi.fn();
const columnLayout = [[{ sessionId: "s1", weight: 1 }]];

vi.mock("../../features/terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: () => ({
    sessions: [{ id: "s1", project: "vector", name: "dev" }],
    refresh: async () => {},
    reorder: () => {},
    swapOrder: () => {},
    columnLayout,
    mergeColumn,
    joinColumn,
    splitColumn,
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
  it("passes the column layout props to TerminalsSurface", () => {
    const props = renderPage();
    expect(props.columnLayout).toEqual(columnLayout);
    for (const name of [
      "onMergeColumn",
      "onJoinColumn",
      "onSplitColumn",
      "onApplyPreset",
    ]) {
      expect(typeof props[name]).toBe("function");
    }
  });

  it("forwards merge/join/split/preset to the hook", () => {
    const props = renderPage();
    (props.onMergeColumn as (a: string, b: string) => void)("a", "b");
    (props.onJoinColumn as (a: string, b: string) => void)("a", "c");
    (props.onSplitColumn as (a: string, i: number) => void)("a", 1);
    (props.onApplyPreset as (sizes: number[]) => void)([1, 2]);
    expect(mergeColumn).toHaveBeenCalledWith("a", "b");
    expect(joinColumn).toHaveBeenCalledWith("a", "c");
    expect(splitColumn).toHaveBeenCalledWith("a", 1);
    expect(applyPreset).toHaveBeenCalledWith([1, 2]);
  });
});
