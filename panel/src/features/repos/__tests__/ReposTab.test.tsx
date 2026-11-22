import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { stubFetch } from "../../../test-utils";
import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import ReposTab from "../ReposTab";
import { ME, pr } from "./prFixtures";

const REPOS = [{ name: "pavilio", path: "/root/git/prv/pavilio", present: true }];

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderTab(project = "pavilio", entry = `/project/${project}/repos`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
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

const pill = (name: string | RegExp) => within(screen.getByRole("group", { name: "Repos view" })).getByRole("button", { name });

beforeEach(() => {
  stubFetch({
    "/api/prs": {
      me: ME,
      prs: [pr({ number: 1, reviewers: [ME] }), pr({ number: 2, reviewers: ["bob", ME] }), pr({ number: 3, author: ME })],
      unavailable: [],
    },
  });
});

describe("ReposTab", () => {
  it("renders the three pills and the project crumb", () => {
    renderTab();
    expect(screen.getByTestId("repos-crumb")).toHaveTextContent("pavilio / Repos");
    const pills = within(screen.getByRole("group", { name: "Repos view" })).getAllByRole("button");
    expect(pills.map((b) => b.textContent?.replace(/\d+$/, ""))).toEqual(["Review", "Code", "PRs"]);
  });

  it("switching a pill updates the URL and the project preference", () => {
    renderTab();
    expect(pill("Code")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pill(/^PRs/));
    expect(pill(/^PRs/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("search")).toHaveTextContent("view=prs");
    expect(readPreference(preferences.reposView, "pavilio")).toBe("prs");
    expect(readPreference(preferences.reposView, "other")).toBe("code");
  });

  it("restores the last view per project", () => {
    writePreference(preferences.reposView, "review", "pavilio");
    writePreference(preferences.reposView, "prs", "other");
    const first = renderTab("pavilio");
    expect(pill("Review")).toHaveAttribute("aria-pressed", "true");
    first.unmount();
    const second = renderTab("other");
    expect(pill(/^PRs/)).toHaveAttribute("aria-pressed", "true");
    second.unmount();
    // The URL wins over the remembered view.
    renderTab("other", "/project/other/repos?view=code");
    expect(pill("Code")).toHaveAttribute("aria-pressed", "true");
  });

  it("drops the old Changes-page params from the URL on mount", async () => {
    renderTab("pavilio", "/project/pavilio/repos?view=prs&scope=commits&sha=abc&gitfile=a.ts&branchfile=b.ts&file=x.ts");
    await waitFor(() => {
      const params = new URLSearchParams(screen.getByTestId("search").textContent ?? "");
      expect([...params.keys()].sort()).toEqual(["file", "view"]);
    });
  });

  it("PRs pill counts reviews requested from me", async () => {
    renderTab();
    const count = await waitFor(() => within(pill(/^PRs/)).getByTestId("prs-pill-count"));
    expect(count).toHaveTextContent("2");
    expect(count).toHaveClass("rt-n-hot");
    expect(count).toHaveAttribute("title", "Your review requested");
  });

  it("context slot follows the active view", () => {
    renderTab();
    const slot = screen.getByTestId("repos-context");
    expect(within(slot).getByTestId("repo-switcher")).toBeInTheDocument();
    fireEvent.click(pill("Review"));
    expect(within(slot).getByTestId("pr-switcher")).toBeInTheDocument();
    expect(within(slot).queryByTestId("repo-switcher")).toBeNull();
    fireEvent.click(pill(/^PRs/));
    expect(slot).toBeEmptyDOMElement();
  });
});
