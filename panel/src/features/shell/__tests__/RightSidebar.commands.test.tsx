import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RightSidebar from "../RightSidebar";

// Stub WebSocket since FileTree's useFileIndex depends on useWebSocket
class MockWebSocket {
  onmessage: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  close() {}
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockWebSocket);
  // Mock fetch so FileTree's useFileIndex calls don't error in jsdom
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
});

describe("RightSidebar Commands section", () => {
  it("renders a Commands section with Claude and OpenCode sub-tree labels", () => {
    render(
      <MemoryRouter>
        <RightSidebar />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /commands/i })).toBeInTheDocument();
    expect(screen.getByText(/\.claude\/commands/i)).toBeInTheDocument();
    expect(screen.getByText(/\.opencode\/commands/i)).toBeInTheDocument();
  });
});
