import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { matchProjectFromPath } from "../projects/matchProjectFromPath";
import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { useIsMobile } from "../shell/useIsMobile";

export const DRAWER_MIN_WIDTH = 320;
export const DRAWER_DEFAULT_WIDTH = 480;
/** Floor for <main>: the drawer may never squeeze it narrower than this. */
export const MAIN_MIN_WIDTH = 360;

export function drawerMaxWidth(viewport: number): number {
  return Math.max(DRAWER_MIN_WIDTH, viewport - MAIN_MIN_WIDTH);
}

function clampWidth(value: number, viewport: number): number {
  return Math.min(drawerMaxWidth(viewport), Math.max(DRAWER_MIN_WIDTH, value));
}

/**
 * Left is the default; only an explicitly stored "right" docks right.
 *
 * The declaration's key is deliberately NOT bumped along with that default. A
 * stored value is only ever written by an explicit drag, so a workspace that
 * already holds "right" is holding a choice its user made — and overriding an
 * explicit choice is worse than asking one user to drag the drawer once. Do
 * not "fix" this by clearing the key.
 */
export type DrawerSide = "left" | "right";

interface DrawerCtx {
  /** Persisted user intent. Navigation must never write this. */
  open: boolean;
  /** Current route cannot host the drawer. Derived every render, never stored. */
  suppressed: boolean;
  /**
   * A conflicting overlay (the Cmd+O quick-terminal modal) is up and owns the
   * single pooled xterm holder. Session-only — never persisted, so a conflict
   * cannot outlive itself or a reload.
   */
  overlayActive: boolean;
  /**
   * open && !suppressed && !overlayActive && !narrowViewport — what the drawer
   * actually renders on. The narrow-viewport term has no field of its own on
   * this context: nothing outside the provider ever needed to tell the reasons
   * apart, and a published fact with no reader is a promise the next change
   * has to keep for nobody. The distinction it was there to make — that the
   * ROUTE is still perfectly able to host the drawer on a phone — is carried
   * by `suppressed` staying false while this is false, which is what the
   * drawer suite asserts.
   */
  visible: boolean;
  width: number;
  maxWidth: number;
  side: DrawerSide;
  setOpen: (v: boolean) => void;
  setOverlayActive: (v: boolean) => void;
  toggle: () => void;
  setWidth: (v: number) => void;
  setSide: (v: DrawerSide) => void;
}

const Ctx = createContext<DrawerCtx | null>(null);

export function TerminalDrawerProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  // All three are `global`-scoped and portable: the drawer's shape is a choice
  // about the panel, not about a machine, so it travels in the workspace file.
  // `usePreference` rather than a hand-rolled useState: the provider is a
  // single component with a fixed key per value, so there is no dynamic-scope
  // problem here, and the hook brings the cross-tab subscription with it.
  const [open, setOpenPref] = usePreference(preferences.terminalDrawerOpen);
  const [storedWidth, setStoredWidthPref] = usePreference(preferences.terminalDrawerWidth);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [side, setSidePref] = usePreference(preferences.terminalDrawerSide);
  // Deliberately never persisted: an overlay conflict is a transient fact about
  // this session, not a preference.
  const [overlayActive, setOverlayActive] = useState(false);
  /**
   * The viewport is too narrow to share with a drawer. On a phone the terminal
   * has a tab of its own — it is what the panel is open for there — and the
   * drawer has nothing left to sit beside.
   *
   * A term of its own rather than a fourth condition folded into `suppressed`,
   * because `suppressed` answers a different question — whether the ROUTE can
   * host the drawer — and a consumer asking it is asking about the route. Both
   * are derived every render and neither is ever stored.
   *
   * Kept live across a resize or a rotation rather than read once at mount, so
   * a window dragged back out to a desktop width brings the drawer back with
   * it. `useIsMobile` is the shared subscription the rest of the shell already
   * uses for exactly this question, and reusing it is what keeps every
   * component agreeing on where the phone stops.
   */
  const narrowViewport = useIsMobile();

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const maxWidth = drawerMaxWidth(viewport);
  const width = clampWidth(storedWidth, viewport);

  const setOpen = useCallback(
    (v: boolean) => {
      setOpenPref(v);
    },
    [setOpenPref],
  );

  // The stored width is the clamped one, exactly as before: the floor and the
  // live-viewport ceiling are applied on the way IN, so a value written on a
  // wide screen is not the one a narrow one reads back.
  const setWidth = useCallback(
    (v: number) => {
      setStoredWidthPref(clampWidth(v, window.innerWidth));
    },
    [setStoredWidthPref],
  );

  const setSide = useCallback(
    (v: DrawerSide) => {
      setSidePref(v);
    },
    [setSidePref],
  );

  const openRef = useRef(open);
  const pathRef = useRef(location.pathname);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  const match = matchProjectFromPath(location.pathname);
  const suppressed = !match || match.section === "iterm";
  const visible = open && !suppressed && !overlayActive && !narrowViewport;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        const match = matchProjectFromPath(pathRef.current);
        if (!match || match.section === "iterm") return;
        setOpen(!openRef.current);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [setOpen]);

  return (
    <Ctx.Provider
      value={{
        open,
        suppressed,
        overlayActive,
        visible,
        width,
        maxWidth,
        side,
        setOpen,
        setOverlayActive,
        toggle,
        setWidth,
        setSide,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useTerminalDrawer(): DrawerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useTerminalDrawer must be used within TerminalDrawerProvider");
  }
  return ctx;
}
