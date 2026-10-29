import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { makeSpeech, synthMock } from "./speech.harness";
import type { AnswerWaitingPort, SpeechHost } from "../useSpeechHost";

/**
 * The ▶ on a page's blocks, end to end inside one jsdom page: the real
 * markdown renderer, the real toolbar (`ViewerActions`, which owns the bar)
 * and `PlayFromHere` over the rendered blocks. Only the host is stubbed, as in
 * `ViewerActions.speech.test.tsx`: its `speakDocument` and `onJumpToUnit` are
 * the spies, its `unitsFor` hands the bar the page's prepared units.
 */
const stub = vi.hoisted(() => ({ host: null as SpeechHost | null }));

vi.mock("../synth", () => synthMock());
vi.mock("../useSpeechHost", () => {
  const useSpeechHost = () => stub.host;
  return { useSpeechHost, default: useSpeechHost };
});
vi.mock("../useMediaSessionTransport", () => ({ useMediaSessionTransport: () => {} }));
vi.mock("../useSpeechKeys", () => ({ useSpeechKeys: () => {} }));
vi.mock("../../shell/vscode", () => ({ openInVSCode: vi.fn() }));
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: () => <div data-testid="mermaid">diagram</div>,
}));

import { SpeechHostProvider } from "../SpeechHostProvider";
import ViewerActions from "../../projects/ViewerActions";
import MarkdownRenderer from "../../markdown/MarkdownRenderer";
import { PlayFromHere } from "../PlayFromHere";
import { prepare } from "../prepare";
import { pageSpeechText } from "../pageText";

const KEY = "doc:pavilio/wiki/page.md";

const answerWaiting: AnswerWaitingPort = {
  get: () => ({ waiting: false, pending: false }),
  hold: () => {},
  release: () => {},
  noteTransport: () => {},
  isHeld: () => false,
};

function Host({ children }: { children: ReactNode }) {
  return (
    <SpeechHostProvider
      sessionOf={() => undefined}
      isSessionOpen={() => false}
      focusedCell={{ read: () => null, readStandalone: () => null, subscribe: () => () => {} }}
      drawerVisible={false}
      onArrival={() => {}}
      answerWaiting={answerWaiting}
      voiceFor={() => "a-voice"}
    >
      {children}
    </SpeechHostProvider>
  );
}

const LONG_SENTENCE =
  "This sentence is here to make the paragraph long enough that block-bounded packing has to cut it into more than one unit at a sentence boundary.";

const PAGE = [
  "# Page title",
  "",
  "## Example",
  "",
  "The first example paragraph says something about the first case.",
  "",
  "## Example",
  "",
  "The second example paragraph says something about the second case.",
  "",
  "- outer item of the list",
  "  - nested child item one",
  "  - nested child item two",
  "- second outer item here",
  "",
  "1. loose first paragraph of the item",
  "",
  "   loose second paragraph of the item",
  "",
  "2. next loose item of the list",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "```mermaid",
  "graph TD; A-->B",
  "```",
  "",
  "| col a | col b |",
  "|---|---|",
  "| cell one | cell two |",
  "",
  `${LONG_SENTENCE} ${LONG_SENTENCE} ${LONG_SENTENCE} ${LONG_SENTENCE}`,
  "",
  "Read the guide at https://example.com/a/very/long/path/to/somewhere before you continue to the end.",
  "",
  "`const veryLongExpression = something.else.entirely(withArguments, andMore)` sits in the middle here `const anotherVeryLongExpression = other.thing.entirely(withArgs)`",
  "",
].join("\n");

const UNITS = prepare(pageSpeechText(PAGE), { blockBounded: true }).units;

/** The first unit whose source is exactly `source`, from `from` on. */
function unitOf(source: string, from = 0): number {
  const index = UNITS.findIndex((u, i) => i >= from && u.source.replace(/\.$/, "") === source);
  if (index < 0) throw new Error(`no unit for ${source}`);
  return index;
}

function Page({ text = PAGE, noKey = false }: { text?: string; noKey?: boolean }) {
  const docKey = noKey ? undefined : KEY;
  return (
    <MemoryRouter>
      <Host>
        <ViewerActions
          absolutePath="/x/page.md"
          relativePath="projects/pavilio/wiki/page.md"
          content={text}
          speech={docKey ? { key: docKey, text } : undefined}
        />
        <PlayFromHere docKey={docKey} text={text}>
          <MarkdownRenderer content={text} />
        </PlayFromHere>
      </Host>
    </MemoryRouter>
  );
}

/** Every rendered heading, paragraph and list item, in page order. */
function blocks(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".prose h1, .prose h2, .prose h3, .prose p, .prose li"));
}

/** The rendered block whose own text starts with `text`, in page order (`nth` for repeats). */
function block(container: HTMLElement, text: string, nth = 0): HTMLElement {
  const found = blocks(container).filter((el) => {
    // A loose item is found through its paragraphs.
    if (el.tagName === "LI" && Array.from(el.children).some((c) => c.tagName === "P")) return false;
    const own = Array.from(el.childNodes)
      .filter((n) => !(n instanceof HTMLElement && (n.tagName === "UL" || n.tagName === "OL")))
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
    return own.startsWith(text);
  });
  if (!found[nth]) throw new Error(`no block ${text}`);
  return found[nth];
}

