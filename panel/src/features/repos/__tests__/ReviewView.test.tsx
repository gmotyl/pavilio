import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, stubFetch, type FetchHandler } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import ReposTab from "../ReposTab";
import { ME, PRS, pr } from "./prFixtures";

const REPO_PATH = "/root/git/prv/pavilio";
const REPOS = [{ name: "pavilio", path: REPO_PATH, present: true }];

/** A ResizeObserver the test drives: `resize(width)` reports a new content width to every observer. */
class DrivenResizeObserver {
  static all: DrivenResizeObserver[] = [];
  constructor(private cb: ResizeObserverCallback) {
    DrivenResizeObserver.all.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    DrivenResizeObserver.all = DrivenResizeObserver.all.filter((o) => o !== this);
  }
  static resize(width: number): void {
    act(() => {
      for (const o of DrivenResizeObserver.all) {
        o.cb([{ contentRect: { width } } as ResizeObserverEntry], o as unknown as ResizeObserver);
      }
    });
  }
}

// New side: "line N", except line 15 (changed) and 16 (added); old line 29 is deleted.
const CONTENT = Array.from({ length: 40 }, (_, i) =>
  i === 14 ? "const area = width * height;" : i === 15 ? "added 16" : `line ${i + 1}`,
).join("\n");
const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -12,7 +12,8 @@",
  " line 12",
  " line 13",
  " line 14",
  "-const area = w * h;",
  "+const area = width * height;",
  "+added 16",
  " line 17",
  " line 18",
  " line 19",
  "@@ -28,3 +29,2 @@",
  " line 29",
  "-removed 29",
  " line 30",
].join("\n");

const CHANGED = [
  { path: "src/a.ts", status: "M", add: 2, del: 2 },
  { path: "src/gone.ts", status: "D", add: 0, del: 3 },
];
const TREE = { files: [{ path: "README.md", status: null }, { path: "src/a.ts", status: null }, { path: "src/b.ts", status: null }] };

const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain" } });

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

interface Setup {
  search?: string;
  prs?: typeof PRS;
  open?: FetchHandler;
}

function renderReview({ search = "?view=review&pr=pavilio%231", prs = PRS, open }: Setup = {}) {
  const fetch = stubFetch({
    // Before "/api/prs": the first matching fragment wins.
    "/api/prs/open": open ?? (() => jsonResponse({ head: "h".repeat(40), base: "b".repeat(40) })),
    "/api/prs": { me: ME, prs, unavailable: [] },
    "/api/git/changed": CHANGED,
    "/api/git/tree": TREE,
    "/api/git/diff-ref": () => text(DIFF),
    "/api/git/file": (url: string) =>
      url.includes("logo.png") ? jsonResponse({ error: "binary file", binary: true }, { status: 415 }) : text(CONTENT),
  });
  render(
    <MemoryRouter initialEntries={[`/project/pavilio/repos${search}`]}>
      <Routes>
        <Route
          path="/project/:name/:section"
          element={
            <>
              <ReposTab project="pavilio" repos={REPOS} />
              <Search />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return fetch;
}

const calls = (fetch: ReturnType<typeof stubFetch>, fragment: string) =>
  fetch.mock.calls.filter(([u]) => String(u).includes(fragment));
const treeArea = () => screen.getByTestId("review-tree");
const rail = () => screen.queryByRole("complementary", { name: "Changes in this file" });
const loaded = () => waitFor(() => expect(screen.getByTestId("ft-file-src/a.ts")).toBeInTheDocument());

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
  writePreference(preferences.reposPrFilter, { preset: "mine", author: null }, "pavilio");
});

