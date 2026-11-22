import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../../../test-utils";
import { A_DIFF, calls, DrivenResizeObserver, FEAT, MAIN, MISSING, REPOS, renderCode, urlParams } from "./codeHarness";

const search = () => urlParams(screen.getByTestId("search"));
const rail = () => screen.queryByRole("complementary", { name: "Outline" });

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
});

describe("CodeView", () => {
  it("switcher groups repos with their worktrees and disables missing ones", async () => {
    const { fetch } = renderCode();
    const switcher = within(screen.getByTestId("repos-context")).getByTestId("repo-switcher");
    await waitFor(() => expect(switcher).toHaveTextContent("pavilio"));
    fireEvent.click(switcher);
    const pop = await screen.findByRole("dialog", { name: "Pick a repository or worktree" });

    const groups = within(pop).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["pavilio", "notes", "site"]);
    await waitFor(() => expect(within(groups[0]).getAllByRole("button")).toHaveLength(2));
    const [main, feat] = within(groups[0]).getAllByRole("button");
    expect(main).toHaveTextContent("main");
    expect(main).toHaveTextContent(MAIN);
    expect(main).toHaveAttribute("aria-current", "true");
    expect(feat).toHaveTextContent("feat/x");
    expect(feat).toHaveTextContent(FEAT);
    await waitFor(() => expect(feat).toHaveTextContent("2 uncommitted"));
    await waitFor(() => expect(main).toHaveTextContent("1 uncommitted"));

    const missing = within(groups[1]).getByRole("button");
    expect(missing).toBeDisabled();
    expect(missing).toHaveTextContent("Not on this machine");
    await waitFor(() => expect(within(groups[2]).getAllByRole("button")).toHaveLength(1));
    expect(fetch.mock.calls.some(([u]) => decodeURIComponent(String(u)).includes(MISSING))).toBe(false);
  });

  it("picking a worktree rereads tree and puts wt in the URL", async () => {
    const { fetch } = renderCode("?view=code&file=src/b.ts");
    await screen.findByTestId("ft-file-README.md");
    fireEvent.click(screen.getByTestId("repo-switcher"));
    const pop = await screen.findByRole("dialog", { name: "Pick a repository or worktree" });
    const feat = await within(pop).findByRole("button", { name: /feat\/x/ });
    fireEvent.click(feat);

    expect(search().get("repo")).toBe("pavilio");
    expect(search().get("wt")).toBe(FEAT);
    expect(search().get("file")).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("ft-file-README.md")).toBeNull());
    fireEvent.click(await screen.findByTestId("ft-dir-src"));
    await screen.findByTestId("ft-file-src/feat.ts");
    expect(calls(fetch, `/api/git/tree?repo=${encodeURIComponent(FEAT)}`)).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("repo-switcher")).toHaveTextContent("feat/x");

    fireEvent.click(screen.getByTestId("ft-file-src/feat.ts"));
    await waitFor(() => expect(calls(fetch, `/api/git/file?repo=${encodeURIComponent(FEAT)}&path=src%2Ffeat.ts`)).toHaveLength(1));
  });

  it("a wt param outside the repo's worktrees falls back to the main checkout", async () => {
    const { fetch } = renderCode("?view=code&wt=%2Felsewhere&file=README.md");
    await screen.findByTestId("ft-file-README.md");
    await screen.findByTestId("file-viewer");
    expect(calls(fetch, `/api/git/tree?repo=${encodeURIComponent(MAIN)}`)).toHaveLength(1);
    expect(fetch.mock.calls.some(([u]) => decodeURIComponent(String(u)).includes("/elsewhere"))).toBe(false);
  });

  it("an unlisted wt param is cleared from the URL once the listing arrives", async () => {
    renderCode("?view=code&wt=%2Felsewhere&file=README.md");
    await screen.findByTestId("ft-file-README.md");
    await waitFor(() => expect(search().get("wt")).toBeNull());
    expect(search().get("file")).toBe("README.md");
  });

  it("a changed repo list keeps the open worktree mounted while it relists", async () => {
    const { fetch, setRepos } = renderCode(`?view=code&wt=${encodeURIComponent(FEAT)}`);
    fireEvent.click(await screen.findByTestId("ft-dir-src"));
    await screen.findByTestId("ft-file-src/feat.ts");
    setRepos([...REPOS, { name: "extra", path: "/root/extra", present: true }]);
    expect(screen.queryByText("Listing worktrees…")).toBeNull();
    expect(screen.getByTestId("ft-file-src/feat.ts")).toBeInTheDocument();
    await waitFor(() => expect(calls(fetch, "/api/git/worktrees?repo=%2Froot%2Fextra")).toHaveLength(1));
    expect(calls(fetch, `/api/git/tree?repo=${encodeURIComponent(FEAT)}`)).toHaveLength(1);
  });

  it("a listed wt param opens that worktree once the listing arrives", async () => {
    const { fetch } = renderCode(`?view=code&wt=${encodeURIComponent(FEAT)}`);
    fireEvent.click(await screen.findByTestId("ft-dir-src"));
    await screen.findByTestId("ft-file-src/feat.ts");
    expect(calls(fetch, "/api/git/tree")).toEqual([`/api/git/tree?repo=${encodeURIComponent(FEAT)}`]);
  });

  it("renders search, tree, Back bar, viewer in Code and outline", async () => {
    renderCode("?view=code&file=src/b.ts");
    const view = screen.getByTestId("code-view");
    const input = within(view).getByRole("combobox", { name: "Go to file" });
    expect(input).toHaveAttribute("placeholder", "Go to file…");
    expect(within(view).getByText("Ctrl+P")).toBeInTheDocument();
    await within(view).findByRole("navigation", { name: "Repository files" });
    expect(await within(view).findByTestId("ft-file-src/a.ts")).toHaveTextContent("+1 −1");
    const back = within(view).getByRole("button", { name: "← Back" });
    expect(back).toBeDisabled();
    const viewer = await within(view).findByTestId("file-viewer");
    expect(within(viewer).getByTestId("file-viewer-header")).toHaveTextContent("src/b.ts");
    expect(within(viewer).queryByTestId("file-viewer-mode-diff")).toBeNull();
    expect(rail()).not.toBeNull();
  });

  it("outline lists top-level declarations and scrolls to them", async () => {
    renderCode("?view=code&file=src/b.ts");
    await screen.findByTestId("file-viewer");
    const outline = await waitFor(() => {
      const r = rail();
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    await waitFor(() => expect(within(outline).getAllByRole("button").length).toBeGreaterThan(0));
    expect(within(outline).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "ƒalpha2",
      "IBeta5",
      "TGamma6",
      "cDELTA7",
      "CEpsilon8",
      "EZeta9",
      "ƒomega10",
    ]);
    fireEvent.click(within(outline).getByRole("button", { name: /DELTA/ }));
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled());
    const target = vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts.at(-1) as HTMLElement;
    expect(target.getAttribute("data-line")).toBe("7");
    expect(search().get("line")).toBe("7");
  });

  it("uncommitted changes are labelled in the viewer", async () => {
    const { fetch } = renderCode("?view=code&file=src/a.ts");
    const header = await screen.findByTestId("file-viewer-header");
    await waitFor(() => expect(header).toHaveTextContent("modified, uncommitted"));
    expect(calls(fetch, `/api/git/diff?file=src%2Fa.ts&repo=${encodeURIComponent(MAIN)}&against=HEAD`)).toHaveLength(1);
    expect(screen.getByTestId("file-viewer-body").querySelector('tr[data-line="15"]')).toHaveAttribute("data-mark");
  });

  it("staged-only changes are diffed against HEAD and marked uncommitted", async () => {
    // A plain `git diff` misses staged edits; only a HEAD diff carries them.
    renderCode("?view=code&file=src/a.ts", {
      "/api/git/diff": (url) => jsonResponse({ diff: new URL(url, "http://x").searchParams.get("against") === "HEAD" ? A_DIFF : "" }),
    });
    const header = await screen.findByTestId("file-viewer-header");
    await waitFor(() => expect(header).toHaveTextContent("modified, uncommitted"));
    await waitFor(() =>
      expect(screen.getByTestId("file-viewer-body").querySelector('tr[data-line="15"]')).toHaveAttribute("data-mark"),
    );
  });

  it("a file over the read cap shows its size instead of loading", async () => {
    renderCode("?view=code&file=src/b.ts", {
      "/api/git/file": () => jsonResponse({ error: "file too large", tooLarge: true, size: 3 * 1024 * 1024 }, { status: 413 }),
    });
    expect(await screen.findByText("This file is too large to display (3.0 MB).")).toBeInTheDocument();
  });

  it("an untracked file too large to diff is never read whole", async () => {
    const { fetch } = renderCode("?view=code&file=src/a.ts", {
      "/api/git/diff": () => jsonResponse({ diff: "", tooLarge: true, size: 1.5 * 1024 * 1024 }),
    });
    expect(await screen.findByText("This file is too large to display (1.5 MB).")).toBeInTheDocument();
    expect(calls(fetch, "/api/git/file")).toHaveLength(0);
  });

  it("rail hides below 1100px and columns stack below 860px", async () => {
    renderCode("?view=code&file=src/b.ts");
    await screen.findByTestId("file-viewer");
    const body = screen.getByTestId("code-body");
    DrivenResizeObserver.resize(1300);
    await waitFor(() => expect(rail()).not.toBeNull());
    expect(body).not.toHaveClass("cv-stack");

    DrivenResizeObserver.resize(1000);
    expect(rail()).toBeNull();
    expect(body).toHaveClass("cv-norail");
    expect(body).not.toHaveClass("cv-stack");

    DrivenResizeObserver.resize(800);
    expect(rail()).toBeNull();
    expect(body).toHaveClass("cv-stack");
  });
});
