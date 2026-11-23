import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, type FetchHandler } from "../../../test-utils";
import { calls, DrivenResizeObserver, MAIN, renderCode } from "./codeHarness";

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
    "/api/git/branches": () => jsonResponse({ current: "main", branches: ["main", "feat/y"] }),
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
});
