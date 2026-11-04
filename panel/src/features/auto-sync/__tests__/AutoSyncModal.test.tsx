import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const syncNow = vi.fn(async () => {});
const refresh = vi.fn();
let mockStatus: any = null;

vi.mock("../useAutoSyncStatus", () => ({
  useAutoSyncStatus: () => ({ status: mockStatus, syncNow, refresh, enable: vi.fn(), disable: vi.fn() }),
}));

import { AutoSyncModal } from "../AutoSyncModal";

const status = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  state: "synced",
  lastSync: "2026-11-04T09:36:00.000Z",
  detail: "",
  summary: "↑0 ↓0",
  intervalMinutes: 15,
  conflictFiles: [],
  conflictPrompt: "",
  blockedFiles: [],
  ...over,
});

describe("AutoSyncModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus = status();
  });

  it("blocked state lists the blocking files", () => {
    const files = ["panel/a.tsx", "scripts/sync"];
    mockStatus = status({
      state: "blocked",
      detail: `Local changes to ${files.join(", ")} block the sync — commit or discard them.`,
      blockedFiles: files,
    });
    render(<AutoSyncModal onClose={() => {}} />);
    const banner = screen.getByTestId("sync-blocked-banner");
    expect(within(banner).getByText("Blocked")).toBeInTheDocument();
    expect(banner).toHaveTextContent(
      /local changes to panel\/a\.tsx, scripts\/sync block the sync — commit or discard them/i,
    );
    for (const f of files) expect(within(banner).getByText(f)).toBeInTheDocument();
    expect(screen.getByTestId("auto-sync-sync-now")).toHaveTextContent("Sync now");
  });

  it("blocked banner is absent in other states", () => {
    for (const state of ["idle", "syncing", "synced", "offline", "conflict", "push-failed", "busy"]) {
      mockStatus = status({ state, blockedFiles: [] });
      const { unmount } = render(<AutoSyncModal onClose={() => {}} />);
      expect(screen.queryByTestId("sync-blocked-banner")).not.toBeInTheDocument();
      expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
      unmount();
    }
  });
});
