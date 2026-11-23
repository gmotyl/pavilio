import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewComment } from "../../../../../server/lib/prs/provider";
import type { ReviewThread } from "../../reviewThreads";

vi.mock("../../../speech/SpeechHostProvider", () => ({ usePageSpeech: () => ({ speakDocument: vi.fn() }) }));

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
});
