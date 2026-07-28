import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const syncNow = vi.fn(async () => {});
const refresh = vi.fn();
let mockStatus: any = null;

vi.mock("../../auto-sync/useAutoSyncStatus", () => ({
  useAutoSyncStatus: () => ({ status: mockStatus, syncNow, refresh, enable: vi.fn(), disable: vi.fn() }),
}));
vi.mock("../GitChanges", () => ({ default: () => <div data-testid="git-changes" /> }));

import GitPanel from "../GitPanel";

const status = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  state: "synced",
  lastSync: "2026-07-28T09:36:00.000Z",
  detail: "",
  summary: "↑2 ↓1",
  intervalMinutes: 15,
  conflictFiles: [],
  conflictPrompt: "",
  ...over,
});

describe("GitPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus = status();
  });

  it("labels the control Sync and shows the summary", () => {
    render(<GitPanel />);
    expect(screen.getByTestId("git-sync")).toHaveTextContent("Sync");
    expect(screen.getByTestId("git-sync-status")).toHaveTextContent("↑2 ↓1");
  });

  it("disables the control and says Syncing… while a sync is running", () => {
    mockStatus = status({ state: "syncing" });
    render(<GitPanel />);
    const btn = screen.getByTestId("git-sync");
    expect(btn).toHaveTextContent("Syncing…");
    expect(btn).toBeDisabled();
  });

  it("calls syncNow then refresh on click", async () => {
    const user = userEvent.setup();
    render(<GitPanel />);
    await user.click(screen.getByTestId("git-sync"));
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
  });

  it("hides the conflict banner when there is no conflict", () => {
    render(<GitPanel />);
    expect(screen.queryByTestId("sync-conflict-banner")).not.toBeInTheDocument();
  });

  it("shows the conflict banner and copy button on conflict", () => {
    mockStatus = status({
      state: "conflict",
      conflictFiles: ["panel/a.tsx"],
      conflictPrompt: "fix it",
      detail: "Rebase conflict — manual sync needed.",
    });
    render(<GitPanel />);
    expect(screen.getByTestId("sync-conflict-banner")).toBeInTheDocument();
    expect(screen.getByTestId("sync-conflict-copy-prompt")).toBeInTheDocument();
  });

  it("surfaces the failure detail instead of the summary", () => {
    mockStatus = status({ state: "offline", detail: "Remote unreachable.", summary: "" });
    render(<GitPanel />);
    expect(screen.getByTestId("git-sync-status")).toHaveTextContent("Remote unreachable.");
  });
});
