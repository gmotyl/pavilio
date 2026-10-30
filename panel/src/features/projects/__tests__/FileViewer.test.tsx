import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../markdown/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}));

// The page's ▶ layer as a probe: which speech key the rendered markdown sits
// under. `speechKey` stands in for the projects directory the server reports,
// so a test can give the open page a key.
let speechKey: string | null = null;
vi.mock("../docSpeech", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../docSpeech")>();
  return {
    ...actual,
    useDocSpeech: (...args: Parameters<typeof actual.useDocSpeech>) => {
      const real = actual.useDocSpeech(...args);
      return speechKey && args[2] ? { key: speechKey, text: args[1] ?? "" } : real;
    },
  };
});
// The toolbar's speaking half needs the panel's one speech host; these tests
// are about the page under it, so a keyed page gets no toolbar.
vi.mock("../ViewerActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ViewerActions")>();
  const Real = actual.default;
  return {
    ...actual,
    default: (props: import("react").ComponentProps<typeof Real>) => (speechKey ? null : <Real {...props} />),
  };
});
vi.mock("../../speech/PlayFromHere", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../speech/PlayFromHere")>();
  return {
    ...actual,
    PlayFromHere: ({ docKey, children }: { docKey?: string; children: import("react").ReactNode }) => (
      <div data-testid="play-from-here" data-doc-key={docKey ?? ""}>
        {children}
      </div>
    ),
  };
});

import FileViewer from "../FileViewer";

const ABSOLUTE = "/p/projects/alokai/notes/foo.md";
const CONTENT = "# Foo\n\nsome source text\n";
// Compact on the wire, pretty-printed on screen — the two must not be confused.
const RAW_JSON = '{"a":1,"b":[2,3]}';

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

afterEach(() => {
  vi.clearAllMocks();
});

const copyButton = () => screen.getByTestId("file-viewer-copy-content");

describe("FileViewer copy contents", () => {
  it("disables copy while a file is loading even though stale content is still rendered", () => {
    // The toolbar stays mounted across a file switch, still holding the
    // previously-open file's text — it must not be offered for copying.
    render(
      <FileViewer
        filePath="notes/bar.md"
        content={CONTENT}
        absolutePath={ABSOLUTE}
        loading
      />,
    );

    expect(copyButton()).toBeDisabled();
    fireEvent.click(copyButton());
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies raw json source rather than the pretty-printed rendering", async () => {
    render(
      <FileViewer
        filePath="notes/data.json"
        content={RAW_JSON}
        absolutePath="/p/projects/alokai/notes/data.json"
        loading={false}
      />,
    );

    // What is on screen is the pretty-printed form...
    expect(screen.getByText(/"b": \[/)).toBeTruthy();

    // ...but what lands on the clipboard is the file's own bytes.
    fireEvent.click(copyButton());
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(RAW_JSON));
  });

  it("renders no toolbar at all when absolutePath is empty", () => {
    render(
      <FileViewer
        filePath="notes/foo.md"
        content={CONTENT}
        absolutePath=""
        loading={false}
      />,
    );

    expect(screen.queryByTestId("file-viewer-vscode")).toBeNull();
    expect(screen.queryByTestId("file-viewer-copy-path")).toBeNull();
    expect(screen.queryByTestId("file-viewer-copy-content")).toBeNull();
  });

  describe("play from here", () => {
    afterEach(() => {
      speechKey = null;
    });

    it("renders a markdown note under the page's speech key", () => {
      speechKey = "alokai/notes/foo.md";
      render(<FileViewer filePath="notes/foo.md" content={CONTENT} absolutePath={ABSOLUTE} loading={false} />);
      const layer = screen.getByTestId("play-from-here");
      expect(layer.getAttribute("data-doc-key")).toBe("alokai/notes/foo.md");
      expect(layer.contains(screen.getByTestId("md"))).toBe(true);
    });
  });
});
