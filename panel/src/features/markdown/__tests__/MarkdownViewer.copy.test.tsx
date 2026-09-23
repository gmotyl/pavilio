import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownViewer from "../MarkdownViewer";
import {
  BreadcrumbActionsContext,
  BreadcrumbActionsProvider,
} from "../../shell/Breadcrumbs/BreadcrumbActionsProvider";

const PATH = "pavilio/notes/foo.md";
const ABSOLUTE = "/root/git/prv/projects/projects/pavilio/notes/foo.md";
const SOURCE = "# Foo\n\nthe file's source text\n";

/**
 * The viewer hands its toolbar to the shell through a context rather than
 * rendering it where it is declared, so a bare `render(<MarkdownViewer/>)`
 * shows no buttons however correct the component is. This is the smallest
 * piece of the breadcrumb bar that puts them back on screen.
 */
function BreadcrumbSlot() {
  const { actions } = useContext(BreadcrumbActionsContext);
  return <div data-testid="breadcrumb-slot">{actions}</div>;
}

function stubRead(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ content, absolutePath: ABSOLUTE }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

/**
 * jsdom's `navigator.clipboard` is not a real Clipboard instance and its
 * prototype is inert here, so a `vi.spyOn(Clipboard.prototype, …)` never
 * fires. The INSTANCE is the object `lib/clipboard.ts` reaches for, so that
 * is what gets replaced — the same reasoning the sidebar and ViewerActions
 * suites use. `isSecureContext` has to be true or the helper skips the
 * clipboard API entirely and falls through to `execCommand`.
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

function renderViewer() {
  return render(
    <BreadcrumbActionsProvider>
      <BreadcrumbSlot />
      <MemoryRouter initialEntries={[`/view/${PATH}`]}>
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
  vi.useRealTimers();
});

describe("MarkdownViewer copy actions", () => {
  it("the standalone viewer offers copy-content", async () => {
    stubRead(SOURCE);
    spyClipboard();
    renderViewer();

    expect(
      await screen.findByTestId("markdown-viewer-copy-content"),
    ).toBeInTheDocument();
    // The path button is the one that already shipped; composing must not
    // cost it its identity.
    expect(
      screen.getByTestId("markdown-viewer-copy-path"),
    ).toBeInTheDocument();
  });

  it("copy-content places the file source on the clipboard", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubRead(SOURCE);
    const writeText = spyClipboard();
    renderViewer();

    const button = await screen.findByTestId("markdown-viewer-copy-content");
    fireEvent.click(button);

    // The file's source, not its path — the two buttons differ only in this.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SOURCE));
    await waitFor(() =>
      expect(
        screen.getByTestId("markdown-viewer-copy-content"),
      ).toHaveTextContent("Copied"),
    );

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(
      screen.getByTestId("markdown-viewer-copy-content"),
    ).toHaveTextContent("Copy");
  });

  it("copy-content is disabled when there is nothing to copy", async () => {
    stubRead("");
    const writeText = spyClipboard();
    renderViewer();

    // The path is known (the read succeeded), so the toolbar is up — it is
    // only the content that is empty.
    const button = await screen.findByTestId("markdown-viewer-copy-content");
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("only one action shows confirmation at a time", async () => {
    stubRead(SOURCE);
    const writeText = spyClipboard();
    renderViewer();

    const content = () => screen.getByTestId("markdown-viewer-copy-content");
    const path = () => screen.getByTestId("markdown-viewer-copy-path");

    fireEvent.click(await screen.findByTestId("markdown-viewer-copy-content"));
    await waitFor(() => expect(content()).toHaveTextContent("Copied"));
    expect(path()).toHaveTextContent("Path");

    // Now the other one: the first button's confirmation must clear, not sit
    // there alongside it.
    fireEvent.click(path());
    await waitFor(() => expect(path()).toHaveTextContent("Copied"));
    expect(content()).toHaveTextContent("Copy");
    expect(screen.getAllByText("Copied")).toHaveLength(1);
    expect(writeText).toHaveBeenLastCalledWith(ABSOLUTE);
  });
});
