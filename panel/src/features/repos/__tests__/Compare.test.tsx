import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../../../test-utils";
import { BASE_SHA, calls, DrivenResizeObserver, HEAD_SHA, MAIN, renderCode, urlParams } from "./codeHarness";

const B_DIFF = ["diff --git a/src/b.ts b/src/b.ts", "--- a/src/b.ts", "+++ b/src/b.ts", "@@ -6,1 +6,1 @@", "-type Gamma = number;", "+type Gamma = string;"].join("\n");
const q = encodeURIComponent;
const text = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
});

describe("Compare with", () => {
  it("Compare with sits outside the scrolling worktree list and its branches replace that list", async () => {
    renderCode("?view=code", {
      "/api/git/branches": () => jsonResponse({ current: "feat/x", branches: ["main", "feat/x", "release"] }),
    });
    fireEvent.click(await screen.findByTestId("repo-switcher"));
    const pop = await screen.findByRole("dialog", { name: "Pick a repository or worktree" });
    const list = within(pop).getByTestId("repo-switcher-list");
    const toggle = within(pop).getByTestId("compare-with-toggle");
    expect(list).not.toContainElement(toggle);
    // Pinned above the list, so a long worktree list never pushes it out of view.
    expect(toggle.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(toggle);
    expect(within(pop).queryByTestId("repo-switcher-list")).toBeNull();
    const branches = await within(pop).findByTestId("compare-with-list");
    await waitFor(() => expect(within(branches).getAllByRole("option").map((o) => o.textContent)).toEqual(["main", "feat/x", "release"]));
    fireEvent.change(within(pop).getByRole("searchbox", { name: "Filter branches" }), { target: { value: "rel" } });
    expect(within(branches).getAllByRole("option").map((o) => o.textContent)).toEqual(["release"]);

    fireEvent.click(within(pop).getByTestId("compare-with-back"));
    expect(within(pop).getByTestId("repo-switcher-list")).toBeInTheDocument();
    expect(within(pop).queryByTestId("compare-with-list")).toBeNull();

    fireEvent.click(within(pop).getByTestId("compare-with-toggle"));
    fireEvent.click(await within(pop).findByTestId("compare-with-option-release"));
    expect(urlParams(screen.getByTestId("search")).get("cmp")).toBe("release");
    expect(screen.queryByRole("dialog", { name: "Pick a repository or worktree" })).toBeNull();
  });

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
    // Both refs pinned once, so tree, counts, patch and file all read one pair of commits.
    expect(calls(fetch, `/api/git/resolve?repo=${q(MAIN)}&ref=main`)).toHaveLength(1);
    expect(calls(fetch, `/api/git/resolve?repo=${q(MAIN)}&ref=HEAD`)).toHaveLength(1);
    expect(calls(fetch, `/api/git/changed?repo=${q(MAIN)}&base=${BASE_SHA}&head=${HEAD_SHA}`)).toHaveLength(1);
    expect(calls(fetch, `/api/git/tree?repo=${q(MAIN)}&ref=${HEAD_SHA}`)).toHaveLength(1);
    expect(calls(fetch, "head=HEAD")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("ft-file-src/b.ts"));
    await waitFor(() => expect(screen.getByTestId("file-viewer")).toHaveTextContent("type Gamma = number;"));
    expect(within(screen.getByTestId("file-viewer")).getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    expect(calls(fetch, `/api/git/diff-ref?repo=${q(MAIN)}&base=${BASE_SHA}&head=${HEAD_SHA}&path=${q("src/b.ts")}`)).toHaveLength(1);
    await waitFor(() => expect(calls(fetch, `/api/git/file?repo=${q(MAIN)}&ref=${HEAD_SHA}&path=${q("src/b.ts")}`)).toHaveLength(1));
    expect(calls(fetch, "ref=HEAD&")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("code-compare-exit"));
    expect(urlParams(screen.getByTestId("search")).get("cmp")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("ft-file-src/a.ts")).not.toHaveClass("unchanged"));
  });
});
