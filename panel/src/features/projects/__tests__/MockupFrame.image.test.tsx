import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../shell/vscode", () => ({
  openInVSCode: vi.fn(),
}));

import MockupFrame from "../MockupFrame";
import { __resetWorkspaceRootForTests } from "../useWorkspaceRoot";
import { isMockupImage, isRasterImage } from "../mockupFiles";

const PNG_PATH = "pavilio/mockups/2026-10-07-hero.png";
const PNG_ABSOLUTE =
  "/root/git/prv/projects/projects/pavilio/mockups/2026-10-07-hero.png";
const SVG_PATH = "pavilio/mockups/2026-10-07-icon.svg";
const SVG_ABSOLUTE =
  "/root/git/prv/projects/projects/pavilio/mockups/2026-10-07-icon.svg";

/** The clipboard spy for the current test. Asserted on so a never-reached spy
 * cannot let a test pass silently. */
let writeText: ReturnType<typeof vi.fn>;

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
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const image = () => screen.getByTestId("mockup-viewer-image") as HTMLImageElement;

describe("MockupFrame with an image mockup", () => {
  it("image mockup renders as img not iframe", () => {
    render(<MockupFrame filePath={PNG_PATH} absolutePath={PNG_ABSOLUTE} />);

    expect(image().tagName).toBe("IMG");
    expect(image()).toHaveAttribute(
      "src",
      "/api/files/raw/pavilio/mockups/2026-10-07-hero.png",
    );
    expect(screen.queryByTestId("mockup-viewer-frame")).toBeNull();
    // The viewport widths mean nothing for a static image.
    expect(screen.queryByTestId("mockup-viewer-width-full")).toBeNull();
    expect(screen.queryByTestId("mockup-viewer-width-phone")).toBeNull();
  });

  it("fit and 100% toggle", () => {
    render(<MockupFrame filePath={PNG_PATH} absolutePath={PNG_ABSOLUTE} />);

    const fit = screen.getByTestId("mockup-viewer-zoom-fit");
    const actual = screen.getByTestId("mockup-viewer-zoom-actual");
    expect(fit).toHaveTextContent("Fit");
    expect(actual).toHaveTextContent("100%");

    // Fit is the default.
    expect(fit).toHaveAttribute("aria-pressed", "true");
    expect(actual).toHaveAttribute("aria-pressed", "false");
    expect(image().style.maxWidth).toBe("100%");

    fireEvent.click(actual);
    expect(actual).toHaveAttribute("aria-pressed", "true");
    expect(fit).toHaveAttribute("aria-pressed", "false");
    expect(image().style.maxWidth).toBe("none");

    fireEvent.click(fit);
    expect(fit).toHaveAttribute("aria-pressed", "true");
    expect(image().style.maxWidth).toBe("100%");
  });

  it("svg renders through img", () => {
    // An `<img>` never runs an SVG's scripts; an iframe or inline SVG would.
    render(<MockupFrame filePath={SVG_PATH} absolutePath={SVG_ABSOLUTE} />);

    expect(image().tagName).toBe("IMG");
    expect(image()).toHaveAttribute(
      "src",
      "/api/files/raw/pavilio/mockups/2026-10-07-icon.svg",
    );
    expect(screen.queryByTestId("mockup-viewer-frame")).toBeNull();
    expect(document.querySelector("svg script")).toBeNull();
  });

  it("raster mockup disables copy content", async () => {
    render(<MockupFrame filePath={PNG_PATH} absolutePath={PNG_ABSOLUTE} />);

    expect(screen.getByTestId("mockup-viewer-copy-content")).toBeDisabled();

    const copyPath = screen.getByTestId("mockup-viewer-copy-path");
    await waitFor(() => expect(copyPath).not.toBeDisabled());
    fireEvent.click(copyPath);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenLastCalledWith(
      "projects/pavilio/mockups/2026-10-07-hero.png",
    );

    fireEvent.click(screen.getByTestId("mockup-viewer-copy-absolute"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenLastCalledWith(PNG_ABSOLUTE);

    fireEvent.click(screen.getByTestId("mockup-viewer-copy-link"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
    expect(writeText).toHaveBeenLastCalledWith(
      `[projects/pavilio/mockups/2026-10-07-hero.png](/project/pavilio/mockups?file=${encodeURIComponent(PNG_PATH)})`,
    );
  });
});

describe("MockupFrame copy content", () => {
  it("copies an svg mockup's text", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    render(<MockupFrame filePath={SVG_PATH} absolutePath={SVG_ABSOLUTE} content={svg} />);

    const button = screen.getByTestId("mockup-viewer-copy-content");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenLastCalledWith(svg);
  });

  it("never offers a raster's bytes as content", () => {
    render(<MockupFrame filePath={PNG_PATH} absolutePath={PNG_ABSOLUTE} content="\u0089PNG" />);

    expect(screen.getByTestId("mockup-viewer-copy-content")).toBeDisabled();
  });
});

describe("MockupFrame copy link", () => {
  const ROOT = "/root/git/prv/projects/projects";

  const copiedLink = async () => {
    const button = screen.getByTestId("mockup-viewer-copy-link");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    return writeText.mock.calls[0][0] as string;
  };

  it("links an archived project's mockup to that project", async () => {
    const path = "archived/pavilio/mockups/old.png";
    render(<MockupFrame filePath={path} absolutePath={`${ROOT}/${path}`} />);

    expect(await copiedLink()).toBe(
      `[projects/${path}](/project/pavilio/mockups?file=${encodeURIComponent(path)})`,
    );
  });

  it("has no copy link outside a project's mockups folder", async () => {
    for (const path of ["pavilio/notes/x.png", "x.png", "archived/x.png", "a/b/mockups/x.png"]) {
      const { unmount } = render(
        <MockupFrame filePath={path} absolutePath={`${ROOT}/${path}`} />,
      );
      // Positive control: the toolbar rendered
      expect(screen.getByTestId("mockup-viewer-copy-absolute")).toBeTruthy();
      expect(screen.queryByTestId("mockup-viewer-copy-link")).toBeNull();
      unmount();
    }
  });

  it("escapes brackets in the text and parentheses in the target", async () => {
    const path = "pavilio/mockups/a [b] (c).png";
    render(<MockupFrame filePath={path} absolutePath={`${ROOT}/${path}`} />);

    expect(await copiedLink()).toBe(
      "[projects/pavilio/mockups/a \\[b\\] (c).png]" +
        "(/project/pavilio/mockups?file=pavilio%2Fmockups%2Fa%20%5Bb%5D%20%28c%29.png)",
    );
  });
});

describe("mockup image detection", () => {
  it("matches the image extensions case-insensitively", () => {
    for (const p of ["a.svg", "a.png", "a.jpg", "a.jpeg", "a.webp", "A.PNG", "b.JpEg"])
      expect(isMockupImage(p)).toBe(true);
    for (const p of ["a.html", "a.md", "a.gif", "png", "a.png.md"])
      expect(isMockupImage(p)).toBe(false);
  });

  it("treats every image but svg as raster", () => {
    expect(isRasterImage("a.PNG")).toBe(true);
    expect(isRasterImage("a.webp")).toBe(true);
    expect(isRasterImage("a.svg")).toBe(false);
    expect(isRasterImage("a.html")).toBe(false);
  });
});
