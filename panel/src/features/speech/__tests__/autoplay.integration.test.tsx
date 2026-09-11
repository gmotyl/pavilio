/**
 * The end-to-end wiring: an utterance frame arrives, the channel registers it,
 * the armed cell's speech host prepares it and the player speaks it — all of it
 * driven through the real terminals surfaces, never through a hand-built
 * `speech` prop.
 *
 * Mounting `TerminalLayoutGrid` directly would be far easier to write and would
 * prove nothing: `GridSpeech` reaches the cell header as a prop, so a surface
 * that forgets to pass it leaves every cell `empty`, every callback a no-op,
 * and a grid-level suite entirely green. So these tests mount
 * `ProjectTerminalsSurface` and `TerminalsPage` — the two hosts — and read the
 * cell header's own `data-speech` / `data-armed` attributes.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Deferred synthesis, copied in spirit from `useSpeechPlayer.test.ts`: the real
 * vendored edge-tts client must never be opened, and every assertion about
 * "what spoke" is really an assertion about which unit texts were synthesized.
 */
const synth = vi.hoisted(() => {
  const buffers = new Map<string, ArrayBuffer>();
  const bufferText = new Map<ArrayBuffer, string>();
  const blobText = new Map<Blob, string>();
  let requests: string[] = [];

  function bufferFor(text: string): ArrayBuffer {
    const existing = buffers.get(text);
    if (existing) return existing;
    const buffer = new Uint8Array([text.length % 255]).buffer;
    buffers.set(text, buffer);
    bufferText.set(buffer, text);
    return buffer;
  }

  return {
    synthesizeSpeech: async (text: string): Promise<ArrayBuffer> => {
      requests.push(text);
      return bufferFor(text);
    },
    prefetchSpeech: (): void => {},
    toSpeechBlob: (buffer: ArrayBuffer): Blob => {
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      blobText.set(blob, bufferText.get(buffer) ?? "unknown");
      return blob;
    },
    textForBlob: (blob: Blob): string => blobText.get(blob) ?? "unknown",
    get requests() {
      return requests;
    },
    reset: () => {
      requests = [];
    },
  };
});

vi.mock("../synth", () => ({
  synthesizeSpeech: synth.synthesizeSpeech,
  prefetchSpeech: synth.prefetchSpeech,
  toSpeechBlob: synth.toSpeechBlob,
  SPEECH_AUDIO_MIME_TYPE: "audio/mpeg",
}));

/**
 * `prepare` stays the real one — the language it is handed is the thing under
 * test, and a stub could not tell a wrong language from a right one. The
 * wrapper only records the call.
 */
const prepareCalls = vi.hoisted(() => [] as Array<{ text: string; language?: string }>);
/** The language the most recent `prepare` was handed. */
const lastLanguage = (): string | undefined => prepareCalls[prepareCalls.length - 1]?.language;
vi.mock("../prepare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../prepare")>();
  return {
    ...actual,
    prepare: (markdown: string, opts?: { language?: "pl" | "en"; budgetChars?: number }) => {
      prepareCalls.push({ text: markdown, language: opts?.language });
      return actual.prepare(markdown, opts);
    },
  };
});

/**
 * A real, state-backed socket stand-in: `emit` pushes a frame into every mounted
 * `useWebSocket`, so a broadcast is an actual React state update rather than a
 * module variable plus a manual rerender.
 */
const ws = vi.hoisted(() => {
  const setters = new Set<(message: Record<string, unknown> | null) => void>();
  return {
    setters,
    emit(message: Record<string, unknown>) {
      for (const set of setters) set(message);
    },
  };
});

vi.mock("../../realtime/useWebSocket", async () => {
  const React = await import("react");
  return {
    useWebSocket: () => {
      const [lastMessage, setLastMessage] = React.useState<Record<string, unknown> | null>(
        null,
      );
      React.useEffect(() => {
        ws.setters.add(setLastMessage);
        return () => {
          ws.setters.delete(setLastMessage);
        };
      }, []);
      return { lastMessage };
    },
  };
});

