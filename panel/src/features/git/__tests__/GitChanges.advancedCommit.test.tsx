import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitChanges from "../GitChanges";

const files = [{ status: "M", path: "projects/p/note.md" }];

function mockFetch() {
  return vi.fn(async (url: string) => {
    const body = url.includes("/status")
      ? files
      : url.includes("/branches")
        ? { current: "main", branches: ["main"] }
        : url.includes("/branch")
          ? { branch: "main" }
          : url.includes("/suggest-message")
            ? { suggestion: "update(p): " }
            : url.includes("/worktrees")
              ? []
              : {};
    return { ok: true, json: async () => body } as Response;
  });
}

describe("GitChanges advancedCommit", () => {
  beforeEach(() => {
    global.fetch = mockFetch() as unknown as typeof fetch;
  });

  it("shows the commit form inline when advancedCommit is unset", async () => {
    render(<GitChanges showCommit />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Commit message...")).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("git-changes-advanced-toggle-workspace"),
    ).not.toBeInTheDocument();
  });

  it("hides the commit form behind a closed disclosure when advancedCommit is set", async () => {
    render(<GitChanges showCommit advancedCommit />);
    await waitFor(() =>
      expect(screen.getByTestId("git-changes-advanced-toggle-workspace")).toBeInTheDocument(),
    );
    expect(screen.queryByPlaceholderText("Commit message...")).not.toBeInTheDocument();
  });

  it("reveals the commit form when the disclosure is opened", async () => {
    const user = userEvent.setup();
    render(<GitChanges showCommit advancedCommit />);
    await waitFor(() =>
      expect(screen.getByTestId("git-changes-advanced-toggle-workspace")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("git-changes-advanced-toggle-workspace"));
    expect(screen.getByPlaceholderText("Commit message...")).toBeInTheDocument();
    expect(screen.getByTestId("git-changes-commit-workspace")).toBeInTheDocument();
  });
});
