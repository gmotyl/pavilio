import { describe, it, expect, beforeEach, vi } from "vitest";
import { useContext } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectView from "../ProjectView";
import { FloatingActionProvider } from "../../shell/Layout";
import { FloatingActionContext } from "../../shell/Layout/FloatingActionProvider";
import { mockFetchResponses } from "../../../test-utils";

// The repos tab is covered by its own suite; here it only has to mount.
vi.mock("../../repos/ReposTab", () => ({
  default: ({ project }: { project: string }) => <div data-testid="repos-tab" data-project={project} />,
}));

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
});
