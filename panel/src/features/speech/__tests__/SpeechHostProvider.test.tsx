import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { SpeechHostProvider, usePanelSpeech, type FocusedCellPort } from "../SpeechHostProvider";
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
  host: { marker: "the host" } as unknown,
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
    expect(args?.isSessionOpen).toBe(isSessionOpen);
    expect(seen.transportArrivals.at(-1)).toBe(onArrival);
    expect(seen.keyArrivals.at(-1)).toBe(onArrival);
    // The looked-at rule is rechecked on a focus change the port reports.
    expect(focusedCell.subscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
