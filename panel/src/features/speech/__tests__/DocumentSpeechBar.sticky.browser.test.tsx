import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useContext, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeSpeech, synthMock } from "./speech.harness";
import type { AnswerWaitingPort, SpeechHost } from "../useSpeechHost";

/**
 * The page speech row, unfolded, sticks to the top of the viewer's scroll area.
 *
 * Named `.browser` after the `browser` vitest project, which is jsdom: there is
 * no layout engine here, so these tests assert the structure sticky positioning
 * depends on — the row is rendered into a host that is a block child of the
 * scrolled content (not inside the breadcrumb/toolbar row, whose box would cap
 * both the stickiness and the width) — plus the cascade `src/index.css` gives
 * that host, applied for real through jsdom's computed style.
 */
const stub = vi.hoisted(() => ({ host: null as SpeechHost | null }));

vi.mock("../synth", () => synthMock());
vi.mock("../useSpeechHost", () => {
  const useSpeechHost = () => stub.host;
  return { useSpeechHost, default: useSpeechHost };
});
vi.mock("../useMediaSessionTransport", () => ({ useMediaSessionTransport: () => {} }));
vi.mock("../useSpeechKeys", () => ({ useSpeechKeys: () => {} }));
vi.mock("../../shell/vscode", () => ({ openInVSCode: vi.fn() }));
vi.mock("../../realtime/useWebSocket", () => ({
  useWebSocket: () => ({ lastMessage: null }),
}));
vi.mock("../../markdown/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

import { SpeechHostProvider } from "../SpeechHostProvider";
import { PageSpeechRowSlot } from "../PageSpeechRowHost";
import MarkdownViewer from "../../markdown/MarkdownViewer";
import {
  BreadcrumbActionsContext,
  BreadcrumbActionsProvider,
} from "../../shell/Breadcrumbs/BreadcrumbActionsProvider";
import { __resetWorkspaceRootForTests } from "../../projects/useWorkspaceRoot";

const ROOT = "/h/git/prv/projects";
const PROJECTS = `${ROOT}/projects`;
const NOTE = `${PROJECTS}/pavilio/wiki/x.md`;
const KEY = "doc:pavilio/wiki/x.md";
const TEXT = `# Note\n\n${Array.from({ length: 40 }, (_, i) => `Sentence ${i}.`).join("\n\n")}`;

const answerWaiting: AnswerWaitingPort = {
  get: () => ({ waiting: false, pending: false }),
  hold: () => {},
  release: () => {},
  noteTransport: () => {},
  isHeld: () => false,
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/** Every rule of `src/index.css` that styles the page row's host, as written. */
function hostRules(): string {
  const css = readFileSync(resolve("src/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = css.match(/[^{}]*\{[^{}]*\}/g) ?? [];
  return rules
    .filter((r) => /page-speech-row-host|viewer-speech-bar/.test(r.split("{")[0]))
    .join("\n");
}

function BreadcrumbSlot() {
  const { actions } = useContext(BreadcrumbActionsContext);
  return <nav data-testid="breadcrumb-slot">{actions}</nav>;
}

/** The shell around `/view/*`: the breadcrumb row and the page share one scroller. */
function Shell({ children }: { children: ReactNode }) {
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
      <BreadcrumbActionsProvider>
        <PageSpeechRowSlot>
          <div data-testid="scroller" style={{ overflow: "auto", height: "300px" }}>
            <BreadcrumbSlot />
            {children}
          </div>
        </PageSpeechRowSlot>
      </BreadcrumbActionsProvider>
    </SpeechHostProvider>
  );
}

function renderViewer() {
  return render(
    <Shell>
      <MemoryRouter initialEntries={["/view/pavilio/wiki/x.md"]}>
        <Routes>
          <Route path="/view/*" element={<MarkdownViewer />} />
        </Routes>
      </MemoryRouter>
    </Shell>,
  );
}

const row = () => screen.queryByTestId(`document-speech-bar-${KEY}`);
const host = () => screen.getByTestId("page-speech-row-host");

async function unfold() {
  const play = await screen.findByTestId("markdown-viewer-play");
  await waitFor(() => expect(play).not.toBeDisabled());
  fireEvent.click(play);
  await waitFor(() => expect(row()).not.toBeNull());
}

let style: HTMLStyleElement;

beforeEach(() => {
  stub.host = makeSpeech();
  __resetWorkspaceRootForTests();
  style = document.createElement("style");
  style.textContent = hostRules();
  document.head.appendChild(style);
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url.startsWith("/api/system")) {
        return json({ wslDistro: null, workspaceRoot: ROOT, projectsDir: PROJECTS });
      }
      if (url.startsWith("/api/files/exists")) return json({ exists: {} });
      if (url.startsWith("/api/files/read/")) return json({ content: TEXT, absolutePath: NOTE });
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(() => {
  style.remove();
  stub.host = null;
  vi.unstubAllGlobals();
});

describe("sticky page speech row", () => {
  it("page speech row stays at the top of the scrolled viewer", async () => {
    renderViewer();
    await unfold();

    // The row lives in the page's sticky host, inside the scrolled content —
    // not in the breadcrumb row the Play button sits in.
    const scroller = screen.getByTestId("scroller");
    expect(host().contains(row())).toBe(true);
    expect(screen.getByTestId("breadcrumb-slot").contains(row())).toBe(false);
    expect(scroller.contains(host())).toBe(true);

    // Sticky to the scroll area's top, below the sticky breadcrumb bar
    // (2.25rem, the offset the project tab row uses too), painted above the
    // page text and the ▶ layer (`.play-from-here` is z-index 1).
    const computed = getComputedStyle(host());
    expect(computed.position).toBe("sticky");
    expect(computed.top).toBe("2.25rem");
    expect(Number(computed.zIndex)).toBeGreaterThan(1);

    // Scrolling the viewer by more than the row's height keeps it in the host.
    act(() => {
      scroller.scrollTop = 600;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(host().contains(row())).toBe(true);
  });

  it("folding removes the sticky row", async () => {
    renderViewer();
    // Not playing: the host is empty, so it occupies no space.
    await screen.findByTestId("markdown-viewer-play");
    expect(host().childElementCount).toBe(0);

    await unfold();
    fireEvent.click(screen.getByTestId("markdown-viewer-play"));

    expect(row()).toBeNull();
    expect(host().childElementCount).toBe(0);
    expect(vi.mocked(stub.host!.stopDocument)).toHaveBeenCalledWith(KEY);
  });

  it("page speech row spans the full viewer width", async () => {
    renderViewer();
    await unfold();

    // The toolbar-fitting rule (`width: 0; min-width: 100%` of the button row)
    // is gone: the row's wrapper is a plain block in the host, which is a
    // block child of the viewer's content box — so both take its full width.
    const wrapper = row()!.parentElement!;
    expect(wrapper.parentElement).toBe(host());
    const w = getComputedStyle(wrapper);
    expect(w.width).not.toBe("0px");
    expect(w.minWidth).not.toBe("100%");
    expect(getComputedStyle(host()).display).not.toMatch(/flex|inline/);
  });
});
