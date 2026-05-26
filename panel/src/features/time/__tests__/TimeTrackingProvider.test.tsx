import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";

vi.mock("../../terminal/useAllTerminalSessions", () => ({
  useAllTerminalSessions: vi.fn(),
}));

vi.mock("../../terminal/useTerminalActivityChannel", () => ({
  useAggregateActivityState: vi.fn(),
}));

import { useAllTerminalSessions } from "../../terminal/useAllTerminalSessions";
import { useAggregateActivityState } from "../../terminal/useTerminalActivityChannel";
import {
  TimeTrackingProvider,
  useProjectTodayMinutes,
} from "../TimeTrackingProvider";

const NOW = new Date(2026, 4, 26, 10, 0);

const useAllTerminalSessionsMock =
  useAllTerminalSessions as unknown as ReturnType<typeof vi.fn>;
const useAggregateActivityStateMock =
  useAggregateActivityState as unknown as ReturnType<typeof vi.fn>;

interface FakeSession {
  id: string;
  project: string;
}

function setSessions(sessions: FakeSession[]): void {
  useAllTerminalSessionsMock.mockReturnValue({
    sessions,
    refresh: vi.fn(),
    reorder: vi.fn(),
    swapOrder: vi.fn(),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ entry: {} }),
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setSessions([]);
  // Default: per-project busy state lookup returns idle.
  useAggregateActivityStateMock.mockReturnValue({
    state: "idle",
    attentionSinceAt: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function Probe({ project, onValue }: { project: string; onValue: (m: number) => void }) {
  const { todayMinutes } = useProjectTodayMinutes(project);
  onValue(todayMinutes);
  return null;
}

describe("TimeTrackingProvider", () => {
  it("mounts a tracker for every project with an active session", () => {
    setSessions([
      { id: "s1", project: "metro" },
      { id: "s2", project: "ch" },
    ]);

    const metroSeen: number[] = [];
    const chSeen: number[] = [];

    render(
      <TimeTrackingProvider>
        <Probe project="metro" onValue={(m) => metroSeen.push(m)} />
        <Probe project="ch" onValue={(m) => chSeen.push(m)} />
      </TimeTrackingProvider>,
    );

    // Both projects' slots mounted → both report initial 0m.
    expect(metroSeen.at(-1)).toBe(0);
    expect(chSeen.at(-1)).toBe(0);
  });

  it("picks up projects from localStorage even when no live session exists", () => {
    localStorage.setItem(
      "pavilio.time.ch",
      JSON.stringify({
        date: "2026-05-26",
        closedMinutes: 30,
        open: null,
      }),
    );
    setSessions([]);

    const seen: number[] = [];

    render(
      <TimeTrackingProvider>
        <Probe project="ch" onValue={(m) => seen.push(m)} />
      </TimeTrackingProvider>,
    );

    expect(seen.at(-1)).toBe(30);
  });

  it("ignores pavilio.time.report.* pref blobs when scanning", () => {
    localStorage.setItem(
      "pavilio.time.report.ch",
      JSON.stringify({ format: "detailed-text" }),
    );
    setSessions([]);

    const seen: number[] = [];

    render(
      <TimeTrackingProvider>
        <Probe project="ch" onValue={(m) => seen.push(m)} />
      </TimeTrackingProvider>,
    );

    // No accumulator entry for "ch" → consumer reads 0.
    expect(seen.at(-1)).toBe(0);
  });

  it("clears a project's entry when its slot unmounts", () => {
    // Seed LS so the slot reports a non-zero minute count while mounted.
    localStorage.setItem(
      "pavilio.time.ch",
      JSON.stringify({ date: "2026-05-26", closedMinutes: 30, open: null }),
    );
    setSessions([{ id: "s1", project: "ch" }]);

    const seen: number[] = [];

    const { rerender } = render(
      <TimeTrackingProvider>
        <Probe project="ch" onValue={(m) => seen.push(m)} />
      </TimeTrackingProvider>,
    );

    expect(seen.at(-1)).toBe(30);

    // Drop both the session and the LS entry — trackedProjects recomputes
    // to [] → slot unmounts → cleanup deletes ch from minutesByProject.
    localStorage.removeItem("pavilio.time.ch");
    setSessions([]);
    rerender(
      <TimeTrackingProvider>
        <Probe project="ch" onValue={(m) => seen.push(m)} />
      </TimeTrackingProvider>,
    );

    expect(seen.at(-1)).toBe(0);
  });

  it("returns 0 + noop reset when used outside the provider", async () => {
    const seen: number[] = [];

    function ResetProbe() {
      const { todayMinutes, resetToday } = useProjectTodayMinutes("metro");
      seen.push(todayMinutes);
      // Should not throw when called.
      void resetToday();
      return null;
    }

    render(<ResetProbe />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(seen.at(-1)).toBe(0);
  });
});
