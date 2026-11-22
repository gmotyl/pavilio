import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { stubFetch } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import ReposTab from "../ReposTab";
import type { PrsResponse } from "../usePrs";
import { ME, PRS, pr } from "./prFixtures";

const REPOS = [{ name: "pavilio", path: "/root/git/prv/pavilio", present: true }];

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderPrs(body: PrsResponse = { me: ME, prs: PRS, unavailable: [] }, project = "pavilio") {
  stubFetch({ "/api/prs": body });
  return render(
    <MemoryRouter initialEntries={[`/project/${project}/repos?view=prs`]}>
      <Routes>
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
});

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
});
