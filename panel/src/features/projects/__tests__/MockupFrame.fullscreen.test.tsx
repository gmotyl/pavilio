import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import {
  BrowserRouter,
  Route,
  Routes,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";

vi.mock("../../shell/vscode", () => ({
  openInVSCode: vi.fn(),
}));

import MockupFrame from "../MockupFrame";
import { __resetWorkspaceRootForTests } from "../useWorkspaceRoot";

const ABSOLUTE = "/root/git/prv/projects/projects/pavilio/mockups/boot.html";
const FILE_PATH = "pavilio/mockups/boot.html";
const PNG_PATH = "pavilio/mockups/hero.png";
const PNG_ABSOLUTE = "/root/git/prv/projects/projects/pavilio/mockups/hero.png";
const OTHER = "pavilio/mockups/other.html";
const OTHER_ABSOLUTE = "/root/git/prv/projects/projects/pavilio/mockups/other.html";

/**
 * The app mounts under `<StrictMode>` and a `BrowserRouter`, so every test
 * does: StrictMode replays effects (the round-2 restore bug lived there), and
 * the router writes jsdom's real session history, which these tests traverse.
 */
const Shell = ({ children }: { children: ReactNode }) => (
  <StrictMode>
    <BrowserRouter>{children}</BrowserRouter>
  </StrictMode>
);

let navigateTo: NavigateFunction = () => {};
/** Exposes the router's navigate, as Quick finder or a link would use it. */
function Nav() {
  navigateTo = useNavigate();
  return null;
}

const renderFrame = (filePath = FILE_PATH, absolutePath = ABSOLUTE) =>
  render(<MockupFrame filePath={filePath} absolutePath={absolutePath} />, { wrapper: Shell });

/** History steps this frame took itself. Spied, not stubbed: jsdom traverses. */
let go: ReturnType<typeof vi.spyOn>;
let pushState: ReturnType<typeof vi.spyOn>;

/** The marker on the current entry; react-router keeps user state under `usr`. */
const marker = () =>
  (window.history.state as { usr?: { mockupFullscreen?: string } } | null)?.usr
    ?.mockupFullscreen;

beforeEach(() => {
  __resetWorkspaceRootForTests();
  // jsdom keeps one history per file: a marker an earlier test left on the
  // current entry would otherwise reopen the next test's mockup fullscreen.
  window.history.replaceState(null, "", "/mock");
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
  go = vi.spyOn(window.history, "go");
  pushState = vi.spyOn(window.history, "pushState");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const frame = () => screen.getByTestId("mockup-viewer-frame") as HTMLIFrameElement;
const layer = () => screen.queryByTestId("mockup-viewer-fullscreen");
const exitButton = () => screen.queryByRole("button", { name: "Exit fullscreen" });
const toggle = () => screen.getByTestId("mockup-viewer-fullscreen-toggle");
const enter = () => fireEvent.click(toggle());
/** Browser Back / Forward; the router hears the popstate jsdom fires later. */
const back = () => act(() => window.history.back());
const forward = () => act(() => window.history.forward());

describe("MockupFrame fullscreen", () => {
  it("toolbar shows Fullscreen after the width buttons", () => {
    renderFrame();

    const toolbar = screen.getByTestId("mockup-viewer-toolbar");
    const order = ["full", "tablet", "phone"].map((id) =>
      screen.getByTestId(`mockup-viewer-width-${id}`),
    );
    const fullscreen = toggle();
    expect(toolbar).toContainElement(fullscreen);
    expect(fullscreen).toHaveTextContent("Fullscreen");
    // Full, Tablet, Phone, then Fullscreen.
    for (const [a, b] of [
      [order[0], order[1]],
      [order[1], order[2]],
      [order[2], fullscreen],
    ])
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // At the right: pushed away from the width buttons.
    expect(fullscreen.className).toContain("ml-auto");
  });

  it("fullscreen shows the mockup alone with an exit button", () => {
    renderFrame();
    expect(layer()).toBeNull();
    expect(exitButton()).toBeNull();

    enter();

    const fs = layer()!;
    expect(fs).not.toBeNull();
    // A fixed full-viewport layer above the panel chrome.
    expect(Array.from(fs.classList)).toEqual(
      expect.arrayContaining(["fixed", "inset-0", "z-[90]"]),
    );
    // The mockup alone: the frame and the one exit button, no toolbar.
    expect(fs).toContainElement(frame());
    expect(fs).not.toContainElement(screen.getByTestId("mockup-viewer-toolbar"));
    expect(fs.querySelectorAll("button")).toHaveLength(1);
    // One round floating button, top-right.
    const exit = exitButton()!;
    expect(fs).toContainElement(exit);
    expect(Array.from(exit.classList)).toEqual(
      expect.arrayContaining(["fixed", "top-3", "right-3", "rounded-full", "w-10", "h-10"]),
    );
    // Entering pushes the entry Back pops: same page, marked with the file.
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/mock");
    expect(marker()).toBe(FILE_PATH);
  });

  it("fullscreen keeps the same iframe element", async () => {
    renderFrame();

    const before = frame();
    enter();
    expect(frame()).toBe(before);
    fireEvent.click(exitButton()!);
    await waitFor(() => expect(layer()).toBeNull());
    expect(frame()).toBe(before);
  });

  it("exit button leaves fullscreen", async () => {
    renderFrame();
    enter();

    fireEvent.click(exitButton()!);

    await waitFor(() => expect(layer()).toBeNull());
    expect(exitButton()).toBeNull();
    // The same mockup stays open.
    expect(frame()).toHaveAttribute("src", "/api/files/raw/pavilio/mockups/boot.html");
    // The entry pushed on enter is popped, so Back is not needed twice.
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
    expect(window.location.pathname).toBe("/mock");
    expect(marker()).toBeUndefined();
  });

  it("browser back leaves fullscreen", async () => {
    renderFrame();
    enter();

    back();

    await waitFor(() => expect(layer()).toBeNull());
    expect(frame()).toHaveAttribute("src", "/api/files/raw/pavilio/mockups/boot.html");
    // Back already popped the entry; popping again would leave the page.
    expect(go).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/mock");
  });

  it("escape leaves fullscreen", async () => {
    renderFrame();
    enter();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(layer()).toBeNull());
    expect(frame()).toHaveAttribute("src", "/api/files/raw/pavilio/mockups/boot.html");
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("escape with a dialog open does not leave fullscreen", () => {
    render(
      <>
        <MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />
        <div role="dialog" aria-modal="true" aria-label="Quick finder" />
      </>,
      { wrapper: Shell },
    );
    enter();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(layer()).not.toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it("escape already handled by someone else does not leave fullscreen", () => {
    renderFrame();
    enter();
    const handled = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", handled, true);

    try {
      fireEvent.keyDown(window, { key: "Escape" });
    } finally {
      window.removeEventListener("keydown", handled, true);
    }

    expect(layer()).not.toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it("fullscreen keeps the selected width", () => {
    renderFrame();
    fireEvent.click(screen.getByTestId("mockup-viewer-width-phone"));

    enter();

    expect(frame().style.width).toBe("390px");
    // Centred in the layer.
    expect(layer()!.classList).toContain("justify-center");
  });

  it("image mockups can go fullscreen", () => {
    renderFrame(PNG_PATH, PNG_ABSOLUTE);

    expect(
      screen.getByTestId("mockup-viewer-zoom-actual").compareDocumentPosition(toggle()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const image = screen.getByTestId("mockup-viewer-image");

    enter();

    const fs = layer()!;
    expect(fs).toContainElement(image);
    expect(screen.getByTestId("mockup-viewer-image")).toBe(image);
    expect(fs).not.toContainElement(screen.getByTestId("mockup-viewer-toolbar"));
    expect(fs.querySelectorAll("button")).toHaveLength(1);
    expect(exitButton()).not.toBeNull();
  });
});

describe("MockupFrame fullscreen leaves with the file", () => {
  it("a routed replace off the marker leaves fullscreen without popping", () => {
    render(
      <>
        <Nav />
        <MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />
      </>,
      { wrapper: Shell },
    );
    enter();

    // Something replaced the marker entry (a router replace, say): popping
    // now would step off a page the user never pushed.
    act(() => navigateTo("/mock", { replace: true }));

    expect(layer()).toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it("switching to another file leaves fullscreen and pops the marker", async () => {
    const { rerender } = renderFrame();
    enter();
    expect(layer()).not.toBeNull();

    rerender(<MockupFrame filePath={OTHER} absolutePath={OTHER_ABSOLUTE} />);

    expect(layer()).toBeNull();
    expect(exitButton()).toBeNull();
    expect(go).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(marker()).toBeUndefined());
  });

  it("re-rendering the same file keeps fullscreen", () => {
    const { rerender } = renderFrame();
    enter();

    rerender(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} content="<p/>" />);

    expect(layer()).not.toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it("unmounting in fullscreen leaves the entry to mean fullscreen", () => {
    const { unmount } = renderFrame();
    enter();

    unmount();

    // No step of its own: the entry stays "this file, fullscreen", and a
    // frame that mounts on it again (reload, the router coming back) shows it so.
    expect(go).not.toHaveBeenCalled();
    expect(marker()).toBe(FILE_PATH);
    renderFrame();
    expect(layer()).not.toBeNull();
  });
});

describe("MockupFrame fullscreen enter is idempotent and moves focus", () => {
  it("entering twice pushes one history entry", () => {
    renderFrame();

    enter();
    // The toggle is still in the DOM under the layer; Enter on it fires again.
    enter();

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(layer()).not.toBeNull();
  });

  it("leaving twice pops one history entry", async () => {
    renderFrame();
    enter();

    // The router commits the pop in a transition after jsdom's popstate; a
    // second Escape before then must not step off the page.
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(layer()).toBeNull());
    expect(go).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/mock");
  });

  it("entering moves focus to the exit button", () => {
    renderFrame();
    toggle().focus();

    enter();

    expect(document.activeElement).toBe(exitButton());
  });

  it("leaving returns focus to the Fullscreen toggle", async () => {
    renderFrame();
    enter();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(layer()).toBeNull());
    expect(document.activeElement).toBe(toggle());
  });
});

describe("MockupFrame fullscreen marker under a routed navigation", () => {
  /** Whatever react-router would write for a marked entry at /mock. */
  const landOn = (file: string) =>
    window.history.replaceState(
      { usr: { mockupFullscreen: file }, key: "restored", idx: 0 },
      "",
      "/mock",
    );

  it("a mockup that mounts on its own marker entry opens fullscreen and stays so", async () => {
    // A reload onto the marker, under StrictMode: the replayed effects must
    // not treat the simulated unmount as leaving.
    landOn(FILE_PATH);

    renderFrame();

    expect(layer()).not.toBeNull();
    // Give any stray traversal a chance to land before asserting it did not.
    await new Promise((r) => setTimeout(r, 20));
    expect(layer()).not.toBeNull();
    expect(go).not.toHaveBeenCalled();
    expect(marker()).toBe(FILE_PATH);
    // The toolbar is covered: focus starts on the exit control.
    expect(document.activeElement).toBe(exitButton());
  });

  it("another file's marker entry does not open this mockup fullscreen", () => {
    landOn(OTHER);

    renderFrame();

    expect(layer()).toBeNull();
  });

  it("Quick finder style navigate away: Back restores fullscreen, Back again exits it", async () => {
    render(
      <>
        <Nav />
        <Routes>
          <Route
            path="/mock"
            element={<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />}
          />
          <Route path="/view" element={<div data-testid="other-page" />} />
        </Routes>
      </>,
      { wrapper: Shell },
    );
    enter();
    expect(layer()).not.toBeNull();

    act(() => navigateTo("/view"));
    expect(screen.getByTestId("other-page")).toBeInTheDocument();

    // Back from the new page lands on the marker entry: the mockup it was
    // left in, fullscreen again — not a dead duplicate of the page below —
    // with focus on its exit control.
    back();
    await waitFor(() => expect(layer()).not.toBeNull());
    expect(window.location.pathname).toBe("/mock");
    expect(document.activeElement).toBe(exitButton());
    // It stays: StrictMode's replayed cleanup does not pop it again.
    await new Promise((r) => setTimeout(r, 20));
    expect(layer()).not.toBeNull();
    expect(window.location.pathname).toBe("/mock");

    // Forward and Back again land on the same entries, no bounce.
    forward();
    await waitFor(() => expect(screen.getByTestId("other-page")).toBeInTheDocument());
    back();
    await waitFor(() => expect(layer()).not.toBeNull());

    // The next Back exits fullscreen and stays on the mockup.
    back();
    await waitFor(() => expect(layer()).toBeNull());
    expect(window.location.pathname).toBe("/mock");
    expect(frame()).toBeInTheDocument();
    expect(go).not.toHaveBeenCalled();
  });

  it("Quick finder opening the same file leaves fullscreen; Back restores it, Back again exits", async () => {
    window.history.replaceState(null, "", "/view/boot");
    render(
      <>
        <Nav />
        <Routes>
          <Route
            path="/view/boot"
            element={<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />}
          />
        </Routes>
      </>,
      { wrapper: Shell },
    );
    const before = frame();
    enter();
    expect(layer()).not.toBeNull();

    // Same route, new entry: the frame stays mounted, the entry is not marked.
    act(() => navigateTo("/view/boot"));
    expect(layer()).toBeNull();
    expect(exitButton()).toBeNull();
    expect(frame()).toBe(before);

    // Back lands on the marker: visibly fullscreen again, one step.
    back();
    await waitFor(() => expect(layer()).not.toBeNull());
    expect(frame()).toBe(before);

    // The next Back leaves it, still on the same file.
    back();
    await waitFor(() => expect(layer()).toBeNull());
    expect(window.location.pathname).toBe("/view/boot");
    expect(frame()).toBe(before);
    expect(go).not.toHaveBeenCalled();
  });
});
