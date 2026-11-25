import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "../MarkdownRenderer";

vi.mock("../MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

// Fixtures follow the pavilio-pr-explain skill: a numbered `diff` block, then its notes as an
// ordered list, each starting with a bold `**L12**`, `**L27–33**` or `**base L16**` label.
function renderMd(content: string) {
  return render(
    <MemoryRouter>
      <MarkdownRenderer content={content} />
    </MemoryRouter>,
  );
}

function fence(lines: string[]): string {
  return ["```diff", ...lines, "```", ""].join("\n");
}

const BLOCK = fence([
  "@@ panel/src/x.ts L10–14 base L8 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " const d = 5;",
  " const e = 6;",
]);

/** Each lit row as "<gutter number>|<text>" across the whole document. */
function lit(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".story-line-hit")].map(
    (row) => `${row.getAttribute("data-line")}|${(row.textContent ?? "").replace(/\n$/, "")}`,
  );
}

function noteItem(container: HTMLElement, label: string, nth = 0): HTMLElement {
  const items = [...container.querySelectorAll("li")].filter((li) => li.querySelector("strong")?.textContent === label);
  const item = items[nth];
  if (!item) throw new Error(`no note ${label} #${nth}`);
  return item as HTMLElement;
}

describe("MarkdownRenderer line-note highlight", () => {
  it("hovering an L note lights its row and leaving clears it", () => {
    const { container } = renderMd([BLOCK, "1. **L12**: why c.", "2. **L13**: why d.", ""].join("\n"));
    const item = noteItem(container, "L12");
    expect(item.hasAttribute("data-note-target")).toBe(true);
    fireEvent.mouseEnter(item);
    expect(lit(container)).toEqual(["12|+const c = 4;"]);
    fireEvent.mouseLeave(item);
    expect(lit(container)).toEqual([]);
  });

  it("a range lights every row in it", () => {
    const { container } = renderMd([BLOCK, "1. **L11–13**: why.", "2. **L10-11**: why.", ""].join("\n"));
    fireEvent.mouseEnter(noteItem(container, "L11–13"));
    expect(lit(container)).toEqual(["11|+const b = 3;", "12|+const c = 4;", "13| const d = 5;"]);
    fireEvent.mouseLeave(noteItem(container, "L11–13"));
    fireEvent.mouseEnter(noteItem(container, "L10-11"));
    expect(lit(container)).toEqual(["10| const a = 1;", "11|+const b = 3;"]);
  });

  it("base L lights the removed row with that base number", () => {
    const { container } = renderMd([BLOCK, "1. **base L9**: why b had to go.", ""].join("\n"));
    fireEvent.mouseEnter(noteItem(container, "base L9"));
    expect(lit(container)).toEqual(["|-const b = 2;"]);
  });

  it("base L lights the removed row in an unknown-language block", () => {
    const block = fence(["@@ notes/x.zzzunknown L5–6 base L5 @@", " a", "-b", "+c"]);
    const { container } = renderMd([block, "1. **base L6**: why b went.", ""].join("\n"));
    // The whole-line fallback rendering, not the coloured rows.
    expect(container.querySelector(".story-line-sign")).toBeNull();
    fireEvent.mouseEnter(noteItem(container, "base L6"));
    expect(lit(container)).toEqual(["|-b"]);
  });

  it("focusing the label lights its rows", () => {
    const { container } = renderMd([BLOCK, "1. **L10**: why a.", ""].join("\n"));
    const label = noteItem(container, "L10").querySelector("strong")!;
    expect(label.getAttribute("tabindex")).toBe("0");
    fireEvent.focus(label);
    expect(lit(container)).toEqual(["10| const a = 1;"]);
    fireEvent.blur(label);
    expect(lit(container)).toEqual([]);
  });

  it("a note binds only to the block directly above", () => {
    const content = [
      BLOCK,
      "1. **L12**: first block.",
      "",
      fence(["@@ panel/src/y.ts L12 @@", "+const y = 1;"]),
      "1. **L12**: second block.",
      "",
      BLOCK,
      "Some prose in between.",
      "",
      "1. **L12**: not a note.",
      "",
    ].join("\n");
    const { container } = renderMd(content);
    fireEvent.mouseEnter(noteItem(container, "L12", 1));
    expect(lit(container)).toEqual(["12|+const y = 1;"]);
    const rows = [...container.querySelectorAll(".story-line-hit")];
    expect(rows[0]!.closest("pre")).toBe(container.querySelectorAll("pre")[1]);
    fireEvent.mouseLeave(noteItem(container, "L12", 1));

    const unbound = noteItem(container, "L12", 2);
    expect(unbound.hasAttribute("data-note-target")).toBe(false);
    expect(unbound.querySelector("strong")!.hasAttribute("tabindex")).toBe(false);
    fireEvent.mouseEnter(unbound);
    expect(lit(container)).toEqual([]);
  });

  it("a missing line lights nothing", () => {
    const { container } = renderMd([BLOCK, "1. **L99**: not in the block.", "2. Plain note with no label.", "3. **Why** not a label.", ""].join("\n"));
    expect(() => fireEvent.mouseEnter(noteItem(container, "L99"))).not.toThrow();
    expect(lit(container)).toEqual([]);
    const plain = [...container.querySelectorAll("li")][1]!;
    expect(plain.hasAttribute("data-note-target")).toBe(false);
    fireEvent.mouseEnter(plain);
    fireEvent.mouseEnter(noteItem(container, "Why"));
    expect(noteItem(container, "Why").querySelector("strong")!.hasAttribute("tabindex")).toBe(false);
    expect(lit(container)).toEqual([]);
  });

  it("a hovered note that a re-render removes leaves nothing lit", () => {
    const { container, rerender } = renderMd([BLOCK, "1. **L12**: why c.", ""].join("\n"));
    fireEvent.mouseEnter(noteItem(container, "L12"));
    expect(lit(container)).toEqual(["12|+const c = 4;"]);
    rerender(
      <MemoryRouter>
        <MarkdownRenderer content={[BLOCK, "1. Plain note, no label.", ""].join("\n")} />
      </MemoryRouter>,
    );
    expect(lit(container)).toEqual([]);
  });

  it("a loose list (blank lines between items) binds and lights", () => {
    const { container } = renderMd([BLOCK, "1. **L12**: why c.", "", "2. **L13**: why d.", ""].join("\n"));
    const item = noteItem(container, "L13");
    expect(item.querySelector("p > strong")).not.toBeNull();
    expect(item.hasAttribute("data-note-target")).toBe(true);
    fireEvent.mouseEnter(item);
    expect(lit(container)).toEqual(["13| const d = 5;"]);
  });

  it("story blocks carry no node attribute", () => {
    const { container } = renderMd([BLOCK, "1. **L12**: why c.", ""].join("\n"));
    const pre = container.querySelector("pre")!;
    expect(pre.querySelector(".diff-line")).not.toBeNull();
    expect(pre.hasAttribute("node")).toBe(false);
    expect(pre.querySelector("code")!.hasAttribute("node")).toBe(false);
  });
});
