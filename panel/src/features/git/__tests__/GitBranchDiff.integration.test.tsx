import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitBranchDiff from "../GitBranchDiff";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";

// Stateful stub of the realtime channel so tests can push messages.
const ws = vi.hoisted(() => ({ setLast: (_m: unknown) => {} }));
vi.mock("../../realtime/useWebSocket", () => {
  const React = require("react");
  return {
    useWebSocket: () => {
      const [lastMessage, setLastMessage] = React.useState(null);
      React.useEffect(() => {
        ws.setLast = setLastMessage;
      }, []);
      return { lastMessage };
    },
  };
});

describe("GitBranchDiff integration", () => {
  beforeEach(() => {
    mockFetchResponses({
      "/api/git/branches": {
        current: "feature/search",
        branches: ["main", "feature/search", "develop"],
      },
      "/api/git/branch-diff-files": {
        files: [
          { status: "M", path: "src/search.ts" },
          { status: "A", path: "src/search.test.ts" },
        ],
        commitsAhead: 3,
      },
      "/api/git/branch-diff?base=main&file=src%2Fsearch.test.ts": {
        diff: "diff --git a/src/search.test.ts b/src/search.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/search.test.ts\n@@ -0,0 +1,2 @@\n+import { describe } from 'vitest';\n+describe('search', () => {});",
      },
      "/api/git/branch-diff": {
        diff: "--- a/src/search.ts\n+++ b/src/search.ts\n@@ -1 +1 @@\n-old\n+new",
      },
    });
  });

  it("renders changed files after branch auto-select", async () => {
    renderWithRouter(<GitBranchDiff repo="/path/to/repo" />);
    await waitFor(() => {
      expect(screen.getByText("src/search.ts")).toBeInTheDocument();
    });
    expect(screen.getByText("src/search.test.ts")).toBeInTheDocument();
  });

  it("shows commits ahead count", async () => {
    renderWithRouter(<GitBranchDiff repo="/path/to/repo" />);
    await waitFor(() => {
      expect(screen.getByText("+3 commits")).toBeInTheDocument();
    });
  });

  it("shows file count", async () => {
    renderWithRouter(<GitBranchDiff repo="/path/to/repo" />);
    await waitFor(() => {
      expect(screen.getByText("2 files")).toBeInTheDocument();
    });
  });

  it("clicking a file opens diff view", async () => {
    const user = userEvent.setup();
    renderWithRouter(<GitBranchDiff repo="/path/to/repo" />);
    await waitFor(() => {
      expect(screen.getByText("src/search.ts")).toBeInTheDocument();
    });
    await user.click(screen.getByText("src/search.ts"));
    await waitFor(() => {
      expect(screen.getByText("Back")).toBeInTheDocument();
    });
  });

  it("shows added file contents for branch-added files", async () => {
    const user = userEvent.setup();
    renderWithRouter(<GitBranchDiff repo="/path/to/repo" />);
    await waitFor(() => {
      expect(screen.getByText("src/search.test.ts")).toBeInTheDocument();
    });
    await user.click(screen.getByText("src/search.test.ts"));
    await waitFor(() => {
      expect(
        screen.getByText(
          (_, element) =>
            element?.textContent === "import { describe } from 'vitest';",
        ),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText("No changes (binary or new file)"),
    ).not.toBeInTheDocument();
  });

  it("refetches branches + diff files on git-change (branch switch)", async () => {
    let phase: "before" | "after" = "before";
    const mockFetch = vi.fn((input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (url.includes("/api/git/branches")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              current: phase === "before" ? "feature/search" : "hotfix/login",
              branches: ["main", "feature/search", "hotfix/login"],
            }),
        } as Response);
      }
      if (url.includes("/api/git/branch-diff-files")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              files:
                phase === "before"
                  ? [{ status: "M", path: "src/search.ts" }]
                  : [{ status: "M", path: "src/login.ts" }],
              commitsAhead: 1,
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
      } as Response);
    });
    vi.stubGlobal("fetch", mockFetch);

    renderWithRouter(<GitBranchDiff repo="/path/to/repo" />);
    await waitFor(() =>
      expect(screen.getByText("src/search.ts")).toBeInTheDocument(),
    );

    // Server switched HEAD and broadcast git-change; diff must follow without reload.
    phase = "after";
    act(() => ws.setLast({ type: "git-change" }));

    await waitFor(() =>
      expect(screen.getByText("src/login.ts")).toBeInTheDocument(),
    );
    expect(screen.queryByText("src/search.ts")).not.toBeInTheDocument();
  });
});
