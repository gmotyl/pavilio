import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "../MarkdownRenderer";

vi.mock("../MermaidDiagram", () => ({
  default: () => null,
}));

const BASE = "pavilio/wiki/concepts/utterance.md";

/** Paths the mocked `POST /api/files/exists` reports as present. */
let existing = new Set<string>();
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  const { paths } = JSON.parse(String(init?.body ?? "{}")) as { paths: string[] };
  const exists = Object.fromEntries(paths.map((p) => [p, existing.has(p)]));
  return new Response(JSON.stringify({ exists }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

function renderMd(content: string, basePath = BASE) {
  return render(
    <MemoryRouter>
      <MarkdownRenderer content={content} basePath={basePath} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  existing = new Set();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MarkdownRenderer wikilinks", () => {
  it("renders a project-root wikilink as a viewer link", async () => {
    existing.add("pavilio/progress/2026-10-19-tts-relay-node20.md");
    renderMd("See [[progress/2026-10-19-tts-relay-node20]] for details.");

    const link = screen.getByRole("link", { name: "progress/2026-10-19-tts-relay-node20" });
    expect(link.getAttribute("href")).toBe("/view/pavilio/progress/2026-10-19-tts-relay-node20.md");

    // The existence check ran for the owning project's path and kept the link.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/files/exists");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "progress/2026-10-19-tts-relay-node20" })).toBeTruthy(),
    );
  });

  it("renders a prefixed wikilink with its label", async () => {
    existing.add("metro/wiki/entities/jane-doe.md");
    renderMd("Owner: [[metro:wiki/entities/jane-doe|Jane]].");

    const link = screen.getByRole("link", { name: "Jane" });
    expect(link.getAttribute("href")).toBe("/view/metro/wiki/entities/jane-doe.md");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { paths } = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(paths).toEqual(["metro/wiki/entities/jane-doe.md"]);
    expect(screen.getByRole("link", { name: "Jane" })).toBeTruthy();
  });

  it("renders a missing target as warning text", async () => {
    renderMd("Broken: [[wiki/concepts/nope|Nope]] here.");

    const warning = await screen.findByText("Nope", { selector: ".wikilink-missing" });
    expect(warning.tagName).not.toBe("A");
    expect(warning.closest("a")).toBeNull();
    expect(screen.queryByRole("link", { name: "Nope" })).toBeNull();
  });

  it("renders an unprefixed wikilink without a basePath as warning text, unchecked", async () => {
    render(
      <MemoryRouter>
        <MarkdownRenderer content="See [[wiki/concepts/x|X]]." />
      </MemoryRouter>,
    );

    const warning = screen.getByText("X", { selector: ".wikilink-missing" });
    expect(warning.closest("a")).toBeNull();
    // Past the debounce: nothing to check, so no request.
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the links when the existence check fails", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("network down");
    });
    renderMd("See [[wiki/concepts/x|X]].");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("link", { name: "X" }).getAttribute("href")).toBe(
      "/view/pavilio/wiki/concepts/x.md",
    );
    expect(document.querySelector(".wikilink-missing")).toBeNull();
  });

  it("keeps missing marks while the next check is pending", async () => {
    const { rerender } = renderMd("Broken: [[wiki/concepts/nope|Nope]].");
    await screen.findByText("Nope", { selector: ".wikilink-missing" });

    rerender(
      <MemoryRouter>
        <MarkdownRenderer content="Broken: [[wiki/concepts/nope|Nope]] and [[wiki/b|B]]." basePath={BASE} />
      </MemoryRouter>,
    );
    // No flash back to a link before the new answer arrives.
    expect(screen.getByText("Nope", { selector: ".wikilink-missing" })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByText("B", { selector: ".wikilink-missing" });
    expect(screen.getByText("Nope", { selector: ".wikilink-missing" })).toBeTruthy();
  });

  it("leaves wikilinks in code untouched", () => {
    const { container } = renderMd(
      "Inline `[[wiki/concepts/x]]` code.\n\n```\n[[wiki/concepts/y]]\n```\n",
    );

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    const codes = Array.from(container.querySelectorAll("code")).map((c) => c.textContent);
    expect(codes).toContain("[[wiki/concepts/x]]");
    expect(codes.some((t) => t?.includes("[[wiki/concepts/y]]"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("survives content that is not a string, as before wikilinks", () => {
    // A file endpoint that answers without `content` hands the renderer undefined at
    // runtime; react-markdown renders that as nothing, and so must the wikilink scan.
    renderMd(undefined as unknown as string);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
