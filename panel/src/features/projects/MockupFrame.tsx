import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Minimize } from "lucide-react";
import ViewerActions from "./ViewerActions";
import { relativeToWorkspace } from "./relativeToWorkspace";
import { useWorkspaceRoot } from "./useWorkspaceRoot";
import { useWebSocket } from "../realtime/useWebSocket";
import { isMockupImage, isRasterImage } from "./mockupFiles";
import { holdFullscreenLayer } from "../shell/Layout/fullscreenLayer";

/**
 * The widths the viewer can pin the frame to. `full` fills the pane; the
 * device widths are the CSS viewport widths a mockup is usually designed
 * against, so the author sees the same breakpoints the browser would pick.
 */
const WIDTHS = [
  { id: "full", label: "Full", width: "100%" },
  { id: "tablet", label: "Tablet", width: "768px" },
  { id: "phone", label: "Phone", width: "390px" },
] as const;

type Width = (typeof WIDTHS)[number];

/**
 * How an image mockup is sized. `fit` caps it at the pane width (the default:
 * a Figma export is usually wider than the pane); `actual` shows it at its
 * natural size and the pane scrolls to reach the rest.
 */
const ZOOMS = [
  { id: "fit", label: "Fit", maxWidth: "100%" },
  { id: "actual", label: "100%", maxWidth: "none" },
] as const;

type Zoom = (typeof ZOOMS)[number];

export interface MockupFrameProps {
  /** Index-relative path, e.g. "pavilio/mockups/x.html". Drives the iframe src. */
  filePath: string;
  absolutePath: string;
  /**
   * The file's source, for Copy content. Only a text mockup (HTML, SVG) has
   * one; a raster image's is ignored. Null/undefined while it is loading.
   */
  content?: string | null;
  testIdPrefix?: string;
}

/**
 * The raw-file URL for a mockup. Each segment is encoded on its own so spaces
 * and `#` survive, while the separators stay literal slashes. Express 5's splat
 * decodes the captured path, so an encoded `%2F` would most likely still
 * resolve — but it is fragile: a `#` ahead of it is stripped as a fragment
 * before the request leaves the browser, and proxies normalise encoded slashes
 * inconsistently. A literal slash is what every hop agrees on.
 */
const rawSrc = (filePath: string) =>
  `/api/files/raw/${filePath.split("/").map(encodeURIComponent).join("/")}`;

/**
 * The project whose Mockups tab a file belongs to: `<p>` for
 * `<p>/mockups/…` and `archived/<p>/mockups/…`, otherwise null — a file
 * outside a project's mockups folder has no Mockups route to link to.
 */
const mockupProject = (filePath: string): string | null => {
  const parts = filePath.split("/");
  const rest = parts[0] === "archived" ? parts.slice(1) : parts;
  return rest.length >= 3 && rest[0] && rest[1] === "mockups" ? rest[0] : null;
};

/**
 * The markdown link Copy link puts on the clipboard: the workspace-relative
 * path as its text (what an agent reads) and the host-relative Mockups route
 * as its target (what a human clicks). Host-relative so it works on localhost,
 * over Tailscale and on a phone. `[`/`]` are escaped in the text and `(`/`)`
 * encoded in the target so a file name cannot end the link early. An archived
 * project's file links to the same tab, which opens it by its `?file=`.
 */
