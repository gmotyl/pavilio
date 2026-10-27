import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../shell/vscode", () => ({
  openInVSCode: vi.fn(),
}));

import MockupFrame from "../MockupFrame";
import { __resetWorkspaceRootForTests } from "../useWorkspaceRoot";

const ABSOLUTE = "/root/git/prv/projects/projects/pavilio/mockups/boot.html";
const FILE_PATH = "pavilio/mockups/boot.html";
const PNG_PATH = "pavilio/mockups/hero.png";
const PNG_ABSOLUTE = "/root/git/prv/projects/projects/pavilio/mockups/hero.png";

/** The history.back spy. Asserted on so a never-reached spy cannot let a test
 * pass silently; stubbed so jsdom does not traverse the shared history. */
let back: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
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
  back = vi.spyOn(window.history, "back").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const frame = () => screen.getByTestId("mockup-viewer-frame") as HTMLIFrameElement;
const layer = () => screen.queryByTestId("mockup-viewer-fullscreen");
const exitButton = () => screen.queryByRole("button", { name: "Exit fullscreen" });
const enter = () => fireEvent.click(screen.getByTestId("mockup-viewer-fullscreen-toggle"));

describe("MockupFrame fullscreen", () => {
  it("toolbar shows Fullscreen after the width buttons", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);

    const toolbar = screen.getByTestId("mockup-viewer-toolbar");
    const order = ["full", "tablet", "phone"].map((id) =>
      screen.getByTestId(`mockup-viewer-width-${id}`),
    );
    const fullscreen = screen.getByTestId("mockup-viewer-fullscreen-toggle");
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
    const pushState = vi.spyOn(window.history, "pushState");
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);
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
    // Entering pushes the entry Back pops.
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it("fullscreen keeps the same iframe element", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);

    const before = frame();
    enter();
    expect(frame()).toBe(before);
    fireEvent.click(exitButton()!);
    expect(frame()).toBe(before);
  });

  it("exit button leaves fullscreen", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);
    enter();

    fireEvent.click(exitButton()!);

    expect(layer()).toBeNull();
    expect(exitButton()).toBeNull();
    // The same mockup stays open.
    expect(frame()).toHaveAttribute("src", "/api/files/raw/pavilio/mockups/boot.html");
    // The entry pushed on enter is popped, so Back is not needed twice.
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("browser back leaves fullscreen", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);
    enter();

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });

    expect(layer()).toBeNull();
    expect(frame()).toHaveAttribute("src", "/api/files/raw/pavilio/mockups/boot.html");
    // Back already popped the entry; popping again would leave the page.
    expect(back).not.toHaveBeenCalled();
  });

  it("escape leaves fullscreen", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);
    enter();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(layer()).toBeNull();
    expect(frame()).toHaveAttribute("src", "/api/files/raw/pavilio/mockups/boot.html");
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("fullscreen keeps the selected width", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);
    fireEvent.click(screen.getByTestId("mockup-viewer-width-phone"));

    enter();

    expect(frame().style.width).toBe("390px");
    // Centred in the layer.
    expect(layer()!.classList).toContain("justify-center");
  });

  it("image mockups can go fullscreen", () => {
    render(<MockupFrame filePath={PNG_PATH} absolutePath={PNG_ABSOLUTE} />);

    const toggle = screen.getByTestId("mockup-viewer-fullscreen-toggle");
    expect(
      screen.getByTestId("mockup-viewer-zoom-actual").compareDocumentPosition(toggle) &
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
  it("exit only pops history when the marker entry is on top", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);
    enter();
    // Something replaced the marker entry (a router replace, say): popping now
    // would step off a page the user never pushed.
    window.history.replaceState({}, "");

    fireEvent.click(exitButton()!);

    expect(layer()).toBeNull();
    expect(back).not.toHaveBeenCalled();
  });

  it("switching to another file leaves fullscreen and pops the marker", () => {
    const { rerender } = render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);
    enter();
    expect(layer()).not.toBeNull();

    rerender(
      <MockupFrame
        filePath="pavilio/mockups/other.html"
        absolutePath="/root/git/prv/projects/projects/pavilio/mockups/other.html"
      />,
    );

    expect(layer()).toBeNull();
    expect(exitButton()).toBeNull();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("re-rendering the same file keeps fullscreen", () => {
    const { rerender } = render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);
    enter();

    rerender(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} content="<p/>" />);

    expect(layer()).not.toBeNull();
    expect(back).not.toHaveBeenCalled();
  });

  it("unmounting in fullscreen pops the marker entry", () => {
    const { unmount } = render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);
    enter();

    unmount();

    expect(back).toHaveBeenCalledTimes(1);
  });

  it("unmounting after Back already popped the marker does not pop again", () => {
    const { unmount } = render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);
    enter();
    // Back: the browser restores the entry below the marker, then fires popstate.
    window.history.replaceState({}, "");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    });

    unmount();

    expect(back).not.toHaveBeenCalled();
  });
});
