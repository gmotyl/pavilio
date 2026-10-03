/**
 * Raises a system notification when a session starts wanting you while the
 * panel is not being looked at.
 *
 * It invents no signal. It listens to the same per-session activity channel the
 * favicon does (`useAggregateActivity`), over the same session list
 * (`useAllTerminalSessions`), and asks `shouldNotify` about every state a
 * session publishes. The words come from `notificationText`.
 *
 * ## What counts as an edge
 *
 * The channel republishes a state as it is, so the edge into `attention` is
 * worked out here against the last state THIS notifier saw for the session,
 * kept in a ref keyed by session id:
 *
 * - A session seen for the first time has no previous state, so one already
 *   sitting in `attention` counts as an edge (`shouldNotify`'s contract). On a
 *   page opened in the background that raises one notification per waiting
 *   session — wanted: each of them is waiting.
 * - A change to the session list resubscribes, but does NOT forget what was
 *   seen for a session that stays in the list, so a list refresh can never
 *   replay a notification. Only sessions that left the list are forgotten.
 *
 * ## Where the registration comes from
 *
 * `showNotification` lives on a service worker registration, and the page
 * cannot raise one through the plain `Notification` constructor on Android.
 * The notifier registers the worker itself at mount (`registerPanelServiceWorker`,
 * idempotent in the browser) and then waits for `navigator.serviceWorker.ready`:
 * the registration `register()` hands back may not have an ACTIVE worker yet
 * on a first visit, and `showNotification` on such a registration rejects.
 * `ready` is only awaited once registration succeeded, because it never settles
 * where nothing was registered. No support, a failed registration or a
 * rejected `showNotification` all end in silence: the in-page LED and favicon
 * still say the same thing.
 *
 * ## The way back
 *
 * A tap on a notification is answered by the service worker, which focuses a
 * panel window and posts it a `NotificationClickMessage`. This hook listens
 * for that message on `navigator.serviceWorker` and hands it to
 * `arriveFromNotification`, with the session list it already holds as the
 * answer to "does that session still exist".
 *
 * With no panel window running, the worker opens one instead, at the
 * project's terminals with the session in a `?notification=` parameter. On
 * mount the hook reads that parameter from the location it is given and, once
 * the session list holds the session, runs the same arrival as a posted click.
 * The list may load after mount, so it waits: a loaded (non-empty) list without
 * the session, or {@link COLD_START_WAIT_MS} without one, ends the wait in
 * silence. Either way the parameter is replaced out of the URL, so a reload
 * does not arrive a second time.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePanelSpeech } from "../speech/SpeechHostProvider";
import { newestUtteranceId, type UtteranceQueue } from "../speech/utteranceQueue";
import { useAllTerminalSessions } from "../terminal/useAllTerminalSessions";
import type { SessionMeta } from "../terminal/useTerminalSessions";
import {
  getActivityState,
  subscribeActivity,
  type ActivityState,
} from "../terminal/useTerminalActivityChannel";
import { notificationText } from "./notificationText";
import {
  arriveFromNotification,
  isNotificationClickMessage,
  NOTIFICATION_CLICK_MESSAGE_TYPE,
  notificationSessionFrom,
  withoutNotificationSession,
} from "./notificationClickTarget";
import { getNotificationsEnabled, notificationsAvailability } from "./notificationsEnabled";
import { registerPanelServiceWorker } from "./registerServiceWorker";
import { shouldNotify } from "./shouldNotify";

export interface NotifierOptions {
  /**
   * The newest answer the session's agent gave, for the preview line. Read at
   * the moment of the edge, so it may be absent; the notification then names
   * the terminal only.
   */
  latestUtteranceFor?: (sessionId: string) => string | undefined;
  /**
   * The router's navigate, for a tapped notification. A parameter rather than
   * `useNavigate` here so the hook stays usable without a router; without it a
   * tap still focuses the window, it just does not move the page.
   */
  navigate?: (path: string, options?: { replace?: boolean }) => void;
  /**
   * The router's location at mount, read once for a cold start's
   * `?notification=` parameter. Without it no cold start is recognised.
   */
  location?: { pathname: string; search: string; hash?: string };
}

/**
 * How long a cold start waits for the session list before giving up. The
 * store's first fetch normally answers in well under a second; this only
 * bounds the case where no list ever arrives (or it is genuinely empty).
 */
export const COLD_START_WAIT_MS = 10_000;

interface ColdStart {
  sessionId: string;
  pathname: string;
  search: string;
  hash: string;
}

function coldStartFrom(location: NotifierOptions["location"]): ColdStart | null {
  if (!location) return null;
  const sessionId = notificationSessionFrom(location.search);
  if (sessionId === null) return null;
  return {
    sessionId,
    pathname: location.pathname,
    search: location.search,
    hash: location.hash ?? "",
  };
}

/** The registration that can show notifications, or null where there is none. */
async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  const registered = await registerPanelServiceWorker();
  if (!registered) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/** The browser permission as `shouldNotify` takes it; no API reads as not granted. */
function currentPermission(): NotificationPermission {
  const availability = notificationsAvailability();
  return availability === "unsupported" ? "default" : availability;
}

