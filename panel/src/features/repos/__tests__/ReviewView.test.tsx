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
  changed?: FetchHandler;
  tree?: FetchHandler;
  file?: FetchHandler;
  list?: FetchHandler;
}

const GONE_DIFF = ["diff --git a/src/gone.ts b/src/gone.ts", "--- a/src/gone.ts", "+++ /dev/null", "@@ -1,3 +0,0 @@", "-one", "-two", "-three"].join("\n");

function renderReview({ search = "?view=review&pr=pavilio%231", prs = PRS, open, changed, tree, file, list }: Setup = {}) {
  const fetch = stubFetch({
    // Before "/api/prs": the first matching fragment wins.
    "/api/prs/open": open ?? (() => jsonResponse({ head: "h".repeat(40), base: "b".repeat(40) })),
    "/api/prs": list ?? { me: ME, prs, unavailable: [] },
    "/api/git/changed": changed ?? (() => jsonResponse(CHANGED)),
    "/api/git/tree": tree ?? (() => jsonResponse(TREE)),
    "/api/git/diff-ref": (url: string) => text(url.includes("gone.ts") ? GONE_DIFF : DIFF),
    "/api/git/file": file ?? ((url: string) =>
      url.includes("logo.png")
        ? jsonResponse({ error: "binary file", binary: true }, { status: 415 })
        : url.includes("huge.json")
          ? jsonResponse({ error: "file too large", tooLarge: true, size: 2.5 * 1024 * 1024 }, { status: 413 })
          : text(CONTENT)),
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

  it("a missing PR refetches the list once, even when each request outlasts the freshness window", async () => {
    // Every request looks older than the 15s freshness window by the time it completes.
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 20_000));
    const fetch = renderReview({ search: "?view=review&pr=pavilio%23999" });
    await screen.findByText(/is not an open pull request/);
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(calls(fetch, "/api/prs?project=")).toHaveLength(2);
    vi.mocked(Date.now).mockRestore();
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

    const r = await waitFor(() => {
      const el = rail()!;
      expect(within(el).getAllByRole("button")).toHaveLength(2);
      return el;
    });
    expect(within(r).getAllByRole("button").map((b) => b.textContent)).toEqual(["L15+2 −1", "L29−1"]);
  });

  it("unticking changed-only lists the whole repo at the PR head", async () => {
    const fetch = renderReview();
    await loaded();
    fireEvent.click(within(treeArea()).getByRole("checkbox", { name: "Changed files only" }));
    await waitFor(() => expect(screen.getByTestId("ft-file-README.md")).toBeInTheDocument());
    expect(calls(fetch, "/api/git/tree")[0][0]).toBe(
      `/api/git/tree?repo=${encodeURIComponent(REPO_PATH)}&ref=${"h".repeat(40)}`,
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
      `/api/git/file?repo=${encodeURIComponent(REPO_PATH)}&ref=${"h".repeat(40)}&path=${encodeURIComponent("src/a.ts")}`,
    );
  });

  it("a file over the read cap shows its size instead of loading", async () => {
    renderReview({ search: "?view=review&pr=pavilio%231&file=huge.json" });
    expect(await screen.findByText("This file is too large to display (2.5 MB).")).toBeInTheDocument();
  });

  it("rail entry scrolls the viewer to its line", async () => {
    renderReview();
    await loaded();
    // The rail mounts before the file's diff arrives; wait for its entries, not just the rail.
    const r = await waitFor(() => {
      const el = rail()!;
      within(el).getByRole("button", { name: /^L29/ });
      return el;
    });
    const scroll = vi.mocked(Element.prototype.scrollTo);
    const outer = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scroll.mockClear();
    outer.mockClear();
    fireEvent.click(within(r).getByRole("button", { name: /^L29/ }));
    // A pure removal lands on the removed row itself, not the line after it.
    const row = screen.getByTestId("file-viewer-body").querySelector('tr[data-old-line="29"]')!;
    expect(row).toHaveTextContent("removed 29");
    await waitFor(() => expect(row).toHaveClass("fv-flash"));
    // Only the viewer pane scrolls; the page around it stays put.
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toHaveClass("rv-main");
    expect(outer).not.toHaveBeenCalled();
    // URL `line` counts new-side lines only.
    expect(screen.getByTestId("search").textContent).not.toContain("line=");
    // The default file is written with the line, so the link survives a change of first file.
    expect(screen.getByTestId("search").textContent).toContain(`file=${encodeURIComponent("src/a.ts")}`);

    fireEvent.click(within(r).getByRole("button", { name: /^L29/ }));
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
    // Settle the late answer itself rather than sleeping for a guessed interval.
    const lateAnswer = fetch.mock.results[fetch.mock.calls.findIndex(([u]) => String(u).includes("/api/prs/open"))].value as Promise<Response>;
    await act(async () => {
      release();
      await lateAnswer;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(calls(fetch, "/api/git/changed").map(([u]) => u)).toEqual([expect.stringContaining("head=head2")]);
    expect(screen.getByTestId("search").textContent).toContain("pr=pavilio%232");
  });
  it("selecting a deleted file renders its diff without reading the file", async () => {
    const fetch = renderReview();
    await loaded();
    fireEvent.click(screen.getByTestId("ft-file-src/gone.ts"));
    const viewer = await waitFor(() => {
      const v = screen.getByTestId("file-viewer");
      expect(within(v).getByTestId("file-viewer-header")).toHaveTextContent("src/gone.ts");
      return v;
    });
    expect(within(viewer).getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    expect(viewer).toHaveTextContent("three");
    expect(calls(fetch, "/api/git/file").filter(([u]) => String(u).includes("gone.ts"))).toHaveLength(0);
  });

  it("rail offers no jump into a fully deleted file", async () => {
    renderReview({ search: "?view=review&pr=pavilio%231&file=src%2Fgone.ts" });
    await waitFor(() => expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("src/gone.ts"));
    const r = await waitFor(() => rail()!);
    await waitFor(() => expect(r).toHaveTextContent("File deleted"));
    expect(within(r).queryAllByRole("button")).toHaveLength(0);
  });

  it("switcher closes on Escape and on an outside click", async () => {
    renderReview({ search: "?view=review" });
    const switcher = screen.getByTestId("pr-switcher");
    fireEvent.click(switcher);
    expect(screen.getByRole("dialog", { name: "Pick a pull request" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Pick a pull request" })).toBeNull();
    expect(switcher).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(switcher);
    const pop = screen.getByRole("dialog", { name: "Pick a pull request" });
    fireEvent.mouseDown(pop);
    expect(screen.getByRole("dialog", { name: "Pick a pull request" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Pick a pull request" })).toBeNull();
  });

  it("a failed changed-files listing has its own message and Retry", async () => {
    let fail = true;
    renderReview({ changed: () => (fail ? jsonResponse({ error: "boom" }, { status: 500 }) : jsonResponse(CHANGED)) });
    const alert = await waitFor(() => within(treeArea()).getByRole("alert"));
    expect(alert).toHaveTextContent("Couldn't load this PR's changes");
    expect(alert).not.toHaveTextContent("Couldn't fetch this PR's branch");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await loaded();
    expect(within(treeArea()).queryByRole("alert")).toBeNull();
  });

  it("missing history says so and offers to fetch more instead of a plain Retry", async () => {
    let fail = true;
    const fetch = renderReview({
      changed: () => (fail ? jsonResponse({ error: "base and head have no merge base", code: "no-merge-base" }, { status: 400 }) : jsonResponse(CHANGED)),
    });
    const alert = await waitFor(() => within(treeArea()).getByRole("alert"));
    expect(alert).toHaveTextContent("This clone is missing history needed to compare");
    expect(within(alert).queryByRole("button", { name: "Retry" })).toBeNull();
    fail = false;
    fireEvent.click(within(alert).getByTestId("review-fetch-history"));
    await loaded();
    // Re-opening the PR is what deepens a shallow clone.
    expect(calls(fetch, "/api/prs/open")).toHaveLength(2);
  });

  it("a whole-tree listing failure can be retried and resets on re-toggle", async () => {
    let fail = true;
    const fetch = renderReview({ tree: () => (fail ? jsonResponse({ error: "boom" }, { status: 500 }) : jsonResponse(TREE)) });
    await loaded();
    const box = () => within(treeArea()).getByRole("checkbox", { name: "Changed files only" });
    fireEvent.click(box());
    const status = await waitFor(() => within(treeArea()).getByText(/Couldn't list the repo/));
    expect(calls(fetch, "/api/git/tree")).toHaveLength(1);

    // Re-toggling clears the error and refetches.
    fireEvent.click(box());
    fireEvent.click(box());
    await waitFor(() => expect(calls(fetch, "/api/git/tree")).toHaveLength(2));
    await waitFor(() => within(treeArea()).getByText(/Couldn't list the repo/));

    fail = false;
    fireEvent.click(within(treeArea()).getByTestId("review-tree-retry"));
    await waitFor(() => expect(screen.getByTestId("ft-file-README.md")).toBeInTheDocument());
    expect(within(treeArea()).queryByText(/Couldn't list the repo/)).toBeNull();
    expect(status).not.toBeInTheDocument();
  });

  it("a changed file too large to read whole keeps its patch", async () => {
    renderReview({ file: () => jsonResponse({ error: "file too large", tooLarge: true, size: 9 * 1024 * 1024 }, { status: 413 }) });
    await loaded();
    const viewer = await waitFor(() => screen.getByTestId("file-viewer"));
    expect(within(viewer).getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    expect(viewer).toHaveTextContent("const area = width * height;");
    expect(screen.getByTestId("review-code-note")).toHaveTextContent("too large to load");
    // A modified file can't be rebuilt from its hunks: never promise Code will show it.
    expect(screen.getByTestId("review-code-note")).not.toHaveTextContent(/Code mode shows/);
    expect(screen.getByTestId("review-code-note")).toHaveTextContent("Diff shows the changes");
    expect(screen.queryByText(/too large to display/)).toBeNull();
  });


  it("switcher shows unavailable repos and retries a failed list", async () => {
    let fail = true;
    renderReview({
      search: "?view=review",
      list: () =>
        fail
          ? jsonResponse({ error: "boom" }, { status: 500 })
          : jsonResponse({ me: ME, prs: PRS, unavailable: [{ repo: "api", reason: "failed" }] }),
    });
    fireEvent.click(screen.getByTestId("pr-switcher"));
    const pop = screen.getByRole("dialog", { name: "Pick a pull request" });
    const alert = await within(pop).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load pull requests");
    fail = false;
    fireEvent.click(within(alert).getByTestId("pr-switcher-retry"));
    await waitFor(() => expect(within(within(pop).getByRole("listbox")).getAllByRole("option")).toHaveLength(2));
    const lines = within(within(pop).getByRole("list", { name: "Unavailable repositories" })).getAllByRole("listitem");
    expect(lines.map((l) => l.textContent)).toEqual(["apiCouldn't load pull requestsRetry"]);
  });

  it("switcher list has one tab stop, arrow navigation and returns focus to its trigger", async () => {
    renderReview({ search: "?view=review&pr=pavilio%232" });
    const trigger = screen.getByTestId("pr-switcher");
    fireEvent.click(trigger);
    const pop = screen.getByRole("dialog", { name: "Pick a pull request" });
    const options = () => within(within(pop).getByRole("listbox")).getAllByRole("option");
    await waitFor(() => expect(options()).toHaveLength(2));
    // The open PR is the list's single tab stop.
    expect(options().map((o) => o.tabIndex)).toEqual([-1, 0]);
    options()[1].focus();
    fireEvent.keyDown(options()[1], { key: "Home" });
    expect(options()[0]).toHaveFocus();
    fireEvent.keyDown(options()[0], { key: "ArrowDown" });
    expect(options()[1]).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Pick a pull request" })).toBeNull();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    const again = await waitFor(() => within(screen.getByRole("listbox", { name: "Open pull requests" })).getAllByRole("option"));
    again[0].focus();
    fireEvent.keyDown(again[0], { key: "Enter" });
    expect(screen.getByTestId("search").textContent).toContain("pr=pavilio%231");
    expect(trigger).toHaveFocus();
  });

  it("switcher popover is pulled back inside a narrow Repos tab", async () => {
    const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON() {} }) as DOMRect;
    const real = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("rt")) return rect(0, 600);
      // Hung off a trigger 300px in, 560px wide: 260px past the tab's edge until shifted.
      if (this.classList.contains("rv-sw-pop")) return rect(300 + (parseFloat(this.style.left) || 0), 560);
      return real.call(this);
    });
    renderReview({ search: "?view=review" });
    fireEvent.click(screen.getByTestId("pr-switcher"));
    const pop = screen.getByRole("dialog", { name: "Pick a pull request" });
    expect(pop.style.maxWidth).toBe("584px");
    // right edge 860 → 592 (600 minus the 8px gutter)
    expect(pop.style.left).toBe("-268px");
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockRestore();
  });
});
