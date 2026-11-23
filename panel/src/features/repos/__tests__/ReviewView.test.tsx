import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, stubFetch, type FetchHandler } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { writePreference } from "../../../preferences/store";
import ReposTab from "../ReposTab";
import { prSpeechKey } from "../PrDescription";
import type { PullRequest } from "../usePrs";
import type { ReviewComment } from "../../../../server/lib/prs/provider";
import { ME, PRS, pr } from "./prFixtures";

// The description's speech needs the panel's speech host; PrDescription.test
// covers that (Play, play-from-here, the empty body). Here only what the review hands it matters.
vi.mock("../PrDescription", async (importOriginal) => {
  const real = await importOriginal<typeof import("../PrDescription")>();
  return {
    ...real,
    default: ({ project, pr: p, body }: { project: string; pr: PullRequest; body: string | null | undefined }) => (
      <section aria-label="Pull request description" data-speech-key={real.prSpeechKey(project, p)}>
        {body === undefined ? "failed" : body === null ? "loading" : body}
      </section>
    ),
  };
});
// Comment markers speak through the panel's one host; only the call matters here.
const speech = vi.hoisted(() => ({ speakDocument: vi.fn() }));
vi.mock("../../speech/SpeechHostProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../speech/SpeechHostProvider")>()),
  usePageSpeech: () => speech,
}));

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
const comment = (over: Partial<ReviewComment> & { id: number }): ReviewComment => ({
  replyTo: null,
  path: "src/a.ts",
  line: 15,
  side: "new",
  author: "anna",
  body: "Rename this?",
  createdAt: "2026-11-22T10:00:00Z",
  url: `https://github.com/gmotyl/pavilio/pull/1#discussion_r${over.id}`,
  ...over,
});
// Two on src/a.ts (a thread on new line 15 with greg's reply), one on the deleted file.
const COMMENTS = [
  comment({ id: 1 }),
  comment({ id: 2, replyTo: 1, author: ME, body: "Done.", createdAt: "2026-11-22T11:00:00Z" }),
  comment({ id: 3, path: "src/gone.ts", line: 2, side: "old", author: "bob", body: "Why?" }),
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
  comments?: FetchHandler;
}

const GONE_DIFF = ["diff --git a/src/gone.ts b/src/gone.ts", "--- a/src/gone.ts", "+++ /dev/null", "@@ -1,3 +0,0 @@", "-one", "-two", "-three"].join("\n");

