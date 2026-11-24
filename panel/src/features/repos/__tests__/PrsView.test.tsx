import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../../../test-utils";
import { preferences, type TerminalLauncher } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import { BLOCKED_TEXT, NO_LAUNCHER_TEXT } from "../../projects/useProjectLauncher";
import { explainRunLine } from "../../projects/runPrompt";
import { startTaskRun } from "../../projects/startTaskRun";
import ReposTab from "../ReposTab";
import type { PrsResponse } from "../usePrs";
import { ME, PRS, pr } from "./prFixtures";

// Opening a PR mounts the Review view; its description needs the speech host (PrDescription.test).
vi.mock("../PrDescription", () => ({ default: () => null }));

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));
vi.mock("../../projects/startTaskRun", () => ({
  startTaskRun: vi.fn(async () => "new-1"),
}));
// The drawer shows the new terminal, so a launch leaves the URL where it was.
vi.mock("../../terminal/useTerminalDrawer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../terminal/useTerminalDrawer")>()),
  useTerminalDrawerVisible: () => true,
}));
vi.mock("../../terminal/useTerminalSessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../terminal/useTerminalSessions")>()),
  dispatchTerminalFocus: vi.fn(),
}));

const CLAUDE: TerminalLauncher = { name: "claude", command: "claude", runLoop: "/goal {prompt}" };
// Not a shipped name, so its stored whole line is read as one: never ready.
const WHOLE_LINE: TerminalLauncher = { name: "mine", command: "claude", runLoop: 'claude "/goal {prompt}"' };
// A blank run loop is not offered for runs at all.
const NO_RUN_LOOP: TerminalLauncher = { name: "shell", command: "bash", runLoop: "" };

