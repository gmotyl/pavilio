import { describe, it, expect, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const surfaceProps = vi.fn();
vi.mock("../TerminalsSurface", () => ({
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

vi.mock("../useAllTerminalSessions", () => ({
  useAllTerminalSessions: () => ({
    sessions: [{ id: "s1", project: "vector", name: "dev" }],
    refresh: async () => {},
    reorder: () => {},
    tiles,
    placeTiles,
    applyPreset,
  }),
}));
vi.mock("../useTerminalMaximized", () => ({
  useTerminalMaximized: () => [false, () => {}, () => {}],
}));

import { TerminalsPage } from "../TerminalsPage";
// The page reads the panel's one speech host from context.
import {
  readStandaloneTerminalFocus,
  subscribeStandaloneTerminalFocus,
} from "../standaloneTerminalFocus";
import { TerminalSpeechHost } from "../TerminalSpeechHost";

function renderPage() {
  surfaceProps.mockClear();
  render(
    <MemoryRouter>
      <TerminalSpeechHost>
        <TerminalsPage />
      </TerminalSpeechHost>
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

  it("moves the published focus A -> B without an intermediate null, and clears it on unmount", () => {
    const seen: (string | null)[] = [];
    const off = subscribeStandaloneTerminalFocus(() => seen.push(readStandaloneTerminalFocus()));
    const { unmount } = render(
      <MemoryRouter>
        <TerminalSpeechHost>
          <TerminalsPage />
        </TerminalSpeechHost>
      </MemoryRouter>,
    );
    const onFocus = () =>
      surfaceProps.mock.calls[surfaceProps.mock.calls.length - 1][0].onFocus as (id: string) => void;
    act(() => onFocus()("a"));
    act(() => onFocus()("b"));
    expect(seen).toEqual(["a", "b"]);
    unmount();
    expect(seen).toEqual(["a", "b", null]);
    off();
  });
});
