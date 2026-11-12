import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetWikiLinkCardCacheForTests,
  parseCardContent,
  useWikiLinkCard,
  WIKILINK_CARD_MAX_BYTES,
} from "../wikiLinkCard";

describe("parseCardContent", () => {
  it("parseCardContent takes the H1 and the frontmatter description", () => {
    const md = [
      "---",
      "type: source",
      'description: "A relay for Edge TTS on Node 20"',
      "---",
      "",
      "# TTS relay on Node 20",
      "",
      "Some body text.",
    ].join("\n");
    expect(parseCardContent(md)).toEqual({
      title: "TTS relay on Node 20",
      description: "A relay for Edge TTS on Node 20",
    });
  });

  it("parseCardContent falls back to the first prose paragraph", () => {
    const md = [
      "---",
      "type: concept",
      "---",
      "# Resizable pane",
      "",
      "A **pane** that the [user](https://x.test) can _drag_, see [[wiki/concepts/layout-grid]]",
      "and [[wiki/entities/panel|the panel]].",
      "",
      "Second paragraph.",
    ].join("\n");
    const content = parseCardContent(md);
    expect(content.title).toBe("Resizable pane");
    expect(content.description).toBeUndefined();
    expect(content.excerpt).toBe(
      "A pane that the user can drag, see layout-grid and the panel.",
    );
  });

  it("parseCardContent skips a link-only From paragraph", () => {
    const md = [
      "# X",
      "",
      "From [[progress/2026-09-23-x]]",
      "",
      "The real summary.",
    ].join("\n");
    expect(parseCardContent(md).excerpt).toBe("The real summary.");
  });

  it("parseCardContent caps a long excerpt with an ellipsis", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const excerpt = parseCardContent(`# T\n\n${words}\n`).excerpt ?? "";
    expect(excerpt.endsWith("…")).toBe(true);
    const body = excerpt.slice(0, -1);
    expect(body.length).toBeLessThanOrEqual(300);
    // Cut at a word boundary: the kept text is a prefix of whole words.
    expect(words.startsWith(body)).toBe(true);
    expect(words[body.length]).toBe(" ");
  });

  it.each([
    [">", "Folded across two lines."],
    [">-", "Folded across two lines."],
    ["|", "Folded across two lines."],
    ["|+", "Folded across two lines."],
  ])("parseCardContent reads a `description: %s` block scalar", (indicator, expected) => {
    const md = [
      "---",
      `description: ${indicator}`,
      "  Folded across",
      "  two lines.",
      "type: concept",
      "---",
      "# T",
    ].join("\n");
    expect(parseCardContent(md)).toEqual({ title: "T", description: expected });
  });

  it("parseCardContent treats an empty block-scalar description as absent", () => {
    const md = ["---", "description: >", "type: concept", "---", "# T", "", "The excerpt."].join("\n");
    expect(parseCardContent(md)).toEqual({ title: "T", excerpt: "The excerpt." });
  });

  it("parseCardContent does not take a `#` line inside a leading fence as the title", () => {
    const md = ["```sh", "# Example", "echo hi", "```", "", "# Real title", "", "Body."].join("\n");
    expect(parseCardContent(md)).toEqual({ title: "Real title", excerpt: "Body." });
  });

  it("parseCardContent closes a fence only with the opener's char and at least its length", () => {
    const md = [
      "# T",
      "",
      "````md",
      "~~~",
      "Not prose.",
      "```",
      "Still not prose.",
      "````",
      "",
      "The real summary.",
    ].join("\n");
    expect(parseCardContent(md).excerpt).toBe("The real summary.");
  });

  it.each([
    ["a heading", "## Next section"],
    ["a fence", "```"],
    ["a list", "- item"],
    ["a quote", "> quoted"],
    ["a table", "| a | b |"],
    ["a rule", "***"],
  ])("parseCardContent ends the excerpt paragraph at %s", (_, block) => {
    const md = ["# T", "", "First sentence.", block, "Second sentence."].join("\n");
    expect(parseCardContent(md).excerpt).toBe("First sentence.");
  });

  it("parseCardContent tolerates a page without frontmatter or H1", () => {
    expect(parseCardContent("Just a line of prose.")).toEqual({ excerpt: "Just a line of prose." });
    expect(parseCardContent("")).toEqual({});
    expect(() => parseCardContent("---\nbroken: [\n")).not.toThrow();
  });
});

describe("useWikiLinkCard", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    __resetWikiLinkCardCacheForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okResponse = (content: string) =>
    Promise.resolve(new Response(JSON.stringify({ content }), { status: 200 }));

  it("useWikiLinkCard does not fetch until enabled", async () => {
    fetchMock.mockImplementation(() => okResponse("# Page"));
    const { result, rerender } = renderHook(({ enabled }) => useWikiLinkCard("p/wiki/a.md", enabled), {
      initialProps: { enabled: false },
    });
    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/files/read/p/wiki/a.md?maxBytes=${WIKILINK_CARD_MAX_BYTES}`);
    expect(result.current.content).toEqual({ title: "Page" });
  });

  it("useWikiLinkCard fetches a path once per tab", async () => {
    fetchMock.mockImplementation(() => okResponse("# Once"));
    const first = renderHook(() => useWikiLinkCard("p/wiki/b c.md", true));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();

    const second = renderHook(() => useWikiLinkCard("p/wiki/b c.md", true));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(second.result.current.content).toEqual({ title: "Once" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/files/read/p/wiki/b%20c.md?maxBytes=${WIKILINK_CARD_MAX_BYTES}`);
  });

  it("useWikiLinkCard caps the read at 256 KiB", () => {
    expect(WIKILINK_CARD_MAX_BYTES).toBe(256 * 1024);
  });

  it("useWikiLinkCard reads nothing from a too-large page (link label + path only) and does not re-read it", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ content: "", tooLarge: true }), { status: 200 })),
    );
    const first = renderHook(() => useWikiLinkCard("p/wiki/huge#1.md", true));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    expect(first.result.current.content).toEqual({});
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/files/read/p/wiki/huge%231.md?maxBytes=${WIKILINK_CARD_MAX_BYTES}`);
    first.unmount();

    const second = renderHook(() => useWikiLinkCard("p/wiki/huge#1.md", true));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("useWikiLinkCard reports a failed read as error", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("nope", { status: 404 })));
    const { result } = renderHook(() => useWikiLinkCard("p/wiki/missing.md", true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.content).toBeUndefined();
  });
});