describe("ReviewView", () => {
  it("switcher lists filtered PRs and loads the picked one", async () => {
    const fetch = renderReview({ search: "?view=review" });
    const slot = screen.getByTestId("repos-context");
    const switcher = within(slot).getByTestId("pr-switcher");
    expect(screen.getByTestId("review-view")).toHaveTextContent("Pick a pull request");
    expect(switcher).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(switcher);
    expect(switcher).toHaveAttribute("aria-expanded", "true");
    const pop = await waitFor(() => screen.getByRole("dialog", { name: "Pick a pull request" }));
    expect(within(pop).getByRole("group", { name: "Filter pull requests" })).toBeInTheDocument();
    await waitFor(() => expect(within(within(pop).getByRole("listbox")).getAllByRole("option").map((o) => o.getAttribute("data-number"))).toEqual(["1", "2"]));

    fireEvent.click(within(pop).getByRole("button", { name: /^All/ }));
    await waitFor(() => expect(within(within(pop).getByRole("listbox")).getAllByRole("option")).toHaveLength(6));
    fireEvent.click(within(pop).getByTestId("pr-row-pavilio#4"));

    expect(screen.queryByRole("dialog", { name: "Pick a pull request" })).toBeNull();
    expect(switcher).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("search").textContent).toContain("pr=pavilio%234");
    expect(switcher).toHaveTextContent("pavilio");
    expect(switcher).toHaveTextContent("#4 PR 4");
    await loaded();
    const [, init] = calls(fetch, "/api/prs/open")[0];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ repo: REPO_PATH, number: 4 });
  });

  it("header shows state, branches, checks and the GitHub link", async () => {
    renderReview({
      search: "?view=review&pr=pavilio%237",
      prs: [pr({ number: 7, title: "feat: thing", author: "anna", head: "feat/thing", base: "main", checks: "pass" })],
    });
    const header = await waitFor(() => screen.getByTestId("review-header"));
    expect(within(header).getByRole("heading")).toHaveTextContent("feat: thing #7");
    expect(header).toHaveTextContent("Open");
    expect(header).toHaveTextContent("anna wants to merge feat/thing into main");
    expect(within(header).getByText("feat/thing").tagName).toBe("CODE");
    expect(header).toHaveTextContent("Checks passed");
    const link = within(header).getByRole("link", { name: "Open on GitHub ↗" });
    expect(link).toHaveAttribute("href", "https://github.com/gmotyl/pavilio/pull/7");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders tree, viewer in Diff and the change rail", async () => {
    const fetch = renderReview();
    await loaded();
    const tree = treeArea();
    expect(tree).toHaveTextContent("at feat/1");
    expect(within(tree).getByRole("checkbox", { name: "Changed files only" })).toBeChecked();
    expect(within(tree).getByTestId("ft-file-src/gone.ts")).toBeInTheDocument();
    expect(within(tree).queryByTestId("ft-file-README.md")).toBeNull();
    expect(calls(fetch, "/api/git/changed")[0][0]).toBe(
      `/api/git/changed?repo=${encodeURIComponent(REPO_PATH)}&base=${"b".repeat(40)}&head=${"h".repeat(40)}`,
    );

    const viewer = await waitFor(() => screen.getByTestId("file-viewer"));
    expect(within(viewer).getByTestId("file-viewer-header")).toHaveTextContent("src/a.ts");
    expect(within(viewer).getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    expect(within(tree).getByTestId("ft-file-src/a.ts")).toHaveAttribute("aria-current", "true");

    const r = await waitFor(() => rail()!);
    expect(within(r).getAllByRole("button").map((b) => b.textContent)).toEqual(["L15+2 −1", "L30−1"]);
  });

  it("unticking changed-only lists the whole repo at the PR head", async () => {
    const fetch = renderReview();
    await loaded();
    fireEvent.click(within(treeArea()).getByRole("checkbox", { name: "Changed files only" }));
    await waitFor(() => expect(screen.getByTestId("ft-file-README.md")).toBeInTheDocument());
    expect(calls(fetch, "/api/git/tree")[0][0]).toBe(
      `/api/git/tree?repo=${encodeURIComponent(REPO_PATH)}&ref=${encodeURIComponent("refs/pavilio/pr/1")}`,
    );
    expect(screen.getByTestId("ft-file-src/a.ts")).toHaveAttribute("title", "src/a.ts (modified)");
    expect(screen.getByTestId("ft-file-src/b.ts")).toHaveClass("unchanged");
    // Deleted at head, so absent from the tree listing, yet still reviewable.
    expect(screen.getByTestId("ft-file-src/gone.ts")).toHaveAttribute("title", "src/gone.ts (deleted)");
  });

  it("code mode reads the file at the PR head", async () => {
    const fetch = renderReview();
    await loaded();
    const viewer = await waitFor(() => screen.getByTestId("file-viewer"));
    fireEvent.click(within(viewer).getByRole("button", { name: "Code" }));
    // Line 40 sits past the diff's last hunk: only the file at head carries it.
    await waitFor(() => expect(viewer.querySelector('tr[data-line="40"]')).toHaveTextContent("line 40"));
    expect(calls(fetch, "/api/git/file").map(([u]) => u)).toContain(
      `/api/git/file?repo=${encodeURIComponent(REPO_PATH)}&ref=${encodeURIComponent("refs/pavilio/pr/1")}&path=${encodeURIComponent("src/a.ts")}`,
    );
  });

  it("rail entry scrolls the viewer to its line", async () => {
    renderReview();
    await loaded();
    const r = await waitFor(() => rail()!);
    const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scroll.mockClear();
    fireEvent.click(within(r).getByRole("button", { name: /^L30/ }));
    const row = screen.getByTestId("file-viewer-body").querySelector('tr[data-line="30"]')!;
    await waitFor(() => expect(row).toHaveClass("fv-flash"));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("search").textContent).toContain("line=30");

    fireEvent.click(within(r).getByRole("button", { name: /^L30/ }));
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
  });

  it("fetch failure shows Retry in the tree area", async () => {
    let fail = true;
    renderReview({
      open: () => (fail ? jsonResponse({ error: "fetch failed" }, { status: 502 }) : jsonResponse({ head: "h1", base: "b1" })),
    });
    const alert = await waitFor(() => within(treeArea()).getByRole("alert"));
    expect(alert).toHaveTextContent("Couldn't fetch this PR's branch");
    expect(screen.getByTestId("review-header")).toHaveTextContent("PR 1 #1");
    expect(screen.queryByTestId("file-viewer")).toBeNull();

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await loaded();
    expect(within(treeArea()).queryByRole("alert")).toBeNull();
  });

  it("rail hides below 1100px and columns stack below 860px", async () => {
    renderReview();
    await loaded();
    const body = screen.getByTestId("review-body");
    DrivenResizeObserver.resize(1300);
    await waitFor(() => expect(rail()).not.toBeNull());
    expect(body).not.toHaveClass("rv-stack");

    DrivenResizeObserver.resize(1000);
    expect(rail()).toBeNull();
    expect(body).toHaveClass("rv-norail");
    expect(body).not.toHaveClass("rv-stack");

    DrivenResizeObserver.resize(800);
    expect(rail()).toBeNull();
    expect(body).toHaveClass("rv-stack");
  });

  it("a late response for the previous PR never shows its files", async () => {
    let release!: () => void;
    const late = new Promise<void>((r) => (release = r));
    const fetch = renderReview({
      open: async (_url, init) => {
        const { number } = JSON.parse(String(init?.body)) as { number: number };
        if (number === 1) await late;
        return jsonResponse({ head: `head${number}`, base: "base" });
      },
    });
    await waitFor(() => expect(calls(fetch, "/api/prs/open")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("pr-switcher"));
    fireEvent.click(await waitFor(() => screen.getByTestId("pr-row-pavilio#2")));
    await loaded();
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(calls(fetch, "/api/git/changed").map(([u]) => u)).toEqual([expect.stringContaining("head=head2")]);
    expect(screen.getByTestId("search").textContent).toContain("pr=pavilio%232");
  });
});
