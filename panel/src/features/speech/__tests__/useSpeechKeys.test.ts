/**
 * The keyboard fallback: the transport on a desktop with no media keys.
 *
 * `useMediaSessionTransport` covers hardware keys, headphone buttons and phone
 * lock screens. This covers the machine that has none of those — and it has to
 * work while a terminal cell holds focus, which is the whole difficulty:
 * xterm's focus target is a `textarea`, so the panel's existing shortcut family
 * (`useITermShortcuts`) deliberately goes silent there, and these keys must do
 * the opposite.
 *
 * Two halves, in the two files Task 10 names:
 *
 * - **here** — what the combos DO, and where they refuse to act (a real panel
 *   field). The withholding half is asserted through the shared predicate the
 *   xterm handler is built on, so a drift between the two files is a failure
 *   here as well as there;
 * - `features/terminal/__tests__/terminalInstances.test.ts` — that the same
 *   combos never reach the PTY, that everything else still does, and that
 *   `Shift+Enter` is untouched.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { isTypingInPanelField, speechTransportKeyFor, useSpeechKeys } from "../useSpeechKeys";
import type { MediaSessionTransportTarget } from "../useMediaSessionTransport";

/**
 * A target whose callbacks are spies, typed as spies so `toHaveBeenCalledWith`
 * is checked against each one's real signature. Same shape the media-session
 * suite uses — deliberately, because the two surfaces drive the same target.
 */
interface StubTarget extends MediaSessionTransportTarget {
  onSpeak: Mock<(sessionId: string) => void>;
  onPause: Mock<(sessionId: string) => void>;
  onResume: Mock<(sessionId: string) => void>;
  onNext: Mock<(sessionId: string) => void>;
  onPrevious: Mock<(sessionId: string) => void>;
  onSeekBackward: Mock<(seconds: number) => void>;
}

function stubTarget(
  run: {
    speakingSessionId?: string | null;
    pausedSessionId?: string | null;
    armedSessionId?: string | null;
  } = {},
): StubTarget {
  return {
    speakingSessionId: run.speakingSessionId ?? null,
    pausedSessionId: run.pausedSessionId ?? null,
    armedSessionId: run.armedSessionId ?? null,
    onSpeak: vi.fn<(sessionId: string) => void>(),
    onPause: vi.fn<(sessionId: string) => void>(),
    onResume: vi.fn<(sessionId: string) => void>(),
    onNext: vi.fn<(sessionId: string) => void>(),
    onPrevious: vi.fn<(sessionId: string) => void>(),
    onSeekBackward: vi.fn<(seconds: number) => void>(),
  };
}

/** Nothing fired at all — the assertion most of these tests make negatively. */
function silent(target: StubTarget): boolean {
  return [
    target.onSpeak,
    target.onPause,
    target.onResume,
    target.onNext,
    target.onPrevious,
    target.onSeekBackward,
  ].every((spy) => spy.mock.calls.length === 0);
}

interface Press {
  code: string;
  key?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  type?: "keydown" | "keyup";
}

/**
 * A real key press, dispatched at the focused element so it travels the same
 * path a browser would give it — which is the only way the "focus is in a panel
 * field" criterion has anything to be false about.
 */
