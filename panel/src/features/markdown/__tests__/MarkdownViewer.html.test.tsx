import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../shell/vscode", () => ({
  openInVSCode: vi.fn(),
}));

import MarkdownViewer from "../MarkdownViewer";
import MockupFrame from "../../projects/MockupFrame";
import {
  BreadcrumbActionsContext,
  BreadcrumbActionsProvider,
} from "../../shell/Breadcrumbs/BreadcrumbActionsProvider";

// The projects directory is nested one level under the workspace root, so the
// workspace-relative path keeps that directory's own name ("projects/").
const MOCKUP_PATH = "pavilio/mockups/boot.html";
const MOCKUP_ABSOLUTE =
  "/root/git/prv/projects/projects/pavilio/mockups/boot.html";
const MOCKUP_SOURCE = "<!doctype html><title>Boot</title><p>hello</p>";

/**
 * The viewer hands its toolbar to the shell through a context rather than
 * rendering it where it is declared, so the breadcrumb slot has to be on
 * screen for a toolbar-mounted-there assertion to mean anything.
 */
function BreadcrumbSlot() {
  const { actions } = useContext(BreadcrumbActionsContext);
  return <div data-testid="breadcrumb-slot">{actions}</div>;
}

function stubRead(content: string, absolutePath: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ content, absolutePath }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

/**
 * jsdom's `navigator.clipboard` is not a real Clipboard instance and its
 * prototype is inert here, so the INSTANCE is what `lib/clipboard.ts` reaches
 * for and what gets replaced. `isSecureContext` has to be true or the helper
 * skips the clipboard API entirely.
 */
function spyClipboard() {
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

function renderViewer(path: string) {
  return render(
    <BreadcrumbActionsProvider>
      <BreadcrumbSlot />
      <MemoryRouter initialEntries={[`/view/${path}`]}>
        <Routes>
          <Route path="/view/*" element={<MarkdownViewer />} />
        </Routes>
      </MemoryRouter>
    </BreadcrumbActionsProvider>,
  );
}

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
  vi.clearAllMocks();
});

describe("MarkdownViewer html handling", () => {
  it("renders an html file in the mockup frame", async () => {
    stubRead(MOCKUP_SOURCE, MOCKUP_ABSOLUTE);
    const { container } = renderViewer(MOCKUP_PATH);

    const frame = (await screen.findByTestId(
      "markdown-viewer-frame",
    )) as HTMLIFrameElement;
    expect(frame).toHaveAttribute(
      "src",
      "/api/files/raw/pavilio/mockups/boot.html",
    );
    // …and not the source text in a <pre>, which is what it used to show.
    expect(container.querySelector("pre")).toBeNull();
    expect(screen.queryByText(/doctype html/)).toBeNull();
  });

  it("renders a cross-root html file as source, not in a frame", async () => {
    // `/view/_root/<rootId>/<path>` is how the explorer links a file outside the
    // projects root. The raw route the frame points at has no `root` support, so
    // the iframe would load nothing — the source text is the honest fallback.
    stubRead(MOCKUP_SOURCE, "/root/git/prv/projects/skills/tdd/mock.html");
    const { container } = renderViewer("_root/skills/tdd/mock.html");

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.querySelector("pre")).toHaveTextContent("doctype html");
    expect(screen.queryByTestId("markdown-viewer-frame")).toBeNull();
  });

  it("still renders markdown with the markdown renderer", async () => {
    stubRead("# Hello", "/root/git/prv/projects/projects/pavilio/notes/a.md");
    renderViewer("pavilio/notes/a.md");

    expect(
      await screen.findByRole("heading", { name: "Hello" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-viewer-frame")).toBeNull();
  });

  it("still pretty-prints json", async () => {
    stubRead('{"a":1}', "/root/git/prv/projects/projects/pavilio/_index.json");
    const { container } = renderViewer("pavilio/_index.json");

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.querySelector("pre")).toHaveTextContent('"a": 1');
    expect(screen.queryByTestId("markdown-viewer-frame")).toBeNull();
  });

  it("still treats a _skills path as markdown", async () => {
    stubRead("# Skill", "/root/git/prv/projects/skills/tdd/SKILL.md");
    renderViewer("_skills/tdd");

    expect(
      await screen.findByRole("heading", { name: "Skill" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-viewer-frame")).toBeNull();
  });

  it("copies the same workspace-relative path as the mockups tab", async () => {
    stubRead(MOCKUP_SOURCE, MOCKUP_ABSOLUTE);
    const writeText = spyClipboard();

    // The standalone viewer…
    renderViewer(MOCKUP_PATH);
    fireEvent.click(await screen.findByTestId("markdown-viewer-copy-path"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    // …and the mockups tab, which mounts `MockupFrame` directly.
    render(
      <MockupFrame filePath={MOCKUP_PATH} absolutePath={MOCKUP_ABSOLUTE} />,
    );
    fireEvent.click(screen.getByTestId("mockup-viewer-copy-path"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

    const [viewerCopy] = writeText.mock.calls[0];
    const [tabCopy] = writeText.mock.calls[1];
    expect(viewerCopy).toBe("projects/pavilio/mockups/boot.html");
    expect(viewerCopy).toBe(tabCopy);

    // One toolbar, not two: the breadcrumb slot must not also mount a copy
    // button for the same file.
    expect(screen.getAllByTestId("markdown-viewer-copy-path")).toHaveLength(1);
  });
});
