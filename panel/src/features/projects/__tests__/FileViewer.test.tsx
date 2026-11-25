import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { jsonResponse, stubFetch } from "../../../test-utils";

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
vi.mock("../../speech/PagePlayFromHere", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../speech/PagePlayFromHere")>();
  return {
    ...actual,
    PagePlayFromHere: ({ docKey, children }: { docKey?: string; children: import("react").ReactNode }) => (
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

describe("FileViewer story PR header", () => {
  const STORY = [
    "---",
    "title: Refuse requests without an allowed Origin",
    "pr: woo-dev-be#375",
    "head: 18fcc84a1b2c3d4e5f60718293a4b5c6d7e8f901",
    "base: origin/main",
    "lang: pl",
    "---",
    "# Refuse requests without an allowed Origin",
    "",
  ].join("\n");

  const view = (filePath: string, content: string) =>
    render(
      <MemoryRouter>
        <FileViewer filePath={filePath} content={content} absolutePath="" loading={false} />
      </MemoryRouter>,
    );

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts the header above the markdown for a story with pr:, and the story renders when the fetch fails", async () => {
    const fetch = stubFetch({ "/api/prs/one": () => jsonResponse({ unavailable: "failed" }, { status: 502 }) });
    view("woozle/qa/stories/woo-dev-be-pr-375.md", STORY);
    const header = screen.getByTestId("story-pr-header");
    const md = screen.getByTestId("md");
    expect(header.compareDocumentPosition(md) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(String(fetch.mock.calls[0][0])).toBe("/api/prs/one?project=woozle&repo=woo-dev-be&number=375");
    await within(header).findByText("Could not load PR status");
    expect(within(header).getByText("PL")).toBeTruthy();
    expect(screen.getByTestId("md").textContent).toContain("Refuse requests without an allowed Origin");
  });

  it("no header for runs, reviews and ref stories", () => {
    const fetch = stubFetch({});
    // A run and a review: outside qa/stories/, even with a pr: line.
    view("woozle/qa/2026-11-25-login/run.md", STORY).unmount();
    view("woozle/qa/reviews/woo-dev-be-pr-375.md", STORY).unmount();
    // A story of a branch or range: ref:, no pr:.
    view("woozle/qa/stories/feat-origin.md", "---\ntitle: A branch\nref: feat/origin\n---\n# A branch\n").unmount();
    // A pr: whose repo is not a slug, and a pr: with no number, never reach the API.
    view("woozle/qa/stories/x.md", "---\npr: ../etc#1\n---\n").unmount();
    view("woozle/qa/stories/y.md", "---\npr: woo-dev-be\n---\n").unmount();
    // pr: below the frontmatter is prose, not metadata.
    view("woozle/qa/stories/z.md", "# Title\n\npr: woo-dev-be#375\n");
    expect(screen.queryByTestId("story-pr-header")).toBeNull();
    expect(fetch.mock.calls.filter(([u]) => String(u).startsWith("/api/prs/one"))).toHaveLength(0);
  });
});
