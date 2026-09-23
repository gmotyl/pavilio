import { describe, it, expect, beforeEach, vi } from "vitest";
import { useContext } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectView from "../ProjectView";
import { preferences } from "../../../preferences/declarations";
import { storageKey } from "../../../preferences/types";
import { FloatingActionProvider } from "../../shell/Layout";
import { FloatingActionContext } from "../../shell/Layout/FloatingActionProvider";
import { mockFetchResponses } from "../../../test-utils";

// The repos tab's other three blocks each fetch and render a tree of their own,
// and none of them has ever owned a wide toggle. GitChanges stays REAL: it is
// the component that used to render the second copy, so a stub there would
// stub out the very thing "exactly one toggle" is guarding.
vi.mock("../../git/GitBranchDiff", () => ({ default: () => null }));
vi.mock("../../git/GitWorktrees", () => ({ default: () => null }));
vi.mock("../../git/GitHistory", () => ({ default: () => null }));

/**
 * The floating action is handed to the shell through a context rather than
 * rendered where it is declared, so a bare `render(<ProjectView/>)` would show
 * no toggle however correct the component is. This is the smallest piece of
 * `Layout` that puts it back on screen.
 */
function FloatingSlot() {
  const { action } = useContext(FloatingActionContext);
  return <div data-testid="floating-slot">{action}</div>;
}

function renderReposTab() {
  return render(
    <FloatingActionProvider>
      <MemoryRouter initialEntries={["/project/pavilio/repos"]}>
        <Routes>
          <Route path="/project/:name/:section" element={<ProjectView />} />
        </Routes>
      </MemoryRouter>
      <FloatingSlot />
    </FloatingActionProvider>,
  );
}

const PROJECTS = [
  {
    name: "pavilio",
    path: "/root/git/prv/pavilio",
    hasIndex: true,
    hasNotes: true,
    hasProgress: true,
    hasPlans: true,
    latestProgressDate: null,
    repos: [{ name: "pavilio", path: "/root/git/prv/pavilio" }],
  },
];

/** Everything the repos tab asks for, with the working tree's status as the variable. */
function stubRepos(status: { status: string; path: string }[]) {
  mockFetchResponses({
    "/api/projects": PROJECTS,
    "/api/git/status": status,
    "/api/git/branch": { branch: "main" },
    "/api/git/branches": { branches: ["main"] },
    "/api/git/suggest-message": { suggestion: "" },
    "/api/files/index": [],
  });
}

type Doc = Record<string, unknown>;
const prefsDoc = () =>
  (globalThis as { __PAVILIO_PREFS__?: Doc }).__PAVILIO_PREFS__!;

/**
 * The element carrying the layout clamp. It has its own `data-testid` because
 * the old `.p-6` selector was unique only by accident — three sibling blocks
 * are mocked out in this file, and un-mocking any of them would have made it
 * ambiguous without failing loudly.
 */
const findWrapper = () =>
  waitFor(() => screen.getByTestId("project-view"));

describe("ProjectView wide mode", () => {
  beforeEach(() => {
    stubRepos([]);
  });

  it("a clean repository still shows the wide toggle", async () => {
    // The case that was broken: with nothing uncommitted, GitChanges renders
    // "No changes" and never reaches the commit row its inline copy lived in.
    stubRepos([]);
    renderReposTab();

    expect(await screen.findByText("No changes")).toBeTruthy();
    expect(screen.getAllByTestId("wide-toggle")).toHaveLength(1);
  });

  it("a dirty repository shows exactly one wide toggle", async () => {
    // The regression guard for the duplicate: this is the only state in which
    // the inline copy ever rendered, so two toggles here means both paths are
    // alive again.
    stubRepos([{ status: "M", path: "src/app.ts" }]);
    renderReposTab();

    expect(await screen.findByText("src/app.ts")).toBeTruthy();
    expect(screen.getAllByTestId("wide-toggle")).toHaveLength(1);
  });

  it("a view with no recorded choice opens wide", async () => {
    renderReposTab();

    // `max-w-5xl` is the compact clamp, so its absence IS wide — and the
    // toggle offers the way back rather than the way in.
    const wrapper = await findWrapper();
    expect(wrapper.className).not.toContain("max-w-5xl");
    expect(
      screen.getByTestId("wide-toggle").getAttribute("title"),
    ).toBe("Compact view");
  });

  it("an explicit compact choice survives the default flip", async () => {
    // A value a previous session wrote, which must still beat the new default.
    prefsDoc()[storageKey(preferences.wideMode, "repos")] = false;
    renderReposTab();

    const wrapper = await findWrapper();
    expect(wrapper.className).toContain("max-w-5xl");
    expect(
      screen.getByTestId("wide-toggle").getAttribute("title"),
    ).toBe("Wide view");
  });

  it("clicking the toggle flips the layout clamp", async () => {
    // "Present" is not "wired": the toggle is rendered into the shell through a
    // context, so it can be on screen with its `onToggle` going nowhere. This
    // clicks it and watches the clamp the page actually lays out with.
    renderReposTab();

    const wrapper = await findWrapper();
    expect(wrapper.className).not.toContain("max-w-5xl");

    fireEvent.click(screen.getByTestId("wide-toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("project-view").className).toContain(
        "max-w-5xl",
      ),
    );
    expect(screen.getByTestId("wide-toggle").getAttribute("title")).toBe(
      "Wide view",
    );

    // And back, so a one-way write cannot pass either.
    fireEvent.click(screen.getByTestId("wide-toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("project-view").className).not.toContain(
        "max-w-5xl",
      ),
    );
  });
});
