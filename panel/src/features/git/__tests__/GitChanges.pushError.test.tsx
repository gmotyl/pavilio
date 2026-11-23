import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitChanges from "../GitChanges";

describe("GitChanges push failure", () => {
  let files: { status: string; path: string }[];
  let current: string;

  beforeEach(() => {
    files = [{ status: "M", path: "note.md" }];
    current = "main";
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/checkout")) {
        current = "dev";
        return { ok: true, json: async () => ({ branch: "dev" }) } as Response;
      }
      if (url.includes("/push")) return { ok: false, status: 500, json: async () => ({ error: "push rejected" }) } as Response;
      if (url.includes("/commit") && init?.method === "POST") {
        files = [];
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      const body = url.includes("/status")
        ? files
        : url.includes("/branches")
          ? { current, branches: ["main", "dev"] }
          : url.includes("/branch")
            ? { branch: current }
            : url.includes("/suggest-message")
              ? { suggestion: "update: note" }
              : url.includes("/worktrees")
                ? []
                : {};
      return { ok: true, json: async () => body } as Response;
    }) as unknown as typeof fetch;
  });

  it("keeps a rejected push visible once the commit leaves no changes", async () => {
    const user = userEvent.setup();
    render(<GitChanges showCommit />);
    await waitFor(() => expect(screen.getByPlaceholderText("Commit message...")).toHaveValue("update: note"));
    await user.click(screen.getByTestId("git-changes-commit-and-push-workspace"));
    await waitFor(() => expect(screen.getByText("No changes")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("push rejected");
  });

  it("drops the push error once a checkout to another branch succeeds", async () => {
    const user = userEvent.setup();
    render(<GitChanges showCommit />);
    await waitFor(() => expect(screen.getByPlaceholderText("Commit message...")).toHaveValue("update: note"));
    await user.click(screen.getByTestId("git-changes-commit-and-push-workspace"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("push rejected"));
    await user.click(screen.getByTestId("branch-picker-toggle"));
    await user.click(screen.getByTestId("branch-picker-option-dev"));
    await waitFor(() => expect(screen.getByTestId("branch-picker-toggle")).toHaveTextContent("dev"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
