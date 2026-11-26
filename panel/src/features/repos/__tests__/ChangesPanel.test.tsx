import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, type FetchHandler } from "../../../test-utils";
import { branchListing, calls, DrivenResizeObserver, MAIN, renderCode } from "./codeHarness";

const outline = () => screen.queryByRole("complementary", { name: "Outline" });
const panel = () => screen.queryByRole("complementary", { name: "Changes" });
const toggle = () => screen.getByTestId("code-changes-toggle");

const posts = (fetch: ReturnType<typeof renderCode>["fetch"], path: string) =>
  fetch.mock.calls.filter(([u, init]) => String(u) === path && init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)));

/** Working tree where src/a.ts is modified until a commit lands. */
function committing() {
  let committed = false;
  const routes: Record<string, FetchHandler> = {
    "/api/git/suggest-message": () => jsonResponse({ suggestion: "chore: tweak a" }),
    "/api/git/branches": () => jsonResponse({ current: "main", branches: ["main", "feat/y"], local: ["main", "feat/y"], remote: [] }),
    "/api/git/branch?": () => jsonResponse({ branch: "main" }),
    "/api/git/stage": () => jsonResponse({ ok: true }),
    "/api/git/commit": () => {
      committed = true;
      return jsonResponse({ ok: true });
    },
    "/api/git/push": () => jsonResponse({ ok: true }),
    "/api/git/checkout": () => jsonResponse({ branch: "feat/y" }),
    [`/api/git/status?repo=${encodeURIComponent(MAIN)}`]: () => jsonResponse(committed ? [] : [{ status: "M", path: "src/a.ts" }]),
    [`/api/git/tree?repo=${encodeURIComponent(MAIN)}`]: () =>
      jsonResponse({
        files: [
          { path: "README.md", status: null },
          committed ? { path: "src/a.ts", status: null } : { path: "src/a.ts", status: "M", add: 1, del: 1 },
          { path: "src/b.ts", status: null },
        ],
      }),
  };
  return routes;
}

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
});

