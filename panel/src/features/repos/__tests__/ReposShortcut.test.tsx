import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import QuickFinder from "../../search/QuickFinder";
import ReposTab from "../ReposTab";
import { codeFetch, DrivenResizeObserver, REPOS } from "./codeHarness";

class MockWebSocket {
  onmessage: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  close() {}
}

const pill = (name: string) => within(screen.getByRole("group", { name: "Repos view" })).getByRole("button", { name });

function Shell({ repos }: { repos: boolean }) {
  return (
    <MemoryRouter initialEntries={["/project/pavilio/repos?view=prs"]}>
      <QuickFinder />
      {repos && <ReposTab project="pavilio" repos={REPOS} />}
    </MemoryRouter>
  );
}

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.stubGlobal("WebSocket", MockWebSocket);
  codeFetch({ "/api/files/index": () => new Response("[]", { headers: { "Content-Type": "application/json" } }) });
});

describe("Repos tab search shortcut", () => {
  it("Ctrl+P on the repos tab focuses Code search, not the global quick finder", async () => {
    render(<Shell repos />);
    expect(fireEvent.keyDown(window, { key: "p", ctrlKey: true })).toBe(false);
    const input = await screen.findByRole("combobox", { name: "Go to file" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "Quick finder" })).toBeNull();
  });

  it("the quick finder still opens once the repos tab is gone", async () => {
    const { rerender } = render(<Shell repos />);
    rerender(<Shell repos={false} />);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "Quick finder" })).toBeInTheDocument();
  });

  it("ignores repeated, composing and already-handled presses", () => {
    render(<Shell repos />);
    const stop = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", stop, true);
    try {
      fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    } finally {
      window.removeEventListener("keydown", stop, true);
    }
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, repeat: true });
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, isComposing: true });
    expect(pill("PRs")).toHaveAttribute("aria-pressed", "true");
  });
});
