import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useContext } from "react";
import ViewerActions from "../ViewerActions";
import FileViewer from "../FileViewer";
import MockupFrame from "../MockupFrame";
import PlansTab from "../PlansTab";
import MarkdownViewer from "../../markdown/MarkdownViewer";
import {
  BreadcrumbActionsContext,
  BreadcrumbActionsProvider,
} from "../../shell/Breadcrumbs/BreadcrumbActionsProvider";
import { openInVSCode } from "../../shell/vscode";
import { __resetWorkspaceRootForTests } from "../useWorkspaceRoot";

vi.mock("../../shell/vscode", () => ({
  openInVSCode: vi.fn(),
}));

vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));

vi.mock("../../markdown/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}));

const ROOT = "/h/git/prv/projects";
const NOTE_ABSOLUTE = `${ROOT}/projects/metro/notes/a.md`;
const NOTE_RELATIVE = "projects/metro/notes/a.md";
const LINKED_PLAN =
  "/h/git/alokai/clients/carolina-herrera/openspec/changes/x/tasks.md";
const LINKED_RELATIVE =
  "../../alokai/clients/carolina-herrera/openspec/changes/x/tasks.md";

/** The clipboard spy for the current test. Asserted on in every test so a
 * never-reached spy cannot let a test pass silently. jsdom's clipboard
 * prototype is inert, so the INSTANCE is replaced. */
let writeText: ReturnType<typeof vi.fn>;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Every call site learns the workspace root from `/api/system`; the routes the
 * viewers load their file from answer with fixtures. Anything else 404s, so a
 * call site that reached for an unexpected endpoint shows up as a failure.
 */
function stubServer(workspaceRoot = ROOT) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url.startsWith("/api/system")) {
        return json({ wslDistro: null, workspaceRoot });
      }
      if (url.includes("plans-tree")) {
        return json({
          project: "alokai",
          sources: [
            {
              id: "carolina",
              label: "carolina-herrera",
              absoluteRoot:
                "/h/git/alokai/clients/carolina-herrera/openspec/changes/x",
              files: [
                {
                  source: "carolina",
                  filename: "tasks.md",
                  absolutePath: LINKED_PLAN,
                  modified: 1,
                  relativeToProjectsDir: null,
                },
              ],
            },
          ],
        });
      }
      if (url.includes("plans/read")) {
        return json({ absolutePath: LINKED_PLAN, content: "# Plan body" });
      }
      if (url.startsWith("/api/files/read/")) {
        return json({ content: "# Note", absolutePath: NOTE_ABSOLUTE });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

function BreadcrumbSlot() {
  const { actions } = useContext(BreadcrumbActionsContext);
  return <div data-testid="breadcrumb-slot">{actions}</div>;
}

beforeEach(() => {
  __resetWorkspaceRootForTests();
  vi.mocked(openInVSCode).mockClear();
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
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

describe("ViewerActions copy path", () => {
  it("copy path copies the workspace-relative path", async () => {
    render(
      <ViewerActions absolutePath={NOTE_ABSOLUTE} relativePath={NOTE_RELATIVE} />,
    );
    expect(await copied("file-viewer-copy-path")).toBe(NOTE_RELATIVE);
  });

  it("copy absolute copies the absolute path", async () => {
    render(
      <ViewerActions absolutePath={NOTE_ABSOLUTE} relativePath={NOTE_RELATIVE} />,
    );
    expect(await copied("file-viewer-copy-absolute")).toBe(NOTE_ABSOLUTE);
    await waitFor(() =>
      expect(screen.getByTestId("file-viewer-copy-absolute")).toHaveTextContent(
        "Copied",
      ),
    );
    // One feedback timer for the toolbar: only the clicked button confirms.
    expect(screen.getAllByText("Copied")).toHaveLength(1);
  });

  it("disables copy path while the relative path is not known yet", () => {
    render(<ViewerActions absolutePath={NOTE_ABSOLUTE} relativePath={null} />);
    expect(screen.getByTestId("file-viewer-copy-path")).toBeDisabled();
    // The absolute path never stands in for it.
    fireEvent.click(screen.getByTestId("file-viewer-copy-path"));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByTestId("file-viewer-copy-absolute")).not.toBeDisabled();
  });

  it("vscode still gets the absolute path", async () => {
    render(
      <ViewerActions absolutePath={NOTE_ABSOLUTE} relativePath={NOTE_RELATIVE} />,
    );
    fireEvent.click(screen.getByTestId("file-viewer-vscode"));
    expect(openInVSCode).toHaveBeenCalledTimes(1);
    expect(openInVSCode).toHaveBeenCalledWith(NOTE_ABSOLUTE);
    // The copy button is independent of it.
    expect(await copied("file-viewer-copy-path")).toBe(NOTE_RELATIVE);
  });

  it("linked repo file copies a ../ path", async () => {
    render(
      <MemoryRouter initialEntries={[`/?file=${encodeURIComponent(LINKED_PLAN)}`]}>
        <PlansTab projectName="alokai" />
      </MemoryRouter>,
    );
    expect(await copied("file-viewer-copy-path")).toBe(LINKED_RELATIVE);
  });

  it("projects dir name is not hardcoded", async () => {
    // A projects directory called "notes", one level under the workspace root.
    stubServer("/w");
    render(
      <FileViewer
        filePath="metro/a.md"
        content="# A"
        absolutePath="/w/notes/metro/a.md"
        loading={false}
      />,
    );
    expect(await copied("file-viewer-copy-path")).toBe("notes/metro/a.md");
  });
});

describe("every toolbar call site", () => {
  it("every toolbar call site copies relative", async () => {
    // Section file viewer.
    const fileViewer = render(
      <FileViewer
        filePath="metro/notes/a.md"
        content="# Note"
        absolutePath={NOTE_ABSOLUTE}
        loading={false}
      />,
    );
    expect(await copied("file-viewer-copy-path")).toBe(NOTE_RELATIVE);
    expect(await copied("file-viewer-copy-absolute")).toBe(NOTE_ABSOLUTE);
    fileViewer.unmount();

    // Plans tab.
    const plans = render(
      <MemoryRouter initialEntries={[`/?file=${encodeURIComponent(LINKED_PLAN)}`]}>
        <PlansTab projectName="alokai" />
      </MemoryRouter>,
    );
    expect(await copied("file-viewer-copy-path")).toBe(LINKED_RELATIVE);
    expect(await copied("file-viewer-copy-absolute")).toBe(LINKED_PLAN);
    plans.unmount();

    // Mockup frame.
    const mockupAbsolute = `${ROOT}/projects/pavilio/mockups/boot.html`;
    const mockup = render(
      <MockupFrame filePath="pavilio/mockups/boot.html" absolutePath={mockupAbsolute} />,
    );
    expect(await copied("mockup-viewer-copy-path")).toBe(
      "projects/pavilio/mockups/boot.html",
    );
    expect(await copied("mockup-viewer-copy-absolute")).toBe(mockupAbsolute);
    mockup.unmount();

    // Standalone /view/* viewer.
    render(
      <BreadcrumbActionsProvider>
        <BreadcrumbSlot />
        <MemoryRouter initialEntries={["/view/metro/notes/a.md"]}>
          <Routes>
            <Route path="/view/*" element={<MarkdownViewer />} />
          </Routes>
        </MemoryRouter>
      </BreadcrumbActionsProvider>,
    );
    expect(await copied("markdown-viewer-copy-path")).toBe(NOTE_RELATIVE);
    expect(await copied("markdown-viewer-copy-absolute")).toBe(NOTE_ABSOLUTE);
  });
});
