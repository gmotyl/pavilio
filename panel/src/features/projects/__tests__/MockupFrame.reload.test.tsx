import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../shell/vscode", () => ({
  openInVSCode: vi.fn(),
}));

// The realtime frame the frame sees; reassigned, then the tree re-rendered.
const realtime = vi.hoisted(() => ({ lastMessage: null as Record<string, unknown> | null }));
vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: realtime.lastMessage }),
}));

import MockupFrame from "../MockupFrame";
import { __resetWorkspaceRootForTests } from "../useWorkspaceRoot";

const PNG_PATH = "pavilio/mockups/2026-10-07-hero.png";
const PNG_ABSOLUTE = "/root/git/prv/projects/projects/pavilio/mockups/2026-10-07-hero.png";
const RAW = "/api/files/raw/pavilio/mockups/2026-10-07-hero.png";

beforeEach(() => {
  __resetWorkspaceRootForTests();
  realtime.lastMessage = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ wslDistro: null, workspaceRoot: "/root/git/prv/projects" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const image = () => screen.getByTestId("mockup-viewer-image");

describe("MockupFrame image live reload", () => {
  it("busts the image cache when the open image changes on disk", () => {
    const { rerender } = render(<MockupFrame filePath={PNG_PATH} absolutePath={PNG_ABSOLUTE} />);
    expect(image()).toHaveAttribute("src", RAW);

    realtime.lastMessage = { type: "file-change", path: PNG_PATH };
    rerender(<MockupFrame filePath={PNG_PATH} absolutePath={PNG_ABSOLUTE} />);
    expect(image()).toHaveAttribute("src", `${RAW}?v=1`);

    // A fresh frame object for the same file bumps again
    realtime.lastMessage = { type: "file-change", path: PNG_PATH };
    rerender(<MockupFrame filePath={PNG_PATH} absolutePath={PNG_ABSOLUTE} />);
    expect(image()).toHaveAttribute("src", `${RAW}?v=2`);
  });

  it("ignores changes to other files", () => {
    const { rerender } = render(<MockupFrame filePath={PNG_PATH} absolutePath={PNG_ABSOLUTE} />);

    realtime.lastMessage = { type: "file-change", path: "pavilio/mockups/other.png" };
    rerender(<MockupFrame filePath={PNG_PATH} absolutePath={PNG_ABSOLUTE} />);
    expect(image()).toHaveAttribute("src", RAW);
  });
});
