import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewComment } from "../../../../../server/lib/prs/provider";
import type { ReviewThread } from "../../reviewThreads";

const speech = vi.hoisted(() => ({ speakDocument: vi.fn(), stopDocument: vi.fn() }));
const host = vi.hoisted(() => ({ stateFor: () => "empty", onPause: vi.fn(), onResume: vi.fn() }));
vi.mock("../../../speech/SpeechHostProvider", () => ({ usePageSpeech: () => speech, usePanelSpeech: () => host }));

import FileViewer from "../FileViewer";

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const CONTENT = Array.from({ length: 20 }, (_, i) => (i === 14 ? "const area = width * height;" : `line ${i + 1}`));
CONTENT.splice(15, 0, "line 16");
const FULL = CONTENT.slice(0, 20).join("\n");
// Old line 15 replaced by new line 15; new line 16 added.
const DIFF = [
  "--- a/src/geo/area.ts",
  "+++ b/src/geo/area.ts",
  "@@ -12,7 +12,8 @@",
  " line 12",
  " line 13",
  " line 14",
  "-const area = w * h;",
  "+const area = width * height;",
  "+line 16",
  " line 16",
  " line 17",
  " line 18",
].join("\n");

const thread = (side: "old" | "new", line: number, n = 1): ReviewThread => ({
  anchor: { side, line },
  comments: Array.from(
    { length: n },
    (_, i): ReviewComment => ({
      id: line * 10 + i,
      replyTo: i ? line * 10 : null,
      path: "src/geo/area.ts",
      line,
      side,
      author: "kwojcik",
      body: `note ${i}`,
      createdAt: `2026-11-23T10:0${i}:00Z`,
      url: `https://github.com/gmotyl/pavilio/pull/7#discussion_r${line * 10 + i}`,
      commitId: "head",
    }),
  ),
});

/** new:16 is an added line, old:15 the deleted one, new:13 / old:13 a context line. */
const COMMENTS = new Map<string, ReviewThread>([
  ["new:16", thread("new", 16, 2)],
  ["old:15", thread("old", 15)],
]);

const viewer = (extra: Partial<Parameters<typeof FileViewer>[0]> = {}) => (
  <FileViewer
    path="src/geo/area.ts"
    diff={DIFF}
    content={FULL}
    status="M"
    counts={{ add: 2, del: 1 }}
    defaultMode="diff"
    commentSpeechKey="pavilio//pr/gmotyl/pavilio/7"
    {...extra}
  />
);

const body = () => screen.getByTestId("file-viewer-body");
const markers = () => [...body().querySelectorAll<HTMLButtonElement>("button.fv-cmbtn")];
const unified = () => fireEvent.click(screen.getByRole("button", { name: "Unified" }));
const split = () => fireEvent.click(screen.getByRole("button", { name: "Split" }));

/** Every data row (not fold/gap) has exactly `lanes` comment cells, and each table has `lanes` 22px lane columns. */
function expectLanes(table: HTMLTableElement, lanes: number) {
  const rows = [...table.querySelectorAll("tr")].filter((tr) => !tr.matches(".fv-fold-row, .fv-gap-row"));
  expect(rows.length).toBeGreaterThan(0);
  for (const tr of rows) expect(tr.querySelectorAll("td.fv-cm")).toHaveLength(lanes);
  expect(table.querySelectorAll("col.fv-cm-col")).toHaveLength(lanes);
  // Fold and gap rows still span the whole table.
  const cols = table.querySelectorAll("col").length;
  for (const td of table.querySelectorAll<HTMLTableCellElement>(".fv-fold-row td, .fv-gap-row td")) expect(td.colSpan).toBe(cols);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoResizeObserver);
  speech.speakDocument.mockReset();
  speech.stopDocument.mockReset();
});

