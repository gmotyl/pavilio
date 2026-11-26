import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../../../test-utils";
import { DrivenResizeObserver, HEAD_SHA, MAIN, renderCode, SITE } from "./codeHarness";

const posts = (fetch: ReturnType<typeof renderCode>["fetch"], path: string) =>
  fetch.mock.calls.filter(([u, init]) => String(u) === path && init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)));

const toggle = () => screen.getByTestId("code-branch-toggle");
const popover = () => screen.getByTestId("code-branch-popover");

async function openPicker() {
  const t = await screen.findByTestId("code-branch-toggle");
  await waitFor(() => expect(t).toHaveTextContent("main"));
  fireEvent.click(t);
  return await screen.findByTestId("code-branch-popover");
}

function closePicker() {
  fireEvent.mouseDown(document.body);
}

beforeEach(() => {
  DrivenResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CodeBranchPicker", () => {
  it("code branch trigger shows detached sha", async () => {
    const { fetch } = renderCode("?view=code", { "/api/git/branch?": () => jsonResponse({ branch: "HEAD" }) });
    await waitFor(() => expect(toggle()).toHaveTextContent(`detached ${HEAD_SHA.slice(0, 7)}`));
    expect(toggle()).not.toHaveTextContent("HEAD");
    // The sha is read for the open checkout.
    expect(fetch.mock.calls.some(([u]) => String(u) === `/api/git/resolve?repo=${encodeURIComponent(MAIN)}&ref=HEAD`)).toBe(true);
  });

  it("code branch picker shows groups, Fetch and the fetched footer", async () => {
    // Far enough ahead that an earlier test's fetch of this checkout is stale.
    const base = Date.now() + 10 * 60_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    renderCode("?view=code");
    const t = await screen.findByTestId("code-branch-toggle");
    await waitFor(() => expect(t).toHaveTextContent("⎇ main ▾"));
    fireEvent.click(t);
    const pop = popover();

    // Check item 2: the filter with ↻ Fetch on its right.
    const filter = within(pop).getByPlaceholderText("Filter branches...");
    const fetchBtn = within(pop).getByTestId("code-branch-fetch");
    expect(filter.compareDocumentPosition(fetchBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Check item 3: Local first, the current branch marked and in the accent colour.
    const local = await within(pop).findByTestId("code-branch-group-local");
    const remote = within(pop).getByTestId("code-branch-group-remote-origin");
    expect(local.compareDocumentPosition(remote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(local).toHaveTextContent("Local");
    const main = within(pop).getByTestId("code-branch-option-main");
    expect(main).toHaveTextContent("current");
    expect(main.style.color).toBe("var(--accent)");
    expect(within(pop).getByTestId("code-branch-option-feat/x")).not.toHaveTextContent("current");
    // Agreed deviation: no ahead hint, only `current`.
    expect(within(pop).getByTestId("code-branch-option-feat/x")).not.toHaveTextContent("↑");

    // Check item 4: Remote · origin rows read origin/<name> with + track.
    expect(remote).toHaveTextContent("Remote · origin");
    const row = within(pop).getByTestId("code-branch-remote-option-origin/feat/story-pr-header");
    expect(row).toHaveTextContent("origin/feat/story-pr-header");
    expect(row).toHaveTextContent("+ track");

    // Agreed deviation: group counts count the filtered rows.
    fireEvent.change(filter, { target: { value: "story-pr" } });
    expect(within(pop).getByTestId("code-branch-group-remote-origin-count")).toHaveTextContent("1");

    // Check item 5: the footer, once the on-open fetch has landed.
    const footer = within(pop).getByTestId("code-branch-footer");
    await waitFor(() => expect(footer).toHaveTextContent("Fetched 0 s ago · a remote branch becomes a local tracking branch"));
    // Read afresh at each open.
    closePicker();
    now.mockReturnValue(base + 125_000);
    fireEvent.click(t);
    expect(within(popover()).getByTestId("code-branch-footer")).toHaveTextContent(
      "Fetched 2 min ago · a remote branch becomes a local tracking branch",
    );
  });

  it("code branch picker footer reads Not fetched yet, and a fetch error in red", async () => {
    let release!: () => void;
    // A checkout no other test fetches: fetch times are kept per checkout for the page.
    const { fetch } = renderCode("?view=code&repo=site", {
      "/api/git/fetch": () => new Promise<Response>((r) => (release = () => r(jsonResponse({ error: "could not read from remote" }, { status: 502 })))),
    });
    const pop = await openPicker();
    await waitFor(() => expect(posts(fetch, "/api/git/fetch")).toEqual([{ repo: SITE }]));
    const footer = within(pop).getByTestId("code-branch-footer");
    await waitFor(() => expect(footer).toHaveTextContent("Not fetched yet · a remote branch becomes a local tracking branch"));
    await act(async () => release());
    const err = await within(footer).findByText("could not read from remote");
    expect(err).toHaveClass("cv-br-err");
    expect(footer).not.toHaveTextContent("Fetched");
    expect(footer).toHaveTextContent("a remote branch becomes a local tracking branch");
  });

  it("code branch picker fetches on open unless fetched within 30s", async () => {
    const base = Date.now() + 30 * 60_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    const { fetch } = renderCode("?view=code");
    await openPicker();
    await waitFor(() => expect(posts(fetch, "/api/git/fetch")).toEqual([{ repo: MAIN }]));
    await waitFor(() => expect(within(popover()).getByTestId("code-branch-fetch")).toHaveTextContent("↻ Fetch"));
    closePicker();

    now.mockReturnValue(base + 10_000);
    fireEvent.click(toggle());
    await screen.findByTestId("code-branch-popover");
    expect(posts(fetch, "/api/git/fetch")).toHaveLength(1);
    // ↻ Fetch always fetches, however recent the last one.
    fireEvent.click(within(popover()).getByTestId("code-branch-fetch"));
    await waitFor(() => expect(posts(fetch, "/api/git/fetch")).toHaveLength(2));
    await waitFor(() => expect(within(popover()).getByTestId("code-branch-fetch")).toHaveTextContent("↻ Fetch"));
    closePicker();

    now.mockReturnValue(base + 10_000 + 31_000);
    fireEvent.click(toggle());
    await screen.findByTestId("code-branch-popover");
    await waitFor(() => expect(posts(fetch, "/api/git/fetch")).toHaveLength(3));
  });

  it("picking a remote branch checks out with track", async () => {
    let on = "main";
    const { fetch } = renderCode("?view=code", {
      "/api/git/branch?": () => jsonResponse({ branch: on }),
      "/api/git/checkout": (_u, init) => {
        const body = JSON.parse(String(init!.body));
        on = body.track ? "feat/story-pr-header" : body.branch;
        return jsonResponse({ ok: true, branch: on });
      },
    });
    const pop = await openPicker();
    fireEvent.click(await within(pop).findByTestId("code-branch-remote-option-origin/feat/story-pr-header"));
    await waitFor(() => expect(posts(fetch, "/api/git/checkout")).toEqual([{ branch: "origin/feat/story-pr-header", repo: MAIN, track: true }]));
    // The trigger reads the local tracking branch, never the remote ref.
    await waitFor(() => expect(toggle()).toHaveTextContent("⎇ feat/story-pr-header ▾"));
    expect(toggle()).not.toHaveTextContent("origin/");

    // A local row checks out by name, without track.
    fireEvent.click(toggle());
    fireEvent.click(await within(popover()).findByTestId("code-branch-option-feat/x"));
    await waitFor(() => expect(posts(fetch, "/api/git/checkout")).toHaveLength(2));
    expect(posts(fetch, "/api/git/checkout")[1]).toEqual({ branch: "feat/x", repo: MAIN });
    await waitFor(() => expect(toggle()).toHaveTextContent("⎇ feat/x ▾"));
  });
});
