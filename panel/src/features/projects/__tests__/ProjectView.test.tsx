import { describe, it, expect, beforeEach, vi } from "vitest";
import { useContext } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectView from "../ProjectView";
import { FloatingActionProvider } from "../../shell/Layout";
import { FloatingActionContext } from "../../shell/Layout/FloatingActionProvider";
import { mockFetchResponses } from "../../../test-utils";

// The repos tab is covered by its own suite; here it only has to mount, unless a test asks for the real one.
let realReposTab = false;
vi.mock("../../repos/ReposTab", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../repos/ReposTab")>();
  const Real = actual.default;
  return {
    default: (props: Parameters<typeof Real>[0]) =>
      realReposTab ? <Real {...props} /> : <div data-testid="repos-tab" data-project={props.project} />,
  };
});

/**
 * The floating action is handed to the shell through a context rather than
 * rendered where it is declared, so a bare `render(<ProjectView/>)` would show
 * no floating control however the component behaves. This is the smallest
 * piece of `Layout` that puts it back on screen.
 */
function FloatingSlot() {
  const { action } = useContext(FloatingActionContext);
  return <div data-testid="floating-slot">{action}</div>;
}

function renderReposTab(search = "", section = "repos") {
  return render(
    <FloatingActionProvider>
      <MemoryRouter initialEntries={[`/project/pavilio/${section}${search}`]}>
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
    hasWiki: false,
    latestProgressDate: null,
    repos: [{ name: "pavilio", path: "/root/git/prv/pavilio", present: true }],
  },
];

type Doc = Record<string, unknown>;
const prefsDoc = () =>
  (globalThis as { __PAVILIO_PREFS__?: Doc }).__PAVILIO_PREFS__!;

describe("ProjectView layout", () => {
  beforeEach(() => {
    realReposTab = false;
    mockFetchResponses({
      "/api/projects": PROJECTS,
      "/api/git/status": [],
      "/api/git/branch": { branch: "main" },
      "/api/git/branches": { branches: ["main"] },
      "/api/git/suggest-message": { suggestion: "" },
      "/api/files/index": [],
    });
  });

  it("project view is always full width and renders the repos tab", async () => {
    // A compact choice an older panel wrote stays in the file, read by nothing.
    prefsDoc()["view.wide@repos"] = false;
    renderReposTab();

    const wrapper = await waitFor(() => screen.getByTestId("project-view"));
    expect(wrapper.className).not.toContain("max-w-5xl");
    const tab = await screen.findByTestId("repos-tab");
    expect(tab.getAttribute("data-project")).toBe("pavilio");
    // No compact/wide toggle anywhere, floating slot included.
    expect(screen.queryByTestId("wide-toggle")).toBeNull();
  });

  it("repos tab renders ReposTab without the legacy overlay or toggle", async () => {
    const quickFinder = vi.fn();
    window.addEventListener("pavilio:open-quick-finder", quickFinder);
    try {
      renderReposTab("?scope=commits&sha=abc&gitfile=a.ts&branchfile=b.ts");
      await screen.findByTestId("repos-tab");
      fireEvent.click(screen.getByTestId("project-tabs-toggle-search"));
      // The tab-bar search button opens the quick finder; the repo overlay is gone.
      expect(quickFinder).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("project-search-close")).toBeNull();
      expect(document.querySelector('[data-testid^="project-search-repo-scope-"]')).toBeNull();
      expect(document.querySelector('[data-testid^="git-worktree-toggle-"]')).toBeNull();
      expect(screen.queryByTestId("wide-toggle")).toBeNull();
    } finally {
      window.removeEventListener("pavilio:open-quick-finder", quickFinder);
    }
  });

  it("tab-bar search names notes, with the ⌘P hint only where ⌘P opens it", async () => {
    const { unmount } = renderReposTab();
    await screen.findByTestId("repos-tab");
    // On the repos tab ⌘P is the code file search.
    expect(screen.getByTestId("project-tabs-toggle-search")).toHaveAttribute("title", "Search notes");
    unmount();

    renderReposTab("", "notes");
    await waitFor(() => expect(screen.getByTestId("project-tabs-toggle-search")).toHaveAttribute("title", "Search notes (⌘P)"));
  });

  it("a missing linked repo issues no git or PR requests", async () => {
    realReposTab = true;
    const MISSING = "/root/git/prv/ghost";
    const fetchMock = mockFetchResponses({
      "/api/projects": [
        {
          ...PROJECTS[0],
          repos: [
            { name: "pavilio", path: "/root/git/prv/pavilio", present: true },
            { name: "ghost", path: MISSING, present: false },
          ],
        },
      ],
      "/api/git/worktrees": [{ path: "/root/git/prv/pavilio", head: "a".repeat(40), branch: "main" }],
      "/api/git/tree": { files: [] },
      "/api/git/status": [],
      "/api/prs": { me: "me", prs: [], unavailable: [] },
      "/api/files/index": [],
    });
    renderReposTab("?view=prs");
    for (const view of ["prs", "review", "code"]) {
      fireEvent.click(await screen.findByTestId(`repos-view-${view}`));
      await waitFor(() => expect(screen.getByTestId(`repos-view-${view}`)).toHaveAttribute("aria-pressed", "true"));
    }
    fireEvent.click(screen.getByTestId("repo-switcher"));
    await screen.findByRole("dialog", { name: "Pick a repository or worktree" });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/git/"))).toBe(true));
    const urls = fetchMock.mock.calls.map(([u]) => decodeURIComponent(String(u)));
    const leaked = urls.filter((u) => (u.startsWith("/api/git/") || u.startsWith("/api/prs")) && u.includes(MISSING));
    expect(leaked).toEqual([]);
  });
});
