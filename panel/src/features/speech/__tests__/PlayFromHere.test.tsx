import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { makeSpeech, synthMock } from "./speech.harness";
import type { AnswerWaitingPort, SpeechHost } from "../useSpeechHost";

/**
 * The ▶ on a page's blocks, end to end inside one jsdom page: the real
 * markdown renderer, the real toolbar (`ViewerActions`, which owns the bar)
 * and `PagePlayFromHere` (the page adapter over `PlayFromHere`) over the
 * rendered blocks. Only the host is stubbed, as in
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
import { PlayFromHere, playButtonLeft } from "../PlayFromHere";
import { PagePlayFromHere } from "../PagePlayFromHere";
import type { CellSpeechState, SpeechUnit } from "../types";
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

const UNITS = prepare(pageSpeechText(PAGE)).units;

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
        <PagePlayFromHere docKey={docKey} text={text}>
          <MarkdownRenderer content={text} />
        </PagePlayFromHere>
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
  it("hover shows the play button without shifting the block", async () => {
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
    // Only the ▶ shows: the block itself is not highlighted.
    expect(para).not.toHaveAttribute("data-speak-hover");
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
    await waitFor(() => expect(play).not.toHaveAttribute("data-shown"));
  });

  it("the play button stays reachable across the gap between a block and its button", async () => {
    const { container } = render(<Page />);
    const root = container.querySelector<HTMLElement>("[data-play-from-here]")!;
    const para = block(container, "The first example paragraph");
    const play = playOf(container, para)!;

    fireEvent.mouseOver(para);
    expect(play).toHaveAttribute("data-shown");
    // On the way left: over an unmarked container, then out of the page box
    // (the ▶ sits outside it when the page has room on the left).
    fireEvent.mouseOver(root);
    fireEvent.mouseLeave(root);
    expect(play).toHaveAttribute("data-shown");
    // Arriving on the ▶ keeps it, and it can be pressed.
    fireEvent.mouseOver(play);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(play).toHaveAttribute("data-shown");
    fireEvent.click(play);
    expect(stub.host!.speakDocument).toHaveBeenCalled();
  });

  it("the play button hides once the pointer has really left", async () => {
    const { container } = render(<Page />);
    const root = container.querySelector<HTMLElement>("[data-play-from-here]")!;
    const para = block(container, "The first example paragraph");
    const play = playOf(container, para)!;
    fireEvent.mouseOver(para);
    fireEvent.mouseOver(root);
    await waitFor(() => expect(play).not.toHaveAttribute("data-shown"));
  });

  it("shows the play button when focused", () => {
    const { container } = render(<Page />);
    const heading = block(container, "Page title");
    const play = playOf(container, heading)!;
    fireEvent.focus(play);
    expect(play).toHaveAttribute("data-shown");
    fireEvent.blur(play);
    expect(play).not.toHaveAttribute("data-shown");
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

  it("hovering a block outlines its scrubber segment", async () => {
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
    await waitFor(() => expect(segment(unit)).not.toHaveAttribute("data-hint"));

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

  it("a tapped-open play button hides when the pointer leaves the page", async () => {
    const { container } = render(<Page />);
    const item = block(container, "second outer item here");
    const play = playOf(container, item)!;
    fireEvent.click(item);
    expect(play).toHaveAttribute("data-shown");
    fireEvent.mouseLeave(container.querySelector("[data-play-from-here]")!);
    await waitFor(() => expect(play).not.toHaveAttribute("data-shown"));
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

  it("without a doc key the page is not observed for re-marking", () => {
    const Real = globalThis.MutationObserver;
    const observed: Node[] = [];
    vi.stubGlobal(
      "MutationObserver",
      class extends Real {
        observe(target: Node, options?: MutationObserverInit) {
          observed.push(target);
          super.observe(target, options);
        }
      },
    );
    try {
      render(<Page noKey />);
      expect(observed.some((node) => node instanceof Element && node.matches("[data-play-from-here]"))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("with a doc key the page is observed for re-marking", () => {
    const Real = globalThis.MutationObserver;
    const observed: Node[] = [];
    vi.stubGlobal(
      "MutationObserver",
      class extends Real {
        observe(target: Node, options?: MutationObserverInit) {
          observed.push(target);
          super.observe(target, options);
        }
      },
    );
    try {
      render(<Page />);
      expect(observed.some((node) => node instanceof Element && node.matches("[data-play-from-here]"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a Polish page starts at the unit the host prepared, not an English preparation's", () => {
    // A Polish sentence full of images: "obrazek" is longer than "image", so
    // the Polish sentence crosses the unit ceiling and is cut where the English
    // one is not, and every block after it moves by one unit.
    const images = Array.from({ length: 46 }, (_, i) => `![zdjęcie ${i}](a${i}.png)`).join(" ");
    const polish = [
      "# Tytuł strony",
      "",
      `To jest długi akapit o tym, jak działa nasz system i dlaczego warto go poznać. ${images} Następnie opisujemy, co się dzieje dalej w tej części dokumentu, żeby było jasne. Kolejne zdanie jest tutaj, aby akapit był wystarczająco długi.`,
      "",
      "## Następny nagłówek",
      "",
      "Krótki akapit po nagłówku.",
      "",
    ].join("\n");
    // What the host prepares: the page's own vote picks Polish.
    const hostUnits = prepare(pageSpeechText(polish), { language: "pl" }).units;
    const englishUnits = prepare(pageSpeechText(polish)).units;
    const headingOf = (units: typeof hostUnits) => units.findIndex((u) => u.source.includes("Następny nagłówek"));
    expect(headingOf(hostUnits)).not.toBe(headingOf(englishUnits));
    stub.host = makeSpeech({ unitsFor: (key) => (key === KEY ? hostUnits : []) });

    const { container } = render(<Page text={polish} />);
    const heading = block(container, "Następny nagłówek");
    expect(heading).toHaveAttribute("data-speak-unit", String(headingOf(hostUnits)));
    fireEvent.mouseOver(heading);
    fireEvent.click(playOf(container, heading)!);
    expect(stub.host!.speakDocument).toHaveBeenCalledWith({
      key: KEY,
      text: polish,
      startUnit: headingOf(hostUnits),
    });
  });

  it("blocks the markdown remounts with the same text get their play button back", async () => {
    const { container } = render(<Page />);
    const old = block(container, "The second example paragraph");
    const unit = old.getAttribute("data-speak-unit");
    expect(unit).not.toBeNull();

    // What a remount does (a component identity changing under react-markdown):
    // the same text, fresh nodes, none of the marks.
    const fresh = old.cloneNode(true) as HTMLElement;
    for (const attr of ["data-speak-index", "data-speak-unit"]) fresh.removeAttribute(attr);
    act(() => old.replaceWith(fresh));

    await waitFor(() => expect(fresh).toHaveAttribute("data-speak-unit", unit!));
    const play = playOf(container, fresh);
    expect(play).not.toBeNull();
    fireEvent.mouseOver(fresh);
    expect(play).toHaveAttribute("data-shown");
    fireEvent.click(play!);
    expect(stub.host!.speakDocument).toHaveBeenCalledWith({ key: KEY, text: PAGE, startUnit: Number(unit) });
  });

  it("each paragraph of a blockquote gets its own play button", () => {
    const text = "> The first quoted paragraph here.\n>\n> The second quoted paragraph here.\n";
    const { container } = render(<Page text={text} />);

    const first = block(container, "The first quoted paragraph");
    const second = block(container, "The second quoted paragraph");
    expect(playOf(container, first)).not.toBeNull();
    expect(playOf(container, second)).not.toBeNull();
    expect(second.getAttribute("data-speak-unit")).not.toBe(first.getAttribute("data-speak-unit"));
  });

  it("a setext heading and the prose right under it each get a play button", () => {
    const text = "Setext Title Here\n=================\nBody prose right under the title.\n";
    const { container } = render(<Page text={text} />);

    const heading = block(container, "Setext Title Here");
    const body = block(container, "Body prose right under");
    expect(playOf(container, heading)).not.toBeNull();
    expect(playOf(container, body)).not.toBeNull();
    expect(body.getAttribute("data-speak-unit")).not.toBe(heading.getAttribute("data-speak-unit"));
  });

  it("a short setext heading gets its own play button", () => {
    for (const underline of ["=====", "-----"]) {
      const text = `Title\n${underline}\nBody prose right under the short title.\n`;
      const { container, unmount } = render(<Page text={text} />);

      const heading = block(container, "Title");
      const body = block(container, "Body prose right under");
      expect(playOf(container, heading), underline).not.toBeNull();
      expect(playOf(container, body), underline).not.toBeNull();
      expect(body.getAttribute("data-speak-unit"), underline).not.toBe(heading.getAttribute("data-speak-unit"));
      unmount();
    }
  });

  it("a quoted heading and the quoted prose under it each get a play button", () => {
    for (const text of [
      "> ## Quoted\n> Quoted prose right under the quoted heading.\n",
      "> Quoted\n> =====\n> Quoted prose right under the quoted heading.\n",
    ]) {
      const { container, unmount } = render(<Page text={text} />);

      const heading = block(container, "Quoted");
      const body = block(container, "Quoted prose right under");
      expect(heading.tagName, text).toMatch(/^H[12]$/);
      expect(playOf(container, heading), text).not.toBeNull();
      expect(playOf(container, body), text).not.toBeNull();
      expect(body.getAttribute("data-speak-unit"), text).not.toBe(heading.getAttribute("data-speak-unit"));
      unmount();
    }
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

  it("page Play from here wires host progress, pause and play", () => {
    const playing = UNITS.findIndex((u) => u.text.startsWith("The second example paragraph"));
    expect(playing).toBeGreaterThan(0);
    // One object for every read: the toolbar takes the whole progress as an
    // external-store snapshot, and a fresh object per read never settles.
    const progress = Object.freeze({ unitIndex: playing, unitTime: 0, unitDuration: null });
    let state: CellSpeechState = "speaking";
    stub.host = makeSpeech({
      unitsFor: (key) => (key === KEY ? UNITS : []),
      progressFor: (key) => (key === KEY ? progress : null),
      stateFor: (key) => (key === KEY ? state : "empty"),
    });

    const { rerender } = render(<Page />);
    const pinned = () => screen.getByTestId("play-from-here-pinned");
    // The host's progress for the page's key pins the ▶; the run is reading.
    expect(pinned()).toHaveAccessibleName("Pause");
    fireEvent.click(pinned());
    expect(stub.host!.onPause).toHaveBeenCalledWith(KEY);
    expect(stub.host!.speakDocument).not.toHaveBeenCalled();

    // Paused: the same ▶ reads Play and starts the page's run at the unit the
    // voice stopped on, through the toolbar.
    state = "paused";
    rerender(<Page />);
    expect(pinned()).toHaveAccessibleName("Play from here");
    fireEvent.click(pinned());
    expect(stub.host!.speakDocument).toHaveBeenCalledWith({ key: KEY, text: PAGE, startUnit: playing });
    expect(stub.host!.onPause).toHaveBeenCalledTimes(1);
  });

  it("play from here starts at a paragraph ending in wikilink citations", () => {
    const text = [
      "# Wikilink page",
      "",
      "An opening paragraph that comes before the cited one.",
      "",
      // Short prose, then citations: neither match window survives if speech
      // reads the paths while the page renders the short labels.
      "Typing lag ([[wiki/sources/progress-2026-09-23-repos-resize-answer-pane]]; [[wiki/sources/context-snapshot-2026-10-21-speech]])",
      "",
      "A closing paragraph after the cited one.",
      "",
    ].join("\n");
    const units = prepare(pageSpeechText(text)).units;
    const cited = units.findIndex((u) => u.source.startsWith("Typing lag"));
    expect(cited).toBeGreaterThan(0);
    stub.host = makeSpeech({ unitsFor: (key) => (key === KEY ? units : []) });

    const { container } = render(<Page text={text} />);
    const para = block(container, "Typing lag");
    expect(para).toHaveAttribute("data-speak-unit", String(cited));
    fireEvent.mouseOver(para);
    fireEvent.click(playOf(container, para)!);
    expect(stub.host!.speakDocument).toHaveBeenCalledWith({ key: KEY, text, startUnit: cited });
  });

  it("play from here starts at a paragraph ending in a markdown link whose text is a wikilink", () => {
    // `[[x]](url)` is a markdown link with text `[x]`, not a wikilink: the page
    // renders the bracketed name, so speech must read it too — not the short
    // label "repos resize answer pane", which leaves no match window intact.
    const text = [
      "# Link page",
      "",
      "An opening paragraph that comes before the linked one.",
      "",
      "Read [[progress-2026-09-23-repos-resize-answer-pane]](https://example.com)",
      "",
      "A closing paragraph after the linked one.",
      "",
    ].join("\n");
    const units = prepare(pageSpeechText(text)).units;
    const linked = units.findIndex((u) => u.source.startsWith("Read ["));
    expect(linked).toBeGreaterThan(0);
    stub.host = makeSpeech({ unitsFor: (key) => (key === KEY ? units : []) });

    const { container } = render(<Page text={text} />);
    const para = block(container, "Read [");
    expect(para.textContent).toBe("Read [progress-2026-09-23-repos-resize-answer-pane]");
    expect(para).toHaveAttribute("data-speak-unit", String(linked));
  });
});

describe("PlayFromHere on any rendered body", () => {
  // The surface-agnostic layer as the answer pane will use it: units the
  // caller prepared, the host's playing unit, and plain callbacks. No toolbar,
  // no page store.
  const ANSWER = [
    "# Notes",
    "",
    "Alpha opens the first paragraph here.",
    "",
    "Bravo starts the second paragraph. Charlie carries it on to the next line. Delta closes the paragraph.",
    "",
    "```",
    "const code = 1;",
    "```",
    "",
    "Echo is the last paragraph.",
    "",
  ].join("\n");
  const A_UNITS = prepare(ANSWER).units;
  const at = (start: string, units: readonly SpeechUnit[] = A_UNITS) => {
    const index = units.findIndex((u) => u.text.startsWith(start));
    if (index < 0) throw new Error(`no unit ${start}`);
    return index;
  };

  /**
   * jsdom has no layout, so `Range#getClientRects` (absent in jsdom) is
   * stubbed: a range whose text starts with one of `tops`' keys reports one
   * line box at that top. `calls` records every range measured, so a test can
   * prove the stub — not some fallback — placed the ▶.
   */
  function stubLines(tops: Record<string, number>) {
    const calls: string[] = [];
    const proto = Range.prototype as unknown as Record<string, unknown>;
    const had = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value(this: Range) {
        const text = this.toString();
        calls.push(text);
        const key = Object.keys(tops).find((k) => text.startsWith(k));
        if (key === undefined) return [];
        const top = tops[key];
        return [{ top, bottom: top + 22, left: 0, right: 100, width: 100, height: 22, x: 0, y: top }];
      },
    });
    return {
      calls,
      restore() {
        if (had) Object.defineProperty(Range.prototype, "getClientRects", had);
        else delete proto.getClientRects;
      },
    };
  }

  let lines: ReturnType<typeof stubLines>;
  beforeEach(() => {
    lines = stubLines({ Bravo: 50, Charlie: 80, Delta: 110 });
  });
  afterEach(() => {
    lines.restore();
    vi.restoreAllMocks();
  });

  const onPlay = vi.fn();
  const onPause = vi.fn();
  const onHint = vi.fn();
  beforeEach(() => {
    onPlay.mockReset();
    onPause.mockReset();
    onHint.mockReset();
  });

  function Answer({
    playingUnit,
    paused = false,
    units = A_UNITS,
  }: {
    playingUnit: number | null;
    paused?: boolean;
    units?: readonly SpeechUnit[];
  }) {
    return (
      <MemoryRouter>
        <PlayFromHere
          speechKey="session-1"
          units={units}
          playingUnit={playingUnit}
          paused={paused}
          onPlay={onPlay}
          onPause={onPause}
          onHint={onHint}
        >
          <MarkdownRenderer content={ANSWER} />
        </PlayFromHere>
      </MemoryRouter>
    );
  }

  const shown = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button.play-from-here[data-shown]"));
  const pinned = () => screen.getByTestId("play-from-here-pinned");
  const topOf = (el: HTMLElement) => parseFloat(el.style.top);
  /** The ▶ is centred on the line box it is pinned to: its top lands within that line. */
  const onLine = (el: HTMLElement, line: number) => {
    expect(topOf(el)).toBeGreaterThanOrEqual(line);
    expect(topOf(el)).toBeLessThan(line + 22);
  };

  it("pinned play button marks the playing block as Pause", () => {
    const { container } = render(<Answer playingUnit={at("Bravo")} />);
    const visible = shown(container);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toBe(pinned());
    expect(visible[0]).toHaveAccessibleName("Pause");
    expect(lines.calls.some((text) => text.startsWith("Bravo"))).toBe(true);
    onLine(visible[0], 50);
  });

  it("pressing the pinned button pauses; paused it plays from its block", () => {
    const charlie = at("Charlie");
    const { rerender } = render(<Answer playingUnit={charlie} />);
    fireEvent.click(pinned());
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();

    rerender(<Answer playingUnit={charlie} paused />);
    expect(pinned()).toHaveAttribute("data-shown");
    expect(pinned()).toHaveAccessibleName("Play from here");
    fireEvent.click(pinned());
    expect(onPlay).toHaveBeenCalledWith(charlie);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("pinned button follows the playing sentence down a paragraph", () => {
    const { rerender } = render(<Answer playingUnit={at("Bravo")} />);
    onLine(pinned(), 50);
    // Synchronously after the commit — no waiting: the ▶ moves in the same
    // render the playing unit does.
    rerender(<Answer playingUnit={at("Charlie")} />);
    onLine(pinned(), 80);
    rerender(<Answer playingUnit={at("Delta")} />);
    onLine(pinned(), 110);
    expect(lines.calls.some((text) => text.startsWith("Delta"))).toBe(true);
  });

  it("pinned button falls back to the block's first line when the sentence is not found", () => {
    // The playing unit says something the rendered paragraph does not hold.
    const units = A_UNITS.map((u) =>
      u.text.startsWith("Charlie") ? { ...u, text: "Zulu is nowhere in this paragraph." } : u,
    );
    const reached: string[] = [];
    const real = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.tagName === "P" && (this.textContent ?? "").startsWith("Bravo")) {
        reached.push("bravo-paragraph");
        return { top: 200, bottom: 260, left: 0, right: 100, width: 100, height: 60, x: 0, y: 200, toJSON: () => ({}) };
      }
      return real.call(this);
    });

    render(<Answer playingUnit={at("Zulu", units)} units={units} />);
    expect(reached.length).toBeGreaterThan(0);
    onLine(pinned(), 200);
  });

  it("hover still reveals other blocks' play buttons", () => {
    const { container } = render(<Answer playingUnit={at("Charlie")} />);
    // A code block gets no ▶ of its own: only the pinned one is shown.
    fireEvent.mouseOver(container.querySelector("pre")!);
    expect(shown(container)).toEqual([pinned()]);

    const echo = Array.from(container.querySelectorAll<HTMLElement>(".prose p")).find((p) =>
      (p.textContent ?? "").startsWith("Echo"),
    )!;
    fireEvent.mouseOver(echo);
    const visible = shown(container);
    expect(visible).toHaveLength(2);
    expect(visible).toContain(pinned());
    expect(onHint).toHaveBeenLastCalledWith(at("Echo"));
  });
});

describe("playButtonLeft", () => {
  // Positions relative to the page: the text starts at `text`, the nearest
  // clipping box lets a ▶ reach `clip`. The ▶ is 22px wide, 4px off the text.
  it("sits left of the text when there is room", () => {
    expect(playButtonLeft(0, -40)).toBe(-26);
    expect(playButtonLeft(24, -10)).toBe(-2);
  });

  it("goes only as far left as the clipping box allows", () => {
    expect(playButtonLeft(0, -10)).toBe(-10);
    expect(playButtonLeft(24, 0)).toBe(0);
  });

  it("falls back onto the start of the text when there is no room", () => {
    expect(playButtonLeft(0, 0)).toBe(0);
    expect(playButtonLeft(0, 8)).toBe(0);
  });
});
