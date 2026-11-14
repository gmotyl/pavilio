import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { installMatchMedia } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import FocusToggle from "../FocusToggle";

let patches: Record<string, unknown>[];

beforeEach(() => {
  installMatchMedia();
  patches = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input) === "/api/preferences" && init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FocusToggle", () => {
  it("focus persists through the preference and applies across projects", async () => {
    // One global, portable key: no project scope to tell two projects apart.
    expect(preferences.focusLayout.scope).toBe("global");
    expect(preferences.focusLayout.portable).toBe(true);

    // Two mounted consumers stand in for two project views (or two tabs fed
    // by the same store): flipping one flips both.
    const { unmount } = render(
      <>
        <div data-testid="project-a">
          <FocusToggle />
        </div>
        <div data-testid="project-b">
          <FocusToggle />
        </div>
      </>,
    );
    const [a, b] = screen.getAllByTestId("focus-layout-toggle");
    expect(a).toHaveAttribute("aria-pressed", "false");
    expect(b).toHaveAttribute("aria-pressed", "false");

    act(() => a.click());
    expect(a).toHaveAttribute("aria-pressed", "true");
    expect(b).toHaveAttribute("aria-pressed", "true");

    // Persisted to the workspace preferences file, which is what a reload —
    // and every other open tab, through the channel — reads back.
    await waitFor(() =>
      expect(patches).toContainEqual(expect.objectContaining({ "layout.focus": true })),
    );
    unmount();

    // "Reload": a fresh mount reads the injected document.
    render(<FocusToggle />);
    expect(screen.getByTestId("focus-layout-toggle")).toHaveAttribute("aria-pressed", "true");
  });
});
