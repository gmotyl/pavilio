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
 *
 * It keeps the real module's **cache** as well, keyed on voice + text exactly
 * as `synth.ts` keys it, and records a request only on a miss. Warming is worth
 * nothing unless the click that follows hits that cache, and a stub that
 * re-synthesized on every call — or a no-op `prefetchSpeech` — would report a
 * warmed panel as green while every click still paid for a fresh synthesis.
 */
const synth = vi.hoisted(() => {
  const buffers = new Map<string, ArrayBuffer>();
  const bufferText = new Map<ArrayBuffer, string>();
  const blobText = new Map<Blob, string>();
  const cache = new Map<string, Promise<ArrayBuffer>>();
  let requests: string[] = [];
  /** The voice each request carried, in the same order. */
  let requestVoices: (string | undefined)[] = [];
  /** A synthesizer that is simply down, for the three-consecutive-failures rule. */
  let failing = false;
  /** A synthesizer that goes down partway: the first `n` requests succeed. */
  let healthyRequests = Number.POSITIVE_INFINITY;
  /**
   * A synthesizer that has taken the request but not answered yet. Without it
   * every synthesis settles inside the same microtask drain as the frame that
   * asked for it, so `preparing` — the red before the audio is in hand — would
   * never be observable, and a control that never showed it would pass.
   */
  let held: Promise<void> | null = null;
  let releaseHeld: (() => void) | null = null;

  function bufferFor(text: string): ArrayBuffer {
    const existing = buffers.get(text);
    if (existing) return existing;
    const buffer = new Uint8Array([text.length % 255]).buffer;
    buffers.set(text, buffer);
    bufferText.set(buffer, text);
    return buffer;
  }

  function synthesizeSpeech(text: string, options: { voice?: string } = {}): Promise<ArrayBuffer> {
    const key = `${options.voice ?? ""}::${text}`;
    const cached = cache.get(key);
    if (cached) return cached;

    requests.push(text);
    requestVoices.push(options.voice);
    const promise = (async (): Promise<ArrayBuffer> => {
      if (held) await held;
      if (failing || requests.length > healthyRequests) {
        throw new Error("the synthesizer is down");
      }
      return bufferFor(text);
    })();

    cache.set(key, promise);
    // Never cache a failure, as the real module does not: a retry must be able
    // to reach the synthesizer again.
    void promise.catch(() => {
      if (cache.get(key) === promise) cache.delete(key);
    });
    return promise;
  }

  return {
    synthesizeSpeech,
    setFailing: (value: boolean): void => {
      failing = value;
    },
    /** Lets the run speak `count` units and fails everything after them. */
    setHealthyRequests: (count: number): void => {
      healthyRequests = count;
    },
    /** Takes every further request without answering it. */
    hold: (): void => {
      held = new Promise<void>((resolve) => {
        releaseHeld = resolve;
      });
    },
    /** Answers everything taken while held. */
    release: (): void => {
      const resolve = releaseHeld;
      held = null;
      releaseHeld = null;
      resolve?.();
    },
    /** Exactly what the real one is: a fire-and-forget `synthesizeSpeech`. */
    prefetchSpeech: (text: string, options: { voice?: string } = {}): void => {
      void synthesizeSpeech(text, options).catch(() => {});
    },
    toSpeechBlob: (buffer: ArrayBuffer): Blob => {
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      blobText.set(blob, bufferText.get(buffer) ?? "unknown");
      return blob;
    },
    textForBlob: (blob: Blob): string => blobText.get(blob) ?? "unknown",
    get requests() {
      return requests;
    },
    get requestVoices() {
      return requestVoices;
    },
    reset: () => {
      requests = [];
      requestVoices = [];
      cache.clear();
      failing = false;
      healthyRequests = Number.POSITIVE_INFINITY;
      releaseHeld?.();
      held = null;
      releaseHeld = null;
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
import { SPEECH_VOICE_STORAGE_KEY, setStoredArmedSession } from "../voices";

/** Every `<audio>` element the panel drove — criterion 7 is that there is one. */
const elements: HTMLMediaElement[] = [];
/** The `src` of every started playback, in order. */
const played: string[] = [];
/**
 * Every object URL the player materialized — one per unit it actually loaded.
 * A resume must not appear here: it re-issues `play()` on the source the
 * element is still holding, where a restart would build the unit again.
 */
const objectUrls: string[] = [];
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

/** The control's other channel: what a click would do, not where the audio is. */
const speakIcon = (sessionId: string): string | null =>
  screen.getByTestId(`terminal-cell-speak-${sessionId}`).getAttribute("data-icon");

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

/**
 * A response of `count` units, comfortably inside the budget: every paragraph
 * is one sentence over the 200-char packing floor and under the 450-char
 * ceiling, so it is neither merged with its neighbour nor cut in half.
 */
function shortResponse(count: number): string {
  return Array.from({ length: count }, (_, i) => {
    const head = `Paragraph ${String(i).padStart(2, "0")} `;
    return head + "x".repeat(238 - head.length) + ".";
  }).join("\n\n");
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
  // The picked voice is a per-browser preference in localStorage, so one test's
  // choice would otherwise still be in force in the next.
  localStorage.removeItem(SPEECH_VOICE_STORAGE_KEY);
  hosts.reset();
  // The toast store is a module singleton, so a toast raised by one test would
  // otherwise still be standing in the next one.
  dismissToast();
  prepareCalls.length = 0;
  elements.length = 0;
  played.length = 0;
  objectUrls.length = 0;
  ws.setters.clear();
  playResult = () => Promise.resolve();

  global.fetch = vi.fn(
    async () => ({ ok: true, json: async () => ({ utterances: [] }) }) as Response,
  ) as unknown as typeof fetch;

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      const url = `blob:${synth.textForBlob(blob)}`;
      objectUrls.push(url);
      return url;
    },
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

  it("an unarmed cell is warmed but silent", async () => {
    await renderProjectSurface();
    await arm("cell-a");

    await emitUtterance("cell-b", "b1", "Nobody armed this cell.");

    // Warming is not a quiet autoplay: the first unit is synthesized so the
    // click is instant, and NOTHING is handed to the audio element. A warm that
    // could make a sound would be far worse than a slow click.
    expect(synth.requests).toEqual(["Nobody armed this cell."]);
    expect(played).toEqual([]);
    expect(speakState("cell-b")).toBe("ready");
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

    // Every cell is warmed — the decision is that a lit control anywhere is
    // ready, not only the armed one — but only the armed cell's audio is
    // handed to the element.
    expect(new Set(synth.requests)).toEqual(
      new Set(["Answer from A.", "Answer from B.", "Answer from C."]),
    );
    expect(played).toEqual(["blob:Answer from B."]);
    expect(speakState("cell-a")).toBe("ready");
    expect(speakState("cell-b")).toBe("speaking");
    expect(speakState("cell-c")).toBe("ready");
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

  it("a barged-in cell reverts to ready, not heard", async () => {
    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", "A is speaking now.");
    await emitUtterance("cell-b", "b1", "B is waiting its turn.");

    await click("terminal-cell-speak-cell-b");

    // `play()` resolves identically for a barge-in and for a natural end, so
    // this is the assertion that catches `await play(id); markHeard(id)`.
    await waitFor(() => expect(speakState("cell-a")).toBe("ready"));
    expect(speakState("cell-a")).not.toBe("heard");
  });

  it("clicking the speaking cell holds it rather than ending it", async () => {
    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", "A is speaking now.");
    expect(speakState("cell-a")).toBe("speaking");

    // The amendment: there is no explicit stop control any more. The same
    // control, clicked while speaking, PAUSES — the run is not torn down, and
    // it is certainly not heard: it never reached its last unit.
    await click("terminal-cell-speak-cell-a");

    expect(speakState("cell-a")).toBe("paused");
    expect(speakState("cell-a")).not.toBe("heard");
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
  it("a refused autoplay falls back to ready", async () => {
    // The browser refuses the start even though a gesture reached the element:
    // `unlocked` says a gesture happened, never that playback is permitted.
    playResult = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));

    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", "This one will be refused.");

    await waitFor(() => expect(speakState("cell-a")).toBe("ready"));
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
    const markdown = longResponse();
    const prepared = prepare(markdown);
    synth.setFailing(true);

    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", markdown);

    await waitFor(() => expect(getToastSnapshot()?.kind).toBe("error"));
    expect(getToastSnapshot()?.text).toMatch(/speech/i);
    // Consecutive is the point: the run gives up inside the first few units —
    // the three it tried to play, plus the one the ladder had warmed ahead of
    // them — rather than hammering the synthesizer through all twelve.
    expect(new Set(synth.requests)).toEqual(
      new Set(prepared.units.slice(0, 4).map((unit) => unit.text)),
    );
    expect(played).toEqual([]);
  });

  it("a one-unit answer that synthesizes to nothing is reported, not marked heard", async () => {
    // Greg's dead button: one unit means one failure, three short of the
    // ladder's stop rule, so the run ends the way a finished answer ends. No
    // sound, no toast, and a cell flipped to `heard` — the pip that should be
    // inviting the retry that works is gone.
    const markdown = "One sentence, and the synthesizer is down.";
    expect(prepare(markdown).units).toHaveLength(1);
    synth.setFailing(true);

    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", markdown);

    await waitFor(() => expect(getToastSnapshot()?.kind).toBe("error"));
    expect(getToastSnapshot()?.text).toMatch(/speech/i);
    expect(played).toEqual([]);
    // Ready, so the pip still invites the click that usually works.
    expect(speakState("cell-a")).toBe("ready");
  });

  it("a two-unit answer that synthesizes to nothing is reported too", async () => {
    // Two failures is still one short of the ladder's three.
    const markdown = shortResponse(2);
    expect(prepare(markdown).units).toHaveLength(2);
    synth.setFailing(true);

    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", markdown);

    await waitFor(() => expect(getToastSnapshot()?.kind).toBe("error"));
    expect(played).toEqual([]);
    expect(speakState("cell-a")).toBe("ready");
    expect(synth.requests).toHaveLength(2);
  });

  it("a run that spoke before it failed is not heard either", async () => {
    // Half an answer is exactly as unfinished as none of it: the run never
    // reached its last unit, so it lands `ready` with the failure toasted.
    // This used to assert `heard` — the amendment's "systemic failure leaves
    // the cell ready" is what changed it, and it also closes follow-up #19.
    const markdown = shortResponse(4);
    const prepared = prepare(markdown);
    // Fixture guard: four units, no budget cut, so the only thing standing
    // between this run and `heard` is the failure itself.
    expect(prepared.units).toHaveLength(4);
    expect(prepared.spokenUnits).toBe(prepared.units.length);
    // Unit 0 synthesizes; the synthesizer is down for units 1, 2 and 3.
    synth.setHealthyRequests(1);

    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", markdown);

    expect(played).toEqual([`blob:${prepared.units[0].text}`]);
    await endRun();

    await waitFor(() => expect(getToastSnapshot()?.kind).toBe("error"));
    expect(speakState("cell-a")).toBe("ready");
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
    await waitFor(() => expect(speakState("cell-a")).toBe("ready"));
    // Every budgeted unit, and then the marker. The marker is an addition to
    // the spoken sequence, never one of the budgeted units — it displaces none
    // of them, which is what the slice below pins.
    //
    // Compared as a set: the warm and the prefetch ladder both run ahead of
    // the unit that is playing, so the request ORDER interleaves — what is
    // pinned here is that each budgeted unit was synthesized exactly once and
    // nothing past the cut was.
    expect(synth.requests).toHaveLength(prepared.spokenUnits + 1);
    expect(new Set(synth.requests.slice(0, prepared.spokenUnits))).toEqual(
      new Set(prepared.units.slice(0, prepared.spokenUnits).map((unit) => unit.text)),
    );
    expect(synth.requests[synth.requests.length - 1]).toBe(
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
    expect(speakState("cell-a")).toBe("ready");

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
    expect(speakState("cell-a")).toBe("ready");

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
    expect(speakState("cell-a")).toBe("ready");
    // Warmed all the same — hydration is an arrival, so the control the tab
    // comes up with is as ready as one that lit while the tab was watching.
    expect(synth.requests).toEqual(["Said while the tab was away."]);
  });
});

/**
 * "A lit control is ready to speak": the glow used to mean only that an
 * utterance had arrived, and the first click then paid for the dynamic
 * `edge-tts-universal/browser` import, a DRM token and a WebSocket handshake —
 * seconds of silence that read as a dead button. Unit 0 is warmed on arrival
 * instead, and these pin both halves: that the click is instant, and that
 * warming never becomes a quiet autoplay.
 */
describe("warming the first unit on arrival", () => {
  it("warms unit 0 only, and the click plays it without re-synthesizing", async () => {
    const markdown = shortResponse(4);
    const prepared = prepare(markdown);
    expect(prepared.units).toHaveLength(4);

    await renderProjectSurface();
    // cell-b is not armed: warming is not autoplay's back door.
    await emitUtterance("cell-b", "b1", markdown);

    // Unit 0 and no further: units 2..n stay unsynthesized until playback
    // reaches them, so the eager cost is one small unit per response.
    expect(synth.requests).toEqual([prepared.units[0].text]);
    expect(played).toEqual([]);

    await click("terminal-cell-speak-cell-b");

    // The click played unit 0 out of the cache: not one additional request for
    // it, which is the whole promise the lit control makes. A warm that used a
    // different voice, or a click that prepared different text, would show up
    // here as a second request for the same words.
    expect(played).toEqual([`blob:${prepared.units[0].text}`]);
    expect(synth.requests.filter((text) => text === prepared.units[0].text)).toHaveLength(1);
  });

  it("warms with the voice the click will use", async () => {
    // The cache keys on voice + text. Warming with the module's own default —
    // or with anything but the stored voice — is a synthesis nobody plays and
    // a click that still waits, with every state looking exactly right.
    localStorage.setItem(SPEECH_VOICE_STORAGE_KEY, "en-US-EmmaMultilingualNeural");

    await renderProjectSurface();
    await emitUtterance("cell-b", "b1", "The picked voice warms it.");

    expect(synth.requests).toEqual(["The picked voice warms it."]);
    expect(synth.requestVoices).toEqual(["en-US-EmmaMultilingualNeural"]);

    await click("terminal-cell-speak-cell-b");

    expect(played).toEqual(["blob:The picked voice warms it."]);
    expect(synth.requests).toEqual(["The picked voice warms it."]);
  });

  it("a warmed cell that is not armed stays silent", async () => {
    await renderProjectSurface();
    // cell-a is the armed one; the utterances arrive for the other two.
    await arm("cell-a");

    await emitUtterance("cell-b", "b1", "Warmed and waiting.");
    await emitUtterance("cell-c", "c1", "Warmed and waiting too.");

    // Both warmed, neither spoken: the audio element was never handed a source
    // and no cell moved to `speaking`.
    expect(new Set(synth.requests)).toEqual(
      new Set(["Warmed and waiting.", "Warmed and waiting too."]),
    );
    expect(played).toEqual([]);
    expect(elements).toEqual([]);
    expect(speakState("cell-b")).toBe("ready");
    expect(speakState("cell-c")).toBe("ready");
  });

  it("a failed warm changes nothing", async () => {
    synth.setFailing(true);

    await renderProjectSurface();
    await emitUtterance("cell-b", "b1", "The synthesizer is down while this arrives.");

    // The warm rejected inside `prefetchSpeech`, which swallows it: no toast,
    // no state change, and the cell is still the click's to retry.
    expect(synth.requests).toEqual(["The synthesizer is down while this arrives."]);
    expect(getToastSnapshot()).toBeNull();
    expect(played).toEqual([]);
    expect(speakState("cell-b")).toBe("ready");
  });

  it("warms each arriving utterance once", async () => {
    await renderProjectSurface();

    await emitUtterance("cell-b", "b1", "First answer.");
    // A re-delivered frame — a reconnect replay — is not news, so it must not
    // buy a second synthesis.
    await emitUtterance("cell-b", "b1", "First answer.");
    await emitUtterance("cell-b", "b2", "Second answer, same cell.");

    expect(synth.requests).toEqual(["First answer.", "Second answer, same cell."]);
    expect(played).toEqual([]);
  });

  it("a response with nothing to say is not warmed", async () => {
    await renderProjectSurface();

    await emitUtterance("cell-b", "b1", "```ts\nconst x = 1;\n```\n");

    expect(synth.requests).toEqual([]);
    expect(speakState("cell-b")).toBe("empty");
  });
});

/**
 * The control's two channels, end to end through the real host: `data-speech`
 * is the colour channel and `data-icon` the icon channel, and these drive them
 * from the frame that arrives to the unit that ends.
 *
 * jsdom applies no stylesheet, so nothing here proves a colour. What it proves
 * is the STATE the colour is keyed off; that `preparing`/`stalled` are red and
 * `heard` the dimmed yellow is asserted on the rule itself in
 * `features/terminal/__tests__/CellSpeakButton.test.tsx`.
 */
describe("the control's colour and icon, end to end", () => {
  it("an arriving utterance goes preparing → ready without a click", async () => {
    await renderProjectSurface();
    // The synthesizer takes the warm and does not answer: the audio is not in
    // hand yet, which is exactly what the red is for.
    synth.hold();

    await emitUtterance("cell-b", "b1", "The audio is not here yet.");

    expect(speakState("cell-b")).toBe("preparing");
    // The icon channel does not move with it: the click will still be a start.
    expect(speakIcon("cell-b")).toBe("speaker");
    expect(played).toEqual([]);

    await act(async () => {
      synth.release();
      await drain();
    });

    // Green without anybody clicking anything, and still silent.
    expect(speakState("cell-b")).toBe("ready");
    expect(speakIcon("cell-b")).toBe("speaker");
    expect(played).toEqual([]);
  });

  it("click → pause → resume speaks the same unit once", async () => {
    const markdown = shortResponse(3);
    const unit0 = prepare(markdown).units[0].text;

    await renderProjectSurface();
    await emitUtterance("cell-b", "b1", markdown);
    expect(speakState("cell-b")).toBe("ready");

    await click("terminal-cell-speak-cell-b");
    expect(speakState("cell-b")).toBe("speaking");
    expect(speakIcon("cell-b")).toBe("pause");
    expect(played).toEqual([`blob:${unit0}`]);

    // The pause holds the run rather than ending it: the cell is the user's to
    // resume, so it is neither `ready` nor `heard`.
    await click("terminal-cell-speak-cell-b");
    expect(speakState("cell-b")).toBe("paused");
    expect(speakIcon("cell-b")).toBe("play");

    await click("terminal-cell-speak-cell-b");
    expect(speakState("cell-b")).toBe("speaking");
    expect(speakIcon("cell-b")).toBe("pause");

    // The same unit, once. One synthesis and — the sharper half — one object
    // URL: a resume that restarted the unit (the control raising `onSpeak`, or
    // the host calling `play(…, 0)` instead of the player's `resume()`) would
    // materialize it a second time, cache hit or not.
    expect(synth.requests.filter((text) => text === unit0)).toHaveLength(1);
    expect(objectUrls.filter((url) => url === `blob:${unit0}`)).toHaveLength(1);
    expect(new Set(elements).size).toBe(1);

    // And the ladder goes on from where it was held, all the way to the end.
    await endRun();
    await waitFor(() => expect(speakState("cell-b")).toBe("heard"));
  });

  it("the last unit ending is what turns the cell yellow", async () => {
    await renderProjectSurface();
    await arm("cell-a");
    await emitUtterance("cell-a", "a1", shortResponse(3));
    expect(speakState("cell-a")).toBe("speaking");

    // Two of the three units end: the cell has been spoken at, but something
    // in it has still not been listened to, so it stays green.
    await endCurrentUnit();
    expect(speakState("cell-a")).toBe("speaking");
    await endCurrentUnit();
    expect(speakState("cell-a")).toBe("speaking");

    await endCurrentUnit();

    await waitFor(() => expect(speakState("cell-a")).toBe("heard"));
    // The icon channel goes back to "a click replays this", and the pulse —
    // the notification — is off: the cell is not asking for anything.
    expect(speakIcon("cell-a")).toBe("speaker");
    expect(
      screen.getByTestId("terminal-cell-speak-cell-a").getAttribute("data-pulse"),
    ).toBe("0");
  });

  it("a barge-in leaves the first cell green", async () => {
    // The plain speaking → barge-in case is covered above ("a barged-in cell
    // reverts to ready, not heard"). This is the amendment's harder one: the
    // panel has ONE audio element, so a PAUSED position cannot survive another
    // cell taking it over — the cell must fall back to green, not sit there
    // wearing a play icon over a run that no longer exists.
    await renderProjectSurface();
    await emitUtterance("cell-a", "a1", shortResponse(3));
    await emitUtterance("cell-b", "b1", "B is waiting its turn.");

    await click("terminal-cell-speak-cell-a");
    await click("terminal-cell-speak-cell-a");
    expect(speakState("cell-a")).toBe("paused");

    await click("terminal-cell-speak-cell-b");

    await waitFor(() => expect(speakState("cell-b")).toBe("speaking"));
    expect(speakState("cell-a")).toBe("ready");
    expect(speakIcon("cell-a")).toBe("speaker");
  });
});
