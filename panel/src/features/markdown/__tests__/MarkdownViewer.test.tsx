import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { buildReadUrl } from "../MarkdownViewer";
import MarkdownViewer from "../MarkdownViewer";
import { jsonResponse, stubFetch } from "../../../test-utils";

// ---------- unit tests for the pure helper ----------

describe("buildReadUrl", () => {
  it.each([
    ["a plain read URL for normal paths", "pavilio/notes/foo.md", "/api/files/read/pavilio/notes/foo.md"],
    ["percent-encodes each path segment", "p/notes/a b#c?.md", "/api/files/read/p/notes/a%20b%23c%3F.md"],
    ["percent-encodes each segment of a _root path", "_root/skills/a b/SKILL.md", "/api/files/read/a%20b/SKILL.md?root=skills"],
    ["maps _root/<rootId>/<rest> to ?root= query param", "_root/skills/memo/SKILL.md", "/api/files/read/memo/SKILL.md?root=skills"],
    ["URL-encodes the rootId", "_root/my root/file.md", "/api/files/read/file.md?root=my%20root"],
    // Edge case: _root/<id> with nothing after — rest is ""
    ["handles _root with only rootId and no rest path", "_root/skills", "/api/files/read/?root=skills"],
  ])("%s", (_label, path, url) => {
    expect(buildReadUrl(path)).toBe(url);
  });
});

// ---------- wiring: the viewer reads through buildReadUrl (its table is above) ----------

describe("MarkdownViewer cross-root fetch", () => {
  let fetchedUrls: string[];

  beforeEach(() => {
    fetchedUrls = [];
    stubFetch({}, (url: string) => {
      fetchedUrls.push(url);
      return jsonResponse({ content: "# Hello", absolutePath: "/fake/path.md" });
    });
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
});
