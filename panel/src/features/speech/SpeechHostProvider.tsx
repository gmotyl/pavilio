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
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import {
  alertOnAnswer,
  focusedVisibleSessionIdFor,
  isLookedAt,
  type AnswerAlertDeps,
} from "./answerAlert";
import { isDocSpeechKey } from "./docKey";
import { createSpeakingAlert } from "./speakingAlert";
import { useMediaSessionTransport, type TransportArrival } from "./useMediaSessionTransport";
import { useSpeechHost, type AnswerWaitingPort, type PageSpeech } from "./useSpeechHost";
import { useSpeechKeys } from "./useSpeechKeys";
import type { CellSpeechState, GridSpeech, Utterance } from "./types";

/**
 * The states in which a key's run holds the element, so there is a run to
 * stop. Anything else stops nothing: `onStop` silences whatever plays, and a
 * cell that barged in on a page must keep speaking.
 */
export const RUN_HOLDS_ELEMENT: ReadonlySet<CellSpeechState> = new Set([
  "preparing",
  "speaking",
  "stalled",
  "paused",
]);

/**
 * {@link PageSpeech} as the provider publishes it: the host's pair, plus what
 * only the provider can answer because only it keeps the open-page record.
 */
export interface PanelPageSpeech extends PageSpeech {
  /**
   * Stops whichever open page's run holds the element — a cache wipe's first
   * step, so nothing the run plays or warms lands after it. `onStop`, not
   * `stopDocument`: the page stays loaded, only its audio stops.
   */
  stopPageRuns(): void;
}

const SpeechHostContext = createContext<GridSpeech | null>(null);
const PageSpeechContext = createContext<PanelPageSpeech | null>(null);

/**
 * Where the focused cell is read from. The provider combines it with the route
 * and the drawer (`focusedVisibleSessionIdFor`) into the cell on screen.
 */
export interface FocusedCellPort {
  /** The project's focused cell. */
  read: (project: string) => string | null;
  /** The standalone `/terminals` page's focused cell. */
  readStandalone: () => string | null;
  /** Calls `onChange` whenever either focus may have changed; returns the unsubscribe. */
  subscribe: (onChange: () => void) => () => void;
}

/**
 * Everything the provider knows about the terminals comes in here: the speech
 * feature does not import `features/terminal`. `TerminalSpeechHost` is the one
 * component that reads the terminal's stores and builds these.
 */
interface Props {
  children: ReactNode;
  /** The session's project and names at the moment of asking, or undefined. */
  sessionOf: AnswerAlertDeps["sessionOf"];
  /** Whether the session is still open, for the idle transport. */
  isSessionOpen: (sessionId: string) => boolean;
  focusedCell: FocusedCellPort;
  /** Whether the terminal drawer is on screen. */
  drawerVisible: boolean;
  /** What a person working the transport does to the cell: clear its attention LED. */
  onArrival: TransportArrival;
  answerWaiting: AnswerWaitingPort;
  voiceFor: (sessionId: string) => string;
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
function RouterBridge({
  view,
  onRouteChange,
}: {
  view: { current: RouterView };
  onRouteChange: () => void;
}): null {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // In an effect, so a render React throws away never runs the mirror ahead.
  useEffect(() => {
    view.current = { navigate, pathname };
    onRouteChange();
  }, [navigate, pathname, view, onRouteChange]);
  return null;
}

/** Mount once, above every terminals surface. See `App.tsx`. */
export function SpeechHostProvider({
  children,
  sessionOf,
  isSessionOpen,
  focusedCell,
  drawerVisible,
  onArrival,
  answerWaiting,
  voiceFor,
}: Props) {
  // The answer alert (see `answerAlert.ts`): raised for a live arrival, read at
  // the moment it lands — what is on screen then, the session list then. The
  // speaking alert below shares its plumbing.
  const inRouter = useInRouterContext();
  const routerView = useRef<RouterView>({ navigate: null, pathname: "" });
  // The readers are called from callbacks made once per provider, so they are
  // read through a ref rather than captured; mirrored in an effect, like the
  // router view, so a render React throws away never runs the mirror ahead.
  const portsRef = useRef({ sessionOf, focusedCell });
  useEffect(() => {
    portsRef.current = { sessionOf, focusedCell };
  }, [sessionOf, focusedCell]);
  const drawerVisibleRef = useRef(drawerVisible);
  useEffect(() => {
    drawerVisibleRef.current = drawerVisible;
  }, [drawerVisible]);
  // What both speech alerts read to name a cell and to arrive at it: the
  // session list at the moment of asking, and the router's navigate.
  const [cellPlumbing] = useState<Pick<AnswerAlertDeps, "sessionOf" | "navigate">>(() => ({
    sessionOf: (sessionId) => portsRef.current.sessionOf(sessionId),
    navigate: (path) => routerView.current.navigate?.(path),
  }));
  /** The focused cell on screen right now: the project's, the drawer's, or the standalone page's. */
  const readFocusedVisible = useCallback(
    () =>
      focusedVisibleSessionIdFor(
        routerView.current.pathname,
        drawerVisibleRef.current,
        portsRef.current.focusedCell.read,
        portsRef.current.focusedCell.readStandalone,
      ),
    [],
  );
  const onAnswer = useCallback(
    (utterance: Utterance, recovered: boolean) => {
      alertOnAnswer(utterance, recovered, {
        ...cellPlumbing,
        focusedVisibleSessionId: readFocusedVisible,
        documentVisible: () => document.visibilityState === "visible",
      });
    },
    [cellPlumbing, readFocusedVisible],
  );

  // The speaking alert (see `speakingAlert.ts`), fed the host's run events. One
  // per provider, like the host; taken down when the provider goes.
  const [speakingAlert] = useState(() =>
    createSpeakingAlert({
      ...cellPlumbing,
      lookedAt: (sessionId) =>
        isLookedAt(sessionId, readFocusedVisible(), document.visibilityState === "visible"),
    }),
  );
  useEffect(() => () => speakingAlert.dispose(), [speakingAlert]);
  // The looked-at rule is re-evaluated whenever what is on screen can change:
  // the route (RouterBridge), the drawer, a focus change anywhere, the
  // standalone page's focus, and the tab going hidden/visible.
  const recheckSpeakingAlert = speakingAlert.recheck;
  useEffect(() => {
    // After drawerVisibleRef's own effect has run (effects run in order).
    recheckSpeakingAlert();
  }, [drawerVisible, recheckSpeakingAlert]);
  const subscribeFocus = focusedCell.subscribe;
  useEffect(() => {
    const unsubscribe = subscribeFocus(recheckSpeakingAlert);
    document.addEventListener("visibilitychange", recheckSpeakingAlert);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", recheckSpeakingAlert);
    };
  }, [subscribeFocus, recheckSpeakingAlert]);

