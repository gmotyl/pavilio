/**
 * The pane's waiting state: what the body shows between the moment a draft is
 * sent and the moment the reply — or the silence that stands for one — comes
 * back.
 *
 * Everything is asserted through `AnswerPane` and, where the criterion is about
 * the transport, through a `SpeechControlBar` mounted beside it: the two are
 * siblings in `TerminalView`'s speech surface, the press happens on the bar and
 * the consequence shows in the pane, so a harness holding only one of them
 * could not see the criterion at all.
 *
 * ## Why the speech host is a proxy
 *
 * "Entering the waiting state touches nothing on the speech host" is a negative
 * claim, and a negative claim asserted as a list of methods only ever covers
 * the methods whoever wrote the list thought of. So the host here is wrapped:
 * while it is armed, reading ANY member that is not one of the render-time
 * readers throws. A future `speech.onWhatever` that the waiting path calls
 * fails this test without anybody remembering to add it.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { GridSpeech, SpeechUnit, Utterance } from "../../speech/types";
import { type UtteranceQueue } from "../../speech/utteranceQueue";
import { cssPx, cssRule } from "../../shell/__tests__/hamburgerGeometry";
import { AnswerPane } from "../AnswerPane";
import { SpeechControlBar } from "../SpeechControlBar";
import { __resetAnswerWaitingForTests } from "../answerWaiting";
import { _applyEventForTests, _resetForTests } from "../useTerminalActivityChannel";

// The activity channel opens a WebSocket at import time and re-arms a 2s
// reconnect timer whenever that socket closes. jsdom would really try to dial
// `ws://localhost/ws/terminal-activity`, fail, and leave that timer in the
// file — which is precisely the pollution the "no timer" test is about. A
// socket that never closes keeps the module honest and the timer table empty.
vi.hoisted(() => {
  class QuietSocket {
    onopen: unknown = null;
    onmessage: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    close(): void {}
    send(): void {}
  }
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = QuietSocket;
});

// The synthesis cache the rail peeks into. Nothing is warm and nothing
// subscribes: no test here draws a segment.
vi.mock("../../speech/synth", () => ({
  isSpeechSynthesized: () => false,
  speechCacheState: () => "cold",
  subscribeSpeechCache: () => () => {},
}));

// mermaid's rendering stack is browser-only and no answer here holds a fence.
vi.mock("../../markdown/MermaidDiagram", () => ({
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

/** Referentially stable — a fresh array per call is a `useSyncExternalStore` loop. */
const NO_UNITS: readonly SpeechUnit[] = Object.freeze([]);
const NO_DURATIONS: ReadonlyMap<number, number> = new Map<number, number>();

const SESSION = "cell-a";

const ANSWER =
  "The first answer explains why the migration has to finish before any traffic is switched over.";
const NEXT_ANSWER =
  "The second answer arrives while the pane is still waiting, and is what the reader asked for.";

/**
 * The members the pane and the bar read while they render. Everything else on
 * the host is a command — something that enqueues, plays, stops, seeks or arms
 * — and the waiting state must reach none of them.
 */
const READERS = new Set([
  "stateFor",
  "queueFor",
  "unitsFor",
  "subscribeProgress",
  "progressFor",
  "unitDurationsFor",
  "armedSessionId",
]);

const utterance = (id: string, text: string): Utterance => ({
  id,
  sessionId: SESSION,
  text,
  at: 1,
});

const queueOf = (u: Utterance): UtteranceQueue => ({
  previous: null,
  current: u,
  pending: [],
  cursor: "current",
});

function makeSpeech(queueFor: () => UtteranceQueue): GridSpeech {
  return {
    stateFor: () => "ready",
    queueFor,
    unitsFor: () => NO_UNITS,
    subscribeProgress: () => () => {},
    progressFor: () => null,
    unitDurationsFor: () => NO_DURATIONS,
    armedSessionId: null,
    onSpeak: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onArm: vi.fn(),
    onJumpToUnit: vi.fn(),
    onSeekWithinUnit: vi.fn(),
  } satisfies GridSpeech;
}

/**
 * The same host, wrapped so that — once armed — reading any member outside
 * {@link READERS} throws. See the note at the top of the file.
 */
