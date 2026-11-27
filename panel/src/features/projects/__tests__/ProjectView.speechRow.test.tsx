import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { installMatchMedia } from "../../../test-utils";
import { makeSpeech, synthMock } from "../../speech/__tests__/speech.harness";
import type { AnswerWaitingPort, SpeechHost } from "../../speech/useSpeechHost";

/**
 * A project tab's page speech row is drawn in the host ProjectView mounts in
 * its sticky wrapper, right under the tab row — not in the tab's own header
 * toolbar, which scrolls away with the page.
 */
const stub = vi.hoisted(() => ({ host: null as SpeechHost | null }));

vi.mock("../../speech/synth", () => synthMock());
vi.mock("../../speech/useSpeechHost", () => {
  const useSpeechHost = () => stub.host;
  return { useSpeechHost, default: useSpeechHost };
});
vi.mock("../../speech/useMediaSessionTransport", () => ({ useMediaSessionTransport: () => {} }));
vi.mock("../../speech/useSpeechKeys", () => ({ useSpeechKeys: () => {} }));
vi.mock("../../shell/vscode", () => ({ openInVSCode: vi.fn() }));
vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));
vi.mock("../../shell/LeftSidebar", () => ({ __esModule: true, default: () => <div /> }));
vi.mock("../../shell/RightSidebar", () => ({ __esModule: true, default: () => <div /> }));
// The plans tab stands in for any tab that opens a page: its header toolbar is
// the real `ViewerActions`, handed a speech source.
vi.mock("../PlansTab", async () => {
  const { default: ViewerActions } = await import("../ViewerActions");
  return {
    __esModule: true,
    default: () => (
      <div data-testid="plans-tab-header">
        <ViewerActions
          absolutePath="/p/projects/pavilio/plans/x.md"
          relativePath="projects/pavilio/plans/x.md"
          content="# Plan"
          speech={{ key: KEY, text: "# Plan\n\nOne sentence." }}
        />
      </div>
    ),
  };
});

import ProjectView from "../ProjectView";
import { refreshProjects } from "../useProjects";
import { Layout, FloatingActionProvider } from "../../shell/Layout";
import { BreadcrumbActionsProvider } from "../../shell/Breadcrumbs";
import { TerminalDrawerProvider } from "../../terminal/useTerminalDrawer";
import { SpeechHostProvider } from "../../speech/SpeechHostProvider";

const KEY = "doc:pavilio/plans/x.md";

const answerWaiting: AnswerWaitingPort = {
  get: () => ({ waiting: false, pending: false }),
  hold: () => {},
  release: () => {},
  noteTransport: () => {},
  isHeld: () => false,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const project = {
  name: "pavilio",
  path: "/p/projects/pavilio",
  hasIndex: true,
  hasNotes: true,
  hasProgress: false,
  hasPlans: true,
  hasWiki: false,
  latestProgressDate: null,
  kind: "client",
  lastActivity: null,
  repos: [],
  archived: false,
};

function Speech({ children }: { children: ReactNode }) {
  return (
    <SpeechHostProvider
      sessionOf={() => undefined}
      isSessionOpen={() => false}
      focusedCell={{ read: () => null, readStandalone: () => null, subscribe: () => () => {} }}
      drawerVisible={false}
      onArrival={() => {}}
      answerWaiting={answerWaiting}
      voiceFor={() => "a-voice"}
      languageFor={() => "en"}
    >
      {children}
    </SpeechHostProvider>
  );
}

beforeEach(() => {
  stub.host = makeSpeech();
  installMatchMedia();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url === "/api/projects") return json([project]);
      if (url === "/api/projects/pavilio") return json(project);
      if (url === "/api/archive") return json([]);
      if (url.startsWith("/api/scripts")) return json({ scripts: [] });
      if (url.startsWith("/api/files/index")) return json([]);
      return json({}, 404);
    }),
  );
});

afterEach(() => {
  stub.host = null;
  vi.unstubAllGlobals();
});

describe("ProjectView page speech row", () => {
  it("page speech row unfolds in the sticky wrapper under the tab row", async () => {
    // `Layout` publishes the `PageSpeechRowSlot` over the breadcrumb bar and
    // the routed page, as in the app.
    render(
      <MemoryRouter initialEntries={["/project/pavilio/plans"]}>
        <FloatingActionProvider>
          <TerminalDrawerProvider>
            <BreadcrumbActionsProvider>
              <Speech>
                <Layout>
                  <Routes>
                    <Route path="/project/:name/:section" element={<ProjectView />} />
                  </Routes>
                </Layout>
              </Speech>
            </BreadcrumbActionsProvider>
          </TerminalDrawerProvider>
        </FloatingActionProvider>
      </MemoryRouter>,
    );
    await act(async () => {
      refreshProjects();
      await new Promise((r) => setTimeout(r, 20));
    });

    const host = screen.getByTestId("page-speech-row-host");
    const tabs = screen.getByTestId("project-tabs-bar");
    // Idle: the host is there, empty, so it takes no space.
    expect(host.childElementCount).toBe(0);

    const play = screen.getByTestId("file-viewer-play");
    await waitFor(() => expect(play).not.toBeDisabled());
    fireEvent.click(play);
    const row = await screen.findByTestId(`document-speech-bar-${KEY}`);

    // The row is in the host, not in the tab's header toolbar it unfolded from.
    expect(host.contains(row)).toBe(true);
    // The row carries the project's rate button, right after the scrubber.
    expect(screen.getByTestId(`speech-bar-scrubber-${KEY}`).nextElementSibling).toBe(
      screen.getByTestId("speech-bar-rate-pavilio"),
    );
    expect(screen.getByTestId("plans-tab-header").contains(row)).toBe(false);

    // The host shares the sticky wrapper with the tab row, right after it.
    const wrapper = tabs.parentElement!;
    expect(host.parentElement).toBe(wrapper);
    expect(tabs.nextElementSibling).toBe(host);
    expect(wrapper.className).toMatch(/(?:^|\s)sticky(?:\s|$)/);
    // ...stuck under the breadcrumb bar by the bar's measured height (the bar
    // carries different buttons on a phone and on a desktop), not a constant.
    expect(wrapper.style.top).toBe("var(--breadcrumb-h, 0px)");
  });
});
