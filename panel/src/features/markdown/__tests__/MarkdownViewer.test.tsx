import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { buildReadUrl } from "../MarkdownViewer";
import MarkdownViewer from "../MarkdownViewer";

// ---------- unit tests for the pure helper ----------

describe("buildReadUrl", () => {
  it("returns a plain read URL for normal paths", () => {
    expect(buildReadUrl("pavilio/notes/foo.md")).toBe(
      "/api/files/read/pavilio/notes/foo.md",
    );
  });

  it("maps _root/<rootId>/<rest> to ?root= query param", () => {
    expect(buildReadUrl("_root/skills/memo/SKILL.md")).toBe(
      "/api/files/read/memo/SKILL.md?root=skills",
    );
  });

  it("URL-encodes the rootId", () => {
    expect(buildReadUrl("_root/my root/file.md")).toBe(
      "/api/files/read/file.md?root=my%20root",
    );
  });

  it("handles _root with only rootId and no rest path", () => {
    // Edge case: _root/<id> with nothing after — rest is ""
    const url = buildReadUrl("_root/skills");
    expect(url).toBe("/api/files/read/?root=skills");
  });
});

// ---------- integration: viewer fetches the right URL ----------

function stubFetch(captured: string[]) {
  return vi.fn(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    captured.push(u);
    return new Response(
      JSON.stringify({ content: "# Hello", absolutePath: "/fake/path.md" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

describe("MarkdownViewer cross-root fetch", () => {
  let fetchedUrls: string[];

  beforeEach(() => {
    fetchedUrls = [];
    vi.stubGlobal("fetch", stubFetch(fetchedUrls));
    // Stub WebSocket so the component doesn't throw
    vi.stubGlobal(
      "WebSocket",
      class {
        onopen = null;
        onmessage = null;
        onclose = null;
        onerror = null;
        close() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls /api/files/read/<rest>?root=<id> for a _root path", async () => {
    render(
      <MemoryRouter initialEntries={["/view/_root/skills/memo/SKILL.md"]}>
        <Routes>
          <Route path="/view/*" element={<MarkdownViewer />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(fetchedUrls).toContain(
        "/api/files/read/memo/SKILL.md?root=skills",
      ),
    );
  });

  it("calls plain /api/files/read/<path> for a non-_root path", async () => {
    render(
      <MemoryRouter initialEntries={["/view/pavilio/notes/foo.md"]}>
        <Routes>
          <Route path="/view/*" element={<MarkdownViewer />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(fetchedUrls).toContain("/api/files/read/pavilio/notes/foo.md"),
    );
  });
});
