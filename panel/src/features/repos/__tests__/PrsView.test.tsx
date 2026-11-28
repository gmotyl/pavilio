import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, stubFetch } from "../../../test-utils";
import { preferences, type TerminalLauncher } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import { BLOCKED_TEXT, NO_LAUNCHER_TEXT } from "../../projects/useProjectLauncher";
import { explainRunLine } from "../../projects/runPrompt";
import { startTaskRun } from "../../projects/startTaskRun";
import { refreshFileIndex } from "../../explorer/useFileIndex";
import { __resetExplainingForTests, EXPLAIN_TIMEOUT_MS } from "../explainingStore";
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
  // Read on every index fetch, so a test can add a story and call `refreshFileIndex`.
  files: (string | { relativePath: string; archived?: boolean; modified?: number })[] = [],
) {
  stubFetch({
    "/api/prs": body,
    "/api/files/index": () =>
      jsonResponse(files.map((f) => ({ modified: 1, ...(typeof f === "string" ? { relativePath: f } : f) }))),
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
  writePreference(preferences.storyLanguage, "en");
  vi.mocked(startTaskRun).mockClear();
  __resetExplainingForTests();
});
afterEach(() => {
  vi.useRealTimers();
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
          { repo: "notes", reason: "unknown-forge", host: "git.example.org" },
          { repo: "tools", reason: "gh-missing" },
          { repo: "site", reason: "gh-unauthenticated" },
          { repo: "api", reason: "failed" },
        ],
    });
    const fetch = globalThis.fetch as unknown as { mock: { calls: unknown[] } };
    await waitFor(() => expect(rows()).toHaveLength(1));
    const lines = within(screen.getByRole("list", { name: "Unavailable repositories" })).getAllByRole("listitem");
    expect(lines.map((l) => l.textContent)).toEqual([
      "notesUnknown forge for git.example.org — run glab auth login --hostname git.example.org or set forge in repos.json",
      "toolsgh is not installed",
      "siteRun gh auth login",
      "apiCouldn't load pull requestsRetry",
    ]);
    const before = fetch.mock.calls.length;
    fireEvent.click(within(lines[3]).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetch.mock.calls.length).toBe(before + 1));
  });

  describe("GitHub and GitLab", () => {
    const GITLAB_URL = "https://git.cps.metro-markets.org/web/web-app-buyer-react/-/merge_requests/244";
    const mixed = (): PrsResponse => ({
      me: ME,
      // The server sorts by last update, newest first, across forges.
      prs: [
        pr({ number: 244, repo: "web-app-buyer-react", forge: "gitlab", url: GITLAB_URL, updatedAt: "2026-11-22T12:00:00Z" }),
        pr({ number: 244, updatedAt: "2026-11-22T11:00:00Z" }),
        pr({ number: 1881, repo: "monorepo", forge: "gitlab", url: "https://gitlab.com/g/monorepo/-/merge_requests/1881", updatedAt: "2026-11-22T09:00:00Z" }),
      ],
      unavailable: [],
    });
    const restingLine = async (entry: PrsResponse["unavailable"][number]) => {
      renderPrs({ me: ME, prs: [pr({ number: 1 })], unavailable: [entry] });
      await waitFor(() => expect(rows()).toHaveLength(1));
      const [line] = within(screen.getByRole("list", { name: "Unavailable repositories" })).getAllByRole("listitem");
      return line;
    };

    it("lists GitHub and GitLab rows together newest first", async () => {
      renderPrs(mixed());
      await waitFor(() => expect(rows()).toHaveLength(3));
      expect(rows().map((r) => r.getAttribute("data-testid"))).toEqual([
        "pr-row-web-app-buyer-react#244",
        "pr-row-pavilio#244",
        "pr-row-monorepo#1881",
      ]);
    });

    it("GitHub row shows #n and GitLab row shows !n", async () => {
      renderPrs(mixed());
      await waitFor(() => expect(rows()).toHaveLength(3));
      const [gl, gh, gl2] = rows();
      expect(within(gl).getByText("!244")).toBeInTheDocument();
      expect(within(gl).queryByText("#244")).toBeNull();
      expect(within(gh).getByText("#244")).toBeInTheDocument();
      expect(within(gh).queryByText("!244")).toBeNull();
      expect(within(gl2).getByText("!1881")).toBeInTheDocument();
    });

    it("GitLab row offers Review and Explain", async () => {
      renderPrs({ ...mixed(), prs: [mixed().prs[0]] });
      await waitFor(() => expect(rows()).toHaveLength(1));
      await waitFor(() => expect(screen.queryAllByTitle("Loading stories…")).toHaveLength(0));
      const [gl] = rows();
      expect(await within(gl).findByRole("button", { name: "Explain" })).toBeEnabled();
      // Review: opening the row switches to the Review view with the MR in the URL.
      fireEvent.click(gl);
      const search = new URLSearchParams(screen.getByTestId("search").textContent ?? "");
      expect(search.get("view")).toBe("review");
      expect(search.get("pr")).toBe("web-app-buyer-react#244");
    });

    it("unknown forge resting line names the host and both fixes", async () => {
      const line = await restingLine({ repo: "legacy-cms", reason: "unknown-forge", host: "git.example.org" });
      expect(line).toHaveTextContent(
        "legacy-cmsUnknown forge for git.example.org — run glab auth login --hostname git.example.org or set forge in repos.json",
      );
      expect([...line.querySelectorAll("code")].map((c) => c.textContent)).toEqual([
        "git.example.org",
        "glab auth login --hostname git.example.org",
        "forge",
      ]);
      expect(line).not.toHaveTextContent("No GitHub remote");
    });

    it("a host-less unknown forge resting line asks to fix the origin remote", async () => {
      // No usable origin: the resolver gives up before the forge override, so the fix is the remote.
      const line = await restingLine({ repo: "scratch", reason: "unknown-forge" });
      expect(line).toHaveTextContent("scratchNo usable origin remote — add or fix it");
      expect(line.querySelector("code")).toHaveTextContent(/^origin$/);
      expect(line).not.toHaveTextContent("repos.json");
    });

    it("glab unauthenticated resting line names the host", async () => {
      const line = await restingLine({ repo: "monorepo", reason: "glab-unauthenticated", host: "git.cps.metro-markets.org" });
      expect(line).toHaveTextContent("monorepoRun glab auth login --hostname git.cps.metro-markets.org");
      expect(line.querySelector("code")).toHaveTextContent("glab auth login --hostname git.cps.metro-markets.org");
    });

    it("glab missing resting line", async () => {
      const line = await restingLine({ repo: "tools", reason: "glab-missing" });
      expect(line).toHaveTextContent("toolsglab is not installed");
      expect(line.querySelector("code")).toHaveTextContent(/^glab$/);
    });

    it("identity note still names GitHub", async () => {
      renderPrs({ ...mixed(), me: "" });
      await waitFor(() => expect(rows()).toHaveLength(3));
      expect(screen.getByTestId("prs-identity-unknown")).toHaveTextContent(
        "Couldn't tell who you are on GitHub, so Mine and Review requested are unavailable.",
      );
    });
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
      // Explain / ↻ stay inert until the file index has loaded once.
      await waitFor(() => expect(screen.queryAllByTitle("Loading stories…")).toHaveLength(0));
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

    it("GitLab row names its rebuild with the MR's !n", async () => {
      renderPrs(one({ number: 7, forge: "gitlab", url: "https://gitlab.example.com/grp/pavilio/-/merge_requests/7" }), "pavilio", "?view=prs", [STORY]);
      const r = await row();
      expect(await within(r).findByRole("button", { name: "Rebuild story for !7" })).toBeEnabled();
      expect(within(r).queryByRole("button", { name: "Rebuild story for #7" })).toBeNull();
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
        runLine: explainRunLine(CLAUDE, "pavilio", "pavilio", 7, "en"),
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

    it("offers no launchable Explain until the file index has loaded", async () => {
      let resolveIndex!: (r: Response) => void;
      const index = new Promise<Response>((r) => (resolveIndex = r));
      stubFetch({ "/api/prs": one(), "/api/files/index": () => index });
      render(
        <MemoryRouter initialEntries={["/project/pavilio/repos?view=prs"]}>
          <Routes>
            <Route path="/project/:name/:section" element={<ReposTab project="pavilio" repos={REPOS} />} />
          </Routes>
        </MemoryRouter>,
      );
      await waitFor(() => expect(rows()).toHaveLength(1));
      const r = rows()[0];
      // The story exists but the index has not said so yet: nothing launchable, no Explain run.
      const pending = within(r).getByRole("button", { name: "Explain" });
      expect(pending).toBeDisabled();
      expect(pending).toHaveAttribute("title", "Loading stories…");
      fireEvent.click(pending);
      expect(vi.mocked(startTaskRun)).not.toHaveBeenCalled();

      await act(async () => resolveIndex(jsonResponse([{ relativePath: STORY, modified: 1 }])));
      expect(await within(r).findByRole("button", { name: "Story" })).toBeEnabled();
      expect(within(r).getByRole("button", { name: "Rebuild story for #7" })).toBeEnabled();
      expect(within(r).queryByRole("button", { name: "Explain" })).toBeNull();
    });

    it("a failed file index keeps Explain disabled, says it is retrying, and recovers", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let indexUp = false;
      stubFetch({
        "/api/prs": { me: ME, prs: [pr({ number: 7 }), pr({ number: 8 })], unavailable: [] },
        "/api/files/index": () =>
          indexUp ? jsonResponse([{ relativePath: STORY, modified: 1 }]) : new Response("boom", { status: 500 }),
      });
      render(
        <MemoryRouter initialEntries={["/project/pavilio/repos?view=prs"]}>
          <Routes>
            <Route path="/project/:name/:section" element={<ReposTab project="pavilio" repos={REPOS} />} />
          </Routes>
        </MemoryRouter>,
      );
      await waitFor(() => expect(rows()).toHaveLength(2));
      const failed = () => screen.queryAllByTitle("Couldn't load stories — retrying…");
      await waitFor(() => expect(failed()).toHaveLength(2));
      for (const b of failed()) expect(b).toBeDisabled();
      expect(screen.queryAllByTitle("Loading stories…")).toHaveLength(0);
      fireEvent.click(failed()[0]);
      expect(vi.mocked(startTaskRun)).not.toHaveBeenCalled();

      indexUp = true;
      await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
      expect(await within(rows()[0]).findByRole("button", { name: "Story" })).toBeEnabled();
      expect(within(rows()[0]).getByRole("button", { name: "Rebuild story for #7" })).toBeEnabled();
      expect(within(rows()[0]).queryByRole("button", { name: "Explain" })).toBeNull();
      expect(within(rows()[1]).getByRole("button", { name: "Explain" })).toBeEnabled();
      expect(failed()).toHaveLength(0);
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
      expect(within(r).queryByRole("button", { name: /^Story language:/ })).toBeNull();
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
      // Row 7: Story, rebuild and its language half; row 8: Explain and its language half.
      expect(tabIndexes()).toEqual([[0, 0, 0], [-1, -1]]);

      rows()[0].focus();
      fireEvent.keyDown(rows()[0], { key: "ArrowDown" });
      expect(rows()[1]).toHaveFocus();
      expect(tabIndexes()).toEqual([[-1, -1, -1], [0, 0]]);
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
      // Inert but still focusable, so a keyboard launch keeps its focus.
      for (const b of [explain, rebuild]) {
        expect(b).toHaveAttribute("aria-disabled", "true");
        expect(b).not.toHaveAttribute("disabled");
      }
      // Opening a story launches nothing, so it stays usable.
      expect(within(rows()[0]).getByRole("button", { name: "Story" })).toBeEnabled();

      await act(async () => finish("new-1"));
      // The launched row now waits for its story; the other row is free again.
      expect(within(rows()[1]).getByRole("button", { name: "Explaining…" })).toHaveAttribute("aria-disabled", "true");
      const free = within(rows()[0]).getByRole("button", { name: "Rebuild story for #7" });
      expect(free).toBeEnabled();
      expect(free).not.toHaveAttribute("aria-disabled");
    });

    it("keyboard launch keeps focus on the row's main half", async () => {
      let finish = (_id: string) => {};
      vi.mocked(startTaskRun).mockImplementationOnce(() => new Promise<string>((done) => (finish = done)));
      renderPrs({ me: ME, prs: [pr({ number: 7 }), pr({ number: 8 })], unavailable: [] });
      await waitFor(() => expect(rows()).toHaveLength(2));
      const explain = await within(rows()[0]).findByRole("button", { name: "Explain" });
      act(() => explain.focus());
      // Enter on a focused button is a click.
      fireEvent.click(explain);
      // Pending: the same button keeps focus and is only aria-disabled.
      expect(explain).toHaveFocus();
      expect(explain).not.toHaveAttribute("disabled");

      await act(async () => finish("new-1"));
      const main = within(rows()[0]).getByRole("button", { name: "Explaining…" });
      expect(main).toHaveFocus();
      expect(main).not.toHaveAttribute("disabled");
      expect(main).toHaveAttribute("aria-disabled", "true");
      expect(main.tabIndex).toBe(0);
      // A second press does nothing.
      fireEvent.click(main);
      expect(vi.mocked(startTaskRun)).toHaveBeenCalledTimes(1);
      // The list's arrow navigation still works from it.
      fireEvent.keyDown(main, { key: "ArrowDown" });
      expect(rows()[1]).toHaveFocus();
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

    describe("story language and the explaining spinner", () => {
      const langHalf = (r: HTMLElement) => within(r).getByRole("button", { name: /^Story language:/ });
      const indexCalls = () =>
        (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.filter(([u]) => String(u) === "/api/files/index")
          .length;
      /** Re-reads the file index and waits until the fetch has been answered. */
      const refreshIndex = async () => {
        const before = indexCalls();
        await act(async () => refreshFileIndex());
        await waitFor(() => expect(indexCalls()).toBe(before + 1));
        await act(async () => {});
      };
      const TIMEOUT_NOTE = "No story after 15 min — check the run in iterm.";

      it("no story: Explain joined to the language half", async () => {
        renderPrs(one());
        const r = await row();
        const explain = await within(r).findByRole("button", { name: "Explain" });
        const half = langHalf(r);
        expect(explain.closest(".pr-split")).toContainElement(half);
        expect(explain.querySelector("svg")).not.toBeNull();
        expect(half).toHaveTextContent("EN ▾");
        expect(half).toHaveAttribute("aria-haspopup", "menu");
        expect(half).toHaveAccessibleName("Story language: English");
        expect(half).toBeEnabled();
      });

      it("picking PL writes the preference and every half reads PL", async () => {
        renderPrs({ me: ME, prs: [pr({ number: 7 }), pr({ number: 8 })], unavailable: [] }, "pavilio", "?view=prs", [STORY]);
        await waitFor(() => expect(rows()).toHaveLength(2));
        await within(rows()[0]).findByRole("button", { name: "Story" });
        // The ↻ carries the language too (option A).
        expect(within(rows()[0]).getByRole("button", { name: "Rebuild story for #7" }).closest(".pr-split")).toContainElement(
          langHalf(rows()[0]),
        );

        fireEvent.click(langHalf(rows()[1]));
        fireEvent.click(screen.getByRole("menuitemradio", { name: "Polski — PL" }));
        expect(readPreference(preferences.storyLanguage)).toBe("pl");
        const halves = screen.getAllByRole("button", { name: "Story language: Polish" });
        expect(halves).toHaveLength(2);
        for (const h of halves) expect(h).toHaveTextContent("PL ▾");
        expect(screen.queryByRole("button", { name: "Story language: English" })).toBeNull();
        // Picking only sets the language; it starts nothing.
        expect(vi.mocked(startTaskRun)).not.toHaveBeenCalled();
      });

      it("Polish launch sends the Polish line", async () => {
        writePreference(preferences.storyLanguage, "pl");
        renderPrs({ me: ME, prs: [pr({ number: 7 }), pr({ number: 8 })], unavailable: [] }, "pavilio", "?view=prs", [STORY]);
        await waitFor(() => expect(rows()).toHaveLength(2));
        fireEvent.click(await within(rows()[1]).findByRole("button", { name: "Explain" }));
        await waitFor(() => expect(vi.mocked(startTaskRun)).toHaveBeenCalledTimes(1));
        expect(vi.mocked(startTaskRun).mock.calls[0][0].runLine).toBe(explainRunLine(CLAUDE, "pavilio", "pavilio", 8, "pl"));
        expect(vi.mocked(startTaskRun).mock.calls[0][0].runLine).toContain("Write the story in Polish.");

        fireEvent.click(within(rows()[0]).getByRole("button", { name: "Rebuild story for #7" }));
        await waitFor(() => expect(vi.mocked(startTaskRun)).toHaveBeenCalledTimes(2));
        expect(vi.mocked(startTaskRun).mock.calls[1][0].runLine).toBe(explainRunLine(CLAUDE, "pavilio", "pavilio", 7, "pl"));
      });

      it("spinner shows after a launch and disables both halves", async () => {
        writePreference(preferences.storyLanguage, "pl");
        renderPrs(one());
        const r = await row();
        fireEvent.click(await within(r).findByRole("button", { name: "Explain" }));
        const main = await within(r).findByRole("button", { name: "Explaining…" });
        expect(main).toHaveAttribute("aria-disabled", "true");
        expect(main.querySelector(".pr-spin")).not.toBeNull();
        expect(main).toHaveAttribute("title", "Writing the story (PL) — started 0 min ago");
        expect(langHalf(r)).toBeDisabled();
        expect(langHalf(r)).toHaveAccessibleName("Story language: Polish");
        expect(within(r).queryByRole("button", { name: "Explain" })).toBeNull();
      });

      it("story appearing ends the explain spinner", async () => {
        const files: { relativePath: string; modified: number }[] = [];
        renderPrs(one(), "pavilio", "?view=prs", files);
        const r = await row();
        fireEvent.click(await within(r).findByRole("button", { name: "Explain" }));
        await within(r).findByRole("button", { name: "Explaining…" });

        files.push({ relativePath: STORY, modified: Date.now() });
        await refreshIndex();
        const story = await within(r).findByRole("button", { name: "Story" });
        expect(story).toHaveClass("pr-act-story");
        const rebuild = within(r).getByRole("button", { name: "Rebuild story for #7" });
        expect(rebuild).toBeEnabled();
        expect(rebuild.closest(".pr-split")).toContainElement(langHalf(r));
        expect(langHalf(r)).toBeEnabled();
        expect(within(r).queryByRole("button", { name: "Explaining…" })).toBeNull();
      });

      it("newer modified time ends the rebuild spinner", async () => {
        const files = [{ relativePath: STORY, modified: 1 }];
        renderPrs(one(), "pavilio", "?view=prs", files);
        const r = await row();
        fireEvent.click(await within(r).findByRole("button", { name: "Rebuild story for #7" }));
        await within(r).findByRole("button", { name: "Explaining…" });
        // The old file is still there: Story stays, the spinner sits in the ↻ half.
        expect(within(r).getByRole("button", { name: "Story" })).toBeEnabled();
        expect(within(r).queryByRole("button", { name: "Rebuild story for #7" })).toBeNull();

        // An index re-read with the same old file does not end it.
        await refreshIndex();
        expect(within(r).getByRole("button", { name: "Explaining…" })).toHaveAttribute("aria-disabled", "true");

        files[0] = { relativePath: STORY, modified: Date.now() + 1_000 };
        await refreshIndex();
        expect(await within(r).findByRole("button", { name: "Rebuild story for #7" })).toBeEnabled();
        expect(within(r).queryByRole("button", { name: "Explaining…" })).toBeNull();
      });

      it("15 minutes without a story shows the timeout note", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        renderPrs(one());
        const r = await row();
        fireEvent.click(await within(r).findByRole("button", { name: "Explain" }));
        const main = await within(r).findByRole("button", { name: "Explaining…" });

        act(() => vi.advanceTimersByTime(3 * 60_000));
        expect(main).toHaveAttribute("title", "Writing the story (EN) — started 3 min ago");
        expect(within(r).queryByText(TIMEOUT_NOTE)).toBeNull();

        // No file change at all: the clock alone ends the wait.
        act(() => vi.advanceTimersByTime(EXPLAIN_TIMEOUT_MS - 3 * 60_000));
        const explain = within(r).getByRole("button", { name: "Explain" });
        expect(explain).toBeEnabled();
        expect(langHalf(r)).toBeEnabled();
        const note = within(r).getByRole("status");
        expect(note).toHaveTextContent(TIMEOUT_NOTE);
        expect(note).toHaveClass("pr-hint");
        expect(note).toHaveAttribute("title", TIMEOUT_NOTE);

        // The next launch on the row replaces the note.
        fireEvent.click(explain);
        await within(r).findByRole("button", { name: "Explaining…" });
        expect(within(r).queryByText(TIMEOUT_NOTE)).toBeNull();
      });

      it("failed launch shows no spinner", async () => {
        vi.mocked(startTaskRun).mockRejectedValueOnce(new Error("Could not create a terminal for the run"));
        renderPrs(one());
        const r = await row();
        fireEvent.click(await within(r).findByRole("button", { name: "Explain" }));
        expect(await screen.findByTestId("prs-launch-error")).toHaveTextContent("Could not create a terminal for the run");
        expect(within(r).queryByRole("button", { name: "Explaining…" })).toBeNull();
        expect(within(r).getByRole("button", { name: "Explain" })).toBeEnabled();
        expect(langHalf(r)).toBeEnabled();
      });

      it("not-ready launcher still opens the language menu", async () => {
        writePreference(preferences.terminalLaunchers, [WHOLE_LINE]);
        renderPrs({ me: ME, prs: [pr({ number: 7 }), pr({ number: 8 })], unavailable: [] }, "pavilio", "?view=prs", [STORY]);
        await waitFor(() => expect(rows()).toHaveLength(2));
        const rebuild = await within(rows()[0]).findByRole("button", { name: "Rebuild story for #7" });
        const explain = within(rows()[1]).getByRole("button", { name: "Explain" });
        for (const b of [rebuild, explain]) {
          expect(b).toBeDisabled();
          expect(b).toHaveAttribute("title", BLOCKED_TEXT);
        }
        for (const r of rows()) expect(langHalf(r)).toBeEnabled();

        fireEvent.click(langHalf(rows()[0]));
        expect(screen.getByRole("menu", { name: "Story language" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("menuitemradio", { name: "Polski — PL" }));
        expect(readPreference(preferences.storyLanguage)).toBe("pl");
        expect(vi.mocked(startTaskRun)).not.toHaveBeenCalled();
      });

      it("spinner survives leaving and re-entering the PRs view", async () => {
        const first = renderPrs(one());
        fireEvent.click(await within(await row()).findByRole("button", { name: "Explain" }));
        await within(rows()[0]).findByRole("button", { name: "Explaining…" });
        // Leaving for the QA tab unmounts the whole Code tab.
        first.unmount();

        renderPrs(one());
        const r = await row();
        await waitFor(() => expect(indexCalls()).toBeGreaterThan(0));
        expect(await within(r).findByRole("button", { name: "Explaining…" })).toHaveAttribute("aria-disabled", "true");
        expect(within(r).queryByRole("button", { name: "Explain" })).toBeNull();
      });

      const css = readFileSync(resolve("src/features/repos/Prs.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      /** The declarations of the first `selector {…}` rule inside `block` (or the whole sheet). */
      const rule = (selector: string, block = css) => {
        const at = block.indexOf(`${selector} {`);
        expect(at, `${selector} rule`).toBeGreaterThanOrEqual(0);
        return block.slice(at, block.indexOf("}", at));
      };
      /** The body of the at-rule whose prelude starts with `prelude`. */
      const atBlock = (prelude: string) => {
        const at = css.indexOf(prelude);
        expect(at, prelude).toBeGreaterThanOrEqual(0);
        let depth = 0;
        for (let i = css.indexOf("{", at); i < css.length; i++) {
          if (css[i] === "{") depth++;
          else if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
        }
        throw new Error(`unclosed ${prelude}`);
      };

      it("actions wrap at 390px", async () => {
        renderPrs(one());
        await row();
        // The breakpoint follows the pane, not the window: the view is the size container.
        expect(screen.getByTestId("prs-view")).toHaveClass("prs-view");
        expect(rule(".prs-view")).toMatch(/container-type:\s*inline-size/);
        expect(rule(".pr-actions")).toMatch(/flex-wrap:\s*wrap/);
        const narrow = atBlock("@container (max-width: 560px)");
        // Under the title, across the title and right columns, and free to wrap.
        expect(rule(".prs-view .pr-right", narrow)).toMatch(/grid-column:\s*2\s*\/\s*4/);
        expect(rule(".prs-view .pr-right", narrow)).toMatch(/flex-wrap:\s*wrap/);
        expect(rule(".prs-view .pr-right", narrow)).toMatch(/justify-self:\s*start/);
      });

      it("timeout note is red, under the meta line, with room reserved", async () => {
        const hint = rule(".pr-hint");
        expect(hint).toMatch(/color:\s*var\(--red\)/);
        // Pinned to the row's bottom edge, below the meta line, from the meta column
        // (row padding + icon column + gap) to the row's right padding.
        expect(hint).toMatch(/position:\s*absolute/);
        expect(hint).toMatch(/bottom:\s*\d+px/);
        expect(hint).toMatch(/left:\s*calc\(16px \+ 18px \+ 10px\)/);
        expect(hint).toMatch(/right:\s*16px/);
        // Never more than two lines, so the reserve below always holds it.
        expect(hint).toMatch(/line-height:\s*16px/);
        expect(hint).toMatch(/-webkit-line-clamp:\s*2/);
        expect(hint).toMatch(/overflow:\s*hidden/);
        // The row grows by two note lines, so a wrapped note never covers the meta line.
        expect(rule(".prs-view .pr-row:has(.pr-hint)")).toMatch(/padding-bottom:\s*calc\([^;]*2 \* 16px[^;]*\)/);
      });

      it("busy story buttons get no hover", () => {
        // A busy Explain / ↻ / spinner is aria-disabled, not disabled: hover must skip it too.
        expect(css).toContain(".pr-act:hover:not(:disabled):not([aria-disabled=\"true\"]) {");
        expect(css).toContain(".pr-act-icon:hover:not(:disabled):not([aria-disabled=\"true\"]) {");
        expect(css).not.toMatch(/\.pr-act(-icon)?:hover:not\(:disabled\)\s*\{/);
      });

      it("reduced motion stops the spinner rotation", async () => {
        expect(rule(".pr-spin")).toMatch(/animation:\s*pr-spin\b[^;]*infinite/);
        const reduced = atBlock("@media (prefers-reduced-motion: reduce)");
        expect(rule(".pr-spin", reduced)).toMatch(/animation:\s*none/);
      });
    });
  });
});
