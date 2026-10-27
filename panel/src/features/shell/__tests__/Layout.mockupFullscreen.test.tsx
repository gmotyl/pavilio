import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Layout, FloatingActionProvider } from "../Layout";
import { TerminalDrawerProvider } from "../../terminal/useTerminalDrawer";
import MockupFrame from "../../projects/MockupFrame";
import { __resetWorkspaceRootForTests } from "../../projects/useWorkspaceRoot";

vi.mock("../LeftSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../RightSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../Breadcrumbs", () => ({ Breadcrumbs: () => <div /> }));
vi.mock("../vscode", () => ({ openInVSCode: vi.fn() }));

const FILE_PATH = "pavilio/mockups/boot.html";
const ABSOLUTE = "/root/git/prv/projects/projects/pavilio/mockups/boot.html";

beforeEach(() => {
  localStorage.clear();
  __resetWorkspaceRootForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ wslDistro: null, workspaceRoot: "/root/git/prv/projects" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(showMockup = true) {
  const tree = (show: boolean) => (
    <MemoryRouter initialEntries={["/project/pavilio/mockups"]}>
      <FloatingActionProvider>
        <TerminalDrawerProvider>
          <Layout>
            <div data-testid="page">
              {show && <MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />}
            </div>
          </Layout>
        </TerminalDrawerProvider>
      </FloatingActionProvider>
    </MemoryRouter>
  );
  const utils = render(tree(showMockup));
  return { ...utils, hide: () => utils.rerender(tree(false)) };
}

/** The routed-content scroll container: the page's direct parent. */
const scroller = () => screen.getByTestId("page").parentElement!;

/** Every ancestor of `el` up to the document that carries `isolate`. */
const isolatingAncestors = (el: Element) => {
  const hits: Element[] = [];
  for (let n = el.parentElement; n; n = n.parentElement)
    if (n.classList.contains("isolate")) hits.push(n);
  return hits;
};

const enter = () => fireEvent.click(screen.getByTestId("mockup-viewer-fullscreen-toggle"));

describe("Layout with a fullscreen mockup", () => {
  it("the scroll container isolates while no mockup is fullscreen", () => {
    // Keeps the sticky breadcrumb's z-30 scoped below the sidebar toggles.
    setup();
    expect(scroller().classList).toContain("isolate");
  });

  it("no ancestor of the fullscreen layer isolates, so z-[90] tops the chrome", () => {
    setup();
    enter();

    const layer = screen.getByTestId("mockup-viewer-fullscreen");
    expect(isolatingAncestors(layer)).toEqual([]);
  });

  it("leaving fullscreen restores the isolation", () => {
    setup();
    enter();
    fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));

    expect(scroller().classList).toContain("isolate");
  });

  it("unmounting the mockup in fullscreen restores the isolation", () => {
    const { hide } = setup();
    enter();
    expect(scroller().classList).not.toContain("isolate");

    hide();

    expect(scroller().classList).toContain("isolate");
  });
});
