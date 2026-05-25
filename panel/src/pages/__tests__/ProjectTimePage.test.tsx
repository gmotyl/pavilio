import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../features/terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: () => ({
    sessions: [],
    refresh: vi.fn(),
    reorder: vi.fn(),
    swapOrder: vi.fn(),
  }),
}));

vi.mock("../../features/terminal/useTerminalActivityChannel", () => ({
  useAggregateActivityState: () => ({ state: "idle", attentionSinceAt: null }),
}));

import ProjectTimePage from "../ProjectTimePage";

let fetchMock: ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/project/metro/time"]}>
      <Routes>
        <Route path="/project/:name/time" element={<ProjectTimePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-25T12:00:00Z"));
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ entries: [], totals: { busyMinutes: 0, manualMinutes: 0 } }),
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("ProjectTimePage", () => {
  it("renders the project name in the header", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "metro · Time",
    );
  });

  it("renders the today total and the reset button", () => {
    renderPage();
    expect(screen.getByText(/Today:/)).toBeInTheDocument();
    expect(screen.getByTestId("time-reset-today")).toBeInTheDocument();
  });

  it("clicking Reset today calls window.confirm and triggers reset on confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId("time-reset-today"));
    });
    expect(confirmSpy).toHaveBeenCalledWith("Reset today's time for metro?");
    const auditCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/time/append" && init?.method === "POST",
    );
    expect(auditCall).toBeDefined();
    const body = JSON.parse(auditCall![1].body as string);
    expect(body.project).toBe("metro");
    expect(body.entry.type).toBe("reset");
    expect(body.entry.date).toBe("2026-05-25");
  });

  it("does not POST when the user cancels the confirm dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId("time-reset-today"));
    });
    expect(confirmSpy).toHaveBeenCalled();
    const auditCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/time/append" && init?.method === "POST",
    );
    expect(auditCall).toBeUndefined();
  });

  it("renders the manual entry form, reset button, and report block", async () => {
    renderPage();
    expect(screen.getByTestId("time-manual-entry-save")).toBeInTheDocument();
    expect(screen.getByTestId("time-reset-today")).toBeInTheDocument();
    expect(screen.getByTestId("time-report-period")).toBeInTheDocument();
  });

  it("refreshes EntriesList after the manual entry form saves", async () => {
    vi.useRealTimers();
    renderPage();

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        ([url]) => typeof url === "string" && url.startsWith("/api/time/today"),
      );
      expect(calls.length).toBeGreaterThan(0);
    });
    const initialTodayCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === "string" && url.startsWith("/api/time/today"),
    ).length;

    const durationInput = screen.getByLabelText(
      "Duration (HH:MM or minutes)",
    ) as HTMLInputElement;
    fireEvent.change(durationInput, { target: { value: "30" } });
    fireEvent.click(screen.getByTestId("time-manual-entry-save"));

    await waitFor(() => {
      const todayCalls = fetchMock.mock.calls.filter(
        ([url]) => typeof url === "string" && url.startsWith("/api/time/today"),
      ).length;
      expect(todayCalls).toBeGreaterThan(initialTodayCalls);
    });
  });
});