describe("FileViewer comment lane", () => {
  it("FileViewer renders no comment lane without comments", () => {
    const { container } = render(viewer());
    unified();
    expect(container.querySelector(".fv-cm, .fv-cm-col, .fv-cmbtn")).toBeNull();
    expect(container.querySelectorAll("table.fv-unified col")).toHaveLength(4);
    split();
    expect(container.querySelector(".fv-cm, .fv-cm-col, .fv-cmbtn")).toBeNull();
    expect(container.querySelectorAll("table.fv-split col")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(container.querySelector(".fv-cm, .fv-cm-col, .fv-cmbtn")).toBeNull();
    expect(container.querySelectorAll("table.fv-code col")).toHaveLength(3);
  });

  it("FileViewer puts a marker on the commented new line in unified diff", () => {
    const { container } = render(viewer({ comments: COMMENTS }));
    unified();
    const table = container.querySelector<HTMLTableElement>("table.fv-unified")!;
    expectLanes(table, 1);
    // The lane comes before the old-number column.
    const row = body().querySelector('tr[data-line="16"]')!;
    expect(row.children[0]).toHaveClass("fv-cm");
    expect(row.children[1]).toHaveClass("fv-no");
    const btn = row.querySelector("td.fv-cm button.fv-cmbtn");
    expect(btn).toHaveAccessibleName("2 comments on line 16");
    expect(markers()).toHaveLength(2);
  });

  it("FileViewer puts an old-side marker on the deleted line", () => {
    render(viewer({ comments: new Map([["old:15", thread("old", 15)], ["old:13", thread("old", 13)]]) }));
    unified();
    const del = body().querySelector('tr.fv-r-del[data-old-line="15"]')!;
    expect(del.querySelector("td.fv-cm button.fv-cmbtn")).toHaveAccessibleName("1 comment on line 15");
    // The added row that took new line 15 has no marker.
    expect(body().querySelector('tr[data-line="15"] .fv-cmbtn')).toBeNull();
    // A context row also carries its old-side thread.
    const ctx = body().querySelector('tr.fv-r-ctx[data-old-line="13"]')!;
    expect(ctx.querySelector("td.fv-cm button.fv-cmbtn")).toHaveAccessibleName("1 comment on line 13");
    expect(markers()).toHaveLength(2);
  });

  it("FileViewer stacks both sides' markers on a unified context row", () => {
    render(viewer({ comments: new Map([["new:13", thread("new", 13)], ["old:13", thread("old", 13, 2)]]) }));
    unified();
    const ctx = body().querySelector('tr.fv-r-ctx[data-line="13"][data-old-line="13"]')!;
    const cells = ctx.querySelectorAll("td.fv-cm");
    expect(cells).toHaveLength(1);
    const btns = [...cells[0].querySelectorAll("button.fv-cmbtn")].map((b) => b.getAttribute("aria-label"));
    expect(btns).toEqual(["1 comment on line 13", "2 comments on line 13"]);
    expect(markers()).toHaveLength(2);
  });

  it("FileViewer splits markers by side in split view", () => {
    const comments = new Map([...COMMENTS, ["new:13", thread("new", 13)]]);
    const { container } = render(viewer({ comments }));
    split();
    const table = container.querySelector<HTMLTableElement>("table.fv-split")!;
    expectLanes(table, 2);
    const laneOf = (btn: Element) => {
      const tr = btn.closest("tr")!;
      return [...tr.querySelectorAll("td.fv-cm")].indexOf(btn.closest("td")!) === 0 ? "left" : "right";
    };
    const placed = markers().map((b) => [b.getAttribute("aria-label"), laneOf(b), b.closest("tr")!.getAttribute("data-line"), b.closest("tr")!.getAttribute("data-old-line")]);
    expect(placed).toEqual(
      expect.arrayContaining([
        ["1 comment on line 13", "right", "13", "13"],
        ["1 comment on line 15", "left", "15", "15"],
        ["2 comments on line 16", "right", "16", null],
      ]),
    );
    expect(placed).toHaveLength(3);
    // Each lane sits right before its side's number column.
    const row = body().querySelector('tr[data-old-line="15"]')!;
    expect([...row.children].map((td) => td.className.split(" ")[0])).toEqual(["fv-cm", "fv-no", "fv-cd", "fv-cm", "fv-no", "fv-cd"]);
  });

  it("FileViewer shows only new-side markers in Code mode", () => {
    const { container } = render(viewer({ comments: COMMENTS, defaultMode: "code" }));
    const table = container.querySelector<HTMLTableElement>("table.fv-code")!;
    expectLanes(table, 1);
    expect(markers()).toHaveLength(1);
    const row = body().querySelector('tr[data-line="16"]')!;
    // The lane comes before the gutter mark.
    expect([...row.children].map((td) => td.className.split(" ")[0])).toEqual(["fv-cm", "fv-gm", "fv-no", "fv-cd"]);
    expect(row.querySelector(".fv-cmbtn")).toHaveAccessibleName("2 comments on line 16");
    expect(body().querySelector('tr[data-line="15"] .fv-cmbtn')).toBeNull();
  });

  it("FileViewer expands a fold holding a commented line, so its marker shows without a click", () => {
    const long = Array.from({ length: 100 }, (_, i) => `row ${i + 1}`);
    long[79] = "row 80 edited";
    const longDiff = [
      "--- a/src/geo/area.ts",
      "+++ b/src/geo/area.ts",
      "@@ -77,7 +77,7 @@",
      " row 77",
      " row 78",
      " row 79",
      "-row 80",
      "+row 80 edited",
      " row 81",
      " row 82",
      " row 83",
    ].join("\n");
    const fixture = (comments: Map<string, ReviewThread>) =>
      viewer({ diff: longDiff, content: long.join("\n"), counts: { add: 1, del: 1 }, comments });
    // Without a comment in it, lines 1–73 fold.
    const { container, unmount } = render(fixture(new Map([["new:80", thread("new", 80)]])));
    unified();
    expect(container.querySelectorAll(".fv-fold-row")).not.toHaveLength(0);
    expect(body().querySelector('tr[data-line="10"]')).toBeNull();
    unmount();

    render(fixture(new Map([["new:10", thread("new", 10)], ["old:95", thread("old", 95)]])));
    unified();
    expect(body().querySelector('tr[data-line="10"] .fv-cmbtn')).toHaveAccessibleName("1 comment on line 10");
    expect(body().querySelector('tr[data-old-line="95"] .fv-cmbtn')).toHaveAccessibleName("1 comment on line 95");
    split();
    expect(body().querySelector('tr[data-line="10"] .fv-cmbtn')).toHaveAccessibleName("1 comment on line 10");
    expect(body().querySelector('tr[data-old-line="95"] .fv-cmbtn')).toHaveAccessibleName("1 comment on line 95");
  });

  it("FileViewer reveals only a few lines either side of a commented line in a fold, the rest stays folded", () => {
    const long = Array.from({ length: 100 }, (_, i) => `row ${i + 1}`);
    long[79] = "row 80 edited";
    const longDiff = ["--- a/src/geo/area.ts", "+++ b/src/geo/area.ts", "@@ -77,7 +77,7 @@", " row 77", " row 78", " row 79", "-row 80", "+row 80 edited", " row 81", " row 82", " row 83"].join("\n");
    render(viewer({ diff: longDiff, content: long.join("\n"), counts: { add: 1, del: 1 }, comments: new Map([["new:30", thread("new", 30)]]) }));
    for (const layout of [unified, split]) {
      layout();
      expect(body().querySelector('tr[data-line="30"] .fv-cmbtn')).toHaveAccessibleName("1 comment on line 30");
      for (const n of [27, 28, 29, 31, 32, 33]) expect(body().querySelector(`tr[data-line="${n}"]`)).not.toBeNull();
      for (const n of [1, 26, 34, 76]) expect(body().querySelector(`tr[data-line="${n}"]`)).toBeNull();
      // Lines 1–26 and 34–76 are still folds, each expandable on its own; 84–100 is the trailing one.
      const folds = [...body().querySelectorAll(".fv-fold-row button")].map((b) => b.textContent);
      expect(folds).toEqual(["⋯ Expand 26 unchanged lines", "⋯ Expand 43 unchanged lines", "⋯ Expand 17 unchanged lines"]);
    }
    unified();
    fireEvent.click(screen.getByRole("button", { name: "⋯ Expand 26 unchanged lines" }));
    expect(body().querySelector('tr[data-line="1"]')).not.toBeNull();
    expect(body().querySelector('tr[data-line="34"]')).toBeNull();
  });

  // Thousands of mounted rows: slow when the whole suite shares the machine, hence the timeout.
  it("FileViewer keeps a far edit within the rendered rows when a comment sits in the leading fold", () => {
    const n = 6100;
    const long = Array.from({ length: n }, (_, i) => `row ${i + 1}`);
    long[6000] = "row 6001 edited";
    const farDiff = ["--- a/src/geo/area.ts", "+++ b/src/geo/area.ts", "@@ -5998,7 +5998,7 @@", " row 5998", " row 5999", " row 6000", "-row 6001", "+row 6001 edited", " row 6002", " row 6003", " row 6004"].join("\n");
    const comments = new Map([
      ["new:10", thread("new", 10)],
      ["new:6001", thread("new", 6001)],
    ]);
    render(viewer({ diff: farDiff, content: long.join("\n"), counts: { add: 1, del: 1 }, comments }));
    unified();
    expect(body().querySelector('tr[data-line="10"] .fv-cmbtn')).toHaveAccessibleName("1 comment on line 10");
    expect(body().querySelector('tr[data-line="6001"] .fv-cmbtn')).toHaveAccessibleName("1 comment on line 6001");
    expect(screen.queryByTestId("file-viewer-more")).toBeNull();
    expect(screen.queryByTestId("file-viewer-unplaced")).toBeNull();
    expect(screen.queryByTestId("file-viewer-beyond")).toBeNull();
  }, 30_000);

  // Thousands of mounted rows: slow when the whole suite shares the machine, hence the timeout.
  it("FileViewer lists threads on rows past the rendered limit until those rows are shown", () => {
    // A new file of 6000 lines: every row is an addition, so nothing folds and rows past 5000 wait for "Show more".
    const lines = Array.from({ length: 6000 }, (_, i) => `row ${i + 1}`);
    const added = ["--- /dev/null", "+++ b/src/geo/area.ts", "@@ -0,0 +1,6000 @@", ...lines.map((l) => `+${l}`)].join("\n");
    const comments = new Map([
      ["new:10", thread("new", 10)],
      ["new:5500", thread("new", 5500, 2)],
    ]);
    render(viewer({ diff: added, content: lines.join("\n"), status: "A", counts: { add: 6000, del: 0 }, comments }));
    for (const layout of [unified, split]) {
      layout();
      expect(body().querySelector('tr[data-line="5500"]')).toBeNull();
      const note = screen.getByTestId("file-viewer-beyond");
      expect(note).toHaveTextContent("On lines further down:");
      expect([...note.querySelectorAll("button.fv-cmbtn")].map((b) => b.getAttribute("aria-label"))).toEqual(["2 comments on line 5500"]);
      expect(screen.queryByTestId("file-viewer-unplaced")).toBeNull();
      expect(body().querySelector('tr[data-line="10"] .fv-cmbtn')).toHaveAccessibleName("1 comment on line 10");
    }
    fireEvent.click(screen.getByTestId("file-viewer-more"));
    expect(body().querySelector('tr[data-line="5500"] .fv-cmbtn')).toHaveAccessibleName("2 comments on line 5500");
    expect(screen.queryByTestId("file-viewer-beyond")).toBeNull();
  }, 30_000);

  it("FileViewer lists threads whose lines the diff leaves out above the table, in unified and split", () => {
    // No whole file and no context lines: line 13 and old line 30 have no row to carry a marker.
    const bare = ["--- a/src/geo/area.ts", "+++ b/src/geo/area.ts", "@@ -15 +15,2 @@", "-const area = w * h;", "+const area = width * height;", "+line 16"].join("\n");
    const comments = new Map([
      ["new:16", thread("new", 16)],
      ["new:13", thread("new", 13, 2)],
      ["old:30", thread("old", 30)],
    ]);
    render(viewer({ diff: bare, content: undefined, comments }));
    for (const layout of [unified, split]) {
      layout();
      const note = screen.getByTestId("file-viewer-unplaced");
      expect(note).toHaveTextContent("On lines not in this diff:");
      expect(body().firstElementChild).toBe(note);
      const listed = [...note.querySelectorAll("button.fv-cmbtn")].map((b) => b.getAttribute("aria-label"));
      expect(listed).toEqual(["2 comments on line 13", "1 comment on line 30"]);
      // The one on a shown line stays in its row, not in the note.
      expect(body().querySelector('tr[data-line="16"] .fv-cmbtn')).toHaveAccessibleName("1 comment on line 16");
      expect(markers()).toHaveLength(3);
    }
  });

  it("FileViewer shows no unplaced note when every thread has a row", () => {
    render(viewer({ comments: COMMENTS }));
    unified();
    expect(screen.queryByTestId("file-viewer-unplaced")).toBeNull();
    split();
    expect(screen.queryByTestId("file-viewer-unplaced")).toBeNull();
  });

  const playThread16 = () => {
    fireEvent.focus(body().querySelector<HTMLButtonElement>('tr[data-line="16"] .fv-cmbtn')!);
    fireEvent.click(screen.getByRole("button", { name: "Play all comments on line 16" }));
    expect(speech.speakDocument).toHaveBeenCalledWith(expect.objectContaining({ key: "pavilio//pr/gmotyl/pavilio/7/t/160" }));
  };

  it("FileViewer keeps a comment playing when the diff layout changes and its marker remounts", () => {
    render(viewer({ comments: COMMENTS }));
    split();
    playThread16();
    unified();
    expect(body().querySelector('tr[data-line="16"] .fv-cmbtn')).not.toBeNull();
    expect(speech.stopDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(speech.stopDocument).not.toHaveBeenCalled();
  });

  it("FileViewer stops the comment speech it started when it unmounts", () => {
    const { unmount } = render(viewer({ comments: COMMENTS }));
    unified();
    playThread16();
    unmount();
    expect(speech.stopDocument).toHaveBeenCalledWith("pavilio//pr/gmotyl/pavilio/7/t/160");
    expect(speech.stopDocument).toHaveBeenCalledTimes(1);
  });

  it("FileViewer stops the comment speech it started when it shows another file", () => {
    const { rerender } = render(viewer({ comments: COMMENTS }));
    unified();
    playThread16();
    rerender(viewer({ comments: COMMENTS, path: "src/geo/other.ts" }));
    expect(speech.stopDocument).toHaveBeenCalledWith("pavilio//pr/gmotyl/pavilio/7/t/160");
    expect(speech.stopDocument).toHaveBeenCalledTimes(1);
  });
});
