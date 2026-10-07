import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "../MarkdownRenderer";

const navigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("../MermaidDiagram", () => ({
  default: () => null,
}));

const MOCKUP_ROUTE = "/project/pavilio/mockups?file=pavilio%2Fmockups%2Fx.svg";

function renderMd(content: string, basePath?: string) {
  return render(
    <MemoryRouter>
      <MarkdownRenderer content={content} basePath={basePath} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigate.mockReset();
});

describe("MarkdownRenderer host-relative links", () => {
  it("slash-prefixed href navigates in-app unchanged", () => {
    renderMd(`[x.svg](${MOCKUP_ROUTE})`, "pavilio/plans/design.md");

    const link = screen.getByRole("link", { name: "x.svg" });
    expect(link.getAttribute("href")).toBe(MOCKUP_ROUTE);

    const notCancelled = fireEvent.click(link);
    expect(notCancelled).toBe(false); // default navigation prevented
    expect(navigate).toHaveBeenCalledWith(MOCKUP_ROUTE);
  });

  it("slash-prefixed href navigates in-app even without a basePath", () => {
    // A design doc from an OpenSpec backend outside projectsDir has no
    // basePath, and that is exactly where mockup links are cited from.
    renderMd(`[x.svg](${MOCKUP_ROUTE})`);

    const link = screen.getByRole("link", { name: "x.svg" });
    expect(link.getAttribute("href")).toBe(MOCKUP_ROUTE);
    expect(fireEvent.click(link)).toBe(false);
    expect(navigate).toHaveBeenCalledWith(MOCKUP_ROUTE);
  });

  it("modifier and middle clicks on an app route keep browser default", () => {
    renderMd(`[x.svg](${MOCKUP_ROUTE})`, "pavilio/plans/design.md");
    const link = screen.getByRole("link", { name: "x.svg" });

    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(fireEvent.click(link, { shiftKey: true })).toBe(true);
    expect(fireEvent.click(link, { button: 1 })).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("relative file links still open the viewer", () => {
    renderMd("[a](../memo/a.md)", "pavilio/notes/n.md");

    const link = screen.getByRole("link", { name: "a" });
    expect(link.getAttribute("href")).toBe("/view/pavilio/memo/a.md");
    expect(fireEvent.click(link)).toBe(false);
    expect(navigate).toHaveBeenCalledWith("/view/pavilio/memo/a.md");
  });

  it("protocol-relative links stay external", () => {
    renderMd("[cdn](//cdn.example.com/x.js)", "pavilio/notes/n.md");

    const link = screen.getByRole("link", { name: "cdn" });
    expect(link.getAttribute("href")).toBe("//cdn.example.com/x.js");
    expect(fireEvent.click(link)).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("relative images still resolve through the raw files API", () => {
    const { container } = renderMd("![shot](./img/s.png)", "pavilio/notes/n.md");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/files/raw/pavilio/notes/img/s.png");
  });
});

describe("MarkdownRenderer links that ask for another target", () => {
  it("leaves target=_blank and download links to the browser", () => {
    renderMd(
      [
        `<a href="${MOCKUP_ROUTE}" target="_blank">blank</a>`,
        `<a href="../mockups/x.svg" download>dl</a>`,
        `<a href="../mockups/y.svg" target="_self">self</a>`,
      ].join("\n\n"),
      "pavilio/plans/design.md",
    );

    expect(fireEvent.click(screen.getByRole("link", { name: "blank" }))).toBe(true);
    expect(fireEvent.click(screen.getByRole("link", { name: "dl" }))).toBe(true);
    expect(navigate).not.toHaveBeenCalled();

    // An explicit same-tab target is still an in-app navigation
    expect(fireEvent.click(screen.getByRole("link", { name: "self" }))).toBe(false);
    expect(navigate).toHaveBeenCalledWith("/view/pavilio/mockups/y.svg");
  });

  it("points a relative download link at the raw file, not the viewer route", () => {
    // `/view/*` is answered with the SPA shell, so downloading it would save
    // index.html instead of the linked file.
    renderMd(
      [
        `<a href="../mockups/x.svg" download>dl</a>`,
        `<a href="../mockups/z.svg" target="_blank">blank</a>`,
      ].join("\n\n"),
      "pavilio/plans/design.md",
    );

    expect(screen.getByRole("link", { name: "dl" })).toHaveAttribute(
      "href",
      "/api/files/raw/pavilio/mockups/x.svg",
    );
    // A new tab opens the viewer, which is what an in-app file link means.
    expect(screen.getByRole("link", { name: "blank" })).toHaveAttribute(
      "href",
      "/view/pavilio/mockups/z.svg",
    );
  });

  it("points a cross-root download link at the raw route with its root selector", () => {
    // `_root/<id>/` is a viewer-route prefix; the raw route selects the root
    // with `?root=` the way the read route does.
    renderMd(`<a href="./assets/x.svg" download>dl</a>`, "_root/skills/memo/SKILL.md");

    expect(screen.getByRole("link", { name: "dl" })).toHaveAttribute(
      "href",
      "/api/files/raw/memo/assets/x.svg?root=skills",
    );
  });

  it("resolves a cross-root relative image through the raw route's root selector", () => {
    const { container } = renderMd("![shot](./img/s.png)", "_root/skills/memo/SKILL.md");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/api/files/raw/memo/img/s.png?root=skills",
    );
  });
});