  // The pages being spoken right now, by key. A page's key is open from its
  // Play until its stop — which is what the idle transport asks, and the
  // terminal's port, which knows only sessions, cannot answer for a page.
  const openPagesRef = useRef<Set<string>>(new Set());
  const isKeyOpen = useCallback(
    (sessionId: string): boolean =>
      isDocSpeechKey(sessionId)
        ? openPagesRef.current.has(sessionId)
        : isSessionOpen(sessionId),
    [isSessionOpen],
  );

  const speech = useSpeechHost({
    onAnswer,
    isSessionOpen: isKeyOpen,
    onRunChange: speakingAlert.onRunChange,
    voiceFor,
    answerWaiting,
  });

  // Here for the same reason the host is: `navigator.mediaSession` is one state
  // machine per DOCUMENT, so a transport mounted per surface would have the two
  // surfaces overwriting each other's action handlers and each clearing them on
  // the other's unmount. One host, one audio element, one transport.
  //
  // The second argument is what the panel does when a person — as opposed to
  // autoplay — works the transport: it clears that cell's attention LED. The
  // hooks are handed it rather than importing it, because the rule reads the
  // terminal's activity channel and writes to the terminal's socket, and
  // `features/speech` does not depend on `features/terminal`
  // (`terminalInstances.ts` already imports `speechTransportKeyFor` from
  // `./useSpeechKeys`). `TerminalSpeechHost` is the one place that sees both
  // features at once, so it hands the rule in as `onArrival`. See
  // `features/terminal/attentionArrival`.
  useMediaSessionTransport(speech, onArrival);

  // And here for the same reason again: one `window` keydown listener, not one
  // per surface, or a single Ctrl+Shift+Space would toggle the transport twice
  // — pause, then resume — and read as a key that does nothing at all.
  useSpeechKeys(speech, onArrival);

  // Page speech, with the open-page record kept beside it so the two cannot
  // drift: every Play and stop a page makes goes through here. Stable for the
  // provider's life — the host's own pair moves with every arrival, and a page
  // that stops on cleanup must not read that as a reason to stop — so the
  // host's pair is read through a mirror, like the ports above. Synced in a
  // LAYOUT effect, not a passive one: a page calls these from its own effects,
  // and a child's passive effect runs before its parent's, so a passive mirror
  // would hand it the host of the render before.
  const { speakDocument, stopDocument, stateFor, onStop } = speech;
  const pageHostRef = useRef({ speakDocument, stopDocument, stateFor, onStop });
  useLayoutEffect(() => {
    pageHostRef.current = { speakDocument, stopDocument, stateFor, onStop };
  }, [speakDocument, stopDocument, stateFor, onStop]);
  const [pageSpeech] = useState<PanelPageSpeech>(() => ({
    speakDocument: (input) => {
      openPagesRef.current.add(input.key);
      pageHostRef.current.speakDocument(input);
    },
    stopDocument: (key) => {
      pageHostRef.current.stopDocument(key);
      openPagesRef.current.delete(key);
    },
    stopPageRuns: () => {
      const host = pageHostRef.current;
      for (const key of openPagesRef.current) {
        if (RUN_HOLDS_ELEMENT.has(host.stateFor(key))) host.onStop(key);
      }
    },
  }));

  return (
    <SpeechHostContext.Provider value={speech}>
      <PageSpeechContext.Provider value={pageSpeech}>
        {inRouter && <RouterBridge view={routerView} onRouteChange={recheckSpeakingAlert} />}
        {children}
      </PageSpeechContext.Provider>
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

/**
 * Page speech from the panel's one host. Throws without a provider, for the
 * same reason {@link usePanelSpeech} does.
 */
export function usePageSpeech(): PanelPageSpeech {
  const pageSpeech = useContext(PageSpeechContext);

  if (!pageSpeech) {
    throw new Error(
      "usePageSpeech: no <SpeechHostProvider> above this page. The panel has " +
        "exactly one speech host; a page speaks through it rather than hosting " +
        "a second one here.",
    );
  }

  return pageSpeech;
}

const NO_PAGE_RUNS = (): void => {};

/**
 * {@link PanelPageSpeech.stopPageRuns} for Settings, the one caller that does
 * not throw without a provider: Settings is not a speaking surface, and with
 * no host above it there is no page run to stop. (Its suites mount it bare.)
 */
export function useStopPageRuns(): () => void {
  return useContext(PageSpeechContext)?.stopPageRuns ?? NO_PAGE_RUNS;
}

export default SpeechHostProvider;
