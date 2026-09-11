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
  /** A synthesizer that is simply down, for the three-consecutive-failures rule. */
  let failing = false;

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
      if (failing) throw new Error("the synthesizer is down");
      return bufferFor(text);
    },
    setFailing: (value: boolean): void => {
      failing = value;
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
      failing = false;
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

/**
 * Counts *mounted instances* of the two hooks the host owns — not renders. The
 * panel is allowed exactly one of each; before the host was hoisted out of the
 * surfaces there was one per surface, and two surfaces are mounted at once.
 */
const hosts = vi.hoisted(() => {
  const players = new Set<number>();
  const channels = new Set<number>();
  let seq = 0;
  return {
    players,
    channels,
    next: () => {
      seq += 1;
      return seq;
    },
    reset: () => {
      players.clear();
      channels.clear();
    },
  };
});

vi.mock("../useSpeechPlayer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useSpeechPlayer")>();
  const React = await import("react");
  return {
    ...actual,
    useSpeechPlayer: (opts: Parameters<typeof actual.useSpeechPlayer>[0]) => {
      const id = React.useRef<number | null>(null);
      if (id.current === null) id.current = hosts.next();
      hosts.players.add(id.current);
      return actual.useSpeechPlayer(opts);
    },
  };
});

vi.mock("../useUtteranceChannel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useUtteranceChannel")>();
  const React = await import("react");
  return {
    ...actual,
    useUtteranceChannel: (opts: Parameters<typeof actual.useUtteranceChannel>[0]) => {
      const id = React.useRef<number | null>(null);
      if (id.current === null) id.current = hosts.next();
      hosts.channels.add(id.current);
      return actual.useUtteranceChannel(opts);
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
import { SpeechHostProvider } from "../SpeechHostProvider";
import { dismissToast, getToastSnapshot } from "../../../lib/toast";
import { prepare } from "../prepare";
import { setStoredArmedSession } from "../voices";

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
      <SpeechHostProvider>
        <ProjectTerminalsSurface projectName="vector" active />
      </SpeechHostProvider>
    </MemoryRouter>,
  );
  await act(async () => {
    await drain();
  });
}

/**
 * Both surfaces at once, under the one provider — the arrangement the real
 * panel is in the whole time the terminal drawer is open over the iTerm view
 * (`ProjectView.tsx` and `TerminalDrawer.tsx` each mount one).
 */
async function renderBothViews(): Promise<void> {
  render(
    <MemoryRouter>
      <SpeechHostProvider>
        {/* ProjectView's iTerm surface. */}
        <ProjectTerminalsSurface projectName="vector" active />
        {/* TerminalDrawer's, mounted over it on Cmd+B. */}
        <ProjectTerminalsSurface projectName="vector" active={false} fill />
      </SpeechHostProvider>
    </MemoryRouter>,
  );
  await act(async () => {
    await drain();
  });
}

/** One cell's control in each view: the main surface first, the drawer second. */
const controls = (kind: "speak" | "autoplay", sessionId: string): HTMLElement[] =>
  screen.getAllByTestId(`terminal-cell-${kind}-${sessionId}`);

/** What each view says about a cell's arming, in view order. */
const armedInViews = (sessionId: string): (string | null)[] =>
  controls("autoplay", sessionId).map((el) => el.getAttribute("data-armed"));

async function clickIn(
  view: number,
  kind: "speak" | "autoplay",
  sessionId: string,
): Promise<void> {
  await act(async () => {
    fireEvent.click(controls(kind, sessionId)[view]);
    await drain();
  });
}

/**
 * Spends a user gesture inside one view. An `<audio>` element is unlocked by a
 * click that reaches *it*, so a second host would need its own — this is how a
 * user who touches both views gets there. The toggle is clicked twice so the
 * armed cell ends exactly where it started, which keeps the script identical
 * whether the panel has one host or (the bug) one per surface.
 */
async function clickAround(view: number, sessionId: string): Promise<void> {
  await clickIn(view, "autoplay", sessionId);
  await clickIn(view, "autoplay", sessionId);
}

/** How many times the panel hydrated `/api/speech/latest` — one per channel. */
const latestFetches = (): number =>
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    (call) => call[0] === "/api/speech/latest",
  ).length;

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

