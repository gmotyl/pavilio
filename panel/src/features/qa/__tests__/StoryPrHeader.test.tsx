import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, stubFetch } from "../../../test-utils";
import { ME, pr } from "../../repos/__tests__/prFixtures";
import { usePrs } from "../../repos/usePrs";
import StoryPrHeader from "../StoryPrHeader";
import type { StoryPr } from "../useStoryPr";

const HEAD = "18fcc84a1b2c3d4e5f60718293a4b5c6d7e8f901";
const NEWER = "99aa00bb11cc22dd33ee44ff5566778899aabbcc";

const STORY: StoryPr = {
  project: "woozle",
  repo: "woo-dev-be",
  number: 375,
  title: "Refuse state-changing requests without an allowed Origin",
  head: HEAD,
  lang: null,
};

const OPEN = {
  ...pr({
    number: 375,
    repo: "woo-dev-be",
    title: "fix(security): require an allowed Origin",
    author: "olha-infopoly",
    checks: "pass",
    reviewDecision: "required",
    headSha: HEAD,
    url: "https://github.com/acme/woo-dev-be/pull/375",
    updatedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  }),
  state: "open",
};

const REVIEW = "/project/woozle/repos?view=review&pr=woo-dev-be%23375";

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderHeader(story: StoryPr = STORY) {
  return render(
    <MemoryRouter initialEntries={["/project/woozle/qa"]}>
      <Routes>
        <Route path="*" element={<><StoryPrHeader story={story} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const header = () => screen.getByTestId("story-pr-header");
const oneCalls = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/prs/one"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StoryPrHeader", () => {
  it("header shows the PR row parts for an open PR", async () => {
    const fetch = stubFetch({ "/api/prs/one": OPEN });
    renderHeader();
    await screen.findByText("fix(security): require an allowed Origin");
    expect(oneCalls(fetch)[0]).toBe("/api/prs/one?project=woozle&repo=woo-dev-be&number=375");
    const row = within(header()).getByTestId("pr-row-woo-dev-be#375");
    expect(row.querySelector(".pr-ic svg")).not.toBeNull();
    expect(row.querySelector(".pr-ic")?.className).not.toMatch(/merged|closed/);
    expect(within(row).getByLabelText("Checks passed").textContent).toBe("✓");
    expect(within(row).getByText("woo-dev-be").className).toBe("pr-repo");
    expect(within(row).getByText("#375")).toBeTruthy();
    expect(row.querySelector(".pr-av")?.textContent).toBe("OL");
    expect(within(row).getByText("olha-infopoly")).toBeTruthy();
    expect(within(row).getByText("updated 12 min ago")).toBeTruthy();
    expect(within(row).getByText("Review required").className).toContain("pr-badge");
    // Same head: the story is current.
    expect(within(row).queryByText("Story behind")).toBeNull();
  });

  it("the review badge uses the PRs list's login once the list has loaded", async () => {
    stubFetch({
      "/api/prs/one": { ...OPEN, reviewers: [ME] },
      "/api/prs?": { me: ME, prs: [], unavailable: [] },
    });
    const list = renderHook(() => usePrs("woozle", { preset: "all", author: null }));
    await waitFor(() => expect(list.result.current.me).toBe(ME));
    list.unmount();
    renderHeader();
    expect((await screen.findByText("Your review requested")).className).toContain("pr-badge-req");
  });

  it("Review and GitHub links point at the review route and pr.url", async () => {
    stubFetch({ "/api/prs/one": OPEN });
    renderHeader();
    const gh = await screen.findByRole("link", { name: /GitHub ↗/ });
    expect(gh.getAttribute("href")).toBe(OPEN.url);
    expect(gh.getAttribute("target")).toBe("_blank");
    expect(gh.getAttribute("rel")).toBe("noreferrer");
    const review = within(header()).getByRole("link", { name: "Review" });
    expect(review.getAttribute("href")).toBe(REVIEW);
    expect(within(header()).getByRole("button", { name: "Refresh PR status" })).toBeTruthy();
    fireEvent.click(review);
    expect(screen.getByTestId("where").textContent).toBe(REVIEW);
  });

  it("row click opens Review", async () => {
    stubFetch({ "/api/prs/one": OPEN });
    renderHeader();
    fireEvent.click(await screen.findByText("fix(security): require an allowed Origin"));
    expect(screen.getByTestId("where").textContent).toBe(REVIEW);
  });

  it("refresh refetches with fresh=1", async () => {
    let n = 0;
    const fetch = stubFetch({
      "/api/prs/one": () => jsonResponse(n++ === 0 ? OPEN : { ...OPEN, title: "fix(security): renamed", checks: "fail" }),
    });
    renderHeader();
    await screen.findByText("fix(security): require an allowed Origin");
    fireEvent.click(within(header()).getByRole("button", { name: "Refresh PR status" }));
    await screen.findByText("fix(security): renamed");
    expect(within(header()).getByLabelText("Checks failing")).toBeTruthy();
    const calls = oneCalls(fetch);
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toContain("fresh=1");
    expect(calls[1]).toBe("/api/prs/one?project=woozle&repo=woo-dev-be&number=375&fresh=1");
  });

  it("merged PR shows the merged icon and badge; closed shows Closed", async () => {
    stubFetch({ "/api/prs/one": { ...OPEN, state: "merged" } });
    const { unmount } = renderHeader();
    const merged = await screen.findByText("Merged");
    expect(merged.className).toContain("pr-badge-merged");
    expect(header().querySelector(".pr-ic")?.className).toContain("pr-ic-merged");
    expect(within(header()).queryByText("Closed")).toBeNull();
    unmount();

    stubFetch({ "/api/prs/one": { ...OPEN, state: "closed" } });
    renderHeader();
    const closed = await screen.findByText("Closed");
    expect(closed.className).toContain("pr-badge");
    expect(header().querySelector(".pr-ic")?.className).toContain("pr-ic-closed");
    expect(within(header()).queryByText("Merged")).toBeNull();
  });

  it("Story behind shows when head differs", async () => {
    stubFetch({ "/api/prs/one": { ...OPEN, headSha: NEWER } });
    const { unmount } = renderHeader();
    const behind = await screen.findByText("Story behind");
    expect(behind.className).toContain("pr-badge-behind");
    expect(behind.getAttribute("title")).toBe("The PR head moved past the commit this story explains (18fcc84)");
    unmount();

    // An empty headSha says nothing about the head: no badge.
    stubFetch({ "/api/prs/one": { ...OPEN, headSha: "" } });
    const second = renderHeader();
    await screen.findByText("fix(security): require an allowed Origin");
    expect(screen.queryByText("Story behind")).toBeNull();
    second.unmount();

    // No head: in the frontmatter: no badge either.
    stubFetch({ "/api/prs/one": { ...OPEN, headSha: NEWER } });
    renderHeader({ ...STORY, head: null });
    await screen.findByText("fix(security): require an allowed Origin");
    expect(screen.queryByText("Story behind")).toBeNull();
  });

  it("lang tag shows PL, EN or nothing", async () => {
    stubFetch({ "/api/prs/one": OPEN });
    const pl = renderHeader({ ...STORY, lang: "pl" });
    const tag = await screen.findByText("PL");
    expect(tag.closest(".pr-meta")).not.toBeNull();
    pl.unmount();

    const en = renderHeader({ ...STORY, lang: "en" });
    expect((await screen.findByText("EN")).closest(".pr-meta")).not.toBeNull();
    en.unmount();

    renderHeader({ ...STORY, lang: null });
    await screen.findByText("fix(security): require an allowed Origin");
    expect(screen.queryByText("PL")).toBeNull();
    expect(screen.queryByText("EN")).toBeNull();
  });

  it("loading shows the frontmatter title and repo#n", () => {
    stubFetch({ "/api/prs/one": () => new Promise<Response>(() => {}) });
    renderHeader();
    expect(within(header()).getByText(STORY.title as string)).toBeTruthy();
    expect(within(header()).getByText("woo-dev-be")).toBeTruthy();
    expect(within(header()).getByText("#375")).toBeTruthy();
    expect(within(header()).getByRole("link", { name: "Review" }).getAttribute("href")).toBe(REVIEW);
  });

  it("failed fetch shows the reason and no GitHub link", async () => {
    stubFetch({ "/api/prs/one": () => jsonResponse({ unavailable: "gh-unauthenticated" }, { status: 502 }) });
    const { unmount } = renderHeader();
    await within(header()).findByText("gh is not authenticated");
    expect(within(header()).getByText(STORY.title as string)).toBeTruthy();
    expect(within(header()).getByRole("link", { name: "Review" }).getAttribute("href")).toBe(REVIEW);
    expect(within(header()).queryByRole("link", { name: /GitHub/ })).toBeNull();
    unmount();

    stubFetch({ "/api/prs/one": () => jsonResponse({ unavailable: "not-github" }, { status: 502 }) });
    const second = renderHeader();
    await within(header()).findByText("No GitHub remote");
    second.unmount();

    stubFetch({ "/api/prs/one": () => Promise.reject(new TypeError("network down")) });
    renderHeader();
    await within(header()).findByText("Could not load PR status");
    expect(within(header()).queryByRole("link", { name: /GitHub/ })).toBeNull();
  });

  it("unlinked repo shows Repo not linked without Review", async () => {
    stubFetch({ "/api/prs/one": () => jsonResponse({ error: "Repo not found" }, { status: 404 }) });
    renderHeader();
    await within(header()).findByText("Repo not linked");
    expect(within(header()).queryByRole("link", { name: "Review" })).toBeNull();
    expect(within(header()).queryByRole("link", { name: /GitHub/ })).toBeNull();
  });

  it("header actions wrap at 390px", async () => {
    stubFetch({ "/api/prs/one": OPEN });
    renderHeader();
    await screen.findByText("fix(security): require an allowed Origin");
    // jsdom has no layout: assert the narrow-pane rule the header's class opts into.
    expect(header().className).toContain("story-pr");
    const css = readFileSync(join(__dirname, "..", "StoryPrHeader.css"), "utf8").replace(/\s+/g, " ");
    expect(css).toMatch(/\.story-pr \{[^}]*container-type: inline-size/);
    const narrow = css.match(/@container \(max-width: (\d+)px\) \{(.*?)\} \}/);
    expect(narrow).not.toBeNull();
    expect(Number(narrow?.[1])).toBeGreaterThanOrEqual(390);
    expect(narrow?.[2]).toMatch(/\.pr-right \{[^}]*grid-column: 2 \/ 4/);
    expect(narrow?.[2]).toMatch(/\.pr-right \{[^}]*flex-wrap: wrap/);
    expect(narrow?.[2]).toMatch(/\.pr-actions \{[^}]*flex-wrap: wrap/);
    // The title wraps instead of pushing the row wider than the pane.
    expect(css).toMatch(/\.story-pr \.pr-tt \{[^}]*overflow-wrap: anywhere/);
  });
});