function playOf(container: HTMLElement, el: HTMLElement): HTMLButtonElement | null {
  const index = el.getAttribute("data-speak-index");
  if (index === null) return null;
  return container.querySelector<HTMLButtonElement>(`button[data-speak-index="${index}"]`);
}

const segment = (index: number) => screen.getByTestId(`speech-bar-segment-${KEY}-${index}`);
const bar = () => screen.queryByTestId(`document-speech-bar-${KEY}`);

beforeEach(() => {
  stub.host = makeSpeech({ unitsFor: (key) => (key === KEY ? UNITS : []) });
});

afterEach(() => {
  stub.host = null;
});

describe("PlayFromHere", () => {
  it("hover shows the play button without shifting the block", () => {
    const { container } = render(<Page />);
    const para = block(container, "The first example paragraph");
    const play = playOf(container, para)!;
    expect(play).not.toBeNull();
    expect(play).toHaveAccessibleName("Play from here");
    expect(play).not.toHaveAttribute("data-shown");
    // The ▶ is never inside the block: it lives in an overlay layer, so the
    // block's own content — and with it the text's position — is untouched.
    expect(para.contains(play)).toBe(false);
    expect(play.style.position).toBe("absolute");

    const style = getComputedStyle(para);
    const before = {
      padding: style.padding,
      margin: style.margin,
      paddingLeft: style.paddingLeft,
      marginLeft: style.marginLeft,
      rect: JSON.stringify(para.getBoundingClientRect()),
      html: para.innerHTML,
    };

    fireEvent.mouseOver(para);

    expect(play).toHaveAttribute("data-shown");
    expect(para).toHaveAttribute("data-speak-hover");
    const after = getComputedStyle(para);
    expect({
      padding: after.padding,
      margin: after.margin,
      paddingLeft: after.paddingLeft,
      marginLeft: after.marginLeft,
      rect: JSON.stringify(para.getBoundingClientRect()),
      html: para.innerHTML,
    }).toEqual(before);

    // Moving onto the ▶ itself keeps it shown; leaving the page hides it.
    fireEvent.mouseOver(play);
    expect(play).toHaveAttribute("data-shown");
    fireEvent.mouseLeave(container.querySelector("[data-play-from-here]")!);
    expect(play).not.toHaveAttribute("data-shown");
    expect(para).not.toHaveAttribute("data-speak-hover");
  });

  it("shows the play button when focused", () => {
    const { container } = render(<Page />);
    const heading = block(container, "Page title");
    const play = playOf(container, heading)!;
    fireEvent.focus(play);
    expect(play).toHaveAttribute("data-shown");
    expect(heading).toHaveAttribute("data-speak-hover");
    fireEvent.blur(play);
    expect(heading).not.toHaveAttribute("data-speak-hover");
  });

  it("every heading, paragraph and list item gets a play button", () => {
    const { container } = render(<Page />);
    const speakable = [
      block(container, "Page title"),
      block(container, "Example", 0),
      block(container, "The first example paragraph"),
      block(container, "Example", 1),
      block(container, "The second example paragraph"),
      block(container, "outer item of the list"),
      block(container, "nested child item one"),
      block(container, "nested child item two"),
      block(container, "second outer item here"),
      block(container, "loose first paragraph"),
      block(container, "loose second paragraph"),
      block(container, "next loose item"),
      block(container, "This sentence is here"),
      block(container, "Read the guide at"),
    ];
    for (const el of speakable) {
      expect(el, el.textContent ?? "").toHaveAttribute("data-speak-unit");
      expect(playOf(container, el), el.textContent ?? "").not.toBeNull();
    }
    // One ▶ per speakable block, no more: a loose item is its paragraphs,
    // never the item AND its paragraphs.
    expect(screen.getAllByRole("button", { name: "Play from here" })).toHaveLength(speakable.length);
  });

  it("code, mermaid and tables get no play button", () => {
    const { container } = render(<Page />);
    for (const selector of ["pre", "table", ".mermaid-block"]) {
      const el = container.querySelector<HTMLElement>(`.prose ${selector}`);
      expect(el, selector).not.toBeNull();
      expect(el!.querySelector("[data-speak-unit]"), selector).toBeNull();
      expect(el!.hasAttribute("data-speak-unit")).toBe(false);
    }
  });

  it("repeated heading text maps in page order", () => {
    const { container } = render(<Page />);
    const first = unitOf("## Example");
    const second = unitOf("## Example", first + 1);
    expect(second).toBeGreaterThan(first);
    expect(block(container, "Example", 0)).toHaveAttribute("data-speak-unit", String(first));
    expect(block(container, "Example", 1)).toHaveAttribute("data-speak-unit", String(second));
  });

  it("a nested list maps each item to its own unit", () => {
    const { container } = render(<Page />);
    expect(block(container, "outer item of the list")).toHaveAttribute(
      "data-speak-unit",
      String(unitOf("outer item of the list")),
    );
    expect(block(container, "nested child item one")).toHaveAttribute(
      "data-speak-unit",
      String(unitOf("nested child item one")),
    );
    expect(block(container, "nested child item two")).toHaveAttribute(
      "data-speak-unit",
      String(unitOf("nested child item two")),
    );
    // A loose item is its paragraphs: the item itself carries no ▶.
    const loose = block(container, "loose first paragraph").closest("li")!;
    expect(loose).not.toHaveAttribute("data-speak-unit");
  });

  it("a paragraph with an inline transform matches by its intact end; transforms at both ends get none", () => {
    const { container } = render(<Page />);
    const linked = UNITS.findIndex((u) => u.source.startsWith("Read the guide at"));
    expect(UNITS[linked].source).toContain("⟦");
    expect(block(container, "Read the guide at")).toHaveAttribute("data-speak-unit", String(linked));
    // Opens and closes with a long code span: neither window survives.
    const both = Array.from(container.querySelectorAll<HTMLElement>(".prose p")).find((p) =>
      (p.textContent ?? "").includes("sits in the middle here"),
    )!;
    expect(both).not.toHaveAttribute("data-speak-unit");
    expect(playOf(container, both)).toBeNull();
  });

  it("hovering a block outlines its scrubber segment", () => {
    const { container } = render(<Page />);
    fireEvent.click(screen.getByTestId("file-viewer-play"));
    expect(bar()).not.toBeNull();

    const para = block(container, "The second example paragraph");
    const unit = Number(para.getAttribute("data-speak-unit"));
    expect(segment(unit)).not.toHaveAttribute("data-hint");

    fireEvent.mouseOver(para);
    expect(segment(unit)).toHaveAttribute("data-hint");
    expect(container.querySelectorAll("[data-hint]")).toHaveLength(1);

    fireEvent.mouseLeave(container.querySelector("[data-play-from-here]")!);
    expect(segment(unit)).not.toHaveAttribute("data-hint");

    // The segments stay clickable as today.
    fireEvent.click(segment(2));
    expect(stub.host!.onJumpToUnit).toHaveBeenCalledWith(KEY, 2);
  });

  it("pressing play starts at the block's first unit and unfolds the bar", () => {
    const { container } = render(<Page />);
    expect(bar()).toBeNull();

    // A paragraph cut into several units: its ▶ starts at the first of them.
    const long = block(container, "This sentence is here");
    const firstOfLong = UNITS.findIndex((u) => u.source.startsWith("This sentence is here"));
    const units = UNITS.map((u, i) => (u.block === UNITS[firstOfLong].block ? i : -1)).filter((i) => i >= 0);
    expect(units.length).toBeGreaterThan(1);
    expect(long).toHaveAttribute("data-speak-unit", String(units[0]));

    fireEvent.mouseOver(long);
    fireEvent.click(playOf(container, long)!);

    expect(stub.host!.speakDocument).toHaveBeenCalledWith({ key: KEY, text: PAGE, startUnit: units[0] });
    expect(bar()).not.toBeNull();
    expect(screen.getByTestId("file-viewer-play")).toHaveAccessibleName("Stop");

    // Pressed again on another block while unfolded: jumps there, bar stays.
    const heading = block(container, "Example", 1);
    fireEvent.mouseOver(heading);
    fireEvent.click(playOf(container, heading)!);
    expect(stub.host!.speakDocument).toHaveBeenLastCalledWith({
      key: KEY,
      text: PAGE,
      startUnit: Number(heading.getAttribute("data-speak-unit")),
    });
    expect(bar()).not.toBeNull();
    expect(stub.host!.stopDocument).not.toHaveBeenCalled();
  });

  it("a tap reveals the play button on touch", () => {
    const { container } = render(<Page />);
    const item = block(container, "second outer item here");
    const play = playOf(container, item)!;
    // Hidden, so it cannot take the first tap.
    expect(play).not.toHaveAttribute("data-shown");

    fireEvent.click(item);
    expect(play).toHaveAttribute("data-shown");
    expect(stub.host!.speakDocument).not.toHaveBeenCalled();

    fireEvent.click(play);
    expect(stub.host!.speakDocument).toHaveBeenCalledWith({
      key: KEY,
      text: PAGE,
      startUnit: unitOf("second outer item here"),
    });
    expect(bar()).not.toBeNull();
  });

  it("without a doc key no block gets a play button", () => {
    const { container } = render(<Page noKey />);
    expect(screen.queryAllByRole("button", { name: "Play from here" })).toHaveLength(0);
    expect(container.querySelector("[data-speak-unit]")).toBeNull();
  });

  it("a new text remaps the blocks", () => {
    const { container, rerender } = render(<Page />);
    expect(screen.getAllByRole("button", { name: "Play from here" }).length).toBeGreaterThan(2);
    act(() => {
      rerender(<Page text={"# Only heading here\n\nOnly paragraph of the page.\n"} />);
    });
    expect(screen.getAllByRole("button", { name: "Play from here" })).toHaveLength(2);
    expect(block(container, "Only paragraph")).toHaveAttribute("data-speak-unit", "1");
  });
});
