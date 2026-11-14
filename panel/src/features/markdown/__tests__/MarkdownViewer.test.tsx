import { render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { buildReadUrl } from "../MarkdownViewer";
import MarkdownViewer from "../MarkdownViewer";
import { jsonResponse, stubFetch } from "../../../test-utils";
import { FloatingActionProvider } from "../../shell/Layout";
import { FloatingActionContext } from "../../shell/Layout/FloatingActionProvider";

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

describe("MarkdownViewer failed read", () => {
  beforeEach(() => {
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

  it.each([
    ["the fetch rejects", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["the read answers non-ok", async () => new Response("nope", { status: 404 })],
  ])("leaves Loading... when %s", async (_label, fail) => {
    vi.stubGlobal("fetch", vi.fn(fail));
    const view = render(
      <MemoryRouter initialEntries={["/view/pavilio/notes/gone.md"]}>
        <Routes>
          <Route path="/view/*" element={<MarkdownViewer />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(view.queryByText("Loading...")).toBeNull());
  });
});

/** The shell's floating-action slot, so anything the viewer hands it is on screen. */
function FloatingSlot() {
  const { action } = useContext(FloatingActionContext);
  return <div data-testid="floating-slot">{action}</div>;
}

describe("MarkdownViewer layout", () => {
  beforeEach(() => {
    stubFetch({}, () => jsonResponse({ content: "# Hello", absolutePath: "/fake/path.md" }));
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

  it("markdown viewer renders no wide toggle", async () => {
    // A compact choice an older panel wrote stays in the file, read by nothing.
    (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__![
      "view.wide@viewer"
    ] = false;
    const view = render(
      <FloatingActionProvider>
        <MemoryRouter initialEntries={["/view/pavilio/notes/hello.md"]}>
          <Routes>
            <Route path="/view/*" element={<MarkdownViewer />} />
          </Routes>
        </MemoryRouter>
        <FloatingSlot />
      </FloatingActionProvider>,
    );

    await waitFor(() => expect(view.queryByText("Loading...")).toBeNull());
    expect(await screen.findByText("Hello")).toBeTruthy();
    expect(screen.queryByTestId("wide-toggle")).toBeNull();
    expect(view.container.querySelector(".max-w-5xl")).toBeNull();
  });
});