function press(init: Press): KeyboardEvent {
  const event = new KeyboardEvent(init.type ?? "keydown", {
    code: init.code,
    key: init.key ?? init.code,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    metaKey: init.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(event);
  return event;
}

/** A panel field the user types prose into — a rename box, a search input. */
function focusPanelField(tag: "input" | "textarea"): HTMLElement {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  el.focus();
  return el;
}

/**
 * xterm's focus target: a `textarea`, like the one above, and the reason this
 * task needs a discriminator rather than a tag check.
 */
function focusXtermHelper(): HTMLTextAreaElement {
  const screen = document.createElement("div");
  screen.className = "xterm";
  const helper = document.createElement("textarea");
  helper.className = "xterm-helper-textarea";
  screen.appendChild(helper);
  document.body.appendChild(screen);
  helper.focus();
  return helper;
}

/**
 * Half an xterm: the CLASS, with no `.xterm` ancestor over it.
 *
 * `focusXtermHelper` above carries both markers, which is faithful to xterm but
 * makes each check individually invisible — either one alone still recognizes
 * that fixture, so dropping one passes the whole suite. The redundancy is
 * deliberate and worth keeping, so each half gets a fixture that only it can
 * answer, and a future xterm release that stops stamping one marker is a red
 * test rather than a silently dead branch.
 */
function focusXtermHelperByClassOnly(): HTMLTextAreaElement {
  const helper = document.createElement("textarea");
  helper.className = "xterm-helper-textarea";
  document.body.appendChild(helper);
  helper.focus();
  return helper;
}

/** The other half: inside `.xterm`, with no helper class on the textarea. */
function focusXtermHelperByAncestorOnly(): HTMLTextAreaElement {
  const screen = document.createElement("div");
  screen.className = "xterm";
  const helper = document.createElement("textarea");
  screen.appendChild(helper);
  document.body.appendChild(screen);
  helper.focus();
  return helper;
}

/**
 * Mount the hook, run `body`, unmount. Several of these tests walk a target
 * through more than one run state, and a hook left mounted from an earlier
 * state would still be listening — every press would then fire every handler
 * ever mounted in the test, which is exactly the way an assertion passes for
 * the wrong reason.
 */
function mounted(target: MediaSessionTransportTarget, body: () => void): void {
  const { unmount } = renderHook(() => useSpeechKeys(target));
  try {
    body();
  } finally {
    unmount();
  }
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useSpeechKeys", () => {
  it("ctrl+shift+space toggles playback and is withheld from the PTY", () => {
    // The xterm handler is built on this predicate, so "withheld" is the same
    // fact in both files rather than two hand-copied key lists.
    expect(
      speechTransportKeyFor({ type: "keydown", code: "Space", ctrlKey: true, shiftKey: true }),
    ).toBe("toggle");

    const speaking = stubTarget({ speakingSessionId: "cell-a", armedSessionId: "cell-b" });
    mounted(speaking, () => press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true }));
    // The run, never the armed cell, while something is playing.
    expect(speaking.onPause).toHaveBeenCalledWith("cell-a");
    expect(speaking.onSpeak).not.toHaveBeenCalled();

    const held = stubTarget({ speakingSessionId: "cell-a", pausedSessionId: "cell-a" });
    mounted(held, () => press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true }));
    // Resume, not restart: `onSpeak` would replay the unit from its start.
    expect(held.onResume).toHaveBeenCalledWith("cell-a");
    expect(held.onSpeak).not.toHaveBeenCalled();

    const idle = stubTarget({ armedSessionId: "cell-b" });
    mounted(idle, () => press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true }));
    expect(idle.onSpeak).toHaveBeenCalledWith("cell-b");

    const nothing = stubTarget();
    mounted(nothing, () => press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true }));
    expect(silent(nothing)).toBe(true);
  });

  it("ctrl+shift+arrows walk the queue and are withheld from the PTY", () => {
    expect(
      speechTransportKeyFor({ type: "keydown", code: "ArrowLeft", ctrlKey: true, shiftKey: true }),
    ).toBe("previous");
    expect(
      speechTransportKeyFor({ type: "keydown", code: "ArrowRight", ctrlKey: true, shiftKey: true }),
    ).toBe("next");

    const target = stubTarget({ speakingSessionId: "cell-a", armedSessionId: "cell-b" });
    mounted(target, () => {
      press({ code: "ArrowLeft", ctrlKey: true, shiftKey: true });
      expect(target.onPrevious).toHaveBeenCalledWith("cell-a");

      press({ code: "ArrowRight", ctrlKey: true, shiftKey: true });
      expect(target.onNext).toHaveBeenCalledWith("cell-a");
    });

    // With no run, the armed cell is the panel's standing answer to "which
    // queue?" — the same fallback the media keys take.
    const idle = stubTarget({ armedSessionId: "cell-b" });
    mounted(idle, () => press({ code: "ArrowRight", ctrlKey: true, shiftKey: true }));
    expect(idle.onNext).toHaveBeenCalledWith("cell-b");
  });

  it("ctrl+shift+digits still reach the existing shortcut family", () => {
    const target = stubTarget({ speakingSessionId: "cell-a", armedSessionId: "cell-b" });
    renderHook(() => useSpeechKeys(target));

    for (const digit of [1, 2, 3, 4, 5, 6]) {
      const code = `Digit${digit}`;
      // Null here is what makes the xterm handler return true, which is what
      // lets `useITermShortcuts` see its project-navigation chord at all.
      expect(speechTransportKeyFor({ type: "keydown", code, ctrlKey: true, shiftKey: true })).toBe(
        null,
      );
      const event = press({ code, key: String(digit), ctrlKey: true, shiftKey: true });
      expect(event.defaultPrevented).toBe(false);
    }

    expect(silent(target)).toBe(true);
  });

  it("speech keys do not fire while typing in a panel input", () => {
    const target = stubTarget({ speakingSessionId: "cell-a" });
    renderHook(() => useSpeechKeys(target));

    for (const tag of ["input", "textarea"] as const) {
      focusPanelField(tag);
      press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true });
      press({ code: "ArrowLeft", ctrlKey: true, shiftKey: true });
      expect(silent(target)).toBe(true);
    }

    // The other direction: xterm's helper is a textarea too, and the keys MUST
    // fire there — that is the entire point of the task.
    focusXtermHelper();
    press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true });
    expect(target.onPause).toHaveBeenCalledWith("cell-a");
  });

  it("either xterm marker alone is enough to recognize the terminal", () => {
    // One fixture per marker, because the realistic one carries both: with both
    // present each check alone answers, so neither is load-bearing and dropping
    // one is invisible. Here each fixture can only be answered by its own check.
    const fixtures = [
      { name: "class, no .xterm ancestor", focus: focusXtermHelperByClassOnly },
      { name: "inside .xterm, no helper class", focus: focusXtermHelperByAncestorOnly },
    ];

    for (const fixture of fixtures) {
      document.body.innerHTML = "";
      const element = fixture.focus();
      // The predicate first, for a failure that names the marker that stopped
      // being recognized rather than just "nothing spoke".
      expect(isTypingInPanelField(element), fixture.name).toBe(false);

      const target = stubTarget({ speakingSessionId: "cell-a" });
      mounted(target, () => press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true }));
      expect(target.onPause, fixture.name).toHaveBeenCalledWith("cell-a");
    }
  });

  it("falls back to key when code is absent, however that is spelled", () => {
    // The predicate is structural and all-optional — `terminalInstances.ts`
    // hands it xterm's event object — so a caller that does not set `code`
    // reaches it as `undefined` from one dispatcher and as `""` from another.
    // Both mean "no physical key was reported", and `??` only understands one
    // of them.
    for (const code of [undefined, ""]) {
      expect(
        speechTransportKeyFor({ type: "keydown", code, key: " ", ctrlKey: true, shiftKey: true }),
      ).toBe("toggle");
      expect(
        speechTransportKeyFor({
          type: "keydown",
          code,
          key: "ArrowRight",
          ctrlKey: true,
          shiftKey: true,
        }),
      ).toBe("next");
    }
  });

  it("a region that swallows keydown cannot silence the transport", () => {
    // Capture is not only about running before xterm. It is also what makes the
    // listener immune to a `stopPropagation` from something nested — and the
    // panel has one: `TerminalLayoutGrid` stops the event for Cmd/Ctrl+U. A
    // bubble-phase listener would never see a key pressed inside such a region,
    // so the transport would die exactly where it is needed most.
    const target = stubTarget({ speakingSessionId: "cell-a" });
    mounted(target, () => {
      const helper = focusXtermHelper();
      const region = helper.closest(".xterm");
      if (!region) throw new Error("the fixture lost its .xterm region");
      region.addEventListener("keydown", (event) => event.stopPropagation());

      press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true });
      expect(target.onPause).toHaveBeenCalledWith("cell-a");

      press({ code: "ArrowRight", ctrlKey: true, shiftKey: true });
      expect(target.onNext).toHaveBeenCalledWith("cell-a");
    });
  });

  it("ignores the combo when alt or meta is held, and on keyup", () => {
    const target = stubTarget({ speakingSessionId: "cell-a" });
    renderHook(() => useSpeechKeys(target));

    press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true, altKey: true });
    press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true, metaKey: true });
    press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true, type: "keyup" });
    press({ code: "Space", key: " ", ctrlKey: true });

    expect(silent(target)).toBe(true);
  });

  it("stops listening once the host unmounts", () => {
    const target = stubTarget({ speakingSessionId: "cell-a" });
    const { unmount } = renderHook(() => useSpeechKeys(target));
    unmount();

    press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true });
    expect(silent(target)).toBe(true);
  });
});
