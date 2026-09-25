import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../shell/vscode", () => ({
  openInVSCode: vi.fn(),
}));

import MockupFrame from "../MockupFrame";

// The projects directory is nested one level under the workspace root, so the
// workspace-relative path keeps that directory's own name ("projects/").
const ABSOLUTE = "/root/git/prv/projects/projects/pavilio/mockups/boot.html";
const FILE_PATH = "pavilio/mockups/boot.html";

/** The clipboard spy for the current test. Asserted on so a never-reached spy
 * cannot let a test pass silently. */
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

afterEach(() => {
  vi.clearAllMocks();
});

const frame = () =>
  screen.getByTestId("mockup-viewer-frame") as HTMLIFrameElement;

describe("MockupFrame", () => {
  it("renders an iframe pointing at the raw route for the file", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);

    expect(frame()).toHaveAttribute(
      "src",
      "/api/files/raw/pavilio/mockups/boot.html",
    );
  });

  it("URI-encodes path segments in the iframe src", () => {
    render(
      <MockupFrame
        filePath="pavilio/mock ups/a#b.html"
        absolutePath="/w/projects/pavilio/mock ups/a#b.html"
      />,
    );

    // Segments are encoded individually — the separators stay literal slashes
    // or the `/raw/*path` wildcard route no longer matches.
    expect(frame()).toHaveAttribute(
      "src",
      "/api/files/raw/pavilio/mock%20ups/a%23b.html",
    );
  });

  it("sandboxes with allow-scripts and without allow-same-origin", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);

    const sandbox = frame().getAttribute("sandbox") ?? "";
    expect(sandbox.split(/\s+/)).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  it("renders the viewer toolbar above the frame", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);

    const toolbar = screen.getByTestId("mockup-viewer-toolbar");
    expect(toolbar).toContainElement(
      screen.getByTestId("mockup-viewer-copy-path"),
    );
    // DOCUMENT_POSITION_FOLLOWING: the frame comes after the toolbar.
    expect(
      toolbar.compareDocumentPosition(frame()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("copies the workspace-relative path from the toolbar", async () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);
    fireEvent.click(screen.getByTestId("mockup-viewer-copy-path"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      "projects/pavilio/mockups/boot.html",
    );
  });

  it("opens at full width", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);

    expect(frame().style.width).toBe("100%");
  });

  it("constrains the frame to 390px on the phone width and 768px on tablet", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);

    fireEvent.click(screen.getByTestId("mockup-viewer-width-phone"));
    expect(frame().style.width).toBe("390px");

    fireEvent.click(screen.getByTestId("mockup-viewer-width-tablet"));
    expect(frame().style.width).toBe("768px");

    fireEvent.click(screen.getByTestId("mockup-viewer-width-full"));
    expect(frame().style.width).toBe("100%");
  });

  it("wraps the frame in a row that centers it horizontally", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);

    // The wrapper's classes are static — the selected width lives in the
    // iframe's `style` — so this holds at every width. The click is here to
    // show that: switching to a device width must not cost the centering.
    fireEvent.click(screen.getByTestId("mockup-viewer-width-phone"));

    // jsdom lays nothing out, so the centering can only be pinned where it is
    // expressed: the flex row that wraps the frame. All three halves matter — a
    // `justify-center` on a non-flex parent centers nothing, and on a
    // `flex-col` row it centers the frame vertically instead.
    const row = frame().parentElement as HTMLElement;
    const classes = Array.from(row.classList);
    expect(classes).toContain("flex");
    expect(classes).toContain("justify-center");
    expect(classes).not.toContain("flex-col");
  });

  it("keeps the same iframe element across a width change", () => {
    render(<MockupFrame filePath={FILE_PATH} absolutePath={ABSOLUTE} />);

    // A remount reloads the mockup and an interactive one loses its state, so
    // the element identity — not just the src — has to survive the switch.
    const before = frame();
    fireEvent.click(screen.getByTestId("mockup-viewer-width-phone"));
    expect(frame()).toBe(before);
    fireEvent.click(screen.getByTestId("mockup-viewer-width-full"));
    expect(frame()).toBe(before);
  });
});
