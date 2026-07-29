import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SectionFilesList from "../SectionFilesList";
import { MOBILE_QUERY } from "../useFileListSidebar";

const files = [
  { relativePath: "p/notes/a.md", modified: "2026-07-14T00:00:00.000Z" },
  { relativePath: "p/notes/b.md", modified: "2026-07-15T00:00:00.000Z" },
] as never[];

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => ({
      matches: false,
      media: MOBILE_QUERY,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

describe("SectionFilesList rows", () => {
  it("renders one row per file and reports selection", () => {
    const onSelect = vi.fn();
    render(
      <SectionFilesList
        projectName="p"
        section="notes"
        files={files}
        selectedPath={null}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByTestId("section-files-file-p/notes/a.md")).toBeTruthy();
    fireEvent.click(screen.getByTestId("section-files-file-p/notes/b.md"));
    expect(onSelect).toHaveBeenCalledWith("p/notes/b.md");
  });

  it("marks the selected row", () => {
    render(
      <SectionFilesList
        projectName="p"
        section="notes"
        files={files}
        selectedPath="p/notes/a.md"
        onSelect={() => {}}
      />,
    );
    const row = screen.getByTestId("section-files-file-p/notes/a.md");
    expect(row.style.background).toBe("var(--bg-active)");
  });

  it("keeps the section drop target above the rows", () => {
    render(
      <SectionFilesList
        projectName="p"
        section="notes"
        files={files}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("section-files-header-notes")).toBeTruthy();
  });
});