const mockupLink = (relativePath: string, filePath: string, project: string) => {
  const text = relativePath.replace(/[\\[\]]/g, (c) => `\\${c}`);
  const file = encodeURIComponent(filePath).replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${text}](/project/${encodeURIComponent(project)}/mockups?file=${file})`;
};

const BUTTON_CLASS =
  "text-sm px-2 py-1 rounded-md transition-colors cursor-pointer";

/** The `history.state` key that marks the entry pushed on entering fullscreen. */
const FULLSCREEN_STATE = "mockupFullscreen";

const isFullscreenEntry = (state: unknown) =>
  typeof state === "object" && state !== null && FULLSCREEN_STATE in state;

/**
 * The fixed full-viewport layer fullscreen toggles on the element that already
 * holds the mockup. Above the panel chrome (sidebars, terminal drawer, z-50
 * popovers), below the modal tier (z-[100]: Quick finder, Quick terminal and
 * the other dialogs) and alerts (110). The classes change on the same node,
 * never a new parent, so the iframe is not re-mounted and an interactive
 * mockup keeps its state.
 */
const LAYER_CLASS = "fixed inset-0 z-[90]";

/** An open modal dialog; while one is up, Escape belongs to it. */
const MODAL_SELECTOR = '[aria-modal="true"], [role="alertdialog"]';

/**
 * A mockup with its toolbar: an HTML mockup in a sandboxed frame with a width
 * picker, or an image mockup (SVG, PNG, JPEG, WebP) through `<img>` with a
 * Fit / 100% toggle. An SVG goes through `<img>` too, never a frame or inline
 * markup, so any script it carries does not run.
 */
export function MockupFrame({
  filePath,
  absolutePath,
  content,
  testIdPrefix = "mockup-viewer",
}: MockupFrameProps) {
  // The selected entry itself, not its id: the width then needs no lookup and
  // so no unreachable "not found" fallback.
  const [selected, setSelected] = useState<Width>(WIDTHS[0]);
  const [zoom, setZoom] = useState<Zoom>(ZOOMS[0]);
  const isImage = isMockupImage(filePath);
  const project = mockupProject(filePath);
  // An `<img>` keeps showing its cached bitmap when the file changes on disk;
  // a new query string on the raw src makes the browser fetch it again.
  const [imageVersion, setImageVersion] = useState(0);
  const { lastMessage } = useWebSocket();
  useEffect(() => {
    if (!isImage || lastMessage?.type !== "file-change") return;
    const changedPath = lastMessage.path as string | undefined;
    if (changedPath?.includes(filePath)) setImageVersion((v) => v + 1);
  }, [lastMessage, filePath, isImage]);
  // Fullscreen owns one history entry, pushed on enter, so browser Back exits it
  // and leaves the mockup open. Leaving through the exit button or Escape pops
  // that entry again; otherwise a duplicate of this page would sit behind it
  // and the next Back would seem to do nothing.
  const [fullscreen, setFullscreen] = useState(false);
  const enterFullscreen = () => {
    const state: unknown = window.history.state;
    window.history.pushState(
      { ...(typeof state === "object" && state !== null ? state : {}), [FULLSCREEN_STATE]: true },
      "",
    );
    setFullscreen(true);
  };
  // Pops only while the marker is still on top: after Back (or a router
  // replace) it is gone, and popping again would leave the page.
  //
  // Known limit: a navigation inside the sandboxed frame adds a joint-history
  // entry above the marker without changing this document's `history.state`,
  // so the check still passes and `back()` steps the frame instead of popping
  // the marker. The frame is cross-origin (no `allow-same-origin`), so its
  // history cannot be read to tell; Back still works, it just takes one more.
  const exitFullscreen = useCallback(() => {
    setFullscreen(false);
    if (isFullscreenEntry(window.history.state)) window.history.back();
  }, []);
  // Leaving the file or the tab leaves fullscreen (design § 4). A new file
  // exits through the same path as the button; an unmount cannot set state,
  // so it only pops the marker, or Back would land on a duplicate entry.
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  const shownPath = useRef(filePath);
  useEffect(() => {
    if (shownPath.current === filePath) return;
    shownPath.current = filePath;
    if (fullscreenRef.current) exitFullscreen();
  }, [filePath, exitFullscreen]);
  useEffect(
    () => () => {
      if (fullscreenRef.current && isFullscreenEntry(window.history.state))
        window.history.back();
    },
    [],
  );
  // Lifts the shell's scroll-container isolation while the layer is up, so
  // its z-index competes with the chrome instead of being capped inside it.
  // A layout effect, so the chrome never paints one frame over the layer.
  useLayoutEffect(() => (fullscreen ? holdFullscreenLayer() : undefined), [fullscreen]);
  useEffect(() => {
    if (!fullscreen) return;
    // Back has already popped the entry: only the state has to follow.
    const onPopState = () => setFullscreen(false);
    // A key pressed inside the frame stays in the frame's document; Escape
    // works once focus is on the panel, and the exit button always does.
    // A modal above the layer owns Escape: one that handled it (Quick finder
    // marks it) or is still open (the Quick terminal leaves Escape to xterm)
    // closes alone, and the mockup stays fullscreen behind it.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(MODAL_SELECTOR)) return;
      exitFullscreen();
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen, exitFullscreen]);
  const exitButton = fullscreen && (
    <button
      type="button"
      onClick={exitFullscreen}
      data-testid={`${testIdPrefix}-fullscreen-exit`}
      aria-label="Exit fullscreen"
      title="Exit fullscreen"
      className="fixed top-3 right-3 w-10 h-10 rounded-full grid place-items-center cursor-pointer"
      style={{
        background: "rgba(18, 18, 21, 0.62)",
        color: "#fff",
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35)",
      }}
    >
      <Minimize size={18} />
    </button>
  );
  const workspaceRoot = useWorkspaceRoot();
  const relativePath = workspaceRoot
    ? relativeToWorkspace(absolutePath, workspaceRoot)
    : null;

  return (
    // `h-[70vh]` is the phone's height and the fallback for any surface whose
    // ancestor chain is not bounded; from `md` up the pane bounds it, so the
    // frame defers to the chain with `h-full`. `min-h-0` stays unconditional:
    // without it the flex item's `min-height: auto` lets a tall mockup push the
    // column past the pane.
    <div
      data-testid={`${testIdPrefix}-root`}
      className="flex flex-col h-[70vh] md:h-full min-h-0"
    >
      <div
        data-testid={`${testIdPrefix}-toolbar`}
        className="flex items-center gap-2 mb-4 pb-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span
          className="text-sm font-mono truncate flex-1 cursor-default"
          style={{ color: "var(--text-tertiary)" }}
        >
          {filePath.split("/").pop()}
        </span>
        {isImage
          ? ZOOMS.map((z) => (
              <button
                key={z.id}
                data-testid={`${testIdPrefix}-zoom-${z.id}`}
                onClick={() => setZoom(z)}
                aria-pressed={zoom.id === z.id}
                className={BUTTON_CLASS}
                style={{
                  color:
                    zoom.id === z.id
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                  background:
                    zoom.id === z.id ? "var(--bg-hover)" : "transparent",
                }}
              >
                {z.label}
              </button>
            ))
          : WIDTHS.map((w) => (
              <button
                key={w.id}
                data-testid={`${testIdPrefix}-width-${w.id}`}
                onClick={() => setSelected(w)}
                // Colour alone does not reach assistive tech; this does.
                aria-pressed={selected.id === w.id}
                className={BUTTON_CLASS}
                style={{
                  color:
                    selected.id === w.id
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                  background:
                    selected.id === w.id ? "var(--bg-hover)" : "transparent",
                }}
              >
                {w.label}
              </button>
            ))}
        <button
          data-testid={`${testIdPrefix}-fullscreen-toggle`}
          onClick={enterFullscreen}
          className={`${BUTTON_CLASS} ml-auto flex items-center gap-1.5`}
          style={{
            color: "var(--text-secondary)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <Maximize size={14} />
          Fullscreen
        </button>
        <ViewerActions
          absolutePath={absolutePath}
          // The path that means something inside an agent conversation, not the
          // machine-specific absolute one. VS Code still gets the absolute path.
          relativePath={relativePath}
          // Both copies wait on the same workspace root: until it is known the
          // link has no text, and the absolute path never stands in for it.
          // Outside a project's mockups folder there is no link at all.
          copyLinkText={
            project === null
              ? undefined
              : relativePath === null
                ? null
                : mockupLink(relativePath, filePath, project)
          }
          // A raster image's bytes are not text: copy content stays disabled.
          content={isRasterImage(filePath) ? null : content}
          testIdPrefix={testIdPrefix}
        />
      </div>
      {isImage ? (
        // The pane scrolls, not the page: at 100% a large export overflows in
        // both directions inside the same height-bounded box the frame gets.
        <div
          data-testid={fullscreen ? `${testIdPrefix}-fullscreen` : undefined}
          className={`${fullscreen ? LAYER_CLASS : "flex-1 min-h-0"} overflow-auto`}
          style={fullscreen ? { background: "var(--bg-base)" } : undefined}
        >
          <img
            data-testid={`${testIdPrefix}-image`}
            src={
              imageVersion ? `${rawSrc(filePath)}?v=${imageVersion}` : rawSrc(filePath)
            }
            alt={filePath.split("/").pop()}
            className="block mx-auto"
            style={{ maxWidth: zoom.maxWidth, height: "auto" }}
          />
          {exitButton}
        </div>
      ) : (
        /* Centres the frame once a device width leaves it narrower than the pane. */
        <div
          data-testid={fullscreen ? `${testIdPrefix}-fullscreen` : undefined}
          className={`flex justify-center ${fullscreen ? LAYER_CLASS : "flex-1 min-h-0"}`}
          style={fullscreen ? { background: "var(--bg-base)" } : undefined}
        >
          {/* The width lives in `style` rather than in a key or a swapped wrapper
              element: React then keeps this exact iframe across a width change, so
              an interactive mockup does not reload and lose its state. */}
          <iframe
            data-testid={`${testIdPrefix}-frame`}
            src={rawSrc(filePath)}
            title={filePath}
            // No `allow-same-origin`: the mockup is untrusted markup from the
            // notes tree, and with it the frame could reach the panel's own origin.
            sandbox="allow-scripts"
            className="rounded-lg"
            style={{
              width: selected.width,
              height: "100%",
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-surface)",
            }}
          />
          {exitButton}
        </div>
      )}
    </div>
  );
}

export default MockupFrame;
