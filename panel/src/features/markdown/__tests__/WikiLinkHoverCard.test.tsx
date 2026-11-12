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
    hover(a, "touch");
    fireEvent.pointerDown(a, { pointerType: "touch" });
    act(() => a.focus());
    await advance(1000);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(readCalls()).toHaveLength(0);

    fireEvent.click(a);
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