function renderReview({ search = "?view=review&pr=pavilio%231", prs = PRS, open, changed, tree, file, list, comments }: Setup = {}) {
  const fetch = stubFetch({
    // Before "/api/prs": the first matching fragment wins.
    "/api/prs/open": open ?? (() => jsonResponse({ head: "h".repeat(40), base: "b".repeat(40), body: "PR body text" })),
    "/api/prs/comments": comments ?? (() => jsonResponse([])),
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
const desc = () => screen.queryByRole("region", { name: "Pull request description" });
const descEntry = () => within(treeArea()).getByRole("button", { name: "Description" });
const FILE_A = "?view=review&pr=pavilio%231&file=src%2Fa.ts";
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const loaded = () => waitFor(() => expect(screen.getByTestId("ft-file-src/a.ts")).toBeInTheDocument());

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
  vi.mocked(Element.prototype.scrollTo).mockClear();
  speech.speakDocument.mockClear();
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

  it("renders tree and the linked file's viewer in Diff", async () => {
    const fetch = renderReview({ search: FILE_A });
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
    expect(desc()).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Changes in this file" })).toBeNull();
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
    const fetch = renderReview({ search: FILE_A });
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

  it("fetch failure shows Retry in the tree area", async () => {
    let fail = true;
    renderReview({
      open: () => (fail ? jsonResponse({ error: "fetch failed" }, { status: 502 }) : jsonResponse({ head: "h1", base: "b1" })),
    });
    const alert = await waitFor(() => within(treeArea()).getByRole("alert"));
    expect(alert).toHaveTextContent("Couldn't fetch this PR's branch");
    expect(screen.getByTestId("review-header")).toHaveTextContent("PR 1 #1");
    expect(screen.queryByTestId("file-viewer")).toBeNull();
    // The Description entry doesn't wait for the branch.
    expect(descEntry()).toHaveAttribute("aria-current", "true");
    expect(desc()).toHaveTextContent("failed");

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await loaded();
    expect(within(treeArea()).queryByRole("alert")).toBeNull();
    // The retried answer carried no body: the PR has no description.
    expect(desc()).toBeEmptyDOMElement();
  });

  it("Review has no description column at any width", async () => {
    renderReview();
    await loaded();
    const body = screen.getByTestId("review-body");
    for (const width of [1300, 1000, 800]) {
      DrivenResizeObserver.resize(width);
      expect(screen.queryByRole("complementary")).toBeNull();
      expect(body.querySelector(".rv-desc")).toBeNull();
      expect(body).not.toHaveClass("rv-nodesc");
      // The description lives in the viewer, not beside it.
      expect(desc()?.closest(".rv-main")).not.toBeNull();
      expect(body.children).toHaveLength(2);
    }
    expect(body).toHaveClass("rv-stack");
    DrivenResizeObserver.resize(1300);
    expect(body).not.toHaveClass("rv-stack");
  });

  it("Review opens on the Description entry", async () => {
    // An old link's line without a file is ignored.
    const fetch = renderReview({ search: "?view=review&pr=pavilio%231&line=15" });
    await loaded();
    const entry = descEntry();
    expect(entry).toHaveAttribute("aria-current", "true");
    const sep = within(treeArea()).getByRole("separator");
    const files = within(treeArea()).getByRole("navigation", { name: "Pull request files" });
    expect(before(entry, sep) && before(sep, files)).toBe(true);
    expect(within(files).getByTestId("ft-file-src/a.ts")).not.toHaveAttribute("aria-current");

    await waitFor(() => expect(desc()).toHaveTextContent("PR body text"));
    expect(desc()).toHaveAttribute("data-speech-key", prSpeechKey("pavilio", PRS[0]));
    expect(screen.queryByTestId("file-viewer")).toBeNull();
    expect(calls(fetch, "/api/git/diff-ref")).toHaveLength(0);
    // FileViewer jumps by scrolling its host box (scrollRowIntoHost), never via scrollIntoView.
    expect(Element.prototype.scrollTo).not.toHaveBeenCalled();
  });

  it("a deep link's file and line scroll the review pane to that line", async () => {
    renderReview({ search: `${FILE_A}&line=15` });
    const viewer = await waitFor(() => screen.getByTestId("file-viewer"));
    await waitFor(() => expect(viewer).toHaveTextContent("const area = width * height;"));
    const scroll = vi.mocked(Element.prototype.scrollTo);
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts).toContain(document.querySelector(".rv-main"));
  });

  it("an empty file parameter opens the Description", async () => {
    const fetch = renderReview({ search: "?view=review&pr=pavilio%231&file=" });
    await loaded();
    expect(descEntry()).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(desc()).toHaveTextContent("PR body text"));
    expect(screen.queryByTestId("file-viewer")).toBeNull();
    expect(calls(fetch, "/api/git/diff-ref")).toHaveLength(0);
  });

  it("a pull request that changes no files says so in the tree area", async () => {
    renderReview({ changed: () => jsonResponse([]) });
    const msg = await screen.findByText("This pull request changes no files.");
    expect(treeArea().contains(msg)).toBe(true);
    expect(within(treeArea()).getByRole("checkbox", { name: "Changed files only" })).toBeChecked();
    expect(within(treeArea()).queryByRole("navigation", { name: "Pull request files" })).toBeNull();
  });

  it("in a PR diff the comment lane is always present, so line numbers never shift", async () => {
    // Pending: the comments request never answers.
    renderReview({ search: FILE_A, comments: () => new Promise<Response>(() => {}) });
    const viewer = await waitFor(() => screen.getByTestId("file-viewer"));
    await waitFor(() => expect(viewer).toHaveTextContent("const area = width * height;"));
    expect(viewer.querySelector(".fv-cm-col")).not.toBeNull();
  });

  it("the comment lane stays when the comments request fails", async () => {
    renderReview({ search: FILE_A, comments: () => jsonResponse({ error: "boom" }, { status: 502 }) });
    await screen.findByTestId("review-comments-note");
    const viewer = await waitFor(() => screen.getByTestId("file-viewer"));
    await waitFor(() => expect(viewer).toHaveTextContent("const area = width * height;"));
    expect(viewer.querySelector(".fv-cm-col")).not.toBeNull();
  });

  it("Description entry stays first with the whole-repo tree", async () => {
    renderReview();
    await loaded();
    fireEvent.click(within(treeArea()).getByRole("checkbox", { name: "Changed files only" }));
    const readme = await waitFor(() => screen.getByTestId("ft-file-README.md"));
    const entry = descEntry();
    expect(entry).toHaveAttribute("aria-current", "true");
    const sep = within(treeArea()).getByRole("separator");
    expect(before(entry, sep) && before(sep, readme)).toBe(true);
    const rows = within(treeArea()).getAllByRole("button");
    expect(rows[0]).toBe(entry);
  });

  it("Review opens the linked file when the URL names one", async () => {
    // Comments never answer: the tree and diff must not wait for them.
    renderReview({ search: FILE_A, comments: () => new Promise<Response>(() => {}) });
    await loaded();
    const viewer = await waitFor(() => screen.getByTestId("file-viewer"));
    expect(within(viewer).getByTestId("file-viewer-header")).toHaveTextContent("src/a.ts");
    expect(within(viewer).getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(viewer).toHaveTextContent("const area = width * height;"));
    expect(screen.getByTestId("ft-file-src/a.ts")).toHaveAttribute("aria-current", "true");
    expect(descEntry()).not.toHaveAttribute("aria-current");
    expect(desc()).toBeNull();
  });

  it("Picking Description clears file and line", async () => {
    renderReview({ search: `${FILE_A}&line=15` });
    await waitFor(() => screen.getByTestId("file-viewer"));
    fireEvent.click(descEntry());
    const search = screen.getByTestId("search").textContent ?? "";
    expect(search).toContain("pr=pavilio%231");
    expect(search).not.toContain("file=");
    expect(search).not.toContain("line=");
    expect(descEntry()).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("ft-file-src/a.ts")).not.toHaveAttribute("aria-current");
    expect(desc()).toHaveTextContent("PR body text");
    expect(screen.queryByTestId("file-viewer")).toBeNull();
  });

  it("Review shows comment counts in the file list and markers in the viewer", async () => {
    const fetch = renderReview({ search: FILE_A, comments: () => jsonResponse(COMMENTS) });
    await waitFor(() => expect(within(screen.getByTestId("ft-file-src/a.ts")).getByTitle("2 comments")).toBeInTheDocument());
    expect(within(screen.getByTestId("ft-file-src/gone.ts")).getByTitle("1 comment")).toBeInTheDocument();
    expect(calls(fetch, "/api/prs/comments").map(([u]) => u)).toEqual([`/api/prs/comments?repo=${encodeURIComponent(REPO_PATH)}&number=1`]);

    const viewer = await waitFor(() => screen.getByTestId("file-viewer"));
    const marker = await within(viewer).findByRole("button", { name: "2 comments on line 15" });
    // Only this file's threads: the deleted file's comment isn't here.
    expect(within(viewer).getAllByRole("button", { name: /comments? on line/ })).toHaveLength(1);
    fireEvent.focus(marker);
    const pop = await screen.findByRole("dialog", { name: "Comments on line 15" });
    // `me` reaches the marker: greg's reply reads as "you".
    expect(pop).toHaveTextContent("you");
    expect(pop).toHaveTextContent("anna");
    fireEvent.click(within(pop).getByRole("button", { name: "Play thread" }));
    expect(speech.speakDocument).toHaveBeenCalledWith(expect.objectContaining({ key: `${prSpeechKey("pavilio", PRS[0])}/t/1` }));
  });

  it("Review keeps the diff when comments fail and offers Retry", async () => {
    let fail = true;
    const fetch = renderReview({
      search: FILE_A,
      comments: () => (fail ? jsonResponse({ error: "boom" }, { status: 502 }) : jsonResponse(COMMENTS)),
    });
    const note = await screen.findByTestId("review-comments-note");
    expect(note).toHaveTextContent("Couldn't load review comments");
    const main = document.querySelector(".rv-main")!;
    expect(main.contains(note)).toBe(true);
    const viewer = await waitFor(() => screen.getByTestId("file-viewer"));
    expect(before(note, viewer)).toBe(true);
    await waitFor(() => expect(viewer).toHaveTextContent("const area = width * height;"));
    expect(within(viewer).queryByRole("button", { name: /comments? on line/ })).toBeNull();

    const counts = () => [calls(fetch, "/api/prs/open").length, calls(fetch, "/api/git/changed").length, calls(fetch, "/api/git/diff-ref").length];
    const was = counts();
    fail = false;
    fireEvent.click(within(note).getByRole("button", { name: "Retry" }));
    await within(screen.getByTestId("file-viewer")).findByRole("button", { name: "2 comments on line 15" });
    expect(screen.queryByTestId("review-comments-note")).toBeNull();
    expect(calls(fetch, "/api/prs/comments")).toHaveLength(2);
    expect(counts()).toEqual(was);
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
    renderReview({ search: FILE_A, file: () => jsonResponse({ error: "file too large", tooLarge: true, size: 9 * 1024 * 1024 }, { status: 413 }) });
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
