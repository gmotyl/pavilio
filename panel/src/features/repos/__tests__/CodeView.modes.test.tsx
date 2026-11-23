import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, type FetchHandler } from "../../../test-utils";
import { calls, DrivenResizeObserver, MAIN, renderCode, urlParams } from "./codeHarness";

const { frameListeners } = vi.hoisted(() => ({
  frameListeners: new Set<(frame: { type: string; [key: string]: unknown }) => void>(),
}));

vi.mock("../../realtime/channel", () => ({
  subscribeRealtime: (listener: (frame: { type: string; [key: string]: unknown }) => void) => {
    frameListeners.add(listener);
    return () => frameListeners.delete(listener);
  },
}));

const SHA = "d".repeat(40);
const q = encodeURIComponent;
const search = () => urlParams(screen.getByTestId("search"));
const B_DIFF = ["diff --git a/src/b.ts b/src/b.ts", "--- a/src/b.ts", "+++ b/src/b.ts", "@@ -6,1 +6,1 @@", "-type Gamma = number;", "+type Gamma = string;"].join("\n");

const B_SOURCE = ["a", "b", "c", "d", "e", "type Gamma = string;"].join("\n");

const history: Record<string, FetchHandler> = {
  "/api/git/log": () => jsonResponse([{ sha: SHA, shortSha: "ddddddd", message: "touch b", author: "me", date: new Date().toISOString() }]),
  "/api/git/commit-files": () => jsonResponse([{ status: "M", path: "src/b.ts" }]),
  "/api/git/diff?sha=": () => jsonResponse({ diff: B_DIFF }),
  "/api/git/branches": () => jsonResponse({ current: "feat/x", branches: ["main", "feat/x"] }),
  "/api/git/branch?": () => jsonResponse({ branch: "feat/x" }),
  "/api/git/suggest-message": () => jsonResponse({ suggestion: "" }),
  "/api/git/changed": () => jsonResponse([{ path: "src/b.ts", status: "M", add: 1, del: 1 }]),
};

async function enterCommit() {
  await screen.findByTestId("ft-file-README.md");
  fireEvent.click(screen.getByTestId("code-history-toggle"));
  const p = await waitFor(() => screen.getByRole("complementary", { name: "History" }));
  fireEvent.click(await within(p).findByTestId(`history-commit-${SHA}`));
  await waitFor(() => expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("src/b.ts"));
  expect(screen.getByTestId("code-commit-indicator")).toBeInTheDocument();
}

async function compareWithMain() {
  fireEvent.click(screen.getByTestId("repo-switcher"));
  const pop = await screen.findByRole("dialog", { name: "Pick a repository or worktree" });
  fireEvent.click(within(pop).getByTestId("compare-with-toggle"));
  fireEvent.click(await within(pop).findByTestId("compare-with-option-main"));
}

beforeEach(() => {
  frameListeners.clear();
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
});

