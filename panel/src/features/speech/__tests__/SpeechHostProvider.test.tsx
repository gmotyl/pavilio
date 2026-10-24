import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import {
  SpeechHostProvider,
  usePageSpeech,
  usePanelSpeech,
  type FocusedCellPort,
  type PageSpeech,
} from "../SpeechHostProvider";
import type { AnswerWaitingPort } from "../useSpeechHost";
import type { GridSpeech } from "../types";

/**
 * The provider knows nothing about terminals: sessions, focus, drawer
 * visibility, arrival dismissal, answer waiting and voices all come in as
 * props. The host and the two document-wide hooks are stubbed so the suite can
 * see exactly what the provider hands them.
 */
const seen = vi.hoisted(() => ({
  hostArgs: [] as Array<Record<string, unknown>>,
  transportArrivals: [] as unknown[],
  keyArrivals: [] as unknown[],
  host: {
    marker: "the host",
    speakDocument: vi.fn(),
    stopDocument: vi.fn(),
  } as unknown as {
    speakDocument: ReturnType<typeof vi.fn>;
    stopDocument: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("../useSpeechHost", () => {
  const useSpeechHost = (args: Record<string, unknown>) => {
    seen.hostArgs.push(args);
    return seen.host;
  };
  return { useSpeechHost, default: useSpeechHost };
});
vi.mock("../useMediaSessionTransport", () => ({
  useMediaSessionTransport: (_target: unknown, onArrival: unknown) => {
    seen.transportArrivals.push(onArrival);
  },
}));
vi.mock("../useSpeechKeys", () => ({
  useSpeechKeys: (_target: unknown, onArrival: unknown) => {
    seen.keyArrivals.push(onArrival);
  },
}));

afterEach(() => {
  seen.hostArgs.length = 0;
  seen.host.speakDocument.mockClear();
  seen.host.stopDocument.mockClear();
  seen.transportArrivals.length = 0;
  seen.keyArrivals.length = 0;
});

describe("SpeechHostProvider", () => {
  it("the provider serves usePanelSpeech to its children from props alone", () => {
    const answerWaiting: AnswerWaitingPort = {
      get: () => ({ waiting: false, pending: false }),
      hold: () => {},
      release: () => {},
      noteTransport: () => {},
      isHeld: () => false,
    };
    const voiceFor = vi.fn(() => "a-voice");
    const onArrival = vi.fn();
    const isSessionOpen = vi.fn(() => true);
    const unsubscribe = vi.fn();
    const focusedCell: FocusedCellPort = {
      read: vi.fn(() => null),
      readStandalone: vi.fn(() => null),
      subscribe: vi.fn(() => unsubscribe),
    };
    let served: GridSpeech | null = null;
    function Reader() {
      served = usePanelSpeech();
      return null;
    }

    const { unmount } = render(
      <SpeechHostProvider
        sessionOf={() => undefined}
        isSessionOpen={isSessionOpen}
        focusedCell={focusedCell}
        drawerVisible={false}
        onArrival={onArrival}
        answerWaiting={answerWaiting}
        voiceFor={voiceFor}
      >
        <Reader />
      </SpeechHostProvider>,
    );

    expect(served).toBe(seen.host);
    const args = seen.hostArgs.at(-1);
    expect(args?.answerWaiting).toBe(answerWaiting);
    expect(args?.voiceFor).toBe(voiceFor);
    // Handed through behind the page wrapper: a cell's session is asked of
    // the panel's port as before.
    expect((args?.isSessionOpen as (id: string) => boolean)("sess-1")).toBe(true);
    expect(isSessionOpen).toHaveBeenCalledWith("sess-1");
    expect(seen.transportArrivals.at(-1)).toBe(onArrival);
    expect(seen.keyArrivals.at(-1)).toBe(onArrival);
    // The looked-at rule is rechecked on a focus change the port reports.
    expect(focusedCell.subscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("doc key counts as open only while spoken", () => {
    const isSessionOpen = vi.fn(() => false);
    let page: PageSpeech | null = null;
    function Reader() {
      page = usePageSpeech();
      return null;
    }

    render(
      <SpeechHostProvider
        sessionOf={() => undefined}
        isSessionOpen={isSessionOpen}
        focusedCell={{ read: () => null, readStandalone: () => null, subscribe: () => () => {} }}
        drawerVisible={false}
        onArrival={vi.fn()}
        answerWaiting={{
          get: () => ({ waiting: false, pending: false }),
          hold: () => {},
          release: () => {},
          noteTransport: () => {},
          isHeld: () => false,
        }}
        voiceFor={() => "a-voice"}
      >
        <Reader />
      </SpeechHostProvider>,
    );
    const isOpen = seen.hostArgs.at(-1)?.isSessionOpen as (id: string) => boolean;
    const key = "doc:p/page.md";
    expect(isOpen(key)).toBe(false);

    page!.speakDocument({ key, text: "Hello." });
    expect(seen.host.speakDocument).toHaveBeenCalledWith({ key, text: "Hello." });
    expect(isOpen(key)).toBe(true);
    // A doc key is the page's to answer, never the terminal port's.
    expect(isSessionOpen).not.toHaveBeenCalledWith(key);

    page!.stopDocument(key);
    expect(seen.host.stopDocument).toHaveBeenCalledWith(key);
    expect(isOpen(key)).toBe(false);
  });

  it("usePageSpeech throws without a provider", () => {
    function Reader() {
      usePageSpeech();
      return null;
    }
    // React reports the render error on the console as well as throwing it.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Reader />)).toThrow(/usePageSpeech: no <SpeechHostProvider>/);
    quiet.mockRestore();
  });
});
