import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Pause, Play } from "lucide-react";
import { createPortal } from "react-dom";
import MarkdownRenderer from "../../markdown/MarkdownRenderer";
import { usePageSpeech, usePanelSpeech } from "../../speech/SpeechHostProvider";
import type { CellSpeechState } from "../../speech/types";
import { closeOpenFence } from "../../speech/strip";
import { prDescriptionSource } from "../PrDescription";
import { hue, updatedAgo } from "../PrRow";
import type { ReviewComment } from "../../../../server/lib/prs/provider";
import type { ReviewThread } from "../reviewThreads";
import { CommentSpeechScope } from "./commentSpeech";

/** Grace period after the pointer leaves both the marker and the popover (as in WikiLinkHoverCard). */
const CLOSE_DELAY_MS = 150;
/** Gap between the marker and the popover, and the minimum distance kept from the viewport edge. */
const GAP_PX = 4;
const EDGE_PX = 8;

interface Props {
  thread: ReviewThread;
  /** The PR's speech key (`prSpeechKey`); without it the popover has no Play buttons. */
  speechKey?: string;
  /** The signed-in login: their comments read as "you". */
  me?: string | null;
}

type Position = { top: number; left: number };

/** Right of the marker, top-aligned with its row; flipped left / clamped to stay in the viewport. */
function popPosition(marker: DOMRect, pop: { width: number; height: number }): Position {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = marker.right + GAP_PX;
  if (left + pop.width > vw - EDGE_PX) left = Math.max(EDGE_PX, vw - EDGE_PX - pop.width);
  const top = Math.max(EDGE_PX, Math.min(marker.top - 6, vh - EDGE_PX - pop.height));
  return { top, left };
}

/** Only http(s) urls become links: a comment url is provider data, not trusted markup. */
const safeHref = (url: string): string | null => (/^https?:\/\//i.test(url) ? url : null);
const FOCUSABLE = "button, a[href]";
/** Page-wide tabbable controls, for stepping past the marker as if the popover sat inline. */
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Whether `el` can take focus as it stands: not inside a `hidden`, `inert` or `display: none` /
 * `visibility: hidden` ancestor, nor a disabled fieldset (e.g. a `hidden md:block` toggle on a
 * narrow screen). The ancestor walk is what jsdom can see; `checkVisibility` adds layout where it exists.
 */
function canFocus(el: HTMLElement): boolean {
  if (el.closest("[hidden], [inert], fieldset[disabled]")) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === "none") return false;
    if (n === el && (cs.visibility === "hidden" || cs.visibility === "collapse")) return false;
  }
  return el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : true;
}

/** The first focusable tabbable element after `marker` in document order, outside `pop`. */
function nextTabbable(marker: HTMLElement, pop: HTMLElement | null): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(TABBABLE)) {
    // Document order first: it is cheap, and skips the style walk for everything before the marker.
    if (!(marker.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (el.tabIndex < 0 || marker.contains(el) || pop?.contains(el) || !canFocus(el)) continue;
    return el;
  }
  return null;
}

/**
 * The popover's comments as conversations: one per root, in the roots' order, each root followed by
 * its replies. `groupThreads` can merge several roots anchored on the same line into one thread.
 */
function conversations(comments: readonly ReviewComment[]): { root: ReviewComment; items: number[] }[] {
  const byRoot = new Map<number, { root: ReviewComment; items: number[] }>();
  comments.forEach((c, i) => {
    const rootId = c.replyTo ?? c.id;
    const group = byRoot.get(rootId);
    if (group) group.items.push(i);
    else byRoot.set(rootId, { root: comments.find((r) => r.id === rootId) ?? c, items: [i] });
  });
  return [...byRoot.values()];
}

const initials = (login: string): string => login.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
const plural = (n: number) => `${n} comment${n === 1 ? "" : "s"}`;

/**
 * What a comment's Play control shows and does for its key's state, read from the host by key as
 * the page's speech row reads it (`SpeechTransport`): a run in hand offers its pause, red while it
 * waits on synthesis; a held run its resume; anything else Play.
 */
type PlayIntent = "play" | "pause" | "resume";
function playIntent(state: CellSpeechState): PlayIntent {
  if (state === "speaking" || state === "stalled") return "pause";
  if (state === "paused") return "resume";
  return "play";
}
/** The states the control wears the transport's colours for (`.speech-bar-primary[data-speech]`); idle stays neutral. */
const LIT: ReadonlySet<CellSpeechState> = new Set(["preparing", "stalled", "speaking", "paused"]);
const WAITING: ReadonlySet<CellSpeechState> = new Set(["preparing", "stalled"]);
const VERB: Record<PlayIntent, string> = { play: "Play", pause: "Pause", resume: "Resume" };

const ChatIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H7l-3 2.6V11h-.5A1.5 1.5 0 0 1 2 9.5z" />
  </svg>
);