describe("ChangesPanel", () => {
  it("Changes panel replaces the outline and counts changed files", async () => {
    renderCode("?view=code&file=src/b.ts", committing());
    await waitFor(() => expect(toggle()).toHaveTextContent("Changes 1"));
    await waitFor(() => expect(outline()).not.toBeNull());

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    const p = await waitFor(() => panel()!);
    expect(outline()).toBeNull();
    fireEvent.click(await within(p).findByTestId("changes-file-src/a.ts"));
    await waitFor(() => expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("src/a.ts"));

    fireEvent.click(toggle());
    expect(panel()).toBeNull();
    expect(outline()).not.toBeNull();
  });

  it("staging and committing clears the file and its badge", async () => {
    const { fetch } = renderCode("?view=code&file=src/a.ts", committing());
    fireEvent.click(await screen.findByTestId("code-changes-toggle"));
    const p = await waitFor(() => panel()!);
    fireEvent.click(await within(p).findByRole("checkbox", { name: "Select src/a.ts" }));
    fireEvent.click(within(p).getByTestId("changes-stage-selected"));
    await waitFor(() => expect(posts(fetch, "/api/git/stage")).toEqual([{ files: ["src/a.ts"], repo: MAIN }]));

    const msg = within(p).getByRole("textbox", { name: "Commit message" });
    fireEvent.change(msg, { target: { value: "fix: area" } });
    // Commit stays disabled until the stage round-trip settles.
    const commit = within(p).getByTestId("changes-commit");
    await waitFor(() => expect(commit).toBeEnabled());
    fireEvent.click(commit);
    await waitFor(() => expect(posts(fetch, "/api/git/commit")).toEqual([{ message: "fix: area", repo: MAIN }]));

    await waitFor(() => expect(within(p).queryByTestId("changes-file-src/a.ts")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("ft-file-src/a.ts")).toHaveClass("unchanged"));
    expect(toggle()).toHaveTextContent("Changes 0");
  });

  it("suggest message, push and checkout use the existing endpoints", async () => {
    const { fetch } = renderCode("?view=code", committing());
    fireEvent.click(await screen.findByTestId("code-changes-toggle"));
    const p = await waitFor(() => panel()!);
    const msg = within(p).getByRole("textbox", { name: "Commit message" });
    await waitFor(() => expect(msg).toHaveValue("chore: tweak a"));
    expect(calls(fetch, `/api/git/suggest-message?repo=${encodeURIComponent(MAIN)}`).length).toBeGreaterThan(0);

    const commitPush = within(p).getByTestId("changes-commit-push");
    await waitFor(() => expect(commitPush).toBeEnabled());
    fireEvent.click(commitPush);
    await waitFor(() => expect(posts(fetch, "/api/git/push")).toEqual([{ repo: MAIN }]));
    expect(posts(fetch, "/api/git/commit")).toEqual([{ message: "chore: tweak a", repo: MAIN }]);

    fireEvent.click(await within(p).findByTestId("changes-branch-toggle"));
    // The popover is portalled to body, outside the panel.
    fireEvent.click(await screen.findByTestId("changes-branch-option-feat/y"));
    await waitFor(() => expect(posts(fetch, "/api/git/checkout")).toEqual([{ branch: "feat/y", repo: MAIN }]));
  });

  it("a rejected commit never pushes and keeps the message", async () => {
    const routes = committing();
    routes["/api/git/commit"] = () => jsonResponse({ error: "pre-commit hook failed" }, { status: 500 });
    const { fetch } = renderCode("?view=code", routes);
    fireEvent.click(await screen.findByTestId("code-changes-toggle"));
    const p = await waitFor(() => panel()!);
    const msg = within(p).getByRole("textbox", { name: "Commit message" });
    await waitFor(() => expect(msg).toHaveValue("chore: tweak a"));
    fireEvent.change(msg, { target: { value: "fix: area" } });
    const commitPush = within(p).getByTestId("changes-commit-push");
    await waitFor(() => expect(commitPush).toBeEnabled());
    fireEvent.click(commitPush);

    expect(await within(p).findByRole("alert")).toHaveTextContent("pre-commit hook failed");
    expect(posts(fetch, "/api/git/commit")).toHaveLength(1);
    expect(posts(fetch, "/api/git/push")).toEqual([]);
    expect(msg).toHaveValue("fix: area");
    expect(commitPush).toBeEnabled();
  });

  it("the branch picker is locked while a commit is in flight", async () => {
    const routes = committing();
    let release!: () => void;
    routes["/api/git/commit"] = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(jsonResponse({ ok: true }));
      });
    renderCode("?view=code", routes);
    fireEvent.click(await screen.findByTestId("code-changes-toggle"));
    const p = await waitFor(() => panel()!);
    const commitPush = within(p).getByTestId("changes-commit-push");
    await waitFor(() => expect(commitPush).toBeEnabled());
    const branch = await within(p).findByTestId("changes-branch-toggle");
    fireEvent.click(commitPush);

    await waitFor(() => expect(branch).toBeDisabled());
    release();
    await waitFor(() => expect(branch).toBeEnabled());
  });

  it("toolbar checkout error shows once when the Changes panel is open", async () => {
    const routes = committing();
    routes["/api/git/branches"] = () => jsonResponse(branchListing(MAIN));
    routes["/api/git/checkout"] = () => jsonResponse({ error: "your local changes would be overwritten" }, { status: 409 });
    renderCode("?view=code", routes);
    fireEvent.click(await screen.findByTestId("code-changes-toggle"));
    const p = await waitFor(() => panel()!);
    const picker = screen.getByTestId("code-branch-toggle");
    await waitFor(() => expect(picker).toHaveTextContent("main"));
    fireEvent.click(picker);
    fireEvent.click(await screen.findByTestId("code-branch-option-feat/x"));

    expect(await within(p).findByRole("alert")).toHaveTextContent("your local changes would be overwritten");
    expect(screen.queryByTestId("code-checkout-error")).toBeNull();
    expect(screen.getAllByText(/your local changes would be overwritten/)).toHaveLength(1);

    // Closing the panel hands the same error to the toolbar alert.
    fireEvent.click(toggle());
    expect(await screen.findByTestId("code-checkout-error")).toHaveTextContent("Couldn't switch to feat/x: your local changes would be overwritten");
    expect(screen.getAllByText(/your local changes would be overwritten/)).toHaveLength(1);
  });

  it("toolbar switch updates the open Changes panel", async () => {
    let on = "main";
    const routes = committing();
    routes["/api/git/branches"] = () => jsonResponse(branchListing(MAIN, ["main", "feat/y"]));
    routes["/api/git/branch?"] = () => jsonResponse({ branch: on });
    routes["/api/git/checkout"] = (_u, init) => {
      on = JSON.parse(String(init!.body)).branch;
      return jsonResponse({ ok: true, branch: on });
    };
    routes[`/api/git/status?repo=${encodeURIComponent(MAIN)}`] = () =>
      jsonResponse(on === "main" ? [{ status: "M", path: "src/a.ts" }] : [{ status: "??", path: "src/new.ts" }]);
    const { fetch } = renderCode("?view=code", routes);
    fireEvent.click(await screen.findByTestId("code-changes-toggle"));
    const p = await waitFor(() => panel()!);
    await within(p).findByTestId("changes-file-src/a.ts");
    expect(within(p).getByTestId("changes-branch-toggle")).toHaveTextContent("main");

    fireEvent.click(screen.getByTestId("code-branch-toggle"));
    fireEvent.click(await screen.findByTestId("code-branch-option-feat/y"));
    await waitFor(() => expect(posts(fetch, "/api/git/checkout")).toEqual([{ branch: "feat/y", repo: MAIN }]));

    await waitFor(() => expect(within(p).getByTestId("changes-branch-toggle")).toHaveTextContent("feat/y"));
    expect(await within(p).findByTestId("changes-file-src/new.ts")).toBeInTheDocument();
    expect(within(p).queryByTestId("changes-file-src/a.ts")).toBeNull();
    expect(screen.getByTestId("code-branch-toggle")).toHaveTextContent("⎇ feat/y ▾");
  });

  it("changes panel branch label opens the grouped picker", async () => {
    let on = "main";
    const routes = committing();
    routes["/api/git/branches"] = () => jsonResponse(branchListing(MAIN));
    routes["/api/git/branch?"] = () => jsonResponse({ branch: on });
    routes["/api/git/checkout"] = () => jsonResponse({ ok: true, branch: (on = "feat/story-pr-header") });
    const { fetch } = renderCode("?view=code", routes);
    fireEvent.click(await screen.findByTestId("code-changes-toggle"));
    const p = await waitFor(() => panel()!);
    fireEvent.click(await within(p).findByTestId("changes-branch-toggle"));

    const pop = await screen.findByTestId("changes-branch-popover");
    expect(within(pop).getByTestId("changes-branch-group-local")).toHaveTextContent("Local");
    expect(within(pop).getByTestId("changes-branch-group-remote-origin")).toHaveTextContent("Remote · origin");
    expect(within(pop).getByTestId("changes-branch-option-main")).toHaveTextContent("current");
    expect(within(pop).getByTestId("changes-branch-fetch")).toBeInTheDocument();
    expect(within(pop).getByTestId("changes-branch-footer")).toHaveTextContent("a remote branch becomes a local tracking branch");

    fireEvent.click(within(pop).getByTestId("changes-branch-remote-option-origin/feat/story-pr-header"));
    await waitFor(() => expect(posts(fetch, "/api/git/checkout")).toEqual([{ branch: "origin/feat/story-pr-header", repo: MAIN, track: true }]));
    await waitFor(() => expect(within(p).getByTestId("changes-branch-toggle")).toHaveTextContent("feat/story-pr-header"));
  });
});
