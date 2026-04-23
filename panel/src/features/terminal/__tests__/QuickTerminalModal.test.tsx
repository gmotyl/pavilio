import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import QuickTerminalModal, {
  orderProjectSessions,
  pickFirstSessionId,
  pickInitialSessionId,
} from "../QuickTerminalModal";
import type { SessionMeta } from "../useTerminalSessions";

vi.mock("../TerminalView", () => ({
  default: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`terminal-view-${sessionId}`} />
  ),
  TerminalView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`terminal-view-${sessionId}`} />
  ),
}));

vi.mock("../TerminalActivityLed", () => ({
  TerminalActivityLed: ({ sessionId, title }: { sessionId: string; title?: string }) => (
    <span data-testid={`led-${sessionId}`} title={title} />
  ),
}));

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "s1",
    name: "claude-pavilio",
    color: null,
    project: "pavilio",
    cwd: "/tmp",
    pid: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function LocationSpy({ onLocation }: { onLocation: (pathname: string) => void }) {
  const loc = useLocation();
  onLocation(loc.pathname);
  return null;
}

function renderAt(path: string, onLocation?: (p: string) => void) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QuickTerminalModal />
      {onLocation ? (
        <Routes>
          <Route path="*" element={<LocationSpy onLocation={onLocation} />} />
        </Routes>
      ) : null}
    </MemoryRouter>,
  );
}

function pressCmdO() {
  fireEvent.keyDown(window, { key: "o", metaKey: true });
}