// xterm cannot render in jsdom, and the pool's sockets are not this suite's
// subject — the cell header is.
vi.mock("../../terminal/TerminalView", () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`terminal-view-${sessionId}`} />
  ),
}));
vi.mock("../../terminal/useTerminalConnection", () => ({
  useTerminalConnection: () => "connected",
}));
vi.mock("../../terminal/TerminalActivityLed", () => ({
  TerminalActivityLed: () => <span data-testid="activity-led" />,
}));
vi.mock("../../terminal/terminalInstances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../terminal/terminalInstances")>()),
  hasExited: () => false,
  sendDismiss: () => {},
  reconnectOnActivate: () => {},
  reconnectSession: () => {},
  reconnectAllDisconnected: () => 0,
  destroyTerminal: () => {},
}));

const SESSIONS: SessionMeta[] = ["a", "b", "c"].map((suffix) => ({
  id: `cell-${suffix}`,
  name: `claude-${suffix}`,
  project: "vector",
  cwd: "/tmp",
  pid: 1000,
  createdAt: "2026-09-11T00:00:00.000Z",
}));

vi.mock("../../terminal/useTerminalSessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../terminal/useTerminalSessions")>()),
  useTerminalSessions: () => ({
    sessions: SESSIONS,
    focusedId: "cell-a",
    setFocusedId: () => {},
    createSession: async () => {},
    deleteSession: () => {},
    updateSession: () => {},
    reorder: () => {},
    tiles: [],
    placeTiles: () => {},
    applyPreset: () => {},
  }),
}));
vi.mock("../../terminal/useAllTerminalSessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../terminal/useAllTerminalSessions")>()),
  useAllTerminalSessions: () => ({
    sessions: SESSIONS,
    refresh: async () => {},
    reorder: () => {},
    tiles: [],
    placeTiles: () => {},
    applyPreset: () => {},
  }),
}));
vi.mock("../../terminal/useTerminalMaximized", () => ({
  useTerminalMaximized: () => [false, () => {}, () => {}],
}));
vi.mock("../../projects/useProjects", () => ({
  useProjects: () => [{ name: "vector", repos: [] }],
}));
vi.mock("../../projects/useITermShortcuts", () => ({
  useITermShortcuts: () => {},
}));

import type { SessionMeta } from "../../terminal/useTerminalSessions";
import ProjectTerminalsSurface from "../../terminal/ProjectTerminalsSurface";
import TerminalsPage from "../../../pages/TerminalsPage";
import { prepare } from "../prepare";

/** Every `<audio>` element the panel drove — criterion 7 is that there is one. */
const elements: HTMLMediaElement[] = [];
/** The `src` of every started playback, in order. */
const played: string[] = [];
/** Swapped per test: a browser that accepts the start, or one that refuses it. */
let playResult: () => Promise<void>;

/** Drains the microtask ladder the player runs on, without a real-timer sleep. */
async function drain(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

/** Broadcasts one `speech-utterance` frame and lets the host react to it. */
async function emitUtterance(sessionId: string, id: string, text: string): Promise<void> {
  await act(async () => {
    ws.emit({ type: "speech-utterance", id, sessionId, text, at: Date.now() });
    await drain();
  });
}

/** Ends the unit that is currently playing, as the browser's `ended` would. */
async function endCurrentUnit(): Promise<void> {
  const element = elements[elements.length - 1];
  if (!element) throw new Error("nothing is playing");
  await act(async () => {
    element.dispatchEvent(new Event("ended"));
    await drain();
  });
}

/** Ends every unit of the run that is playing, up to a bound. */
async function endRun(max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (!played.length) return;
    const before = played.length;
    await endCurrentUnit();
    if (played.length === before) return;
  }
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
    await drain();
  });
}

const speakState = (sessionId: string): string | null =>
  screen.getByTestId(`terminal-cell-speak-${sessionId}`).getAttribute("data-speech");

const armed = (sessionId: string): string | null =>
  screen.getByTestId(`terminal-cell-autoplay-${sessionId}`).getAttribute("data-armed");