/**
 * A review thread's marker in the file viewer's comment lane. Hover or focus opens the thread
 * (read-only) in a portal popover; it closes 150 ms after the pointer leaves both, or on Escape.
 */
export default function CommentMarker({ thread, speechKey, me }: Props) {
  const speech = usePageSpeech();
  const host = usePanelSpeech();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const popId = useId();
  const markerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const over = useRef({ marker: false, pop: false });
  /** Set while focus is handed back to the marker after closing: that focus must not re-open it. */
  const quietFocus = useRef(false);

  const { comments, anchor } = thread;
  const n = comments.length;
  const line = anchor.line;
  const bodies = comments.map((c) => prDescriptionSource(c.body));
  const groups = conversations(comments);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const close = useCallback(() => {
    cancelClose();
    over.current.pop = false;
    setOpen(false);
    setPos(null);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    // Keyboard focus on the marker or inside the popover holds it open: the pointer only borrowed it.
    const a = document.activeElement;
    if (a && (markerRef.current?.contains(a) || popRef.current?.contains(a))) return;
    closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
  }, [cancelClose, close]);

  useEffect(() => cancelClose, [cancelClose]);

  // Speech this marker started stops with it: leaving the file or PR must not leave a comment
  // playing, nor a stale key for the global Play shortcut to resume (as `SpeakingToolbar` does).
  // Inside a file viewer the viewer owns that instead, so a layout switch remounting the marker
  // keeps the comment playing.
  const scope = useContext(CommentSpeechScope);
  const started = useRef(new Set<string>());
  useEffect(() => {
    const keys = started.current;
    return () => {
      for (const k of keys) speech.stopDocument(k);
      keys.clear();
    };
  }, [speech, speechKey]);

  const focusMarkerClosed = useCallback(() => {
    quietFocus.current = true;
    markerRef.current?.focus();
    quietFocus.current = false;
  }, []);

  // Escape closes it wherever focus is: a hover-opened popover never had focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = popRef.current?.contains(document.activeElement);
      close();
      if (inside) focusMarkerClosed();
    };
    // A tap elsewhere closes a popover opened by tapping (touch has no pointerleave).
    const onDown = (e: globalThis.PointerEvent) => {
      const t = e.target as Node;
      if (!markerRef.current?.contains(t) && !popRef.current?.contains(t)) close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, close, focusMarkerClosed]);

  // Measure after each render while open, and follow scroll (the viewer scrolls inside its host).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const m = markerRef.current;
      const p = popRef.current;
      if (!m || !p) return;
      const next = popPosition(m.getBoundingClientRect(), { width: p.offsetWidth, height: p.offsetHeight });
      setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  });

  const enter = (side: "marker" | "pop") => (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "touch") return;
    over.current[side] = true;
    cancelClose();
    if (side === "marker") setOpen(true);
  };
  const leave = (side: "marker" | "pop") => (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "touch") return;
    over.current[side] = false;
    if (!over.current.marker && !over.current.pop) scheduleClose();
  };
  // Focus leaving both the marker and the popover closes it, unless the pointer still holds it.
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    const into = e.relatedTarget;
    if (over.current.marker || over.current.pop) return;
    if (into instanceof Node && (markerRef.current?.contains(into) || popRef.current?.contains(into))) return;
    close();
  };
  // The popover lives in a portal: Tab from the marker steps into it rather than past it.
  const onMarkerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Tab" || e.shiftKey || !open) return;
    const first = popRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (!first) return;
    e.preventDefault();
    first.focus();
  };

  // The author on a paragraph of their own: a body opening with a fence (```suggestion) must start
  // its line, or the speech filter's line-anchored fence match misses it and swallows what follows.
  // A fence left open is closed per comment, so in Play all it can't swallow the replies after it.
  const spoken = (i: number) => `${comments[i].author}:\n\n${closeOpenFence(bodies[i])}`;
  const speak = (key: string, text: string) => {
    if (scope) scope(key, speech.stopDocument);
    else started.current.add(key);
    speech.speakDocument({ key, text });
  };
  const commentKey = (i: number) => `${speechKey}/c/${comments[i].id}`;
  const threadKey = `${speechKey}/t/${comments[0].id}`;
  const playOne = (i: number) => speechKey && speak(commentKey(i), spoken(i));
  const playAll = () => speechKey && speak(threadKey, groups.flatMap((g) => g.items.map(spoken)).join("\n\n"));

  /** How the popover names an author: "you" for the signed-in login. */
  const who = (c: ReviewComment) => (me && c.author === me ? "you" : c.author);
  /**
   * The control's look and press for `key`: Play starts it, a run in hand pauses, a held one resumes.
   * `what` completes its name after the verb; the name starts with the button's visible text (WCAG 2.5.3).
   */
  const control = (key: string, what: string, play: () => void) => {
    const state = host.stateFor(key);
    const intent = playIntent(state);
    const waiting = WAITING.has(state);
    return {
      intent,
      label: `${VERB[intent]} ${what}${waiting ? " — waiting for the voice" : ""}`,
      icon: intent === "pause" ? <Pause size={11} aria-hidden="true" /> : <Play size={11} aria-hidden="true" />,
      props: {
        "data-speech": LIT.has(state) ? state : undefined,
        "data-icon": intent,
        onClick: () => {
          if (intent === "pause") host.onPause(key);
          else if (intent === "resume") host.onResume(key);
          else play();
        },
      },
    };
  };

  const style: CSSProperties = { top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" };

  return (
    <>
      <button
        ref={markerRef}
        type="button"
        data-testid="comment-marker"
        className={`fv-cmbtn${open ? " open" : ""}`}
        aria-label={`${plural(n)} on line ${line}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onPointerEnter={enter("marker")}
        onPointerLeave={leave("marker")}
        onFocus={() => {
          cancelClose();
          if (quietFocus.current) return;
          setOpen(true);
        }}
        onBlur={onBlur}
        onClick={() => setOpen(true)}
        onKeyDown={onMarkerKey}
      >
        <ChatIcon />
        {n >= 2 && <span className="fv-cmk">{n}</span>}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            className="fv-cmpop"
            role="dialog"
            aria-label={`${n === 1 ? "Comment" : "Comments"} on line ${line}`}
            style={style}
            onPointerEnter={enter("pop")}
            onPointerLeave={leave("pop")}
            onBlur={onBlur}
            onKeyDown={(e) => {
              // The portal sits at the end of <body>, so tab order acts as if it sat inline after the
              // marker: Shift+Tab off the first control returns to the marker (popover stays open); Tab
              // off the last closes it and moves past the marker — never back in (no keyboard trap).
              if (e.key !== "Tab") return;
              const all = popRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
              if (!all?.length) return;
              const edge = e.shiftKey ? all[0] : all[all.length - 1];
              if (e.target !== edge) return;
              e.preventDefault();
              if (e.shiftKey) {
                markerRef.current?.focus();
                return;
              }
              const next = markerRef.current ? nextTabbable(markerRef.current, popRef.current) : null;
              close();
              next?.focus();
              // Nothing focusable after it, or the browser refused the focus: keep it on the marker.
              if (!next || document.activeElement !== next) focusMarkerClosed();
            }}
            // React events from a portal bubble through the React tree: keep them out of the viewer's body click.
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <b>Line {line}</b> · {plural(n)}
              {speechKey &&
                (() => {
                  // "Play all comments on line L"; a one-comment thread's lone Play names that comment.
                  const c = control(threadKey, n >= 2 ? `all comments on line ${line}` : `comment by ${who(comments[0])}`, playAll);
                  return (
                    <button type="button" data-testid="comment-play-thread" className="fv-cmplay fv-cmplay-all speech-bar-primary" aria-label={c.label} title={c.label} {...c.props}>
                      {c.icon}
                      {c.intent === "play" ? (n >= 2 ? "Play all" : "Play") : VERB[c.intent]}
                    </button>
                  );
                })()}
            </header>
            {groups.map(({ root, items }) => {
              const href = safeHref(root.url);
              return (
                <section key={root.id} className="fv-cmconv">
                  {items.map((i) => {
                    const c = comments[i];
                    return (
                      <div key={c.id} className="fv-cmmsg">
                        <div className="fv-cmwho">
                          <span className="fv-cmav" style={{ background: hue(c.author) }} aria-hidden="true">
                            {initials(c.author)}
                          </span>
                          <b>{who(c)}</b> · {updatedAgo(c.createdAt)}
                          {speechKey &&
                            n >= 2 &&
                            (() => {
                              const p = control(commentKey(i), `comment by ${who(c)}`, () => playOne(i));
                              return (
                                <button type="button" data-testid={`comment-play-${c.id}`} className="fv-cmplay speech-bar-primary" aria-label={p.label} title={p.label} {...p.props}>
                                  {p.icon}
                                </button>
                              );
                            })()}
                        </div>
                        <div className="fv-cmbody">
                          <MarkdownRenderer content={bodies[i]} untrusted={{ linkBase: c.url }} />
                        </div>
                      </div>
                    );
                  })}
                  <div className="fv-cmreply">
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer noopener">
                        Reply on GitHub ↗
                      </a>
                    ) : (
                      "Reply on GitHub"
                    )}
                  </div>
                </section>
              );
            })}
            <footer>Read-only</footer>
          </div>,
          document.body,
        )}
    </>
  );
}