const REPOS = [{ name: "pavilio", path: "/root/git/prv/pavilio", present: true }];

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderPrs(
  body: PrsResponse = { me: ME, prs: PRS, unavailable: [] },
  project = "pavilio",
  search = "?view=prs",
  files: (string | { relativePath: string; archived: boolean })[] = [],
) {
  stubFetch({
    "/api/prs": body,
    "/api/files/index": files.map((f) => ({ modified: 1, ...(typeof f === "string" ? { relativePath: f } : f) })),
  });
  return render(
    <MemoryRouter initialEntries={[`/project/${project}/repos${search}`]}>
      <Routes>
        <Route path="/project/:name/qa" element={<Where />} />
        <Route
          path="/project/:name/:section"
          element={
            <>
              <ReposTab project={project} repos={REPOS} />
              <Search />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const filterRow = () => screen.getByRole("group", { name: "Filter pull requests" });
const chip = (name: RegExp) => within(filterRow()).getByRole("button", { name });
const rows = () => within(screen.getByRole("listbox", { name: "Open pull requests" })).getAllByRole("option");
const rowNumbers = () => rows().map((r) => r.getAttribute("data-number"));

beforeEach(() => {
  writePreference(preferences.reposPrFilter, { preset: "all", author: null }, "pavilio");
  writePreference(preferences.terminalLaunchers, [CLAUDE]);
  vi.mocked(startTaskRun).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const prsCalls = () => (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.filter(([u]) => String(u).startsWith("/api/prs?"));

describe("PrsView", () => {
  it("filter row shows preset chips with counts, author select and the remembered note", async () => {
    renderPrs();
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(chip(/^Mine/)).toHaveTextContent("Mine2");
    expect(chip(/^Review requested/)).toHaveTextContent("Review requested3");
    expect(chip(/^All/)).toHaveTextContent("All6");
    expect(chip(/^All/)).toHaveAttribute("aria-pressed", "true");
    expect(chip(/^Mine/)).toHaveAttribute("aria-pressed", "false");

    const author = within(filterRow()).getByRole("combobox", { name: "Author" });
    expect(author).toHaveValue("");
    expect(within(author).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Any author",
      "anna",
      "bob",
      `you (${ME})`,
    ]);
    expect(within(filterRow()).getByText("Remembered for pavilio")).toBeInTheDocument();
  });

  it("row shows icon, title, repo, number, author, updated, badge and checks", async () => {
    const recent = new Date(Date.now() - 12 * 60_000).toISOString();
    renderPrs({
      me: ME,
      prs: [
        pr({ number: 7, title: "feat: mine", author: ME, isDraft: true, checks: "running", updatedAt: recent }),
        pr({ number: 8, title: "fix: theirs", reviewers: [ME], checks: "pass" }),
        pr({ number: 9, reviewDecision: "approved", checks: "fail" }),
        pr({ number: 10, reviewDecision: "changes" }),
        pr({ number: 11, reviewDecision: "required" }),
      ],
      unavailable: [],
    });
    await waitFor(() => expect(rows()).toHaveLength(5));
    const [draft, asked, approved, changes, required] = rows();

    expect(draft.querySelector(".pr-ic")).toHaveClass("pr-ic-draft");
    expect(asked.querySelector(".pr-ic")).not.toHaveClass("pr-ic-draft");
    expect(within(draft).getByText("feat: mine")).toHaveClass("pr-tt");
    expect(within(draft).getByText("pavilio")).toHaveClass("pr-repo");
    expect(within(draft).getByText("#7")).toBeInTheDocument();
    expect(within(draft).getByTitle(ME)).toHaveClass("pr-av");
    expect(within(draft).getByText("you")).toBeInTheDocument();
    expect(within(draft).getByText("updated 12 min ago")).toBeInTheDocument();
    expect(within(draft).getByText("Draft")).toHaveClass("pr-badge");
    expect(within(draft).getByLabelText("Checks running")).toHaveTextContent("●");

    expect(within(asked).getByText("anna")).toBeInTheDocument();
    expect(within(asked).getByText("Your review requested")).toBeInTheDocument();
    expect(within(asked).getByLabelText("Checks passed")).toHaveTextContent("✓");
    expect(within(approved).getByText("Approved")).toBeInTheDocument();
    expect(within(approved).getByLabelText("Checks failing")).toHaveTextContent("✕");
    expect(within(changes).getByText("Changes requested")).toBeInTheDocument();
    expect(within(changes).queryByLabelText(/^Checks/)).toBeNull();
    expect(within(required).getByText("Review required")).toBeInTheDocument();
  });

  it("changing the filter persists it for the project", async () => {
    renderPrs();
    await waitFor(() => expect(rows()).toHaveLength(6));

    fireEvent.click(chip(/^Review requested/));
    expect(readPreference(preferences.reposPrFilter, "pavilio")).toEqual({ preset: "review", author: null });
    expect(rowNumbers()).toEqual(["3", "4", "5"]);

    fireEvent.change(within(filterRow()).getByRole("combobox", { name: "Author" }), { target: { value: "anna" } });
    expect(readPreference(preferences.reposPrFilter, "pavilio")).toEqual({ preset: "review", author: "anna" });
    expect(rowNumbers()).toEqual(["3", "4"]);
    expect(readPreference(preferences.reposPrFilter, "other")).toEqual({ preset: "review", author: null });
  });

  it("opening a row switches to Review with the PR in the URL", async () => {
    const first = renderPrs();
    await waitFor(() => expect(rows()).toHaveLength(6));
    fireEvent.click(rows()[2]);
    const search = new URLSearchParams(screen.getByTestId("search").textContent ?? "");
    expect(search.get("view")).toBe("review");
    expect(search.get("pr")).toBe("pavilio#3");
    first.unmount();

    renderPrs();
    await waitFor(() => expect(rows()).toHaveLength(6));
    fireEvent.keyDown(rows()[4], { key: "Enter" });
    expect(new URLSearchParams(screen.getByTestId("search").textContent ?? "").get("pr")).toBe("pavilio#5");
  });

  it("list uses a roving tabindex with arrow, Home and End navigation", async () => {
    renderPrs();
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);

    rows()[0].focus();
    fireEvent.keyDown(rows()[0], { key: "ArrowDown" });
    expect(rows()[1]).toHaveFocus();
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1]);
    fireEvent.keyDown(rows()[1], { key: "End" });
    expect(rows()[5]).toHaveFocus();
    fireEvent.keyDown(rows()[5], { key: "ArrowDown" });
    expect(rows()[5]).toHaveFocus();
    fireEvent.keyDown(rows()[5], { key: "ArrowUp" });
    expect(rows()[4]).toHaveFocus();
    fireEvent.keyDown(rows()[4], { key: "Home" });
    expect(rows()[0]).toHaveFocus();
    const firstNumber = rows()[0].getAttribute("data-number");
    fireEvent.keyDown(rows()[0], { key: "Enter" });
    expect(new URLSearchParams(screen.getByTestId("search").textContent ?? "").get("pr")).toBe(`pavilio#${firstNumber}`);
  });

  it("no open pull requests at all says so without Show all", async () => {
    writePreference(preferences.reposPrFilter, { preset: "mine", author: null }, "pavilio");
    renderPrs({ me: ME, prs: [], unavailable: [] });
    expect(await screen.findByText("No open pull requests.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
  });

  it("empty match offers Show all", async () => {
    writePreference(preferences.reposPrFilter, { preset: "mine", author: "bob" }, "pavilio");
    renderPrs();
    const empty = await screen.findByText("No open pull requests match.");
    fireEvent.click(within(empty.parentElement as HTMLElement).getByRole("button", { name: "Show all" }));
    expect(readPreference(preferences.reposPrFilter, "pavilio")).toEqual({ preset: "all", author: null });
    expect(rows()).toHaveLength(6);
  });

  it("unavailable repos render their resting lines", async () => {
    renderPrs({
        me: ME,
        prs: [pr({ number: 1 })],
        unavailable: [
          { repo: "notes", reason: "not-github" },
          { repo: "tools", reason: "gh-missing" },
          { repo: "site", reason: "gh-unauthenticated" },
          { repo: "api", reason: "failed" },
        ],
    });
    const fetch = globalThis.fetch as unknown as { mock: { calls: unknown[] } };
    await waitFor(() => expect(rows()).toHaveLength(1));
    const lines = within(screen.getByRole("list", { name: "Unavailable repositories" })).getAllByRole("listitem");
    expect(lines.map((l) => l.textContent)).toEqual([
      "notesNo GitHub remote",
      "toolsgh is not installed",
      "siteRun gh auth login",
      "apiCouldn't load pull requestsRetry",
    ]);
    const before = fetch.mock.calls.length;
    fireEvent.click(within(lines[3]).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetch.mock.calls.length).toBe(before + 1));
  });

  it("opening a PR drops the file and line left from another view", async () => {
    renderPrs(undefined, "pavilio", `?view=prs&pr=pavilio%231&file=${encodeURIComponent("src/x.ts")}&line=42`);
    await waitFor(() => expect(rows()).toHaveLength(6));
    fireEvent.click(rows()[2]);
    const search = new URLSearchParams(screen.getByTestId("search").textContent ?? "");
    expect(search.get("pr")).toBe("pavilio#3");
    expect(search.has("file")).toBe(false);
    expect(search.has("line")).toBe(false);
  });

  it("entering the PRs view refetches a list that is no longer fresh", async () => {
    renderPrs(undefined, "pavilio", "?view=review");
    await waitFor(() => expect(prsCalls()).toHaveLength(1));
    const later = Date.now() + 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    fireEvent.click(screen.getByTestId("repos-view-prs"));
    await waitFor(() => expect(prsCalls()).toHaveLength(2));
    // Fresh again: a quick hop back and forth doesn't refetch.
    fireEvent.click(screen.getByTestId("repos-view-code"));
    fireEvent.click(screen.getByTestId("repos-view-prs"));
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(prsCalls()).toHaveLength(2);
  });

  it("an unknown login disables the personal presets instead of counting zero", async () => {
    writePreference(preferences.reposPrFilter, { preset: "review", author: null }, "pavilio");
    renderPrs({ me: "", prs: PRS, unavailable: [] });
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(screen.getByTestId("prs-identity-unknown")).toHaveTextContent("Couldn't tell who you are");
    expect(chip(/^Review requested/)).toBeDisabled();
    expect(chip(/^Review requested/)).toHaveTextContent("Review requested?");
    expect(chip(/^Mine/)).toBeDisabled();
    expect(chip(/^All/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("No open pull requests match.")).toBeNull();
  });

  describe("story controls", () => {
    const STORY = "pavilio/qa/stories/pavilio-pr-7.md";
    const one = (over: Parameters<typeof pr>[0] = { number: 7 }) => ({ me: ME, prs: [pr(over)], unavailable: [] });
    const row = async () => {
      await waitFor(() => expect(rows()).toHaveLength(1));
      return rows()[0];
    };
    const where = () => screen.getByTestId("search").textContent;

    it("row shows Explain when no story exists", async () => {
      renderPrs(one());
      const r = await row();
      expect(await within(r).findByRole("button", { name: "Explain" })).toBeEnabled();
      expect(within(r).queryByRole("button", { name: "Story" })).toBeNull();
      expect(within(r).queryByRole("button", { name: /Rebuild/ })).toBeNull();
    });

    it("row shows Story and rebuild when the story exists", async () => {
      renderPrs(one(), "pavilio", "?view=prs", [STORY, "pavilio/qa/stories/pavilio-pr-8.md"]);
      const r = await row();
      const story = await within(r).findByRole("button", { name: "Story" });
      expect(story).toHaveClass("pr-act-story");
      const rebuild = within(r).getByRole("button", { name: "Rebuild story for #7" });
      expect(within(r).queryByRole("button", { name: "Explain" })).toBeNull();

      fireEvent.click(rebuild);
      await waitFor(() => expect(vi.mocked(startTaskRun)).toHaveBeenCalledTimes(1));
      expect(vi.mocked(startTaskRun).mock.calls[0][0]).toEqual({
        project: "pavilio",
        runLine: explainRunLine(CLAUDE, "pavilio", "pavilio", 7),
      });
      expect(where()).toBe("?view=prs");
    });

    it("Explain launches the pr-explain line in the project's CLI without opening the review", async () => {
      renderPrs(one());
      const explain = await within(await row()).findByRole("button", { name: "Explain" });

      fireEvent.keyDown(explain, { key: "Enter" });
      expect(where()).toBe("?view=prs");

      fireEvent.click(explain);
      await waitFor(() => expect(vi.mocked(startTaskRun)).toHaveBeenCalledTimes(1));
      expect(vi.mocked(startTaskRun).mock.calls[0][0]).toEqual({
        project: "pavilio",
        runLine:
          "claude 'Read and follow the instructions in skills/pavilio-pr-explain/SKILL.md exactly, for project pavilio and PR pavilio#7.'",
      });
      expect(where()).toBe("?view=prs");
      expect(screen.queryByTestId("prs-launch-error")).toBeNull();
    });

    it("Story opens the file in the QA tab", async () => {
      renderPrs(one(), "pavilio", "?view=prs", [STORY]);
      fireEvent.click(await within(await row()).findByRole("button", { name: "Story" }));
      const to = new URL(screen.getByTestId("where").textContent ?? "", "http://x");
      expect(to.pathname).toBe("/project/pavilio/qa");
      expect(to.searchParams.get("file")).toBe(STORY);
      expect(to.searchParams.has("pr")).toBe(false);
      expect(vi.mocked(startTaskRun)).not.toHaveBeenCalled();
    });

    it("unsafe repo name gets no story controls", async () => {
      renderPrs(one({ number: 7, repo: "bad repo" }), "pavilio", "?view=prs", ["pavilio/qa/stories/bad repo-pr-7.md"]);
      const r = await row();
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/files/index"));
      expect(within(r).queryByRole("button", { name: "Explain" })).toBeNull();
      expect(within(r).queryByRole("button", { name: "Story" })).toBeNull();
      expect(within(r).queryByRole("button", { name: /Rebuild/ })).toBeNull();
    });

    it("Explain is disabled when the launcher is not ready", async () => {
      writePreference(preferences.terminalLaunchers, [WHOLE_LINE]);
      renderPrs(
        { me: ME, prs: [pr({ number: 7 }), pr({ number: 8 })], unavailable: [] },
        "pavilio",
        "?view=prs",
        [STORY],
      );
      await waitFor(() => expect(rows()).toHaveLength(2));
      const rebuild = await within(rows()[0]).findByRole("button", { name: "Rebuild story for #7" });
      const explain = within(rows()[1]).getByRole("button", { name: "Explain" });
      for (const b of [rebuild, explain]) {
        expect(b).toBeDisabled();
        expect(b).toHaveAttribute("title", BLOCKED_TEXT);
      }
      // Story only opens a file, so it needs no launcher.
      expect(within(rows()[0]).getByRole("button", { name: "Story" })).toBeEnabled();
      fireEvent.click(explain);
      expect(vi.mocked(startTaskRun)).not.toHaveBeenCalled();
    });

    it("Explain names the missing launcher when none has a run loop", async () => {
      writePreference(preferences.terminalLaunchers, [NO_RUN_LOOP]);
      renderPrs(one());
      const explain = await within(await row()).findByRole("button", { name: "Explain" });
      expect(explain).toBeDisabled();
      expect(explain).toHaveAttribute("title", NO_LAUNCHER_TEXT);
    });

    it("an archived story file does not count as the row's story", async () => {
      renderPrs({ me: ME, prs: [pr({ number: 7 }), pr({ number: 8 })], unavailable: [] }, "pavilio", "?view=prs", [
        { relativePath: STORY, archived: true },
        "pavilio/qa/stories/pavilio-pr-8.md",
      ]);
      await waitFor(() => expect(rows()).toHaveLength(2));
      // Row 8's live story showing proves the index has loaded, not just been asked for.
      await within(rows()[1]).findByRole("button", { name: "Story" });
      expect(within(rows()[0]).getByRole("button", { name: "Explain" })).toBeEnabled();
      expect(within(rows()[0]).queryByRole("button", { name: "Story" })).toBeNull();
    });

    it("row actions follow the roving tabindex", async () => {
      renderPrs({ me: ME, prs: [pr({ number: 7 }), pr({ number: 8 })], unavailable: [] }, "pavilio", "?view=prs", [STORY]);
      await waitFor(() => expect(rows()).toHaveLength(2));
      await within(rows()[0]).findByRole("button", { name: "Story" });
      const tabIndexes = () => rows().map((r) => within(r).getAllByRole("button").map((b) => b.tabIndex));
      // Row 7: Story and rebuild; row 8: Explain.
      expect(tabIndexes()).toEqual([[0, 0], [-1]]);

      rows()[0].focus();
      fireEvent.keyDown(rows()[0], { key: "ArrowDown" });
      expect(rows()[1]).toHaveFocus();
      expect(tabIndexes()).toEqual([[-1, -1], [0]]);
    });

    it("arrow keys from a row's action button move to the next row", async () => {
      renderPrs({ me: ME, prs: [pr({ number: 7 }), pr({ number: 8 }), pr({ number: 9 })], unavailable: [] });
      await waitFor(() => expect(rows()).toHaveLength(3));
      const explain = await within(rows()[1]).findByRole("button", { name: "Explain" });
      act(() => explain.focus());
      // Focus inside a row makes that row the list's tab stop.
      expect(rows().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);

      fireEvent.keyDown(explain, { key: "ArrowDown" });
      expect(rows()[2]).toHaveFocus();
      act(() => within(rows()[2]).getByRole("button", { name: "Explain" }).focus());
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
      expect(rows()[1]).toHaveFocus();
      expect(where()).toBe("?view=prs");
    });

    it("a pending launch disables every launch button until it settles", async () => {
      let finish = (_id: string) => {};
      vi.mocked(startTaskRun).mockImplementationOnce(() => new Promise<string>((done) => (finish = done)));
      renderPrs({ me: ME, prs: [pr({ number: 7 }), pr({ number: 8 })], unavailable: [] }, "pavilio", "?view=prs", [STORY]);
      await waitFor(() => expect(rows()).toHaveLength(2));
      const rebuild = await within(rows()[0]).findByRole("button", { name: "Rebuild story for #7" });
      const explain = within(rows()[1]).getByRole("button", { name: "Explain" });

      fireEvent.click(explain);
      fireEvent.click(explain);
      fireEvent.click(rebuild);
      expect(vi.mocked(startTaskRun)).toHaveBeenCalledTimes(1);
      expect(explain).toBeDisabled();
      expect(rebuild).toBeDisabled();
      // Opening a story launches nothing, so it stays usable.
      expect(within(rows()[0]).getByRole("button", { name: "Story" })).toBeEnabled();

      await act(async () => finish("new-1"));
      expect(explain).toBeEnabled();
      expect(rebuild).toBeEnabled();
    });

    it("a failed launch shows an error under the list", async () => {
      vi.mocked(startTaskRun).mockRejectedValueOnce(new Error("Could not create a terminal for the run"));
      renderPrs(one());
      fireEvent.click(await within(await row()).findByRole("button", { name: "Explain" }));
      const error = await screen.findByTestId("prs-launch-error");
      expect(error).toHaveAttribute("role", "alert");
      expect(error).toHaveTextContent("Could not create a terminal for the run");
      const list = screen.getByRole("listbox", { name: "Open pull requests" });
      expect(list.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(where()).toBe("?view=prs");
    });
  });
});