async function renderProjectSurface(): Promise<void> {
  render(
    <MemoryRouter>
      <ProjectTerminalsSurface projectName="vector" active />
    </MemoryRouter>,
  );
  await act(async () => {
    await drain();
  });
}

/**
 * Arms a cell. The click is also the gesture the `<audio>` element needs, so
 * everything after it is a programmatic play riding on a real user gesture —
 * which is exactly what the browser requires.
 */
async function arm(sessionId: string): Promise<void> {
  await click(`terminal-cell-autoplay-${sessionId}`);
}

/** A response long enough that the speech budget cuts it in two. */
function longResponse(): string {
  // 240 characters a paragraph: over the 200-char packing floor so each one is
  // its own unit, and two of them exceed the 450-char ceiling so they never
  // merge. Twelve of them overrun the 1300-char budget several times over.
  return Array.from({ length: 12 }, (_, i) => {
    const head = `Paragraph ${String(i).padStart(2, "0")} `;
    return head + "x".repeat(238 - head.length) + ".";
  }).join("\n\n");
}

beforeAll(() => {
  // jsdom implements neither of these; the grid reads matchMedia on its first
  // render to decide whether it is the mobile branch.
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }),
    });
  }
});

beforeEach(() => {
  synth.reset();
  prepareCalls.length = 0;
  elements.length = 0;
  played.length = 0;
  ws.setters.clear();
  playResult = () => Promise.resolve();

  global.fetch = vi.fn(
    async () => ({ ok: true, json: async () => ({ utterances: [] }) }) as Response,
  ) as unknown as typeof fetch;

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => `blob:${synth.textForBlob(blob)}`,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });

  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    const src = this.getAttribute("src");
    // `unlock()` plays a source-less element on purpose; that is not audio.
    if (src) {
      elements.push(this);
      played.push(src);
    }
    return playResult();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

describe("autoplay — the armed cell", () => {
  it("the armed cell speaks without a click", async () => {
    await renderProjectSurface();
    await arm("cell-a");

    expect(played).toEqual([]);
    await emitUtterance("cell-a", "a1", "Hello there. This is the answer.");

    expect(played).toEqual(["blob:Hello there."]);
    expect(speakState("cell-a")).toBe("speaking");
  });

  it("an unarmed cell only pulses", async () => {
    await renderProjectSurface();
    await arm("cell-a");

    await emitUtterance("cell-b", "b1", "Nobody armed this cell.");

    expect(played).toEqual([]);
    expect(synth.requests).toEqual([]);
    expect(speakState("cell-b")).toBe("unheard");
    // The pulse is the whole notification: same attribute the activity LED uses.
    expect(
      screen.getByTestId("terminal-cell-speak-cell-b").getAttribute("data-pulse"),
    ).toBe("1");
  });

  it("only the armed cell speaks when several utterances arrive", async () => {
    await renderProjectSurface();
    await arm("cell-b");

    await emitUtterance("cell-a", "a1", "Answer from A.");
    await emitUtterance("cell-b", "b1", "Answer from B.");
    await emitUtterance("cell-c", "c1", "Answer from C.");

    expect(synth.requests).toEqual(["Answer from B."]);
    expect(speakState("cell-a")).toBe("unheard");
    expect(speakState("cell-b")).toBe("speaking");
    expect(speakState("cell-c")).toBe("unheard");
    // Criterion 7: one element for the whole panel, so "who is speaking" can
    // never be a negotiation between two of them.
    expect(new Set(elements).size).toBe(1);
  });
});