export function useNotifier(options: NotifierOptions = {}): void {
  const { sessions } = useAllTerminalSessions();

  // Read at the moment of an edge rather than captured by the subscription, so
  // a title published after subscribing, or a newer answer, is what is shown.
  const sessionsRef = useRef(new Map<string, SessionMeta>());
  const latestUtteranceForRef = useRef(options.latestUtteranceFor);
  const navigateRef = useRef(options.navigate);
  useEffect(() => {
    sessionsRef.current = new Map(sessions.map((s) => [s.id, s]));
    latestUtteranceForRef.current = options.latestUtteranceFor;
    navigateRef.current = options.navigate;
  });

  const registrationRef = useRef<Promise<ServiceWorkerRegistration | null> | null>(null);
  useEffect(() => {
    registrationRef.current = activeRegistration().catch(() => null);
  }, []);

  // A tapped notification, posted back by the worker. Bound once; reads the
  // session list and navigate through refs at the moment of the message.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    if (typeof container.addEventListener !== "function") return;
    const onMessage = (event: MessageEvent) => {
      if (!isNotificationClickMessage(event.data)) return;
      arriveFromNotification(event.data, {
        projectOf: (sessionId) => sessionsRef.current.get(sessionId)?.project,
        navigate: (path) => navigateRef.current?.(path),
      });
    };
    container.addEventListener("message", onMessage);
    return () => container.removeEventListener("message", onMessage);
  }, []);

  // A cold start: the worker opened this window with the tapped session in the
  // URL. Read once, at mount; cleared as soon as it is settled either way.
  const coldStartRef = useRef<ColdStart | null | undefined>(undefined);
  if (coldStartRef.current === undefined) coldStartRef.current = coldStartFrom(options.location);

  useEffect(() => {
    const pending = coldStartRef.current;
    if (!pending) return;
    const replace = (path: string) => navigateRef.current?.(path, { replace: true });
    const found = sessions.find((s) => s.id === pending.sessionId);
    if (found) {
      coldStartRef.current = null;
      // The arrival's own navigation lands on the project's terminals without
      // the parameter, replacing the cold-start entry.
      arriveFromNotification(
        { type: NOTIFICATION_CLICK_MESSAGE_TYPE, sessionId: found.id, project: found.project },
        { projectOf: () => found.project, navigate: replace },
      );
      return;
    }
    // An empty list before the store's first load means "not known yet"; a
    // non-empty one without the session means it is gone.
    if (sessions.length > 0) {
      coldStartRef.current = null;
      replace(pending.pathname + withoutNotificationSession(pending.search) + pending.hash);
    }
  }, [sessions]);

  useEffect(() => {
    if (!coldStartRef.current) return;
    const timer = setTimeout(() => {
      const pending = coldStartRef.current;
      if (!pending) return;
      coldStartRef.current = null;
      navigateRef.current?.(
        pending.pathname + withoutNotificationSession(pending.search) + pending.hash,
        { replace: true },
      );
    }, COLD_START_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  /** Last state seen per session; absent means never seen. */
  const previousRef = useRef(new Map<string, ActivityState>());

  // Keyed on the ids, not the array: the list is republished with new
  // identities that carry the same sessions, and only membership matters here.
  const idsKey = sessions.map((s) => s.id).join("\n");

  useEffect(() => {
    const ids = idsKey === "" ? [] : idsKey.split("\n");
    const previous = previousRef.current;

    const show = (sessionId: string) => {
      const session = sessionsRef.current.get(sessionId);
      const pending = registrationRef.current;
      if (!session || !pending) return;
      const copy = notificationText({
        session,
        latestUtterance: latestUtteranceForRef.current?.(sessionId),
      });
      void pending
        .then((registration) =>
          registration?.showNotification(copy.title, {
            body: copy.body,
            tag: copy.tag,
            data: copy.data,
          }),
        )
        .catch(() => {
          // Permission revoked between the check and the call, or no active
          // worker after all: the in-page signals still carry the news.
        });
    };

    const observe = (sessionId: string, next: ActivityState) => {
      const before = previous.get(sessionId);
      previous.set(sessionId, next);
      const notify = shouldNotify({
        previous: before,
        next,
        documentVisible: document.visibilityState === "visible",
        enabled: getNotificationsEnabled(),
        permission: currentPermission(),
      });
      if (notify) show(sessionId);
    };

    // Forget sessions that left the list; keep what was seen for the rest so a
    // resubscription is not mistaken for a new edge.
    const current = new Set(ids);
    for (const id of [...previous.keys()]) {
      if (!current.has(id)) previous.delete(id);
    }

    // First sight of a session counts as an observation of its present state.
    for (const id of ids) {
      if (!previous.has(id)) observe(id, getActivityState(id));
    }

    const unsubs = ids.map((id) => subscribeActivity(id, (state) => observe(id, state)));
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [idsKey]);
}

/** The text of the newest answer a cell holds, whatever the transport is on. */
function newestUtteranceText(queue: UtteranceQueue): string | undefined {
  const id = newestUtteranceId(queue);
  if (id === null) return undefined;
  const held = [queue.current, ...queue.pending, ...queue.previous];
  return held.find((utterance) => utterance?.id === id)?.text;
}

/**
 * Mounts the notifier. Lives INSIDE `SpeechHostProvider` (see `App.tsx`) because
 * the preview line is the newest answer the speech channel holds for the cell —
 * the channel is the panel's only reader of the utterance stream, and its
 * queues are React state inside the host, not a store readable from outside it.
 * It is inside `BrowserRouter` too, which is where a tapped notification's
 * navigation, and a cold start's `?notification=` location, come from.
 */
export function Notifier(): null {
  const speech = usePanelSpeech();
  const navigate = useNavigate();
  const location = useLocation();
  useNotifier({
    latestUtteranceFor: (sessionId) => newestUtteranceText(speech.queueFor(sessionId)),
    navigate,
    location,
  });
  return null;
}