function armable(host: GridSpeech) {
  let armed = false;
  const speech = new Proxy(host, {
    get(target, property, receiver) {
      if (armed && typeof property === "string" && !READERS.has(property)) {
        throw new Error(`entering the waiting state reached speech.${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
  }) as GridSpeech;
  return {
    speech,
    arm: (): void => {
      armed = true;
    },
  };
}

/** Every command on a host, found by shape rather than by a list kept by hand. */
const commandsOf = (host: GridSpeech): Mock[] =>
  (Object.keys(host) as (keyof GridSpeech)[])
    .filter((key) => typeof host[key] === "function" && !READERS.has(key))
    .map((key) => host[key] as unknown as Mock);

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** The composer's grip asks jsdom whether this is a touch viewport. */
function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

const send = vi.fn();

/** The pane alone — every criterion but the transport one. */
const paneTree = (speech: GridSpeech) => (
  <MemoryRouter>
    <AnswerPane
      sessionId={SESSION}
      speech={speech}
      onClose={() => {}}
      send={send}
      autoOpen={false}
      onAutoOpenChange={() => {}}
    />
  </MemoryRouter>
);

/** The speech surface as the cell has it: the row, then the pane under it. */
const surfaceTree = (speech: GridSpeech) => (
  <MemoryRouter>
    <SpeechControlBar
      sessionId={SESSION}
      speech={speech}
      answerOpen
      onToggleAnswer={() => {}}
      send={send}
    />
    <AnswerPane
      sessionId={SESSION}
      speech={speech}
      onClose={() => {}}
      send={send}
      autoOpen={false}
      onAutoOpenChange={() => {}}
    />
  </MemoryRouter>
);

/**
 * The same cell with its pane closed — the eye pressed, the row left behind.
 * `TerminalView` mounts the pane only inside the bar's own condition, so this
 * is the one shape the surface can take that the two trees above cannot show:
 * the bar without the pane, never the pane without the bar.
 */
const barOnlyTree = (speech: GridSpeech) => (
  <MemoryRouter>
    <SpeechControlBar
      sessionId={SESSION}
      speech={speech}
      answerOpen={false}
      onToggleAnswer={() => {}}
      send={send}
    />
  </MemoryRouter>
);

/** This cell's surface, and a second cell's row beside it. */
const twoCellTree = (speech: GridSpeech, other: string) => (
  <MemoryRouter>
    <SpeechControlBar
      sessionId={SESSION}
      speech={speech}
      answerOpen
      onToggleAnswer={() => {}}
      send={send}
    />
    <AnswerPane
      sessionId={SESSION}
      speech={speech}
      onClose={() => {}}
      send={send}
      autoOpen={false}
      onAutoOpenChange={() => {}}
    />
    <SpeechControlBar
      sessionId={other}
      speech={speech}
      answerOpen={false}
      onToggleAnswer={() => {}}
      send={send}
    />
  </MemoryRouter>
);

const body = (): HTMLElement => screen.getByTestId(`answer-pane-body-${SESSION}`);

const waiting = (): HTMLElement | null => screen.queryByTestId(`answer-pane-waiting-${SESSION}`);

const field = (): HTMLTextAreaElement =>
  screen.getByTestId(`answer-pane-composer-${SESSION}`) as HTMLTextAreaElement;

const playButton = (): HTMLElement => screen.getByTestId(`speech-bar-playpause-${SESSION}`);

/**
 * An activity broadcast landing while the panel is mounted. Wrapped in `act`
 * because it is the realtime channel's own listener that reaches React here —
 * the waiting store subscribes to the channel, not to anything a render did.
 */
const activity = (state: "idle" | "busy" | "attention", at: number): void => {
  act(() => {
    _applyEventForTests({ sessionId: SESSION, state, at });
  });
};

/** Type a reply and press Enter — the one gesture that starts a wait. */
function sendReply(text = "ship it"): void {
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.keyDown(field(), { key: "Enter" });
}

beforeEach(() => {
  send.mockClear();
  _resetForTests();
  __resetAnswerWaitingForTests();
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  installMatchMedia();
});

afterEach(() => {
  _resetForTests();
  __resetAnswerWaitingForTests();
  vi.useRealTimers();
});

describe("the answer pane while a reply is pending", () => {
  it("shows the waiting state after a send", () => {
    render(paneTree(makeSpeech(() => queueOf(utterance("u-1", ANSWER)))));
    expect(within(body()).getByText(ANSWER)).toBeInTheDocument();

    sendReply();

    // The draft reached the PTY, and the body stopped showing the answer that
    // is now the question's predecessor rather than its reply.
    expect(send).toHaveBeenCalledWith("ship it\r");
    expect(waiting()).toBeInTheDocument();
    expect(within(body()).queryByText(ANSWER)).toBeNull();
  });

  it("touches nothing on the speech host when it starts waiting", () => {
    const host = makeSpeech(() => queueOf(utterance("u-1", ANSWER)));
    const { speech, arm } = armable(host);
    render(paneTree(speech));

    arm();
    sendReply();

    // It got there — otherwise the rest of this test would pass on a pane that
    // never entered the state at all.
    expect(waiting()).toBeInTheDocument();
    const commands = commandsOf(host);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) expect(command).not.toHaveBeenCalled();
  });

  // The surface, not the pane alone: the arrival is noticed on the row, which
  // is what lets the wait end while the pane is closed. A pane without its row
  // is a shape `TerminalView` cannot render anyway — it mounts the pane only
  // inside the row's own condition.
  it("renders the new answer when one arrives", () => {
    let queue = queueOf(utterance("u-1", ANSWER));
    const speech = makeSpeech(() => queue);
    const { rerender } = render(surfaceTree(speech));

    sendReply();
    expect(waiting()).toBeInTheDocument();

    queue = queueOf(utterance("u-2", NEXT_ANSWER));
    rerender(surfaceTree(speech));

    expect(waiting()).toBeNull();
    expect(within(body()).getByText(NEXT_ANSWER)).toBeInTheDocument();
  });

  it("returns to the answer when the transport is used, keeping a pending mark", () => {
    render(surfaceTree(makeSpeech(() => queueOf(utterance("u-1", ANSWER)))));

    sendReply();
    expect(waiting()).toBeInTheDocument();

    fireEvent.click(playButton());

    // The text is legible again, and the play button still says a reply is on
    // its way — the wait shrank, it did not end.
    expect(waiting()).toBeNull();
    expect(within(body()).getByText(ANSWER)).toBeInTheDocument();
    expect(playButton()).toHaveAttribute("data-pending", "1");
  });

  it("returns to the answer when the session goes idle having spoken nothing", () => {
    _applyEventForTests({ sessionId: SESSION, state: "busy", at: 1 });
    render(paneTree(makeSpeech(() => queueOf(utterance("u-1", ANSWER)))));

    sendReply();
    expect(waiting()).toBeInTheDocument();

    // Still working: the wait is not over because an event arrived.
    activity("busy", 2);
    expect(waiting()).toBeInTheDocument();

    activity("idle", 3);

    expect(waiting()).toBeNull();
    expect(within(body()).getByText(ANSWER)).toBeInTheDocument();
  });

  it("does not schedule a timeout to leave the waiting state", () => {
    vi.useFakeTimers();
    _applyEventForTests({ sessionId: SESSION, state: "busy", at: 1 });
    render(paneTree(makeSpeech(() => queueOf(utterance("u-1", ANSWER)))));

    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    sendReply();
    expect(waiting()).toBeInTheDocument();

    // Nothing was armed on the way in...
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();

    // ...and ten minutes of clock changes nothing: the session is still busy,
    // so the only thing that could end this wait has not happened.
    // Inside `act`, deliberately: a timer that fired here would settle the
    // store, and only a flush turns that into the DOM the next line reads. An
    // unwrapped advance would leave the stale element in place and this half of
    // the test would pass over an implementation that does use a timeout
    // (verified: it did, before the wrap).
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(waiting()).toBeInTheDocument();
    expect(within(body()).queryByText(ANSWER)).toBeNull();
  });

  it("notices the reply even when it lands with the pane closed", () => {
    let queue = queueOf(utterance("u-1", ANSWER));
    const speech = makeSpeech(() => queue);
    const { rerender } = render(surfaceTree(speech));

    sendReply();
    expect(waiting()).toBeInTheDocument();
    expect(playButton()).toHaveAttribute("data-pending", "1");

    // The eye closes the pane. The row stays — and so does the wait, because
    // nothing has happened yet.
    rerender(barOnlyTree(speech));
    expect(waiting()).toBeNull();
    expect(playButton()).toHaveAttribute("data-pending", "1");

    // ...and only NOW the reply lands, with nobody watching.
    queue = queueOf(utterance("u-2", NEXT_ANSWER));
    rerender(barOnlyTree(speech));

    // The mark is out: the answer is in the queue, not still on its way. A mark
    // that needed the pane to be reopened before it could notice would be
    // saying the opposite of the truth for as long as the agent stayed busy.
    expect(playButton()).toHaveAttribute("data-pending", "0");

    // And reopening shows the reply rather than a wait that outlived it.
    rerender(surfaceTree(speech));
    expect(waiting()).toBeNull();
    expect(within(body()).getByText(NEXT_ANSWER)).toBeInTheDocument();
  });

  it("keeps waiting when the same activity state is broadcast again", () => {
    // Nothing seeded: an unknown session reads `idle`, which is the state the
    // wait begins in. A server re-broadcast of that same `idle` is a reading,
    // not a transition, and an agent that has not started yet has certainly not
    // finished.
    render(paneTree(makeSpeech(() => queueOf(utterance("u-1", ANSWER)))));

    sendReply();
    expect(waiting()).toBeInTheDocument();

    activity("idle", 2);

    expect(waiting()).toBeInTheDocument();
    expect(within(body()).queryByText(ANSWER)).toBeNull();
  });

  it("ignores an answer that arrives for another cell", () => {
    const OTHER = "cell-b";
    let otherId = "v-1";
    const speech: GridSpeech = {
      ...makeSpeech(() => queueOf(utterance("u-1", ANSWER))),
      queueFor: (sessionId: string) =>
        sessionId === OTHER
          ? queueOf({ id: otherId, sessionId: OTHER, text: NEXT_ANSWER, at: 1 })
          : queueOf(utterance("u-1", ANSWER)),
    };
    const { rerender } = render(twoCellTree(speech, OTHER));

    sendReply();
    expect(waiting()).toBeInTheDocument();

    // A new answer in the OTHER cell. The wait is keyed by session, so this one
    // is somebody else's reply.
    otherId = "v-2";
    rerender(twoCellTree(speech, OTHER));

    expect(waiting()).toBeInTheDocument();
    expect(playButton()).toHaveAttribute("data-pending", "1");
  });
});

/**
 * The waiting animation, read out of the stylesheet that owns it.
 *
 * Same discipline as `AnswerPane.test.tsx`'s "surfaces": jsdom loads no
 * stylesheet, so `getComputedStyle` here would report the user-agent value and
 * every assertion would pass over a rule that does not exist. `cssRule` reads
 * `index.css` itself, throws when a selector matches nothing, and refuses to
 * guess when it matches more than one — which is what keeps the absence
 * assertions below from being true of thin air.
 */
const CSS = readFileSync(resolve("src/index.css"), "utf8");

const wave = (): HTMLElement => screen.getByTestId(`answer-pane-wave-${SESSION}`);

const crests = (): HTMLElement[] =>
  Array.from(wave().querySelectorAll<HTMLElement>(".answer-pane-wave-crest"));

/**
 * The custom property the scrubber paints a live segment with, QUOTED FROM THE
 * SCRUBBER'S OWN RULE rather than named here.
 *
 * This is the whole point of the criterion. A test that spelled the token out
 * — or worse, asserted the green as a literal — would keep passing after the
 * scrubber moved to a different one, and the wave would be drawn in a colour
 * the segments no longer use. Reading the name out of `.speech-bar-seg` means
 * a rename there fails the wave's test, which is the only way "the same
 * vocabulary" can be a fact rather than a wish.
 */
const segmentToken = (): string => {
  const found = cssRule('.speech-bar-seg[data-segment="playing"]').match(/var\((--[\w-]+)\)/);
  if (!found) {
    throw new Error(
      "the scrubber's playing segment paints with a literal, not a custom " +
        "property — there is no token for the wave to share",
    );
  }
  return found[1];
};

/** One `{...}` starting at `open`, brace-counted so a nested rule cannot end it early. */
function block(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error("unterminated block in src/index.css");
}

/**
 * The reduced-motion query that covers the wave.
 *
 * `cssRule` reads a class's declarations; this reads the media block those
 * declarations sit inside, because "no animation runs under reduce" is a claim
 * about the QUERY, not about a rule that happens to say `animation: none`.
 * Exactly one such block, for the same reason `cssRule` refuses two.
 */
const reducedMotion = (): string => {
  const blocks = [...CSS.matchAll(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{/g)]
    .map((match) => block(CSS, match.index + match[0].length - 1))
    .filter((body) => body.includes("answer-pane-wave"));
  if (blocks.length !== 1) {
    throw new Error(
      `${blocks.length} reduced-motion blocks mention the wave in src/index.css — expected one`,
    );
  }
  return blocks[0];
};

/** The per-crest heights the stylesheet declares, in order, until it runs out. */
const crestHeights = (): number[] => {
  const heights: number[] = [];
  for (let n = 1; n < 24; n += 1) {
    try {
      heights.push(cssPx(`.answer-pane-wave-crest:nth-child(${n})`, "height"));
    } catch {
      return heights;
    }
  }
  throw new Error("more than 23 crest rules in src/index.css — that is not a wave");
};

describe("the waiting animation", () => {
  beforeEach(() => {
    render(paneTree(makeSpeech(() => queueOf(utterance("u-1", ANSWER)))));
    sendReply();
    expect(waiting()).toBeInTheDocument();
  });

  it("renders the wave from the scrubber's own segment vocabulary", () => {
    // One element per crest, and the stylesheet knows about every one of them:
    // a sixth crest in the markup with no height rule behind it is a flat bar
    // glued to the end of a wave.
    const heights = crestHeights();
    expect(heights.length).toBeGreaterThan(2);
    expect(crests()).toHaveLength(heights.length);

    // The colour is the scrubber's token, not a hex that happens to match it
    // today. See `segmentToken` — the name is quoted from `.speech-bar-seg`.
    const token = segmentToken();
    expect(cssRule(".answer-pane-wave-crest")).toContain(`var(${token})`);

    // ...and it is a real token, defined once where the panel keeps them.
    expect(cssRule(":root")).toMatch(new RegExp(`${token}\\s*:\\s*\\S`));

    // The pane's own rail is the same scrubber turned vertical, so the two
    // drawings and the wave are one vocabulary rather than two that agree.
    expect(cssRule('.answer-pane-seg[data-segment="playing"]')).toContain(`var(${token})`);
  });

  it("stops the animation but keeps a distinguishable shape under reduced motion", () => {
    // There is motion to stop. Without this the override below is a rule that
    // cancels nothing and the test passes over a wave that never moved.
    expect(cssRule(".answer-pane-wave-crest")).toMatch(/(^|;)\s*animation\s*:\s*(?!none)\S/);

    const reduced = reducedMotion();

    // The override actually REACHES a crest: the selectors are taken from the
    // stylesheet and matched against the element the browser would match them
    // against, so a rule aimed at a class nobody renders fails here.
    const stopped = [...reduced.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , declarations]) => /(^|;)\s*animation\s*:\s*none/.test(declarations))
      .map(([, selector]) => selector.trim());
    expect(stopped.length).toBeGreaterThan(0);
    const crest = crests()[0];
    expect(crest).toBeDefined();
    expect(stopped.some((selector) => crest.matches(selector))).toBe(true);

    // The OTHER half of the criterion, and the one a `display: none` would
    // quietly satisfy the first half with: what is left has to still be a
    // wave. Nothing in the query hides it...
    expect(reduced).not.toMatch(
      /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden|opacity\s*:\s*0(?!\.)|height\s*:\s*0|width\s*:\s*0)/,
    );

    // ...and the shape that survives is not flat: the crests' heights are
    // declared outside the query, and they differ.
    expect(new Set(crestHeights()).size).toBeGreaterThan(1);
  });

  it("hides the decorative wave from assistive technology and names the state in text", () => {
    // The wave is decoration. The state is a sentence.
    expect(wave()).toHaveAttribute("aria-hidden", "true");
    expect(wave().textContent).toBe("");

    // Not vacuous: there is a subtree in there, and no part of it claims a
    // name or a role of its own — the same treatment the scrubber's segments
    // get in `SpeechControlBar.test.tsx`.
    const decoration = [wave(), ...Array.from(wave().querySelectorAll("*"))];
    expect(decoration.length).toBeGreaterThan(1);
    for (const element of decoration) {
      expect(element).not.toHaveAttribute("role");
      expect(element).not.toHaveAttribute("aria-label");
      expect(element).not.toHaveAttribute("title");
    }

    // What a screen reader is left with is the label, and the label is the
    // whole of the state's name.
    const status = screen.getByRole("status");
    expect(status).toBe(waiting());
    expect(status.textContent?.trim()).toMatch(/waiting for a reply/i);
    expect(within(status).getByText(/waiting for a reply/i)).toHaveClass(
      "answer-pane-waiting-label",
    );

    // And it is NAMED IN TEXT: a label the stylesheet hides is a state with no
    // name at all, because the only other thing in here is `aria-hidden`.
    expect(cssRule(".answer-pane-waiting-label")).not.toMatch(
      /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)/,
    );
  });
});
