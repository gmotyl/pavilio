/**
 * The keyboard transport — the fallback for a desktop with no media keys.
 *
 * `useMediaSessionTransport` is the preferred surface: it needs no key
 * interception at all and it is the only one that works on a phone. But a plain
 * PC keyboard has no play/pause to bind, and that is the machine most of this
 * panel is driven from, so there is a second surface — and it drives **the same
 * target**: the run that is playing, else the armed cell. Nothing here reads
 * focus to decide *what* to act on; focus only decides whether to act at all.
 *
 * ## Why this is not four more cases in `useITermShortcuts`
 *
 * That handler opens with "if `document.activeElement` is an input or textarea,
 * return" — and **xterm's focus target is a textarea**. So the whole existing
 * family (`Cmd/Ctrl+Shift+Enter`, `Cmd/Ctrl+0–9`, `Cmd/Ctrl+\``,
 * `Ctrl+Shift+1–6`) is deliberately silent while you are typing at an agent.
 * The speech keys need exactly the opposite: their entire reason to exist is to
 * reach a cell that has focus. Two opposite policies cannot share one guard, so
 * they are two handlers.
 *
 * ## Telling xterm's textarea from a real one
 *
 * Both are `<textarea>`, so the tag says nothing. The discriminator is xterm's
 * own marker: it stamps its helper with `class="xterm-helper-textarea"` and
 * mounts it inside the terminal's `.xterm` element (both are in
 * `@xterm/xterm`'s stylesheet, so they are load-bearing for xterm itself and
 * cannot be quietly dropped). A textarea carrying either is a terminal, not a
 * field — every other input or textarea in the panel is prose the user is
 * typing, and the transport must stay out of it.
 *
 * ## Why the keys are withheld from the PTY somewhere else
 *
 * This hook raises the action; it does not stop the TUI seeing the key. That is
 * `terminalInstances.ts`'s `shiftEnterHandler`, which returns `false` for the
 * same combos — the `Shift+Enter` interception, reused. The two sides agree
 * because they share {@link speechTransportKeyFor}, rather than each holding
 * its own copy of the key list.
 *
 * The listener is on `window` in the **capture** phase, so it runs before
 * xterm's keydown listener on the helper textarea whatever the DOM depth. It
 * calls `preventDefault` on a combo it handled, but never `stopPropagation`:
 * the xterm handler's `false` is what withholds the key, and silently
 * depending on listener order instead would be the kind of coupling that breaks
 * the day the terminal is mounted somewhere new.
 */
import { useEffect, useRef } from "react";
import type { MediaSessionTransportTarget } from "./useMediaSessionTransport";

/** What one of the three combos means. */
export type SpeechTransportKey = "toggle" | "previous" | "next";

/**
 * The shape {@link speechTransportKeyFor} reads. Deliberately structural and
 * all-optional so the one predicate serves both callers: a real
 * `KeyboardEvent` here, and the loose object xterm hands its custom key event
 * handler over in `terminalInstances.ts`.
 */
export interface SpeechKeyEvent {
  type?: string;
  key?: string;
  code?: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

/**
 * Which transport action a key press is, or `null` if it is none of them —
 * which is also the answer to "must the TUI still receive this?".
 *
 * `Ctrl+Shift+1–6` lands here as `null` on purpose: it is `useITermShortcuts`'s
 * project navigation, and it is shipped behaviour that the terminal hands it
 * on. So is every other `Ctrl+Shift` chord a TUI might bind.
 *
 * Alt and Meta must be absent: `Cmd+Ctrl+Shift+Space` is macOS's own chord, and
 * a combo the user meant for the OS is not ours to eat.
 */
export function speechTransportKeyFor(event: SpeechKeyEvent): SpeechTransportKey | null {
  if (event.type !== undefined && event.type !== "keydown") return null;
  if (!event.ctrlKey || !event.shiftKey) return null;
  if (event.altKey || event.metaKey) return null;

  // `code` is the physical key and is what a layout-independent chord should be
  // matched on; `key` is the fallback for the synthetic events a test or an
  // older browser produces, where `code` may be absent.
  switch (event.code ?? event.key) {
    case "Space":
    case " ":
      return "toggle";
    case "ArrowLeft":
      return "previous";
    case "ArrowRight":
      return "next";
    default:
      return null;
  }
}

/**
 * Is the focused element a panel field the user is typing prose into?
 *
 * xterm's helper textarea is not: it is how a terminal receives keys at all, and
 * withholding the transport there would defeat the entire point of this hook.
 * See the module comment for the marker this reads.
 */
export function isTypingInPanelField(element: Element | null): boolean {
  if (!element) return false;
  if ((element as HTMLElement).isContentEditable) return true;

  const tag = element.tagName?.toLowerCase();
  if (tag !== "input" && tag !== "textarea") return false;

  return !isXtermHelperTextarea(element);
}

/** xterm's own markers on its focus target. Either one identifies it. */
function isXtermHelperTextarea(element: Element): boolean {
  if (element.classList?.contains("xterm-helper-textarea")) return true;
  return element.closest?.(".xterm") != null;
}

/**
 * Mount once, with the host. See `SpeechHostProvider`.
 *
 * Returns nothing: its only effect is one `window` listener and the calls it
 * makes on the target it was handed.
 */
export function useSpeechKeys(target: MediaSessionTransportTarget): void {
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
  });

  useEffect(() => {
    /**
     * The cell every action lands on — the run first, the armed cell only when
     * there is no run to act on. The same rule the media keys follow, because
     * two surfaces onto one `<audio>` element that disagreed about their target
     * would be a bug with two correct-looking halves.
     */
    const transportTarget = (): string | null => {
      const current = targetRef.current;
      return current.speakingSessionId ?? current.pausedSessionId ?? current.armedSessionId;
    };

    /**
     * One key, two meanings — unlike the OS, which picks `play` or `pause` for
     * us from `playbackState`. A held run resumes; a live run is held; with
     * nothing running the armed cell starts. Resume rather than `onSpeak`: the
     * one thing the user pressing play on a paused answer cannot have meant is
     * to hear the unit from its start again.
     */
    const toggle = (): void => {
      const current = targetRef.current;
      if (current.pausedSessionId) {
        current.onResume(current.pausedSessionId);
        return;
      }
      if (current.speakingSessionId) {
        current.onPause(current.speakingSessionId);
        return;
      }
      if (current.armedSessionId) current.onSpeak(current.armedSessionId);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const action = speechTransportKeyFor(event);
      if (!action) return;
      if (isTypingInPanelField(document.activeElement)) return;

      event.preventDefault();

      if (action === "toggle") {
        toggle();
        return;
      }
      const sessionId = transportTarget();
      if (!sessionId) return;
      if (action === "previous") targetRef.current.onPrevious(sessionId);
      else targetRef.current.onNext(sessionId);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

export default useSpeechKeys;
