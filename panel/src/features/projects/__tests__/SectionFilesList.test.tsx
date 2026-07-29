import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SectionFilesList, { sectionRows } from "../SectionFilesList";

const files = [
  { relativePath: "p/notes/a.md", modified: Date.parse("2026-07-14T00:00:00.000Z") },
  { relativePath: "p/notes/b.md", modified: Date.parse("2026-07-15T00:00:00.000Z") },
] as never[];

/** What the server's file index actually holds for a qa section: .md/.txt/.json. */
const qaFiles = [
  {
    relativePath: "p/qa/runs/2026-07-20-alpha/run.md",
    modified: Date.parse("2026-07-20T00:00:00.000Z"),
  },
  {
    relativePath: "p/qa/runs/2026-07-20-alpha/console.txt",
    modified: Date.parse("2026-07-20T00:00:00.000Z"),
  },
  {
    relativePath: "p/qa/runs/2026-07-20-alpha/meta.json",
    modified: Date.parse("2026-07-20T00:00:00.000Z"),
  },
  {
    relativePath: "p/qa/runs/2026-07-21-beta/run.md",
    modified: Date.parse("2026-07-21T00:00:00.000Z"),
  },
  {
    relativePath: "p/qa/runs/2026-07-21-beta/notes.txt",
    modified: Date.parse("2026-07-21T00:00:00.000Z"),
  },
  { relativePath: "p/qa/REVIEW_RULES.md", modified: Date.parse("2026-07-01T00:00:00.000Z") },
] as never[];

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

  it("keeps the year on non-qa dates", () => {
    render(
      <SectionFilesList
        projectName="p"
        section="notes"
        files={files}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByTestId("section-files-file-p/notes/a.md").textContent,
    ).toContain("2026");
  });
});

describe("SectionFilesList qa branch", () => {
  it("renders one mono-labelled row per run.md, newest folder first", () => {
    const onSelect = vi.fn();
    render(
      <SectionFilesList
        projectName="p"
        section="qa"
        files={qaFiles}
        selectedPath={null}
        onSelect={onSelect}
      />,
    );

    const rows = screen.getAllByTestId(/^section-files-file-/);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "section-files-file-p/qa/runs/2026-07-21-beta/run.md",
      "section-files-file-p/qa/runs/2026-07-20-alpha/run.md",
    ]);

    // Label is the run folder name, rendered mono.
    const label = rows[0].querySelector("span.font-mono");
    expect(label?.textContent).toBe("2026-07-21-beta");

    // Non-run.md index entries never become rows.
    expect(
      screen.queryByTestId("section-files-file-p/qa/REVIEW_RULES.md"),
    ).toBeNull();
    expect(
      screen.queryByTestId("section-files-file-p/qa/runs/2026-07-20-alpha/meta.json"),
    ).toBeNull();

    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalledWith(
      "p/qa/runs/2026-07-20-alpha/run.md",
    );
  });

  it("omits the year on qa rows (the folder name carries the date)", () => {
    render(
      <SectionFilesList
        projectName="p"
        section="qa"
        files={qaFiles}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    const spans = Array.from(
      screen
        .getByTestId("section-files-file-p/qa/runs/2026-07-21-beta/run.md")
        .querySelectorAll("span"),
    );
    expect(spans[spans.length - 1].textContent).toBe("Jul 21");
  });

  it("shows no drop strip and an empty message when no runs exist", () => {
    render(
      <SectionFilesList
        projectName="p"
        section="qa"
        files={[{ relativePath: "p/qa/REVIEW_RULES.md", modified: 0 }] as never[]}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("No QA runs found.")).toBeTruthy();
    expect(screen.queryByTestId("section-files-header-qa")).toBeNull();
  });
});

describe("sectionRows drives both the count and the rows", () => {
  it("counts only the qa runs, not every indexed qa file", () => {
    // 6 indexed files, 2 runs — the pre-fix sidebar badge showed 6.
    expect(qaFiles).toHaveLength(6);
    expect(sectionRows("qa", qaFiles)).toHaveLength(2);
  });

  it("count matches the rows the sidebar actually renders", () => {
    const count = sectionRows("qa", qaFiles).length;
    render(
      <SectionFilesList
        projectName="p"
        section="qa"
        files={qaFiles}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getAllByTestId(/^section-files-file-/)).toHaveLength(count);
  });

  it("passes non-qa sections through unfiltered", () => {
    expect(sectionRows("notes", files)).toHaveLength(files.length);
    expect(sectionRows("notes", files).map((r) => r.label)).toEqual([
      "a.md",
      "b.md",
    ]);
  });
});
