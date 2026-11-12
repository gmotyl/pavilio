import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "../MarkdownRenderer";
import { __resetWikiLinkCardCacheForTests } from "../wikiLinkCard";

vi.mock("../MermaidDiagram", () => ({
  default: () => null,
}));

const BASE = "pavilio/wiki/concepts/utterance.md";
const TARGET = "pavilio/wiki/sources/progress-2026-09-23-repos-resize-answer-pane.md";
const LINK_MD = "See [[wiki/sources/progress-2026-09-23-repos-resize-answer-pane]] for details.";
const LABEL = "repos resize answer pane";
const PAGE = [
  "---",
  "description: How the answer pane, speech bar and Repos tab learned to resize.",
  "---",
  "# Answer pane, speech bar and Repos tab resize (2026-09-23)",
  "",
  "Body text.",
].join("\n");

/** Paths the mocked `POST /api/files/exists` reports as present. */
let existing = new Set<string>();
/** Bodies the mocked `GET /api/files/read/<path>` answers with; anything else is a 404. */
let pages = new Map<string, string>();

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === "/api/files/exists") {
    const { paths } = JSON.parse(String(init?.body ?? "{}")) as { paths: string[] };
    const exists = Object.fromEntries(paths.map((p) => [p, existing.has(p)]));
    return new Response(JSON.stringify({ exists }), { status: 200 });
  }
  const path = decodeURIComponent(url.replace(/^\/api\/files\/read\//, ""));
  const content = pages.get(path);
  if (content === undefined) return new Response("{}", { status: 404 });
  return new Response(JSON.stringify({ content }), { status: 200 });
});

function readCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/files/read/"));
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderMd(content: string) {
  return render(
    <MemoryRouter initialEntries={["/start"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <MarkdownRenderer content={content} basePath={BASE} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Advance fake time and let the resulting promises (fetch, json) settle inside act. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function link() {
  return screen.getByRole("link", { name: LABEL });
}

function hover(el: Element, pointerType = "mouse") {
  fireEvent.pointerEnter(el, { pointerType });
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetWikiLinkCardCacheForTests();
  existing = new Set([TARGET]);
  pages = new Map([[TARGET, PAGE]]);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WikiLinkHoverCard", () => {
  it("opens the card after 400 ms with title, path and description", async () => {
    renderMd(LINK_MD);
    const href = link().getAttribute("href");
    hover(link());
    await advance(399);
    expect(screen.queryByRole("tooltip")).toBeNull();
    await advance(1);
    await advance(0);

    const card = screen.getByRole("tooltip");
    expect(card.textContent).toContain("Answer pane, speech bar and Repos tab resize (2026-09-23)");
    expect(card.textContent).toContain(TARGET);
    expect(card.textContent).toContain("How the answer pane, speech bar and Repos tab learned to resize.");
    expect(link().getAttribute("aria-describedby")).toBe(card.id);
    // The anchor keeps its own attributes.
    expect(link().getAttribute("data-wikilink")).toBe(TARGET);
    expect(link().getAttribute("href")).toBe(href);
  });

  it("does not open or fetch when the pointer leaves early", async () => {
    renderMd(LINK_MD);
    hover(link());
    await advance(200);
    fireEvent.pointerLeave(link(), { pointerType: "mouse" });
    await advance(1000);

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(readCalls()).toHaveLength(0);
  });

  it("keeps the card open while the pointer is over it", async () => {
    renderMd(LINK_MD);
    hover(link());
    await advance(400);
    const card = screen.getByRole("tooltip");

    fireEvent.pointerLeave(link(), { pointerType: "mouse" });
    await advance(100);
    hover(card);
    await advance(500);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("closes on leave and on Escape", async () => {
    renderMd(LINK_MD);
    hover(link());
    await advance(400);
    const card = screen.getByRole("tooltip");
    hover(card);
    fireEvent.pointerLeave(card, { pointerType: "mouse" });
    await advance(149);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    await advance(1);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(link().hasAttribute("aria-describedby")).toBe(false);

    hover(link());
    await advance(400);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    // The pointer still rests on the link: no timer reopens the card.
    await advance(1000);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on keyboard focus", async () => {
    renderMd(LINK_MD);
    act(() => link().focus());
    expect(screen.getByRole("tooltip")).toBeTruthy();
    await advance(0);
    expect(screen.getByRole("tooltip").textContent).toContain(
      "Answer pane, speech bar and Repos tab resize (2026-09-23)",
    );

    act(() => link().blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("ignores touch pointers", async () => {
    renderMd(LINK_MD);
    const a = link();
    const href = a.getAttribute("href") ?? "";
    // The real touch tap order: pointerup comes before the focus.
    hover(a, "touch");
    fireEvent.pointerDown(a, { pointerType: "touch" });
    fireEvent.pointerUp(a, { pointerType: "touch" });
    act(() => a.focus());
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(a);
    await advance(1000);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(readCalls()).toHaveLength(0);

    // Navigates as before: the in-app route the anchor points at.
    expect(href).not.toBe("");
    expect(screen.getByTestId("location").textContent).toBe(href.split("?")[0]);
  });

  it("renders no card for a missing wikilink", async () => {
    existing = new Set();
    renderMd(LINK_MD);
    // Let the debounced existence check answer.
    await advance(300);
    await advance(0);

    const span = screen.getByText(LABEL);
    expect(span.tagName).toBe("SPAN");
    expect(span.getAttribute("title")).toBe(`Missing: ${TARGET}`);
    hover(span);
    await advance(1000);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(readCalls()).toHaveLength(0);
  });

  it("shows only the path when the read fails", async () => {
    pages = new Map();
    renderMd(LINK_MD);
    hover(link());
    await advance(400);
    await advance(0);

    const card = screen.getByRole("tooltip");
    expect(readCalls()).toHaveLength(1);
    expect(card.textContent).toBe(TARGET);
  });

  it("stays open on blur while the pointer is over the card", async () => {
    // A mousedown inside the (non-focusable) card blurs the focused link; the
    // pointer timers own closing then, so the path can still be selected.
    renderMd(LINK_MD);
    act(() => link().focus());
    const card = screen.getByRole("tooltip");
    hover(card);
    act(() => link().blur());
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.pointerLeave(card, { pointerType: "mouse" });
    await advance(149);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    await advance(1);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("Escape closes only the card, never an outer Escape owner", async () => {
    const outer = { window: vi.fn(), document: vi.fn(), react: vi.fn() };
    window.addEventListener("keydown", outer.window);
    document.addEventListener("keydown", outer.document);
    try {
      render(
        <MemoryRouter>
          <div onKeyDown={outer.react}>
            <MarkdownRenderer content={LINK_MD} basePath={BASE} />
          </div>
        </MemoryRouter>,
      );
      // Hover-opened: focus is elsewhere.
      hover(link());
      await advance(400);
      expect(screen.getByRole("tooltip")).toBeTruthy();
      const onBody = fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onBody).toBe(false); // default prevented
      expect(screen.queryByRole("tooltip")).toBeNull();

      // Keyboard-opened: the key starts on the focused link.
      act(() => link().focus());
      expect(screen.getByRole("tooltip")).toBeTruthy();
      fireEvent.keyDown(link(), { key: "Escape" });
      expect(screen.queryByRole("tooltip")).toBeNull();

      expect(outer.window).not.toHaveBeenCalled();
      expect(outer.document).not.toHaveBeenCalled();
      expect(outer.react).not.toHaveBeenCalled();

      // With no card open, Escape is the outer owners' again.
      fireEvent.keyDown(link(), { key: "Escape" });
      expect(outer.react).toHaveBeenCalledTimes(1);
      expect(outer.window).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", outer.window);
      document.removeEventListener("keydown", outer.document);
    }
  });

  it("opens on keyboard focus after a touch tap that did not focus the link", () => {
    // iOS Safari does not focus links on tap; the click ends the press.
    renderMd(LINK_MD);
    fireEvent.pointerDown(link(), { pointerType: "touch" });
    fireEvent.pointerUp(link(), { pointerType: "touch" });
    fireEvent.click(link());
    act(() => link().focus());
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it.each([
    ["a textarea", "textarea"],
    ["an input", "input"],
    ["an xterm cell", "xterm"],
    ["a contenteditable", "contenteditable"],
  ])("Escape typed in %s closes the card without consuming the key", async (_, kind) => {
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    try {
      render(
        <MemoryRouter>
          <MarkdownRenderer content={LINK_MD} basePath={BASE} />
          {kind === "textarea" && <textarea data-testid="editor" />}
          {kind === "input" && <input data-testid="editor" />}
          {kind === "xterm" && (
            <div className="xterm">
              <textarea data-testid="editor" />
            </div>
          )}
          {kind === "contenteditable" && (
            <div contentEditable suppressContentEditableWarning>
              <span data-testid="editor">text</span>
            </div>
          )}
        </MemoryRouter>,
      );
      const editor = screen.getByTestId("editor");
      act(() => editor.focus());
      // Opened by the mouse resting on the link while focus is in the editor.
      hover(link());
      await advance(400);
      expect(screen.getByRole("tooltip")).toBeTruthy();

      const notPrevented = fireEvent.keyDown(editor, { key: "Escape" });
      expect(notPrevented).toBe(true);
      expect(outer).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      window.removeEventListener("keydown", outer);
    }
  });

  it("pointer events on the card do not bubble to React ancestors", async () => {
    const outer = { mouseOver: vi.fn(), click: vi.fn(), pointerDown: vi.fn() };
    render(
      <MemoryRouter>
        <div onMouseOver={outer.mouseOver} onClick={outer.click} onPointerDown={outer.pointerDown}>
          <MarkdownRenderer content={LINK_MD} basePath={BASE} />
        </div>
      </MemoryRouter>,
    );
    hover(link());
    await advance(400);
    const card = screen.getByRole("tooltip");
    fireEvent.mouseOver(card);
    fireEvent.pointerDown(card, { pointerType: "mouse" });
    fireEvent.click(card);
    expect(outer.mouseOver).not.toHaveBeenCalled();
    expect(outer.pointerDown).not.toHaveBeenCalled();
    expect(outer.click).not.toHaveBeenCalled();
  });

  it("opens on a later keyboard focus after a pointer-caused focus and blur", () => {
    renderMd(LINK_MD);
    fireEvent.pointerDown(link(), { pointerType: "mouse" });
    act(() => link().focus());
    fireEvent.pointerUp(link(), { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => link().blur());

    act(() => link().focus());
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("opens on keyboard focus after a click that did not focus the link", () => {
    // Safari and Firefox on macOS do not focus links on click.
    renderMd(LINK_MD);
    fireEvent.pointerDown(link(), { pointerType: "mouse" });
    fireEvent.pointerUp(link(), { pointerType: "mouse" });
    act(() => link().focus());
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("a leave cancels the pending open", async () => {
    renderMd(LINK_MD);
    hover(link());
    await advance(300);
    fireEvent.pointerLeave(link(), { pointerType: "mouse" });
    // Past the open delay, still inside the close delay: only a cleared open
    // timer keeps the card shut here.
    await advance(120);
    expect(screen.queryByRole("tooltip")).toBeNull();
    await advance(1000);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(readCalls()).toHaveLength(0);
  });

  it("falls back to the link's label as the title when the page has no H1", async () => {
    pages = new Map([[TARGET, "---\ndescription: No heading here.\n---\nBody text.\n"]]);
    renderMd(LINK_MD);
    hover(link());
    await advance(400);
    await advance(0);

    const card = screen.getByRole("tooltip");
    expect(card.firstElementChild?.textContent).toBe(LABEL);
    expect(card.textContent).toContain("No heading here.");
  });

  it("does not attach a card to plain markdown links", async () => {
    renderMd("A [plain link](other.md) here.");
    const a = screen.getByRole("link", { name: "plain link" });
    hover(a);
    await advance(1000);
    act(() => a.focus());
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(a.hasAttribute("aria-describedby")).toBe(false);
    expect(readCalls()).toHaveLength(0);
  });
});
