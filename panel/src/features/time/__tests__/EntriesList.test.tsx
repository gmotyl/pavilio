import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { EntriesList } from "../EntriesList";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("EntriesList", () => {
  it("renders empty state when no entries", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entries: [], totals: { busyMinutes: 0, manualMinutes: 0 } }),
    }) as unknown as typeof fetch;
    render(<EntriesList project="metro" />);
    await waitFor(() => expect(screen.getByText("No entries yet.")).toBeInTheDocument());
  });

  it("shows only manual entries in the list (busy_blocks contribute to totals but not the list)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [
          { id: "a", type: "manual", date: "2026-05-25", minutes: 90, note: "PR review" },
          { id: "b", type: "busy_block", date: "2026-05-25", start: "2026-05-25T14:00:00Z", end: "2026-05-25T14:30:00Z", minutes: 30 },
          { id: "c", type: "reset", date: "2026-05-25", ts: "2026-05-25T12:00:00Z" },
        ],
        totals: { busyMinutes: 30, manualMinutes: 90 },
      }),
    }) as unknown as typeof fetch;
    render(<EntriesList project="metro" />);
    await waitFor(() => expect(screen.getByText("PR review")).toBeInTheDocument());
    // Auto-tracked total still shows
    expect(screen.getByText("30m")).toBeInTheDocument();
    // [manual]/[auto] tags are gone
    expect(screen.queryByText("[manual]")).toBeNull();
    expect(screen.queryByText("[auto]")).toBeNull();
    // busy_block entry should NOT render as a list row (time-range absent)
    expect(screen.queryByText(/14:00.*14:30/)).toBeNull();
    // reset entries shouldn't appear visually
    expect(screen.queryByText(/reset/i)).toBeNull();
  });

  it("re-fetches when refreshKey changes", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entries: [], totals: { busyMinutes: 0, manualMinutes: 0 } }),
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    const { rerender } = render(<EntriesList project="metro" refreshKey={1} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    rerender(<EntriesList project="metro" refreshKey={2} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });
});
