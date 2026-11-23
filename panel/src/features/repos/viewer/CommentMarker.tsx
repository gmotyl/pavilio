import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import MarkdownRenderer from "../../markdown/MarkdownRenderer";
import { usePageSpeech } from "../../speech/SpeechHostProvider";
import { prDescriptionSource } from "../PrDescription";
import { hue, updatedAgo } from "../PrRow";
import type { ReviewThread } from "../reviewThreads";

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

const initials = (login: string): string => login.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
const plural = (n: number) => `${n} comment${n === 1 ? "" : "s"}`;

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
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const popId = useId();
  const markerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const over = useRef({ marker: false, pop: false });

  const { comments, anchor } = thread;
  const n = comments.length;
  const line = anchor.line;
  const bodies = comments.map((c) => prDescriptionSource(c.body));
  const href = safeHref(comments[0].url);

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

  // Escape closes it wherever focus is: a hover-opened popover never had focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = popRef.current?.contains(document.activeElement);
      close();
      if (inside) markerRef.current?.focus();
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
  }, [open, close]);

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

  const playOne = (i: number) =>
    speechKey && speech.speakDocument({ key: `${speechKey}/c/${comments[i].id}`, text: `${comments[i].author}: ${bodies[i]}` });
  const playAll = () =>
    speechKey &&
    speech.speakDocument({
      key: `${speechKey}/t/${comments[0].id}`,
      text: comments.map((c, i) => `${c.author}: ${bodies[i]}`).join("\n\n"),
    });

  const style: CSSProperties = { top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" };

  return (
    <>
      <button
        ref={markerRef}
        type="button"
        className={`fv-cmbtn${open ? " open" : ""}`}
        aria-label={`${plural(n)} on line ${line}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onPointerEnter={enter("marker")}
        onPointerLeave={leave("marker")}
        onFocus={() => {
          cancelClose();
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
              // The portal sits at the end of <body>: Shift+Tab off the first control and Tab off the
              // last both go back to the marker instead of leaving the page's tab order.
              if (e.key !== "Tab") return;
              const all = popRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
              if (!all?.length) return;
              const edge = e.shiftKey ? all[0] : all[all.length - 1];
              if (e.target !== edge) return;
              e.preventDefault();
              markerRef.current?.focus();
            }}
            // React events from a portal bubble through the React tree: keep them out of the viewer's body click.
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <b>Line {line}</b> · {plural(n)}
              {speechKey && (
                <button type="button" className="fv-cmplay fv-cmplay-all" aria-label="Play thread" onClick={playAll}>
                  {n >= 2 ? "▷ Play all" : "▷ Play"}
                </button>
              )}
            </header>
            {comments.map((c, i) => (
              <div key={c.id} className="fv-cmmsg">
                <div className="fv-cmwho">
                  <span className="fv-cmav" style={{ background: hue(c.author) }} aria-hidden="true">
                    {initials(c.author)}
                  </span>
                  <b>{me && c.author === me ? "you" : c.author}</b> · {updatedAgo(c.createdAt)}
                  {speechKey && n >= 2 && (
                    <button type="button" className="fv-cmplay" aria-label="Play comment" onClick={() => playOne(i)}>
                      ▷
                    </button>
                  )}
                </div>
                <div className="fv-cmbody">
                  <MarkdownRenderer content={bodies[i]} untrusted={{ linkBase: c.url }} />
                </div>
              </div>
            ))}
            <footer>
              Read-only ·{" "}
              {href ? (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  Reply on GitHub ↗
                </a>
              ) : (
                "Reply on GitHub ↗"
              )}
            </footer>
          </div>,
          document.body,
        )}
    </>
  );
}
