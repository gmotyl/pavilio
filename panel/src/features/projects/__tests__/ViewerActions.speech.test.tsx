import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom";
import { useContext, type ReactNode } from "react";
import { makeSpeech, synthMock } from "../../speech/__tests__/speech.harness";
import type { AnswerWaitingPort, SpeechHost } from "../../speech/useSpeechHost";

/**
 * The host is stubbed, NOT `usePageSpeech`: the toolbar must reach the panel's
 * one host, and mocking the hook would delete the provider's throw. So the real
 * `SpeechHostProvider` is mounted and only the host it publishes is swapped —
 * its `speakDocument` / `stopDocument` are the spies asserted on.
 */
const stub = vi.hoisted(() => ({ host: null as SpeechHost | null }));

vi.mock("../../speech/synth", () => synthMock());
vi.mock("../../speech/useSpeechHost", () => {
  const useSpeechHost = () => stub.host;
  return { useSpeechHost, default: useSpeechHost };
});
vi.mock("../../speech/useMediaSessionTransport", () => ({
  useMediaSessionTransport: () => {},
}));
vi.mock("../../speech/useSpeechKeys", () => ({ useSpeechKeys: () => {} }));
vi.mock("../../shell/vscode", () => ({ openInVSCode: vi.fn() }));
vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));
// Passthrough spy: records the path each render asks speech for, so a test can
// see what the very first render after a switch offered — before any
// effect-driven re-render could repair it.
const spoken = vi.hoisted(() => ({ paths: [] as Array<string | null | undefined> }));
vi.mock("../docSpeech", async (importOriginal) => {
  const real = await importOriginal<typeof import("../docSpeech")>();
  return {
    ...real,
    useDocSpeech: (...args: Parameters<typeof real.useDocSpeech>) => {
      spoken.paths.push(args[0]);
      return real.useDocSpeech(...args);
    },
  };
});
vi.mock("../../markdown/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

import { SpeechHostProvider } from "../../speech/SpeechHostProvider";
import ViewerActions from "../ViewerActions";
import FileViewer from "../FileViewer";
import MockupFrame from "../MockupFrame";
import PlansTab from "../PlansTab";
import WikiTab from "../WikiTab";
import MarkdownViewer from "../../markdown/MarkdownViewer";
import {
  BreadcrumbActionsContext,
  BreadcrumbActionsProvider,
} from "../../shell/Breadcrumbs/BreadcrumbActionsProvider";
import { __resetWorkspaceRootForTests } from "../useWorkspaceRoot";
import { docSpeechKeyFor } from "../docSpeech";
import { useFileViewer } from "../useFileViewer";

const KEY = "doc:pavilio/wiki/page.md";
const OTHER_KEY = "doc:pavilio/wiki/other.md";
const ABSOLUTE = "/h/git/prv/projects/projects/pavilio/wiki/page.md";

const answerWaiting: AnswerWaitingPort = {
  get: () => ({ waiting: false, pending: false }),
  hold: () => {},
  release: () => {},
  noteTransport: () => {},
  isHeld: () => false,
};

function Host({ children }: { children: ReactNode }) {
  return (
    <SpeechHostProvider
      sessionOf={() => undefined}
      isSessionOpen={() => false}
      focusedCell={{ read: () => null, readStandalone: () => null, subscribe: () => () => {} }}
      drawerVisible={false}
      onArrival={() => {}}
      answerWaiting={answerWaiting}
      voiceFor={() => "a-voice"}
    >
      {children}
    </SpeechHostProvider>
  );
}

const play = () => screen.getByTestId("file-viewer-play");
const bar = (key = KEY) => screen.queryByTestId(`document-speech-bar-${key}`);
const speak = () => vi.mocked(stub.host!.speakDocument);
const stop = () => vi.mocked(stub.host!.stopDocument);

function toolbar(speech?: { key: string; text: string }) {
  return (
    <Host>
      <ViewerActions absolutePath={ABSOLUTE} relativePath="projects/pavilio/wiki/page.md" content="# Page" speech={speech} />
    </Host>
  );
}

beforeEach(() => {
  stub.host = makeSpeech();
});

afterEach(() => {
  stub.host = null;
  vi.unstubAllGlobals();
});

describe("ViewerActions Play", () => {
  it("Play renders only when speech is passed", () => {
    // No speech: no Play, and no provider is needed — the toolbar never reaches
    // for the host (the mockup frame and non-markdown files mount it this way).
    const bare = render(<ViewerActions absolutePath={ABSOLUTE} relativePath={null} />);
    expect(screen.queryByTestId("file-viewer-play")).toBeNull();
    expect(screen.getByTestId("file-viewer-vscode")).toBeTruthy();
    bare.unmount();

    render(toolbar({ key: KEY, text: "# Page" }));
    expect(play()).toBeTruthy();
    expect(screen.getByTestId("file-viewer-vscode")).toBeTruthy();
    expect(screen.getByTestId("file-viewer-copy-path")).toBeTruthy();
    expect(screen.getByTestId("file-viewer-copy-absolute")).toBeTruthy();
    expect(screen.getByTestId("file-viewer-copy-content")).toBeTruthy();
    // Folded until pressed.
    expect(bar()).toBeNull();
  });

  it("Play unfolds the bar and speaks the page", () => {
    render(toolbar({ key: KEY, text: "# Page\n\nBody." }));

    fireEvent.click(play());

    expect(bar()).not.toBeNull();
    expect(play()).toHaveAccessibleName("Stop");
    expect(play()).not.toHaveAttribute("aria-pressed");
    expect(speak()).toHaveBeenCalledTimes(1);
    expect(speak()).toHaveBeenCalledWith({ key: KEY, text: "# Page\n\nBody." });
    expect(stop()).not.toHaveBeenCalled();
  });

  it("second Play folds and stops", () => {
    render(toolbar({ key: KEY, text: "# Page" }));

    fireEvent.click(play());
    fireEvent.click(play());

    expect(bar()).toBeNull();
    expect(play()).toHaveAccessibleName("Play");
    expect(stop()).toHaveBeenCalledTimes(1);
    expect(stop()).toHaveBeenCalledWith(KEY);
    expect(speak()).toHaveBeenCalledTimes(1);
  });

  it("unmount stops the page", () => {
    const view = render(toolbar({ key: KEY, text: "# Page" }));
    fireEvent.click(play());

    view.unmount();

    expect(stop()).toHaveBeenCalledTimes(1);
    expect(stop()).toHaveBeenCalledWith(KEY);
  });

  it("key change stops the old page", () => {
    const view = render(toolbar({ key: KEY, text: "# Page" }));
    fireEvent.click(play());

    view.rerender(toolbar({ key: OTHER_KEY, text: "# Other" }));

    expect(stop()).toHaveBeenCalledTimes(1);
    expect(stop()).toHaveBeenCalledWith(KEY);
    // The new page starts folded and is not spoken until its own Play.
    expect(bar(KEY)).toBeNull();
    expect(bar(OTHER_KEY)).toBeNull();
    expect(speak()).toHaveBeenCalledTimes(1);

    // A key change while folded stops nothing.
    view.rerender(toolbar({ key: KEY, text: "# Page" }));
    expect(stop()).toHaveBeenCalledTimes(1);
  });

  it("text change does not restart the run", () => {
    const view = render(toolbar({ key: KEY, text: "# Old" }));
    fireEvent.click(play());

    view.rerender(toolbar({ key: KEY, text: "# New" }));

    expect(speak()).toHaveBeenCalledTimes(1);
    expect(stop()).not.toHaveBeenCalled();
    expect(bar()).not.toBeNull();

    // Fold, then Play again: the new text is what is spoken.
    fireEvent.click(play());
    fireEvent.click(play());
    expect(speak()).toHaveBeenCalledTimes(2);
    expect(speak()).toHaveBeenLastCalledWith({ key: KEY, text: "# New" });
  });

  it("a page with nothing to speak disables Play", () => {
    const view = render(toolbar({ key: KEY, text: "```ts\nconst x = 1;\n```" }));
    expect(play()).toBeDisabled();
    expect(play()).toHaveAttribute("title", "Nothing to speak yet");
    // The name stays the visible "Play"; the reason is its description.
    expect(play()).toHaveAccessibleName("Play");
    expect(play()).toHaveAccessibleDescription("Nothing to speak yet");
    fireEvent.click(play());
    expect(speak()).not.toHaveBeenCalled();

    // Frontmatter alone is nothing to speak either.
    view.rerender(toolbar({ key: KEY, text: "---\ntitle: X\n---\n" }));
    expect(play()).toBeDisabled();

    // A page with words is playable again.
    view.rerender(toolbar({ key: KEY, text: "# Hello" }));
    expect(play()).not.toBeDisabled();
    expect(play()).toHaveAttribute("title", "Read this page aloud");
  });

  it("an unfolded bar can still be folded when the page empties", () => {
    const view = render(toolbar({ key: KEY, text: "# Hello" }));
    fireEvent.click(play());
    expect(bar()).not.toBeNull();

    view.rerender(toolbar({ key: KEY, text: "```\ncode only\n```" }));

    expect(play()).not.toBeDisabled();
    expect(play()).toHaveAttribute("title", "Stop reading this page");
    fireEvent.click(play());
    expect(bar()).toBeNull();
    expect(stop()).toHaveBeenCalledWith(KEY);
  });
});

const ROOT = "/h/git/prv/projects";
const PROJECTS = `${ROOT}/projects`;
const NOTE = `${PROJECTS}/pavilio/wiki/x.md`;
const LINKED_PLAN = "/h/git/alokai/clients/ch/openspec/changes/x/tasks.md";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

function stubServer(note = "# Note") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url.startsWith("/api/system")) {
        return json({ wslDistro: null, workspaceRoot: ROOT, projectsDir: PROJECTS });
      }
      if (url.includes("plans-tree")) {
        return json({
          project: "alokai",
          sources: [
            {
              id: "ch",
              label: "ch",
              absoluteRoot: "/h/git/alokai/clients/ch/openspec/changes/x",
              files: [
                {
                  source: "ch",
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
      if (url.includes("plans/read")) return json({ absolutePath: LINKED_PLAN, content: "# Plan" });
      if (url.includes("/wiki") && url.startsWith("/api/projects/")) {
        return json({
          project: "pavilio",
          overview: null,
          entities: { count: 0, kinds: [] },
          concepts: { count: 0, pages: [] },
          repos: { count: 0, repos: [] },
          interaction: { count: 0, openQuestions: null, openQuestionsCount: 0, notes: [], questions: [] },
          sources: { count: 0, kinds: [] },
          other: [],
        });
      }
      if (url.startsWith("/api/files/exists")) return json({ exists: {} });
      if (url.startsWith("/api/files/read/")) return json({ content: note, absolutePath: NOTE });
      return new Response("not found", { status: 404 });
    }),
  );
}

function BreadcrumbSlot() {
  const { actions } = useContext(BreadcrumbActionsContext);
  return <div data-testid="breadcrumb-slot">{actions}</div>;
}

describe("markdown surfaces", () => {
  beforeEach(() => {
    __resetWorkspaceRootForTests();
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

  it("keys a page by its path relative to the projects directory", () => {
    expect(docSpeechKeyFor(NOTE, PROJECTS)).toBe("doc:pavilio/wiki/x.md");
    // A file outside the projects directory has no project: a `..` path.
    expect(docSpeechKeyFor(`${ROOT}/AGENTS.md`, PROJECTS)).toBe("doc:../AGENTS.md");
  });

  it("each markdown surface passes speech for .md files", async () => {
    const pressAndExpect = async (testId: string, key: string, text: string) => {
      const button = await screen.findByTestId(testId);
      await waitFor(() => expect(button).not.toBeDisabled());
      speak().mockClear();
      fireEvent.click(button);
      expect(speak()).toHaveBeenCalledWith({ key, text });
    };

    // Section file viewer: a real viewer path keys by the projects dir.
    const fileViewer = render(
      <Host>
        <FileViewer filePath="pavilio/wiki/x.md" content="# Note" absolutePath={NOTE} loading={false} />
      </Host>,
    );
    await pressAndExpect("file-viewer-play", "doc:pavilio/wiki/x.md", "# Note");
    fileViewer.unmount();

    // ...and a non-markdown file gets no Play.
    const jsonViewer = render(
      <Host>
        <FileViewer
          filePath="pavilio/_index.json"
          content="{}"
          absolutePath={`${PROJECTS}/pavilio/_index.json`}
          loading={false}
        />
      </Host>,
    );
    await screen.findByTestId("file-viewer-copy-path");
    await waitFor(() => expect(screen.getByTestId("file-viewer-copy-path")).not.toBeDisabled());
    expect(screen.queryByTestId("file-viewer-play")).toBeNull();
    jsonViewer.unmount();

    // Standalone /view/* viewer, through the breadcrumb slot.
    const viewer = render(
      <Host>
        <BreadcrumbActionsProvider>
          <MemoryRouter initialEntries={["/view/pavilio/wiki/x.md"]}>
            <BreadcrumbSlot />
            <Routes>
              <Route path="/view/*" element={<MarkdownViewer />} />
            </Routes>
          </MemoryRouter>
        </BreadcrumbActionsProvider>
      </Host>,
    );
    await pressAndExpect("markdown-viewer-play", "doc:pavilio/wiki/x.md", "# Note");
    viewer.unmount();

    // Plans tab: a plan in a linked repo outside the projects dir.
    const plans = render(
      <Host>
        <MemoryRouter initialEntries={[`/?file=${encodeURIComponent(LINKED_PLAN)}`]}>
          <PlansTab projectName="alokai" />
        </MemoryRouter>
      </Host>,
    );
    await pressAndExpect(
      "file-viewer-play",
      "doc:../../../alokai/clients/ch/openspec/changes/x/tasks.md",
      "# Plan",
    );
    plans.unmount();

    // Wiki tab: the page source as loaded, frontmatter and all — the host's
    // `speakDocument` is what leaves the frontmatter unspoken.
    const wikiPage = "---\ntitle: X\ntags: [a]\n---\n# Note";
    stubServer(wikiPage);
    const wiki = render(
      <Host>
        <MemoryRouter
          initialEntries={[`/project/pavilio/wiki?file=${encodeURIComponent("pavilio/wiki/x.md")}`]}
        >
          <WikiTab projectName="pavilio" />
        </MemoryRouter>
      </Host>,
    );
    await pressAndExpect("file-viewer-play", "doc:pavilio/wiki/x.md", wikiPage);
    wiki.unmount();

    // Mockup frame: never.
    const mockup = render(
      <Host>
        <MockupFrame
          filePath="pavilio/mockups/boot.html"
          absolutePath={`${PROJECTS}/pavilio/mockups/boot.html`}
        />
      </Host>,
    );
    await waitFor(() => expect(screen.getByTestId("mockup-viewer-copy-path")).not.toBeDisabled());
    expect(screen.queryByTestId("mockup-viewer-play")).toBeNull();
    expect(screen.queryByTestId("file-viewer-play")).toBeNull();
    mockup.unmount();
  });

  // Leaving a page stops its run as soon as the next file is asked for, not
  // when that file has loaded: until then the viewer still holds the previous
  // page's path, and a key built from it would keep the old run going.
  it("navigating the /view/* viewer stops the old page before the next one loads", async () => {
    const OTHER = `${PROJECTS}/pavilio/wiki/y.md`;
    const served = vi.mocked(fetch);
    const serve = served.getMockImplementation()!;
    let release: () => void = () => {};
    served.mockImplementation(async (input) => {
      if (!String(input).startsWith("/api/files/read/pavilio/wiki/y.md")) return serve(input);
      await new Promise<void>((r) => (release = r));
      return json({ content: "# Other", absolutePath: OTHER });
    });

    let navigate: NavigateFunction = () => {};
    function Navigator() {
      navigate = useNavigate();
      return null;
    }
    render(
      <Host>
        <BreadcrumbActionsProvider>
          <MemoryRouter initialEntries={["/view/pavilio/wiki/x.md"]}>
            <Navigator />
            <BreadcrumbSlot />
            <Routes>
              <Route path="/view/*" element={<MarkdownViewer />} />
            </Routes>
          </MemoryRouter>
        </BreadcrumbActionsProvider>
      </Host>,
    );
    const button = await screen.findByTestId("markdown-viewer-play");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(stop()).not.toHaveBeenCalled();

    const mark = spoken.paths.length;
    act(() => navigate("/view/pavilio/wiki/y.md"));

    // Not one render for y.md offered x.md's speech — not even the first one,
    // before the switch effect had run — and x.md's run is already stopped.
    expect(spoken.paths.length).toBeGreaterThan(mark);
    expect(spoken.paths.slice(mark)).not.toContain(NOTE);
    expect(stop()).toHaveBeenCalledWith("doc:pavilio/wiki/x.md");
    expect(bar("doc:pavilio/wiki/x.md")).toBeNull();
    // ...all while the next file's read is still pending; let it land now.
    await act(async () => release());
  });

  it("switching the section file viewer stops the old page before the next one loads", async () => {
    const OTHER = `${PROJECTS}/pavilio/wiki/y.md`;
    const served = vi.mocked(fetch);
    const serve = served.getMockImplementation()!;
    let release: () => void = () => {};
    served.mockImplementation(async (input) => {
      if (!String(input).startsWith("/api/files/read/pavilio/wiki/y.md")) return serve(input);
      await new Promise<void>((r) => (release = r));
      return json({ content: "# Other", absolutePath: OTHER });
    });

    // The section viewer as `ProjectView` wires it: the real `useFileViewer`
    // driving `FileViewer` from the `?file=` param.
    let select: (path: string | null) => void = () => {};
    function Section() {
      const fv = useFileViewer({ project: "pavilio", section: "notes" });
      select = fv.setSelectedFile;
      return fv.selectedFile ? (
        <FileViewer
          filePath={fv.selectedFile}
          content={fv.content}
          absolutePath={fv.absolutePath}
          loading={fv.loading}
        />
      ) : null;
    }
    render(
      <Host>
        <MemoryRouter initialEntries={[`/?file=${encodeURIComponent("pavilio/wiki/x.md")}`]}>
          <Section />
        </MemoryRouter>
      </Host>,
    );
    const button = await screen.findByTestId("file-viewer-play");
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(stop()).not.toHaveBeenCalled();

    const mark = spoken.paths.length;
    act(() => select("pavilio/wiki/y.md"));

    expect(spoken.paths.length).toBeGreaterThan(mark);
    expect(spoken.paths.slice(mark)).not.toContain(NOTE);
    expect(stop()).toHaveBeenCalledWith("doc:pavilio/wiki/x.md");
    expect(bar("doc:pavilio/wiki/x.md")).toBeNull();

    // The next file's speech arrives with its content.
    await act(async () => release());
    await waitFor(() => expect(spoken.paths.at(-1)).toBe(OTHER));
  });
});