describe("CodeView modes", () => {
  it("a git-change broadcast refreshes the file tree", async () => {
    let files = [{ path: "README.md", status: null }];
    renderCode("?view=code", { [`/api/git/tree?repo=${q(MAIN)}`]: () => jsonResponse({ files }) });
    await screen.findByTestId("ft-file-README.md");

    files = [...files, { path: "NEW.md", status: null }];
    act(() => frameListeners.forEach((l) => l({ type: "git-change" })));
    await screen.findByTestId("ft-file-NEW.md");
  });

  it("a refresh that pushes the open file past the read cap switches it to Diff", async () => {
    let tooLarge = false;
    renderCode("?view=code&file=src/a.ts", {
      "/api/git/file": () =>
        tooLarge
          ? jsonResponse({ error: "file too large", tooLarge: true, size: 3 * 1024 * 1024 }, { status: 413 })
          : new Response("const area = width * height;\n"),
    });
    const viewer = await screen.findByTestId("file-viewer");
    await waitFor(() => expect(within(viewer).getByTestId("file-viewer-mode-code")).toHaveAttribute("aria-pressed", "true"));

    tooLarge = true;
    act(() => frameListeners.forEach((l) => l({ type: "git-change" })));
    await waitFor(() =>
      expect(within(screen.getByTestId("file-viewer")).getByTestId("file-viewer-mode-diff")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.queryByText(/File content is not loaded/)).toBeNull();
  });

  it("opening a file outside the commit leaves commit mode for the working tree", async () => {
    const { fetch } = renderCode("?view=code", history);
    await enterCommit();

    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    const input = await screen.findByRole("combobox", { name: "Search in files" });
    fireEvent.change(input, { target: { value: "area" } });
    const results = await screen.findByRole("listbox", { name: "Matches in files" });
    fireEvent.click(within(await within(results).findByRole("group", { name: "src/a.ts" })).getByRole("option"));

    await waitFor(() => expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("src/a.ts"));
    expect(search().get("file")).toBe("src/a.ts");
    expect(screen.queryByTestId("code-commit-indicator")).toBeNull();
    expect(calls(fetch, `/api/git/file?repo=${q(MAIN)}&path=${q("src/a.ts")}`)).toHaveLength(1);
  });

  it("Compare with… in commit mode leaves the commit and compares", async () => {
    renderCode("?view=code", history);
    await enterCommit();
    await compareWithMain();

    expect(search().get("cmp")).toBe("main");
    await screen.findByTestId("code-compare-indicator");
    expect(screen.queryByTestId("code-commit-indicator")).toBeNull();
  });

  it("a Changes click during compare leaves compare and reads the working tree", async () => {
    const { fetch } = renderCode("?view=code", history);
    await screen.findByTestId("ft-file-README.md");
    await compareWithMain();
    await screen.findByTestId("code-compare-indicator");

    fireEvent.click(screen.getByTestId("code-changes-toggle"));
    const p = await waitFor(() => screen.getByRole("complementary", { name: "Changes" }));
    fireEvent.click(await within(p).findByTestId("changes-file-src/a.ts"));

    await waitFor(() => expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("src/a.ts"));
    expect(search().get("cmp")).toBeNull();
    expect(screen.queryByTestId("code-compare-indicator")).toBeNull();
    expect(calls(fetch, `ref=HEAD&path=${q("src/a.ts")}`)).toHaveLength(0);
  });

  it("an open switcher lists branches once across re-renders", async () => {
    const { fetch } = renderCode("?view=code", history);
    await screen.findByTestId("ft-file-README.md");
    fireEvent.click(screen.getByTestId("repo-switcher"));
    await waitFor(() => expect(calls(fetch, `/api/git/branches?repo=${q(MAIN)}`)).toHaveLength(1));

    fireEvent.click(screen.getByTestId("ft-file-README.md"));
    await waitFor(() => expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("README.md"));
    expect(calls(fetch, `/api/git/branches?repo=${q(MAIN)}`)).toHaveLength(1);
  });

  it("a commit whose files can't be listed says so in the tree", async () => {
    renderCode("?view=code", { ...history, "/api/git/commit-files": () => jsonResponse({ error: "boom" }, { status: 500 }) });
    await screen.findByTestId("ft-file-README.md");
    fireEvent.click(screen.getByTestId("code-history-toggle"));
    const p = await waitFor(() => screen.getByRole("complementary", { name: "History" }));
    fireEvent.click(await within(p).findByTestId(`history-commit-${SHA}`));

    const alert = await screen.findByText(/Couldn't list files/);
    expect(alert).toHaveTextContent("HTTP 500");
  });

  it("code from a commit has no definition links: the lookup reads the working tree", async () => {
    renderCode("?view=code", { ...history, "/api/git/file?": () => new Response(B_SOURCE) });
    await enterCommit();
    fireEvent.click(screen.getByTestId("file-viewer-mode-code"));
    await waitFor(() => expect(screen.getByTestId("file-viewer-body")).toHaveTextContent("type Gamma"));
    expect(screen.getByTestId("file-viewer-body").querySelector("[data-sym]")).toBeNull();
  });

  it("a text search hit during compare opens the working tree, where grep found it", async () => {
    const { fetch } = renderCode("?view=code", history);
    await screen.findByTestId("ft-file-README.md");
    await compareWithMain();
    await screen.findByTestId("code-compare-indicator");

    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    const input = await screen.findByRole("combobox", { name: "Search in files" });
    fireEvent.change(input, { target: { value: "area" } });
    const results = await screen.findByRole("listbox", { name: "Matches in files" });
    fireEvent.click(within(await within(results).findByRole("group", { name: "src/a.ts" })).getByRole("option"));

    await waitFor(() => expect(search().get("cmp")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("src/a.ts"));
    expect(calls(fetch, `/api/git/file?repo=${q(MAIN)}&path=${q("src/a.ts")}`)).toHaveLength(1);
  });
});
