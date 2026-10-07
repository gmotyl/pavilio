/**
 * The panel's one speech host.
 *
 * {@link useSpeechHost} owns a single `<audio>` element and a single utterance
 * channel, so "only one thing speaks" is structural *only while the hook runs
 * once*. It used to be called per surface, and the panel mounts two surfaces at
 * the same time: `ProjectView`'s iTerm surface and `TerminalDrawer`'s, which is
 * mounted on Cmd+B over whatever page is showing. Two surfaces meant two hosts,
 * two `<audio>` elements and two independent armed cells — the same utterance
 * echoed twice, two cells talked over each other (barge-in is per-player), the
 * same cell rendered `speaking` in one view and `unheard` in the other, and the
 * one-armed-cell-per-browser invariant held only per surface.
 *
 * So the host is hoisted here, above the routes AND above the drawer, and every
 * surface reads the same value out of context. The surfaces still pass
 * `speech` explicitly down into the grid: the prop is what proves the wiring —
 * a surface that forgets it leaves every cell `empty`, and its suite says so.
 * Letting the grid reach into this context itself would delete that signal.
 */
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { dismissAttentionOnArrival } from "../terminal/attentionArrival";
import { getSessions } from "../terminal/sessionStore";
import { useTerminalDrawerVisible } from "../terminal/useTerminalDrawer";
import { readTerminalFocus } from "../terminal/useTerminalSessions";
import { alertOnAnswer, focusedVisibleSessionIdFor } from "./answerAlert";
import { useMediaSessionTransport } from "./useMediaSessionTransport";
import { useSpeechHost } from "./useSpeechHost";
import { useSpeechKeys } from "./useSpeechKeys";
import type { GridSpeech, Utterance } from "./types";

const SpeechHostContext = createContext<GridSpeech | null>(null);

interface Props {
  children: ReactNode;
}

/** What the answer alert reads off the router, kept current by {@link RouterBridge}. */
interface RouterView {
  navigate: ((path: string) => void) | null;
  pathname: string;
}

/**
 * Mirrors the router's navigate and pathname into the provider's ref. A child
 * rather than hooks in the provider itself, because the provider is also
 * mounted without a router — a surface's own suite — and the router hooks throw
 * there; this is only rendered when a router is above.
 */
function RouterBridge({ view }: { view: { current: RouterView } }): null {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // In an effect, so a render React throws away never runs the mirror ahead.
  useEffect(() => {
    view.current = { navigate, pathname };
  }, [navigate, pathname, view]);
  return null;
}

/** Mount once, above every terminals surface. See `App.tsx`. */
export function SpeechHostProvider({ children }: Props) {
  // The answer alert (see `answerAlert.ts`): raised for a live arrival, read at
  // the moment it lands — what is on screen then, the session list then.
  const inRouter = useInRouterContext();
  const routerView = useRef<RouterView>({ navigate: null, pathname: "" });
  const drawerVisible = useTerminalDrawerVisible();
  const drawerVisibleRef = useRef(drawerVisible);
  useEffect(() => {
    drawerVisibleRef.current = drawerVisible;
  }, [drawerVisible]);
  const onAnswer = useCallback((utterance: Utterance, recovered: boolean) => {
    alertOnAnswer(utterance, recovered, {
      sessionOf: (sessionId) => getSessions().find((session) => session.id === sessionId),
      focusedVisibleSessionId: () =>
        focusedVisibleSessionIdFor(
          routerView.current.pathname,
          drawerVisibleRef.current,
          readTerminalFocus,
        ),
      documentVisible: () => document.visibilityState === "visible",
      navigate: (path) => routerView.current.navigate?.(path),
    });
  }, []);

  // The channel never forgets a session, so the idle transport learns a cell
  // has closed from the session list: a session it no longer lists, while it
  // lists any, is gone. An empty list is read as not loaded yet and rules
  // nothing out — a panel that has not fetched its sessions must not go mute.
  const isSessionOpen = useCallback((sessionId: string): boolean => {
    const sessions = getSessions();
    return sessions.length === 0 || sessions.some((session) => session.id === sessionId);
  }, []);

  const speech = useSpeechHost({ onAnswer, isSessionOpen });

  // Here for the same reason the host is: `navigator.mediaSession` is one state
  // machine per DOCUMENT, so a transport mounted per surface would have the two
  // surfaces overwriting each other's action handlers and each clearing them on
  // the other's unmount. One host, one audio element, one transport.
  //
  // The second argument is what the panel does when a person — as opposed to
  // autoplay — works the transport: it clears that cell's attention LED. The
  // hooks are handed it rather than importing it, because the rule reads the
  // terminal's activity channel and writes to the terminal's socket, and
  // `features/speech` does not depend on `features/terminal` in either
  // direction that would survive (`terminalInstances.ts` already imports
  // `speechTransportKeyFor` from `./useSpeechKeys`). This provider is the one
  // place that legitimately sees both features at once, so it is where the two
  // are joined. See `features/terminal/attentionArrival`.
  useMediaSessionTransport(speech, dismissAttentionOnArrival);

  // And here for the same reason again: one `window` keydown listener, not one
  // per surface, or a single Ctrl+Shift+Space would toggle the transport twice
  // — pause, then resume — and read as a key that does nothing at all.
  useSpeechKeys(speech, dismissAttentionOnArrival);

  return (
    <SpeechHostContext.Provider value={speech}>
      {inRouter && <RouterBridge view={routerView} />}
      {children}
    </SpeechHostContext.Provider>
  );
}

/**
 * The panel's speech host. Throws rather than falling back to a private host:
 * a silent fallback is exactly the bug this provider exists to remove, and it
 * would come back the moment a surface is mounted somewhere new.
 */
export function usePanelSpeech(): GridSpeech {
  const speech = useContext(SpeechHostContext);

  if (!speech) {
    throw new Error(
      "usePanelSpeech: no <SpeechHostProvider> above this surface. The panel has " +
        "exactly one speech host; mount the provider above the routes and the " +
        "terminal drawer rather than hosting a second one here.",
    );
  }

  return speech;
}

export default SpeechHostProvider;
