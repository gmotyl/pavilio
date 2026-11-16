import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * Where an open page's speech row is drawn: a sticky host at the top of the
 * viewer's scrolled content.
 *
 * The row's owner (`SpeakingToolbar` in `ViewerActions`) sits in a toolbar —
 * the breadcrumb bar for `/view/*`, a header row in the project tabs — whose
 * box is only as wide as its buttons and, for a project tab, scrolls away with
 * the page. A sticky box sticks only within its parent, and a portal is the one
 * way to draw the row elsewhere without moving the run's owner. So the shell
 * publishes a slot (`PageSpeechRowSlot`, above both the breadcrumb bar and the
 * routed page), the page viewer mounts the host where the row belongs
 * (`PageSpeechRowHost`), and the toolbar portals into whatever host is mounted.
 * With no host — a toolbar rendered outside the shell — the row stays inline.
 */
interface SlotValue {
  host: HTMLElement | null;
  register: (el: HTMLElement | null, previous: HTMLElement | null) => void;
}

const SlotContext = createContext<SlotValue | null>(null);

export function PageSpeechRowSlot({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  // A host unmounting clears the slot only if it still holds it, so a page
  // switch that mounts the next host first cannot be undone by the old one.
  const register = useCallback((el: HTMLElement | null, previous: HTMLElement | null) => {
    setHost((current) => (el ? el : current === previous ? null : current));
  }, []);
  const value = useMemo(() => ({ host, register }), [host, register]);
  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>;
}

/** The mounted host the page row portals into, or null to render it inline. */
export function usePageSpeechRowHost(): HTMLElement | null {
  return useContext(SlotContext)?.host ?? null;
}

/**
 * The sticky host itself: empty (no height) until a row is portalled in.
 * `top` is the sticky offset — the height of any sticky chrome above it in the
 * same scroller; the default `0` is for a host inside a sticky wrapper.
 */
export function PageSpeechRowHost({ top }: { top?: string }) {
  const register = useContext(SlotContext)?.register;
  const last = useRef<HTMLElement | null>(null);
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      register?.(node, last.current);
      last.current = node;
    },
    [register],
  );
  const style: CSSProperties | undefined = top ? { top } : undefined;
  return (
    <div ref={ref} data-testid="page-speech-row-host" className="page-speech-row-host" style={style} />
  );
}
