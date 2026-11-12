import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { useWikiLinkCard } from "./wikiLinkCard";

/** Hover time before the card opens (design § Decisions 6). */
const WIKILINK_CARD_OPEN_DELAY_MS = 400;
/** Grace period after the pointer leaves both the link and the card. */
const WIKILINK_CARD_CLOSE_DELAY_MS = 150;

/** Gap between the link and the card, and the minimum distance kept from the viewport edge. */
const GAP_PX = 4;
const EDGE_PX = 8;

/**
 * Matches an open hover card. While one is up, Escape is the card's: another
 * Escape owner listening earlier in the dispatch (the answer pane) steps aside.
 */
export const WIKILINK_HOVER_CARD_SELECTOR = "[data-wikilink-hover-card]";

type AnchorProps = {
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
};

interface WikiLinkHoverCardProps {
  /** The target's projectsDir-relative path, as the anchor's `data-wikilink` carries it. */
  path: string;
  /** The link's own text: the card title when the target has no H1. */
  label: string;
  /** The wikilink anchor. Its attributes are kept; hover/focus handlers are added to it. */
  children: ReactElement<AnchorProps>;
}

type Position = { top: number; left: number };

/** Below the link, flipped above when it would leave the viewport, and clamped horizontally. */
function cardPosition(link: DOMRect, card: { width: number; height: number }): Position {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = link.bottom + GAP_PX;
  if (top + card.height > vh - EDGE_PX && link.top - GAP_PX - card.height >= EDGE_PX) {
    top = link.top - GAP_PX - card.height;
  }
  const maxLeft = Math.max(EDGE_PX, vw - EDGE_PX - card.width);
  const left = Math.min(Math.max(link.left, EDGE_PX), maxLeft);
  return { top, left };
}

/**
 * The wikilink hover card: a desktop-only card with the target's title, path and description
 * (or first paragraph). Opens 400 ms after a non-touch pointer rests on the link, or at once on
 * keyboard focus; closes 150 ms after the pointer leaves both link and card, on Escape, or on blur.
 */
export default function WikiLinkHoverCard({ path, label, children }: WikiLinkHoverCardProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const cardId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A focus that follows a pointer press (a click or tap) is not keyboard focus.
  // Cleared again on pointerup: browsers that do not focus a link on click
  // (Safari, Firefox on macOS) would otherwise leave it set for the next Tab.
  const pointerPressed = useRef(false);
  // Whether the pointer is over the link or the card; while it is, the pointer
  // timers own closing and a blur does not close.
  const overLink = useRef(false);
  const overCard = useRef(false);
  const card = useWikiLinkCard(path, open);

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const close = useCallback(() => {
    clearTimers();
    // The card unmounts without a pointerleave.
    overCard.current = false;
    setOpen(false);
    setPos(null);
  }, [clearTimers]);

  const scheduleClose = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(close, WIKILINK_CARD_CLOSE_DELAY_MS);
  }, [close]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Escape closes the card wherever focus is: a hover-opened card never had focus.
  // Window capture phase, so the key is consumed before any outer Escape owner
  // sees it (the answer pane would close itself); the pane's own window capture
  // listener is registered earlier and steps aside for WIKILINK_HOVER_CARD_SELECTOR.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  // Measure after each render while open (content changes the card's size), and follow scroll.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchorRef.current;
      const c = cardRef.current;
      if (!a || !c) return;
      const next = cardPosition(a.getBoundingClientRect(), { width: c.offsetWidth, height: c.offsetHeight });
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

  const own = children.props;
  const anchor = cloneElement(children, {
    ref: (el: HTMLElement | null) => {
      anchorRef.current = el;
    },
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      own.onPointerEnter?.(e);
      if (e.pointerType === "touch") return;
      overLink.current = true;
      cancelClose();
      if (open || openTimer.current) return;
      openTimer.current = setTimeout(() => {
        openTimer.current = null;
        setOpen(true);
      }, WIKILINK_CARD_OPEN_DELAY_MS);
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      own.onPointerLeave?.(e);
      if (e.pointerType === "touch") return;
      overLink.current = false;
      scheduleClose();
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      own.onPointerDown?.(e);
      pointerPressed.current = true;
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      own.onPointerUp?.(e);
      // A click focuses on mousedown, before this; a press that did not focus is over.
      pointerPressed.current = false;
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      own.onFocus?.(e);
      const byPointer = pointerPressed.current;
      pointerPressed.current = false;
      if (byPointer) return;
      clearTimers();
      setOpen(true);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      own.onBlur?.(e);
      pointerPressed.current = false;
      // A press inside the non-focusable card blurs the link; while the pointer
      // is over the link or the card, leaving them closes it instead.
      const into = e.relatedTarget;
      if (overLink.current || overCard.current) return;
      if (into instanceof Node && cardRef.current?.contains(into)) return;
      close();
    },
    "aria-describedby": open
      ? [own["aria-describedby"], cardId].filter(Boolean).join(" ")
      : own["aria-describedby"],
  } as Partial<AnchorProps> & { ref: (el: HTMLElement | null) => void });

  const style: CSSProperties = {
    top: pos?.top ?? 0,
    left: pos?.left ?? 0,
    visibility: pos ? "visible" : "hidden",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-subtle)",
    color: "var(--text-primary)",
  };
  const content = card.status === "ready" ? card.content : undefined;
  const title = content ? content.title || label : undefined;
  const body = content?.description ?? content?.excerpt;

  return (
    <>
      {anchor}
      {open &&
        createPortal(
          <div
            ref={cardRef}
            id={cardId}
            role="tooltip"
            data-testid="wikilink-hover-card"
            data-wikilink-hover-card=""
            className="fixed z-50 max-w-sm p-3 rounded-md text-sm shadow-lg"
            style={style}
            onPointerEnter={(e) => {
              if (e.pointerType === "touch") return;
              overCard.current = true;
              cancelClose();
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "touch") return;
              overCard.current = false;
              scheduleClose();
            }}
            // React events from a portal bubble through the React tree: keep
            // hovering and clicking the card out of the ancestors (PlayFromHere).
            onMouseOver={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {title && <div className="font-semibold">{title}</div>}
            <div className="font-mono text-xs break-all select-text" style={{ color: "var(--text-muted)" }}>
              {path}
            </div>
            {body && (
              <div className="mt-2" style={{ color: "var(--text-secondary)" }}>
                {body}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