const originalFetch = global.fetch;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("pickFirstSessionId / orderProjectSessions", () => {
  it("returns null when no sessions match the project", () => {
    expect(pickFirstSessionId([], "pavilio")).toBeNull();
    expect(
      pickFirstSessionId([makeSession({ project: "other" })], "pavilio"),
    ).toBeNull();
  });

  it("falls back to creation order when no stored order exists", () => {
    const a = makeSession({ id: "a" });
    const b = makeSession({ id: "b" });
    expect(pickFirstSessionId([a, b], "pavilio")).toBe("a");
  });

  it("honors persisted order in localStorage", () => {
    const a = makeSession({ id: "a" });
    const b = makeSession({ id: "b" });
    localStorage.setItem(
      "panel-terminal-order-pavilio",
      JSON.stringify(["b", "a"]),
    );
    expect(pickFirstSessionId([a, b], "pavilio")).toBe("b");
    const ordered = orderProjectSessions([a, b], "pavilio");
    expect(ordered.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("pickInitialSessionId", () => {
  it("prefers the last-focused session when still alive", () => {
    const a = makeSession({ id: "a" });
    const b = makeSession({ id: "b" });
    localStorage.setItem("panel-terminal-focus-pavilio", "b");
    expect(pickInitialSessionId([a, b], "pavilio")).toBe("b");
  });

  it("falls back to first when the last-focused session is gone", () => {
    const a = makeSession({ id: "a" });
    localStorage.setItem("panel-terminal-focus-pavilio", "zombie");
    expect(pickInitialSessionId([a], "pavilio")).toBe("a");
  });

  it("ignores a last-focused id from a different project", () => {
    const a = makeSession({ id: "a", project: "pavilio" });
    const b = makeSession({ id: "b", project: "other" });
    localStorage.setItem("panel-terminal-focus-pavilio", "b");
    expect(pickInitialSessionId([a, b], "pavilio")).toBe("a");
  });
});

describe("QuickTerminalModal", () => {
  it("does not render when closed", () => {
    renderAt("/project/pavilio");
    expect(
      screen.queryByTestId("quick-terminal-modal"),
    ).not.toBeInTheDocument();
  });

  it("opens on cmd+O and renders the last-focused terminal", async () => {
    localStorage.setItem("panel-terminal-focus-pavilio", "t2");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        makeSession({ id: "t1" }),
        makeSession({ id: "t2", name: "claude-pavilio-2" }),
      ],
    }) as unknown as typeof fetch;

    renderAt("/project/pavilio");
    pressCmdO();

    await waitFor(() =>
      expect(screen.getByTestId("terminal-view-t2")).toBeInTheDocument(),
    );
  });

  it("falls back to the first terminal when no last-focus stored", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [makeSession({ id: "t1" })],
    }) as unknown as typeof fetch;

    renderAt("/project/pavilio");
    pressCmdO();
    await waitFor(() =>
      expect(screen.getByTestId("terminal-view-t1")).toBeInTheDocument(),
    );
  });

  it("does NOT open when not on a project route", () => {
    global.fetch = vi.fn();
    renderAt("/");
    pressCmdO();
    expect(
      screen.queryByTestId("quick-terminal-modal"),
    ).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does NOT open when already on the iTerm section", () => {
    global.fetch = vi.fn();
    renderAt("/project/pavilio/iterm");
    pressCmdO();
    expect(
      screen.queryByTestId("quick-terminal-modal"),
    ).not.toBeInTheDocument();
  });

  it("cmd+O again closes when already open", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [makeSession({ id: "t1" })],
    }) as unknown as typeof fetch;

    renderAt("/project/pavilio");
    pressCmdO();
    await waitFor(() =>
      expect(screen.getByTestId("quick-terminal-modal")).toBeInTheDocument(),
    );
    pressCmdO();
    expect(
      screen.queryByTestId("quick-terminal-modal"),
    ).not.toBeInTheDocument();
  });

  it("does NOT close on Escape (passes through to xterm)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [makeSession({ id: "t1" })],
    }) as unknown as typeof fetch;

    renderAt("/project/pavilio");
    pressCmdO();
    await waitFor(() =>
      expect(screen.getByTestId("quick-terminal-modal")).toBeInTheDocument(),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("quick-terminal-modal")).toBeInTheDocument();
  });

  it("click outside closes the modal", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [makeSession({ id: "t1" })],
    }) as unknown as typeof fetch;

    renderAt("/project/pavilio");
    pressCmdO();
    const backdrop = await waitFor(() =>
      screen.getByTestId("quick-terminal-modal"),
    );
    fireEvent.click(backdrop);
    expect(
      screen.queryByTestId("quick-terminal-modal"),
    ).not.toBeInTheDocument();
  });

  it("close button closes the modal", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [makeSession({ id: "t1" })],
    }) as unknown as typeof fetch;

    renderAt("/project/pavilio");
    pressCmdO();
    await waitFor(() =>
      expect(screen.getByTestId("quick-terminal-modal")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(
      screen.queryByTestId("quick-terminal-modal"),
    ).not.toBeInTheDocument();
  });

  it("shows empty state when the project has no sessions", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [makeSession({ project: "other" })],
    }) as unknown as typeof fetch;

    renderAt("/project/pavilio");
    pressCmdO();
    await waitFor(() =>
      expect(
        screen.getByText(/no terminal in this project/i),
      ).toBeInTheDocument(),
    );
  });

  it("dropdown lists current-project terminals and swaps selection on click", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        makeSession({ id: "t1", name: "claude-pavilio-1" }),
        makeSession({ id: "t2", name: "claude-pavilio-2" }),
        makeSession({ id: "x1", project: "other", name: "elsewhere" }),
      ],
    }) as unknown as typeof fetch;

    renderAt("/project/pavilio");
    pressCmdO();
    await waitFor(() =>
      expect(screen.getByTestId("terminal-view-t1")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("quick-terminal-project-dropdown"));
    const menu = await waitFor(() =>
      screen.getByTestId("quick-terminal-project-menu"),
    );
    const options = menu.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(menu.textContent).toContain("claude-pavilio-1");
    expect(menu.textContent).toContain("claude-pavilio-2");
    expect(menu.textContent).not.toContain("elsewhere");

    fireEvent.click(options[1]);
    await waitFor(() =>
      expect(screen.getByTestId("terminal-view-t2")).toBeInTheDocument(),
    );
    expect(localStorage.getItem("panel-terminal-focus-pavilio")).toBe("t2");
  });

  it("global dots render for terminals from every project", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        makeSession({ id: "t1" }),
        makeSession({ id: "x1", project: "other", name: "far" }),
        makeSession({ id: "x2", project: "metro", name: "m-1" }),
      ],
    }) as unknown as typeof fetch;

    renderAt("/project/pavilio");
    pressCmdO();
    await waitFor(() =>
      expect(screen.getByTestId("terminal-view-t1")).toBeInTheDocument(),
    );

    expect(screen.getByTestId("quick-terminal-dot-t1")).toBeInTheDocument();
    expect(screen.getByTestId("quick-terminal-dot-x1")).toBeInTheDocument();
    expect(screen.getByTestId("quick-terminal-dot-x2")).toBeInTheDocument();
    expect(screen.getByTestId("quick-terminal-dot-x1")).toHaveAttribute(
      "title",
      "other / far",
    );
    expect(screen.getByTestId("quick-terminal-dot-t1")).toHaveAttribute(
      "title",
      "claude-pavilio",
    );
  });

  it("clicking a same-project dot swaps selection without navigation", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        makeSession({ id: "t1" }),
        makeSession({ id: "t2", name: "claude-pavilio-2" }),
      ],
    }) as unknown as typeof fetch;

    let currentPath = "/project/pavilio";
    renderAt(currentPath, (p) => (currentPath = p));
    pressCmdO();
    await waitFor(() =>
      expect(screen.getByTestId("terminal-view-t1")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("quick-terminal-dot-t2"));
    await waitFor(() =>
      expect(screen.getByTestId("terminal-view-t2")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("quick-terminal-modal")).toBeInTheDocument();
    expect(currentPath).toBe("/project/pavilio");
  });

  it("clicking a different-project dot closes modal and navigates to that project's iterm", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        makeSession({ id: "t1" }),
        makeSession({ id: "x1", project: "metro", name: "metro-1" }),
      ],
    }) as unknown as typeof fetch;

    let currentPath = "/project/pavilio";
    renderAt(currentPath, (p) => (currentPath = p));
    pressCmdO();
    await waitFor(() =>
      expect(screen.getByTestId("terminal-view-t1")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("quick-terminal-dot-x1"));
    await waitFor(() =>
      expect(screen.queryByTestId("quick-terminal-modal")).not.toBeInTheDocument(),
    );
    expect(currentPath).toBe("/project/metro/iterm");
    expect(localStorage.getItem("panel-terminal-focus-metro")).toBe("x1");
  });
});
