import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SectionFilesList, { sectionRows, visibleSectionRows } from "../SectionFilesList";

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
        rows={sectionRows("notes", files)}
        filterActive={false}
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
        rows={sectionRows("notes", files)}
        filterActive={false}
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
        rows={sectionRows("notes", files)}
        filterActive={false}
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
        rows={sectionRows("notes", files)}
        filterActive={false}
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
        rows={sectionRows("qa", qaFiles)}
        filterActive={false}
        selectedPath={null}
        onSelect={onSelect}
      />,
    );

    const rows = screen.getAllByTestId(/^section-files-file-.*(?<!-kind|-delete)$/);
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
        rows={sectionRows("qa", qaFiles)}
        filterActive={false}
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
        rows={sectionRows("qa", [{ relativePath: "p/qa/REVIEW_RULES.md", modified: 0 }] as never[])}
        filterActive={false}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("No QA reviews or runs found.")).toBeTruthy();
    expect(screen.queryByTestId("section-files-header-qa")).toBeNull();
  });
});

describe("SectionFilesList qa reviews", () => {
  /** Runs + reviews + REVIEW_RULES.md, with known mtimes for order checks. */
  const qaReviewFiles = [
    {
      relativePath: "p/qa/runs/2026-07-20-alpha/run.md",
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
      relativePath: "p/qa/reviews/2026-08-19_CODE_REVIEW_feat-x_1e2ca0f.md",
      modified: Date.parse("2026-08-19T00:00:00.000Z"),
    },
    {
      relativePath: "p/qa/reviews/plain-review.md",
      modified: Date.parse("2026-07-19T00:00:00.000Z"),
    },
    {
      relativePath: "p/qa/REVIEW_RULES.md",
      modified: Date.parse("2026-07-01T00:00:00.000Z"),
    },
  ] as never[];

  it("lists qa reviews with a review badge and stripped label", () => {
    render(
      <SectionFilesList
        projectName="p"
        section="qa"
        rows={sectionRows("qa", qaReviewFiles)}
        filterActive={false}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    const testId =
      "section-files-file-p/qa/reviews/2026-08-19_CODE_REVIEW_feat-x_1e2ca0f.md";
    const label = screen.getByTestId(testId).querySelector("span.font-mono");
    expect(label?.textContent).toBe("feat-x_1e2ca0f");
    expect(screen.getByTestId(`${testId}-kind`).textContent).toBe("review");
  });

  it("merges reviews and runs into one list sorted by mtime desc", () => {
    render(
      <SectionFilesList
        projectName="p"
        section="qa"
        rows={sectionRows("qa", qaReviewFiles)}
        filterActive={false}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    const rows = screen.getAllByTestId(/^section-files-file-.*(?<!-kind|-delete)$/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "section-files-file-p/qa/reviews/2026-08-19_CODE_REVIEW_feat-x_1e2ca0f.md",
      "section-files-file-p/qa/runs/2026-07-21-beta/run.md",
      "section-files-file-p/qa/runs/2026-07-20-alpha/run.md",
      "section-files-file-p/qa/reviews/plain-review.md",
    ]);
  });

  it("keeps run rows unchanged and excludes REVIEW_RULES.md and json", () => {
    render(
      <SectionFilesList
        projectName="p"
        section="qa"
        rows={sectionRows("qa", qaReviewFiles)}
        filterActive={false}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    const runTestId = "section-files-file-p/qa/runs/2026-07-21-beta/run.md";
    expect(
      screen.getByTestId(runTestId).querySelector("span.font-mono")?.textContent,
    ).toBe("2026-07-21-beta");
    expect(screen.getByTestId(`${runTestId}-kind`).textContent).toBe("run");
    expect(
      screen.queryByTestId("section-files-file-p/qa/REVIEW_RULES.md"),
    ).toBeNull();
    expect(
      screen.queryByTestId(
        "section-files-file-p/qa/runs/2026-07-20-alpha/meta.json",
      ),
    ).toBeNull();
  });

  it("shows the reviews-or-runs empty message when qa is empty", () => {
    render(
      <SectionFilesList
        projectName="p"
        section="qa"
        rows={sectionRows("qa", [] as never[])}
        filterActive={false}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("No QA reviews or runs found.")).toBeTruthy();
  });

  it("sectionRows count for qa includes reviews and runs only", () => {
    const out = sectionRows("qa", qaReviewFiles);
    expect(out).toHaveLength(4);
    expect(out.map((r) => r.kind).sort()).toEqual([
      "review",
      "review",
      "run",
      "run",
    ]);
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
        rows={sectionRows("qa", qaFiles)}
        filterActive={false}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getAllByTestId(/^section-files-file-.*(?<!-kind|-delete)$/)).toHaveLength(count);
  });

  it("passes non-qa sections through unfiltered", () => {
    expect(sectionRows("notes", files)).toHaveLength(files.length);
    expect(sectionRows("notes", files).map((r) => r.label)).toEqual([
      "a.md",
      "b.md",
    ]);
  });
});

it("shows the no-match line when a filter is active and rows are empty", () => {
  render(
    <SectionFilesList
      projectName="proj"
      section="notes"
      rows={[]}
      filterActive
      selectedPath={null}
      onSelect={() => {}}
    />,
  );
  expect(screen.getByText("No files match.")).toBeInTheDocument();
});

it("visibleSectionRows filters and sorts qa runs by folder label", () => {
  const qaFiles = [
    { relativePath: "proj/qa/2026-01-02-run/run.md", project: "proj", modified: 5 },
    { relativePath: "proj/qa/2026-01-01-run/run.md", project: "proj", modified: 9 },
  ];
  const out = visibleSectionRows("qa", qaFiles, {
    query: "",
    sortKey: "date",
    sortDir: "desc",
  });
  expect(out.map((r) => r.label)).toEqual(["2026-01-01-run", "2026-01-02-run"]); // newest mtime first
});

it("visibleSectionRows filters notes by substring", () => {
  const files = [
    { relativePath: "proj/notes/alpha.md", project: "proj", modified: 2 },
    { relativePath: "proj/notes/beta.md", project: "proj", modified: 1 },
  ];
  const out = visibleSectionRows("notes", files, {
    query: "alph",
    sortKey: "date",
    sortDir: "desc",
  });
  expect(out.map((r) => r.label)).toEqual(["alpha.md"]);
});

describe("SectionFilesList qa stories and delete", () => {
  const storyFiles = [
    {
      relativePath: "p/qa/stories/pavilio-pr-237.md",
      modified: Date.parse("2026-11-24T00:00:00.000Z"),
    },
    {
      relativePath: "p/qa/stories/.gitignore",
      modified: Date.parse("2026-11-24T00:00:00.000Z"),
    },
    {
      relativePath: "p/qa/runs/2026-11-20-review-view/run.md",
      modified: Date.parse("2026-11-20T00:00:00.000Z"),
    },
    {
      relativePath: "p/qa/reviews/2026-11-22_CODE_REVIEW_feat-y_abc1234.md",
      modified: Date.parse("2026-11-22T00:00:00.000Z"),
    },
    {
      relativePath: "p/qa/REVIEW_RULES.md",
      modified: Date.parse("2026-11-25T00:00:00.000Z"),
    },
  ] as never[];

  const storyId = "section-files-file-p/qa/stories/pavilio-pr-237.md";
  const runId = "section-files-file-p/qa/runs/2026-11-20-review-view/run.md";

  /** Mounts the qa list and drops the deleted row when the index refresh fires. */
  const mountQa = (onSelect = vi.fn()) => {
    const view = render(
      <SectionFilesList
        projectName="p"
        section="qa"
        rows={sectionRows("qa", storyFiles)}
        filterActive={false}
        selectedPath={null}
        onSelect={onSelect}
      />,
    );
    return { ...view, onSelect };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("QA list shows stories with a story marker", () => {
    mountQa();
    const row = screen.getByTestId(storyId);
    expect(row.querySelector("span.font-mono")?.textContent).toBe("pavilio-pr-237");
    expect(screen.getByTestId(`${storyId}-kind`).textContent).toBe("story");
    const rows = screen.getAllByTestId(/^section-files-file-[^]*\.md$|run\.md$/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      storyId,
      "section-files-file-p/qa/reviews/2026-11-22_CODE_REVIEW_feat-y_abc1234.md",
      runId,
    ]);
  });

  it("QA list skips REVIEW_RULES.md and stories/.gitignore", () => {
    const out = sectionRows("qa", storyFiles);
    expect(out.map((r) => r.file.relativePath)).not.toContain("p/qa/REVIEW_RULES.md");
    expect(out.map((r) => r.file.relativePath)).not.toContain("p/qa/stories/.gitignore");
    expect(out).toHaveLength(3);
  });

  it("first click arms Delete?, second within 4s deletes a story", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshed = vi.fn();
    window.addEventListener("pavilio:file-index-refresh", refreshed);
    const { onSelect, rerender } = mountQa();
    const del = screen.getByTestId(`${storyId}-delete`);
    fireEvent.click(del);
    expect(del.textContent).toBe("Delete?");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(del);
    await waitFor(() => expect(refreshed).toHaveBeenCalled());
    window.removeEventListener("pavilio:file-index-refresh", refreshed);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/qa/stories/pavilio-pr-237.md", {
      method: "DELETE",
    });
    // Clicking the trash never opens the row.
    expect(onSelect).not.toHaveBeenCalled();
    // The refreshed index no longer holds the file, so the row is gone.
    rerender(
      <SectionFilesList
        projectName="p"
        section="qa"
        rows={sectionRows(
          "qa",
          (storyFiles as { relativePath: string }[]).filter(
            (f) => f.relativePath !== "p/qa/stories/pavilio-pr-237.md",
          ) as never[],
        )}
        filterActive={false}
        selectedPath={null}
        onSelect={onSelect}
      />,
    );
    expect(screen.queryByTestId(storyId)).toBeNull();
  });

  it("run row arms Delete run? and deletes the run folder", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    mountQa();
    const del = screen.getByRole("button", { name: "Delete runs/2026-11-20-review-view" });
    fireEvent.click(del);
    expect(del.textContent).toBe("Delete run?");
    fireEvent.click(del);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/qa/runs/2026-11-20-review-view", {
        method: "DELETE",
      }),
    );
  });

  it("failed delete keeps the row and shows the error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Could not delete" }, { status: 500 }),
      ),
    );
    mountQa();
    const del = screen.getByTestId(`${storyId}-delete`);
    fireEvent.click(del);
    fireEvent.click(del);
    expect(await screen.findByText("Could not delete")).toBeTruthy();
    expect(screen.getByTestId(storyId)).toBeTruthy();
    expect(del.textContent).toBe("");
  });

  it("no delete control outside the QA tab", () => {
    render(
      <SectionFilesList
        projectName="p"
        section="notes"
        rows={sectionRows("notes", files)}
        filterActive={false}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByTestId("section-files-file-p/notes/a.md-delete")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
  });
});
