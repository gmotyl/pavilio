import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../../../test-utils";
import { calls, DrivenResizeObserver, MAIN, renderCode } from "./codeHarness";

const SHA = "d".repeat(40);
const NEW_DIFF = ["diff --git a/docs/new.md b/docs/new.md", "--- /dev/null", "+++ b/docs/new.md", "@@ -0,0 +1,1 @@", "+brand new"].join("\n");
const q = encodeURIComponent;

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
});

describe("HistoryPanel", () => {
  it("picking a commit lists its files and opens the first diff", async () => {
    const { fetch } = renderCode("?view=code&file=src/b.ts", {
      "/api/git/log": () =>
        jsonResponse([{ sha: SHA, shortSha: "ddddddd", message: "add docs", author: "me", date: new Date().toISOString() }]),
      "/api/git/commit-files": () =>
        jsonResponse([
          { status: "A", path: "docs/new.md" },
          { status: "M", path: "src/b.ts" },
        ]),
      "/api/git/diff?sha=": () => jsonResponse({ diff: NEW_DIFF }),
    });
    await screen.findByTestId("ft-file-README.md");
    fireEvent.click(screen.getByTestId("code-history-toggle"));
    const p = await waitFor(() => screen.getByRole("complementary", { name: "History" }));
    expect(screen.queryByRole("complementary", { name: "Outline" })).toBeNull();
    fireEvent.click(await within(p).findByTestId(`history-commit-${SHA}`));

    await waitFor(() => expect(screen.queryByTestId("ft-file-README.md")).toBeNull());
    expect(screen.getByTestId("code-commit-indicator")).toHaveTextContent("ddddddd");
    await waitFor(() => expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("docs/new.md"));
    expect(screen.getByTestId("ft-file-docs/new.md")).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByTestId("ft-dir-src"));
    expect(screen.getByTestId("ft-file-src/b.ts")).not.toHaveClass("unchanged");
    expect(within(screen.getByTestId("file-viewer")).getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("file-viewer")).toHaveTextContent("brand new");
    expect(calls(fetch, `/api/git/commit-files?sha=${SHA}&repo=${q(MAIN)}`)).toHaveLength(1);
    expect(calls(fetch, `/api/git/diff?sha=${SHA}&file=${q("docs/new.md")}&repo=${q(MAIN)}`)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("code-commit-exit"));
    await screen.findByTestId("ft-file-README.md");
    expect(screen.queryByTestId("code-commit-indicator")).toBeNull();
  });

  it("a failed history load says so and retries", async () => {
    let fail = true;
    renderCode("?view=code", {
      "/api/git/log": () =>
        fail
          ? jsonResponse({ error: "boom" }, { status: 500 })
          : jsonResponse([{ sha: SHA, shortSha: "ddddddd", message: "add docs", author: "me", date: new Date().toISOString() }]),
    });
    fireEvent.click(await screen.findByTestId("code-history-toggle"));
    const p = await waitFor(() => screen.getByRole("complementary", { name: "History" }));
    expect(await within(p).findByRole("alert")).toHaveTextContent("Couldn't load history");
    expect(p).not.toHaveTextContent("No commits.");

    fail = false;
    fireEvent.click(within(p).getByTestId("history-retry"));
    expect(await within(p).findByTestId(`history-commit-${SHA}`)).toBeInTheDocument();
  });
});
