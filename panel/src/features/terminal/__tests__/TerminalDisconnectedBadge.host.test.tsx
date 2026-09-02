import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// Real store, real host. This file deliberately mocks NOTHING the badge or the
// toolbar reads: the property under test is that a real chip survives the badge
// appearing and clearing, which a stubbed connection hook cannot demonstrate.
// Only xterm is faked — jsdom has no canvas/ResizeObserver for it — exactly as
// terminalInstances.test.ts does.
vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        getLine: (_index: number) =>
          undefined as
            | { translateToString: (trim?: boolean) => string }
            | undefined,
      },
    };
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    scrollLines = vi.fn();
    dispose = vi.fn();
    refresh = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    onData = vi.fn((_cb: (data: string) => void) => ({ dispose: vi.fn() }));
  }
  return { Terminal: FakeTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { TerminalToolbar } from "../TerminalToolbar";
import {
  acquireTerminal,
  destroyTerminal,
  __setWebSocketCtorForTests,
} from "../terminalInstances";
import type { SessionMeta } from "../useTerminalSessions";

interface FakeWs {
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
}

const sockets: FakeWs[] = [];

class FakeWebSocket implements FakeWs {
  readyState = 1; // OPEN
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  constructor(public url: string) {
    sockets.push(this);
  }
}

const SESSION_ID = "host-s1";

function session(): SessionMeta {
  return {
    id: SESSION_ID,
    name: "claude-ch",
    project: "ch",
    cwd: "/tmp",
    pid: 1234,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  sockets.length = 0;
  // The reconnect log is fire-and-forget over fetch; jsdom has no server.
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true } as Response)));
  __setWebSocketCtorForTests(
    FakeWebSocket as unknown as new (url: string) => WebSocket,
  );
});

afterEach(() => {
  destroyTerminal(SESSION_ID);
  __setWebSocketCtorForTests(null);
  vi.unstubAllGlobals();
});

describe("TerminalDisconnectedBadge in its real host", () => {
  it("appears and clears without remounting the chip around it", () => {
    // A live session in the pool, then the chrome that lists it.
    acquireTerminal(SESSION_ID);
    const onFocus = vi.fn();
    render(
      <TerminalToolbar
        sessions={[session()]}
        focusedId={SESSION_ID}
        maximized={false}
        currentProject="ch"
        projects={[{ name: "ch" }]}
        repos={[]}
        onFocus={onFocus}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onToggleMaximize={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    // A node of the surrounding chip that has nothing to do with the badge.
    // If the chip remounted, React would build a new element for it.
    const hostNode = screen.getByTestId(`terminal-toolbar-close-${SESSION_ID}`);
    const chip = hostNode.parentElement;
    expect(
      screen.queryByTestId(`terminal-disconnected-${SESSION_ID}`),
    ).not.toBeInTheDocument();

    // The socket dies on its own.
    act(() => {
      sockets[0].readyState = 3;
      sockets[0].onclose?.(new Event("close") as CloseEvent);
    });

    const badge = screen.getByTestId(`terminal-disconnected-${SESSION_ID}`);
    expect(
      screen.getByTestId(`terminal-toolbar-close-${SESSION_ID}`),
    ).toBe(hostNode);
    expect(badge.parentElement).toBe(chip);

    // Repair it the way the user would, then let the fresh socket open.
    act(() => {
      fireEvent.click(badge);
    });
    expect(sockets).toHaveLength(2);
    act(() => {
      sockets[1].onopen?.(new Event("open"));
    });

    expect(
      screen.queryByTestId(`terminal-disconnected-${SESSION_ID}`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`terminal-toolbar-close-${SESSION_ID}`),
    ).toBe(hostNode);
    // The chip focuses on click; activating the badge inside it must not.
    expect(onFocus).not.toHaveBeenCalled();
  });
});