/** The same shape, in Polish: the diacritics are what vote the session `pl`. */
function longPolishResponse(): string {
  return Array.from({ length: 12 }, (_, i) => {
    const head = `Akapit ${String(i).padStart(2, "0")} zażółć gęślą jaźń `;
    return head + "ę".repeat(238 - head.length) + ".";
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
  hosts.reset();
  // The toast store is a module singleton, so a toast raised by one test would
  // otherwise still be standing in the next one.
  dismissToast();
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

  it("a response with nothing to say is not announced anywhere", async () => {
    await renderProjectSurface();
    await arm("cell-a");

    // Only code: it strips to nothing, so there is nothing to say — on the
    // armed cell and on an unarmed one alike.
    const codeOnly = "```ts\nconst x = 1;\n```\n";
    await emitUtterance("cell-a", "a1", codeOnly);
    await emitUtterance("cell-b", "b1", codeOnly);

    // No audio, no pip, no pulse: `empty` is the only inert state, and this is
    // what the click-time check could never give — by then the pip has stood
    // there for however long the user took to notice it.
    expect(played).toEqual([]);
    expect(synth.requests).toEqual([]);
    for (const id of ["cell-a", "cell-b"]) {
      expect(speakState(id)).toBe("empty");
      expect(screen.getByTestId(`terminal-cell-speak-${id}`).getAttribute("data-pulse")).not.toBe(
        "1",
      );
    }
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
    // A refusal is reported by the pip, not by a toast: the two kinds of
    // failure have two different surfaces and must not borrow each other's.
    expect(getToastSnapshot()).toBeNull();
  });

  it("three consecutive synthesis failures are surfaced with a toast", async () => {
    // `spec.md`: three consecutive unit failures stop playback AND surface the
    // failure. Without a handler for `kind: "synthesis"` the stop reaches
    // neither the user nor the console — a present handler suppresses the
    // player's own `console.error` fallback.
    synth.setFailing(true);

    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", longResponse());

    await waitFor(() => expect(getToastSnapshot()?.kind).toBe("error"));
    expect(getToastSnapshot()?.text).toMatch(/speech/i);
    // Consecutive is the point: the run stops at the third failure rather than
    // hammering the synthesizer unit after unit.
    expect(synth.requests).toHaveLength(3);
    expect(played).toEqual([]);
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
    // Every budgeted unit, and then the marker. The marker is an addition to
    // the spoken sequence, never one of the budgeted units — it displaces none
    // of them, which is what the slice below pins.
    expect(synth.requests).toHaveLength(prepared.spokenUnits + 1);
    expect(synth.requests.slice(0, prepared.spokenUnits)).toEqual(
      prepared.units.slice(0, prepared.spokenUnits).map((unit) => unit.text),
    );
    expect(synth.requests[prepared.spokenUnits]).toBe(
      `End of the excerpt. Remaining paragraphs: ${prepared.remainderParagraphs}.`,
    );

    synth.reset();
    await click("terminal-cell-speak-cell-a");

    // And the marker has not consumed the resume point: the continue starts at
    // the first unspoken *prepared* unit, not after the marker.
    await waitFor(() => expect(synth.requests.length).toBeGreaterThan(0));
    expect(synth.requests[0]).toBe(prepared.units[prepared.spokenUnits].text);
  });

  it("no closing marker is spoken when nothing was truncated", async () => {
    await renderProjectSurface();
    await arm("cell-a");

    const markdown = "A short answer. It fits the budget with room to spare.";
    // Fixture guard: nothing to report as remaining.
    expect(prepare(markdown).remainderParagraphs).toBe(0);

    await emitUtterance("cell-a", "a1", markdown);
    await endRun();

    await waitFor(() => expect(speakState("cell-a")).toBe("heard"));
    expect(synth.requests.join(" ")).not.toMatch(/remaining paragraphs/i);
  });

  it("the closing marker is spoken in the session's language", async () => {
    await renderProjectSurface();
    await arm("cell-a");

    // Two Polish votes are what flip the session; no single response can.
    await emitUtterance("cell-a", "a1", "Zażółć gęślą jaźń. To jest odpowiedź.");
    await endRun();
    await emitUtterance("cell-a", "a2", "Drugie zdanie po polsku. Wciąż mówię tak samo.");
    await endRun();

    const markdown = longPolishResponse();
    const prepared = prepare(markdown, { language: "pl" });
    expect(prepared.remainderParagraphs).toBeGreaterThan(0);

    synth.reset();
    await emitUtterance("cell-a", "a3", markdown);
    await endRun();

    // The marker speaks the session's language, not the panel's default — an
    // English sentence at the end of a Polish answer is the failure here.
    expect(synth.requests[synth.requests.length - 1]).toBe(
      `Koniec fragmentu. Pozostałe akapity: ${prepared.remainderParagraphs}.`,
    );
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
        <SpeechHostProvider>
          <TerminalsPage />
        </SpeechHostProvider>
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

/**
 * The panel mounts `ProjectTerminalsSurface` twice at once — ProjectView's and
 * the terminal drawer's — so hosting the channel and the player *per surface*
 * gave the panel two of each: the same utterance echoed twice, two cells could
 * talk over each other, and the armed cell was per-surface rather than per
 * browser. These pin the single host.
 */
describe("one speech host for the panel, not one per surface", () => {
  it("two mounted surfaces are one voice, not two", async () => {
    // A returning browser: the armed cell is restored from storage by whatever
    // mounts, so both views come up armed on the same cell (DECISION 12).
    setStoredArmedSession("cell-a");

    await renderBothViews();
    // Fixture guard: this really is the two-surface arrangement, not one.
    expect(controls("autoplay", "cell-a")).toHaveLength(2);
    expect(armedInViews("cell-a")).toEqual(["1", "1"]);

    // The user works in both views, as they do whenever the drawer is open.
    await clickAround(0, "cell-a");
    await clickAround(1, "cell-a");

    // One sentence, so one unit: anything beyond a single synthesis request
    // here is a second host paying for the same words.
    await emitUtterance("cell-a", "a1", "Only one voice for the panel.");

    // Criterion 7 at the panel level: one playback, one `<audio>` element, one
    // synthesis — never one of each per mounted surface.
    expect(played).toEqual(["blob:Only one voice for the panel."]);
    expect(new Set(elements).size).toBe(1);
    expect(synth.requests).toEqual(["Only one voice for the panel."]);
    // And the structural reason, counted directly.
    expect(hosts.players.size).toBe(1);
    expect(hosts.channels.size).toBe(1);
    // One channel is also one hydration of the latest-per-session store.
    expect(latestFetches()).toBe(1);
  });

  it("arming stays exclusive across both views", async () => {
    await renderBothViews();
    expect(armedInViews("cell-a")).toEqual(["0", "0"]);

    await clickIn(0, "autoplay", "cell-a");

    // The drawer is not a second browser: it shows the same armed cell.
    expect(armedInViews("cell-a")).toEqual(["1", "1"]);

    // Arming from the *other* view disarms the first cell everywhere — one
    // armed cell per browser, whichever view it was armed from.
    await clickIn(1, "autoplay", "cell-b");

    expect(armedInViews("cell-a")).toEqual(["0", "0"]);
    expect(armedInViews("cell-b")).toEqual(["1", "1"]);
  });

  it("a freshly hydrated tab does not start talking on its own", async () => {
    // The browser remembers an armed cell and the server still holds that
    // cell's last response, so the tab comes up armed with something unheard
    // in it — and nothing has been clicked yet.
    setStoredArmedSession("cell-a");
    global.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            utterances: [
              {
                id: "a1",
                sessionId: "cell-a",
                text: "Said while the tab was away.",
                at: 1,
              },
            ],
          }),
        }) as Response,
    ) as unknown as typeof fetch;

    await renderProjectSurface();

    expect(armed("cell-a")).toBe("1");
    // No gesture has reached the `<audio>` element, so this must be absorbed:
    // a page that starts talking by itself is what the lock gate prevents.
    expect(played).toEqual([]);
    expect(synth.requests).toEqual([]);
    expect(speakState("cell-a")).toBe("unheard");
  });
});
