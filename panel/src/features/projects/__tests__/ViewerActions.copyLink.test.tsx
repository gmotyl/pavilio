import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ViewerActions from "../ViewerActions";
import FileViewer from "../FileViewer";
import MockupFrame from "../MockupFrame";
import { __resetWorkspaceRootForTests } from "../useWorkspaceRoot";

vi.mock("../../shell/vscode", () => ({
  openInVSCode: vi.fn(),
}));

vi.mock("../../markdown/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}));

const ROOT = "/h/git/prv/projects";
const MOCKUP_INDEX = "pavilio/mockups/2026-10-05-alerts-banner-options.html";
const MOCKUP_ABSOLUTE = `${ROOT}/projects/${MOCKUP_INDEX}`;
const EXPECTED_LINK =
  "[projects/pavilio/mockups/2026-10-05-alerts-banner-options.html]" +
  "(/project/pavilio/mockups?file=pavilio%2Fmockups%2F2026-10-05-alerts-banner-options.html)";

/** The clipboard spy for the current test. jsdom's clipboard prototype is
 * inert, so the INSTANCE is replaced, and every copy asserts it was reached. */
let writeText: ReturnType<typeof vi.fn>;

/** `/api/system` answers with the workspace root; when `pending`, it never
 * answers, which is the state before the server has replied. */
function stubServer({ pending = false } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (String(input).startsWith("/api/system")) {
        if (pending) return new Promise<Response>(() => {});
        return Promise.resolve(
          new Response(JSON.stringify({ wslDistro: null, workspaceRoot: ROOT }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }),
  );
}

beforeEach(() => {
  __resetWorkspaceRootForTests();
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  stubServer();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Click a copy button once it is enabled, and return what reached the clipboard. */
async function copied(testId: string): Promise<string> {
  await waitFor(() => expect(screen.getByTestId(testId)).not.toBeDisabled());
  writeText.mockClear();
  fireEvent.click(screen.getByTestId(testId));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  return writeText.mock.calls[0][0] as string;
}

describe("ViewerActions copy link", () => {
  it("copy link yields the markdown panel link", async () => {
    render(<MockupFrame filePath={MOCKUP_INDEX} absolutePath={MOCKUP_ABSOLUTE} />);
    expect(await copied("mockup-viewer-copy-link")).toBe(EXPECTED_LINK);
    await waitFor(() =>
      expect(screen.getByTestId("mockup-viewer-copy-link")).toHaveTextContent(
        "Copied",
      ),
    );
    // One feedback timer for the toolbar: only the clicked button confirms.
    expect(screen.getAllByText("Copied")).toHaveLength(1);
  });

  it("copy link is host-independent", async () => {
    render(
      <MockupFrame
        filePath={MOCKUP_INDEX}
        absolutePath={MOCKUP_ABSOLUTE}
        testIdPrefix="markdown-viewer"
      />,
    );
    const text = await copied("markdown-viewer-copy-link");
    expect(text).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);
    expect(text).not.toContain("](//");
    expect(text).not.toContain(window.location.host);
    expect(text).toContain("](/project/pavilio/mockups?file=");
  });

  it("only mockups show copy link", async () => {
    render(
      <FileViewer
        filePath="pavilio/notes/a.md"
        content="# A"
        absolutePath={`${ROOT}/projects/pavilio/notes/a.md`}
        loading={false}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("file-viewer-copy-path")).not.toBeDisabled(),
    );
    expect(screen.queryByTestId("file-viewer-copy-link")).toBeNull();

    // A bare toolbar with no link to offer renders no button either.
    render(
      <ViewerActions
        absolutePath={MOCKUP_ABSOLUTE}
        relativePath="x"
        testIdPrefix="bare"
      />,
    );
    expect(screen.queryByTestId("bare-copy-link")).toBeNull();
  });

  it("copy link is disabled until the workspace root is known", () => {
    stubServer({ pending: true });
    render(<MockupFrame filePath={MOCKUP_INDEX} absolutePath={MOCKUP_ABSOLUTE} />);
    const button = screen.getByTestId("mockup-viewer-copy-link");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(writeText).not.toHaveBeenCalled();
  });
});
