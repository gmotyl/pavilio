import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../../../test-utils";
import { calls, DrivenResizeObserver, MAIN, renderCode, urlParams } from "./codeHarness";

const B_DIFF = ["diff --git a/src/b.ts b/src/b.ts", "--- a/src/b.ts", "+++ b/src/b.ts", "@@ -6,1 +6,1 @@", "-type Gamma = number;", "+type Gamma = string;"].join("\n");
const q = encodeURIComponent;
const text = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
});

describe("Compare with", () => {
  it("compare with main badges differing files and shows the three-dot diff", async () => {
    const { fetch } = renderCode("?view=code", {
      "/api/git/branches": () => jsonResponse({ current: "feat/x", branches: ["main", "feat/x"] }),
      "/api/git/changed": () => jsonResponse([{ path: "src/b.ts", status: "M", add: 1, del: 1 }]),
      "/api/git/diff-ref": () => text(B_DIFF),
    });
    fireEvent.click(await screen.findByTestId("ft-dir-src"));
    await waitFor(() => expect(screen.getByTestId("ft-file-src/a.ts")).not.toHaveClass("unchanged"));

    fireEvent.click(screen.getByTestId("repo-switcher"));
    const pop = await screen.findByRole("dialog", { name: "Pick a repository or worktree" });
    fireEvent.click(within(pop).getByTestId("compare-with-toggle"));
    fireEvent.click(await within(pop).findByTestId("compare-with-option-main"));

    expect(urlParams(screen.getByTestId("search")).get("cmp")).toBe("main");
    expect(screen.getByTestId("code-compare-indicator")).toHaveTextContent("Comparing with main");
    // The compared listing is a fresh tree: folders start closed.
    fireEvent.click(await screen.findByTestId("ft-dir-src"));
    await waitFor(() => expect(screen.getByTestId("ft-file-src/a.ts")).toHaveClass("unchanged"));
    expect(screen.getByTestId("ft-file-src/b.ts")).not.toHaveClass("unchanged");
    expect(calls(fetch, `/api/git/changed?repo=${q(MAIN)}&base=main&head=HEAD`)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("ft-file-src/b.ts"));
    await waitFor(() => expect(screen.getByTestId("file-viewer")).toHaveTextContent("type Gamma = number;"));
    expect(within(screen.getByTestId("file-viewer")).getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    expect(calls(fetch, `/api/git/diff-ref?repo=${q(MAIN)}&base=main&head=HEAD&path=${q("src/b.ts")}`)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("code-compare-exit"));
    expect(urlParams(screen.getByTestId("search")).get("cmp")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("ft-file-src/a.ts")).not.toHaveClass("unchanged"));
  });
});