describe("autoplay — taking over and stopping", () => {
  it("a click on another cell takes over from the speaking cell", async () => {
    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", "A is speaking now.");
    await emitUtterance("cell-b", "b1", "B is waiting its turn.");
    expect(speakState("cell-a")).toBe("speaking");

    await click("terminal-cell-speak-cell-b");

    await waitFor(() => expect(speakState("cell-b")).toBe("speaking"));
    expect(synth.requests).toContain("B is waiting its turn.");
    expect(new Set(elements).size).toBe(1);
  });

  it("a barged-in cell reverts to unheard, not heard", async () => {
    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", "A is speaking now.");
    await emitUtterance("cell-b", "b1", "B is waiting its turn.");

    await click("terminal-cell-speak-cell-b");

    // `play()` resolves identically for a barge-in and for a natural end, so
    // this is the assertion that catches `await play(id); markHeard(id)`.
    await waitFor(() => expect(speakState("cell-a")).toBe("unheard"));
    expect(speakState("cell-a")).not.toBe("heard");
  });

  it("clicking stop on the speaking cell marks it heard", async () => {
    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", "A is speaking now.");
    expect(speakState("cell-a")).toBe("speaking");

    // The same control, clicked while speaking, is the stop — and the opposite
    // outcome to the barge-in above, from the same promise resolution.
    await click("terminal-cell-speak-cell-a");

    await waitFor(() => expect(speakState("cell-a")).toBe("heard"));
  });

  it("a natural end marks the cell heard", async () => {
    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", "A short answer.");

    await endRun();

    await waitFor(() => expect(speakState("cell-a")).toBe("heard"));
  });
});

describe("autoplay — refusal and the budget", () => {
  it("a refused autoplay falls back to unheard", async () => {
    // The browser refuses the start even though a gesture reached the element:
    // `unlocked` says a gesture happened, never that playback is permitted.
    playResult = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));

    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", "This one will be refused.");

    await waitFor(() => expect(speakState("cell-a")).toBe("unheard"));
    expect(speakState("cell-a")).not.toBe("heard");
  });

  it("continuing after the budget resumes at the first unspoken unit", async () => {
    const markdown = longResponse();
    const prepared = prepare(markdown);
    // Fixture guard: without a remainder there is nothing to continue to.
    expect(prepared.spokenUnits).toBeGreaterThan(0);
    expect(prepared.spokenUnits).toBeLessThan(prepared.units.length);

    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", markdown);

    await endRun();
    // The budget cut is not the end of the response: the cell is left with
    // something unheard, which is the chart's `Paused`.
    await waitFor(() => expect(speakState("cell-a")).toBe("unheard"));
    expect(synth.requests).toHaveLength(prepared.spokenUnits);

    synth.reset();
    await click("terminal-cell-speak-cell-a");

    await waitFor(() => expect(synth.requests.length).toBeGreaterThan(0));
    expect(synth.requests[0]).toBe(prepared.units[prepared.spokenUnits].text);
  });
});

describe("autoplay — the surfaces and the session language", () => {
  it("the terminals surface wires its cells to the channel", async () => {
    await renderProjectSurface();

    // An unwired grid reports `empty` for every cell forever, and its autoplay
    // toggle never changes — that is exactly what this pins.
    expect(speakState("cell-a")).toBe("empty");
    await emitUtterance("cell-a", "a1", "Wired to the channel.");
    expect(speakState("cell-a")).toBe("unheard");

    expect(armed("cell-a")).toBe("0");
    await arm("cell-a");
    expect(armed("cell-a")).toBe("1");
  });

  it("the standalone terminals page wires its cells to the channel", async () => {
    render(
      <MemoryRouter>
        <TerminalsPage />
      </MemoryRouter>,
    );
    await act(async () => {
      await drain();
    });

    expect(speakState("cell-a")).toBe("empty");
    await emitUtterance("cell-a", "a1", "Wired to the channel.");
    expect(speakState("cell-a")).toBe("unheard");

    await arm("cell-a");
    expect(armed("cell-a")).toBe("1");
  });

  it("the session language accumulates across utterances", async () => {
    await renderProjectSurface();
    await arm("cell-a");

    // One Polish utterance is not enough — a session's language is a tally, so
    // no single response can flip the pronunciation map on.
    await emitUtterance("cell-a", "a1", "Zażółć gęślą jaźń. To jest odpowiedź.");
    expect(lastLanguage()).toBe("en");

    await emitUtterance("cell-a", "a2", "Drugie zdanie po polsku. Wciąż mówię tak samo.");
    expect(lastLanguage()).toBe("pl");

    await emitUtterance("cell-a", "a3", "Trzecie zdanie, dalej po polsku.");
    expect(lastLanguage()).toBe("pl");
  });
});
