import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Eye, X } from "lucide-react";
import { TerminalView } from "./TerminalView";
import type { BufferSnapshot, TerminalHandle } from "./TerminalView";
import type { SessionMeta } from "./useTerminalSessions";
import { useProjectColors } from "./useProjectColors";
import { TerminalActivityLed } from "./TerminalActivityLed";
import { TerminalDisconnectedBadge } from "./TerminalDisconnectedBadge";
import { ProjectColorPicker } from "./ProjectColorPicker";
import { CellSpeakButton } from "./CellSpeakButton";
import { CellAutoplayToggle } from "./CellAutoplayToggle";
import { ConfirmCloseTerminalModal } from "./ConfirmCloseTerminalModal";
import { TerminalViewportModal } from "./TerminalViewportModal";
import {
  TerminalPlacementOverlay,
  type PlacementOverlayHandle,
} from "./TerminalPlacementOverlay";
import { TerminalSeamHandles } from "./TerminalSeamHandles";
import type { CellSpeechState } from "../speech/useUtteranceChannel";
import type { LayoutCommitKind } from "./orderingReducer";
import { GRID, expandPreset, getLayoutPresets, type TileLayout } from "./tileLayout";

/**
 * The cell header's speech wiring, hoisted so one channel and one player serve
 * the whole surface. Optional: with no speech host the controls still render,
 * every cell reads `empty`, and nothing is armed. Task 11 supplies this from
 * `useUtteranceChannel` + `useSpeechPlayer`.
 */
export interface GridSpeech {
  stateFor: (sessionId: string) => CellSpeechState;
  /** The single armed session in this browser, or `null`. */
  armedSessionId: string | null;
  onSpeak: (sessionId: string) => void;
  /** Stop playback. The host must also mark the session heard. */
  onStop: (sessionId: string) => void;
  onArm: (sessionId: string | null) => void;
}

interface Props {
  sessions: SessionMeta[];
  focusedId: string | null;
  maximized: boolean;
  onFocus: (id: string) => void;
  onExit: (id: string) => void;
  onReady?: (sessionId: string, handle: TerminalHandle) => void;
  onRename?: (id: string, name: string) => void;
  /** The committed tiling. Empty means "no custom shape": the default preset is used. */
  tiles?: TileLayout;
  /**
   * Commit a layout a gesture computed and displayed. `kind` tells the scope which
   * gesture produced it: a placement re-derives the session order from the tiling,
   * a seam resize must not (see ADR 0008's amendment).
   */
  onPlace?: (layout: TileLayout, kind: LayoutCommitKind) => void;
  /** See {@link GridSpeech}. Absent means "no speech host": every cell is `empty`. */
  speech?: GridSpeech;
}

export function TerminalLayoutGrid({
  sessions,
  focusedId,
  maximized,
  onFocus,
  onExit,
  onReady,
  onRename,
  tiles,
  onPlace,
  speech,
}: Props) {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  // Imperative, not state: a re-render inside the browser's dragstart dispatch makes
  // Chrome abandon the drag before it starts. See PlacementOverlayHandle.
  const overlayRef = useRef<PlacementOverlayHandle | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const pendingSession = sessions.find((s) => s.id === pendingCloseId);
  // The live layout during a seam drag. Held here rather than in the handles so
  // the cells themselves follow the boundary: every intermediate position is a
  // valid tiling, so there is nothing to preview and no overlay is involved.
  const [seamDraft, setSeamDraft] = useState<TileLayout | null>(null);
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const [gridBox, setGridBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const count = sessions.length;

  // A seam drag converts pixels to zones, so it needs the grid's box in px. The
  // handles never measure the DOM themselves — their own geometry is pure CSS —
  // so the one measurement the gesture needs is taken here, and only while the
  // tiling is the branch on screen.
  useLayoutEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setGridBox((box) =>
        box.width === rect.width && box.height === rect.height
          ? box
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    // jsdom has no ResizeObserver, and neither do older Safaris; a window resize
    // catches every case that actually changes the grid's box there.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isMobile, maximized, count]);

  const onSeamDraft = useCallback((layout: TileLayout | null) => {
    setSeamDraft(layout);
  }, []);

  // One write per gesture, and flagged as a resize: the scope keeps the session
  // order it already had rather than re-deriving it from the moved tiling.
  const onSeamResize = useCallback(
    (layout: TileLayout) => {
      onPlace?.(layout, "resize");
    },
    [onPlace],
  );

  // The committed tiling, or the default preset for the current count when the caller
  // has none stored. The real caller always passes `tiles` (as `[]` when no custom
  // shape exists), so treat empty the same as absent rather than rendering nothing.
  const resolvedTiles: TileLayout =
    seamDraft ??
    (tiles && tiles.length > 0
      ? tiles
      : expandPreset(
          sessions.map((s) => s.id),
          getLayoutPresets(count)[0] ?? { label: "", slots: [] },
        ));

  const modal = (
    <ConfirmCloseTerminalModal
      sessionName={pendingSession?.name ?? null}
      onCancel={() => setPendingCloseId(null)}
      onConfirm={() => {
        if (pendingCloseId) onExit(pendingCloseId);
        setPendingCloseId(null);
      }}
    />
  );

  if (count === 0) {
    return (
      <>
        <div
          className="flex items-center justify-center h-full"
          style={{ color: "var(--text-muted)" }}
        >
          <div className="text-center space-y-2">
            <div
              className="text-xs uppercase tracking-[0.2em]"
              style={{ color: "var(--text-tertiary)" }}
            >
              No terminals
            </div>
            <div className="text-[13px]">
              Use <span className="font-mono">New Terminal</span> above to start
            </div>
          </div>
        </div>
        {modal}
      </>
    );
  }

  const cell = (session: SessionMeta, style?: React.CSSProperties) => (
    <TerminalCell
      key={session.id}
      session={session}
      focused={session.id === focusedId}
      onFocus={onFocus}
      onExit={onExit}
      onRequestExit={setPendingCloseId}
      onReady={onReady}
      onRename={onRename}
      onDragStart={() => overlayRef.current?.begin(session.id)}
      onDragEnd={() => overlayRef.current?.end()}
      speech={speech}
      style={{ height: "100%", ...style }}
    />
  );

  // Mobile OR explicit maximize: render only focused (or first) fullscreen.
  // Keep ALL other sessions mounted (hidden) so their terminal state survives.
  let body: React.ReactNode;
  if (isMobile || maximized) {
    const visible = focusedId
      ? sessions.find((s) => s.id === focusedId) ?? sessions[0]
      : sessions[0];
    body = (
      <div className="relative w-full h-full">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="absolute inset-0"
            style={{
              visibility: s.id === visible.id ? "visible" : "hidden",
              pointerEvents: s.id === visible.id ? "auto" : "none",
            }}
          >
            {cell(s)}
          </div>
        ))}
      </div>
    );
  } else {
    // One CSS grid of 48x48 zone tracks; each cell is placed by its tile's grid-area.
    // No nested columns and no gutter elements: the tiling carries the whole shape.
    const sessionById = new Map(sessions.map((s) => [s.id, s]));

    body = (
      <div
        ref={gridWrapRef}
        className="relative h-full w-full"
        // The grid wrapper owns the drag events, not the overlay: nothing under the
        // cursor may change at dragstart, or Chromium abandons the drag on the spot.
        onDragOver={(e) => {
          // Only claim drags of our own. Calling preventDefault unconditionally would
          // make the grid a drop target for anything dragged in from outside the app —
          // a file from the desktop, text from another window — and silently eat it.
          if (!overlayRef.current?.isDragging()) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          // Plain drag offers the window under the pointer — its centre and its four
          // edge bands — because that is the gesture reached for most often; Shift
          // paints an area anchored on the dragged window; Ctrl is the plain exchange
          // the grid has always had, and still wins when both modifiers are down.
          overlayRef.current?.over(
            e.clientX,
            e.clientY,
            e.ctrlKey ? "swap" : e.shiftKey ? "grow" : "target",
          );
        }}
        onDrop={(e) => {
          if (!overlayRef.current?.isDragging()) return;
          e.preventDefault();
          const next = overlayRef.current?.release() ?? null;
          if (next) onPlace?.(next, "placement");
        }}
      >
        <div
          data-testid="terminal-grid"
          className="h-full w-full grid"
          style={{
            gap: "4px",
            gridTemplateColumns: `repeat(${GRID}, 1fr)`,
            gridTemplateRows: `repeat(${GRID}, 1fr)`,
          }}
        >
          {resolvedTiles.map((tile) => {
            const s = sessionById.get(tile.sessionId);
            if (!s) return null;
            return cell(s, {
              gridColumn: `${tile.x + 1} / span ${tile.w}`,
              gridRow: `${tile.y + 1} / span ${tile.h}`,
              minWidth: 0,
              minHeight: 0,
            });
          })}
        </div>
        {/* One grab strip per seam, over the gutters. Below the overlay in the
            stack so a placement preview paints on top, which costs nothing: the
            overlay never takes pointer events. */}
        {count > 1 && (
          <TerminalSeamHandles
            layout={resolvedTiles}
            onResize={onSeamResize}
            onDraft={onSeamDraft}
            box={gridBox}
          />
        )}
        {/* Always mounted, never hittable — see PlacementOverlayHandle. */}
        <TerminalPlacementOverlay
          ref={overlayRef}
          layout={resolvedTiles}
          nameOf={(id) => sessionById.get(id)?.name ?? id}
          onCancel={() => {}}
        />
      </div>
    );
  }

  return (
    <>
      {body}
      {modal}
    </>
  );
}

interface CellProps {
  session: SessionMeta;
  focused: boolean;
  onFocus: (id: string) => void;
  onExit: (id: string) => void;
  onRequestExit: (id: string) => void;
  onReady?: (id: string, handle: TerminalHandle) => void;
  onRename?: (id: string, name: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  speech?: GridSpeech;
  style?: React.CSSProperties;
}

function TerminalCell({
  session,
  focused,
  onFocus,
  onExit,
  onRequestExit,
  onReady,
  onRename,
  onDragStart,
  onDragEnd,
  speech,
  style,
}: CellProps) {
  const { colorFor } = useProjectColors();
  const accentColor = colorFor(session.project);
  const headerBg = `color-mix(in srgb, ${accentColor} 22%, rgb(15,16,20))`;
  const handleRef = useRef<TerminalHandle | null>(null);
  const [snapshot, setSnapshot] = useState<BufferSnapshot | null>(null);
  const [editingName, setEditingName] = useState(false);
  // Escape and Enter both end the edit by unmounting the input, which can
  // fire a blur on the way out. Commit exactly once: whichever key handled
  // it raises this flag and the blur that follows is ignored.
  const blurHandledRef = useRef(false);

  const commitRename = useCallback(
    (value: string) => {
      setEditingName(false);
      const next = value.trim();
      if (next && next !== session.name) onRename?.(session.id, next);
    },
    [onRename, session.id, session.name],
  );

  const openViewport = useCallback(() => {
    const snap = handleRef.current?.getBufferSnapshot();
    if (snap) setSnapshot(snap);
  }, []);

  // Cmd+U (Mac) / Ctrl+U (Windows/Linux) toggles the viewport reader for
  // the focused cell. Capture phase so we beat xterm's own keydown handler
  // and the browser's View Source default. Only the focused cell registers
  // the listener — all other cells stay silent so the shortcut is unambiguous.
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "u") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      setSnapshot((cur) => (cur ? null : handleRef.current?.getBufferSnapshot() ?? null));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [focused]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-md group flex flex-col"
      style={{
        height: "100%",
        ...style,
        cursor: "pointer",
        outline: focused
          ? `1.5px solid ${accentColor}`
          : "1px solid var(--border-subtle)",
        outlineOffset: focused ? "-1.5px" : "-1px",
        transition: "outline-color 150ms, outline-width 150ms",
      }}
      onClick={() => onFocus(session.id)}
      onDragEnd={onDragEnd}
    >
      {/* Cell header — the whole row is a drag handle for swapping cells */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 shrink-0"
        style={{ background: headerBg, cursor: "grab" }}
        title="Drag to place this terminal"
        draggable
        onDragStart={(e) => {
          // jsdom's DragEvent constructor is missing, so tests dispatch drag events
          // without a dataTransfer — guard rather than assume it is present.
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            // Firefox refuses to start a drag with an empty payload.
            e.dataTransfer.setData("text/plain", session.id);
          }
          onDragStart();
        }}
      >
        <TerminalActivityLed sessionId={session.id} />
        {editingName ? (
          <>
            <input
              autoFocus
              defaultValue={session.name}
              data-testid={`terminal-cell-name-input-${session.id}`}
              aria-label={`Rename ${session.name}`}
              className="text-[10.5px] font-mono tracking-wide truncate flex-1 bg-transparent outline-none min-w-0"
              style={{ color: "var(--text-primary)", letterSpacing: "0.08em" }}
              onClick={(e) => e.stopPropagation()}
              // The header is `draggable`, so mouse-selecting the text here
              // would start a cell drag instead of a selection. HTML5 drag is
              // initiated from the nearest draggable ancestor, so only
              // cancelling `dragstart` stops it — the same guard the colour
              // picker's hex field needs.
              onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  blurHandledRef.current = true;
                  commitRename(e.currentTarget.value);
                } else if (e.key === "Escape") {
                  blurHandledRef.current = true;
                  setEditingName(false);
                }
              }}
              onBlur={(e) => {
                if (blurHandledRef.current) {
                  blurHandledRef.current = false;
                  return;
                }
                commitRename(e.target.value);
              }}
            />
            {/* Colour is a property of the project, not of this cell — the
                picker names the project so that is not a surprise. It rides
                the rename state rather than standing in every header: a
                project's colour is chosen once and then left alone, and the
                width it used to hold is now the speak and autoplay controls'.
                The picker swallows its own click and dragstart, which is what
                keeps it from focusing the cell or starting a header drag. */}
            <ProjectColorPicker
              project={session.project}
              testId={`terminal-cell-color-${session.id}`}
            />
          </>
        ) : (
          <span
            className="text-[10.5px] font-mono tracking-wide uppercase truncate flex-1"
            style={{ color: "var(--text-secondary)", letterSpacing: "0.08em" }}
            title={`${session.name} — double-click to rename`}
            onDoubleClick={(e) => {
              e.stopPropagation();
              blurHandledRef.current = false;
              setEditingName(true);
            }}
          >
            {session.name}
          </span>
        )}
        <div className="flex gap-0.5">
          {/* Leads the eye · kill group. Renders nothing while the socket is
              healthy, so the group's usual width is unchanged. */}
          <TerminalDisconnectedBadge sessionId={session.id} />
          {/* Speak · autoplay lead the group: they change per utterance, the
              rest are static. Both are inert until a speech host is passed. */}
          <CellSpeakButton
            sessionId={session.id}
            state={speech?.stateFor(session.id) ?? "empty"}
            onSpeak={(id) => speech?.onSpeak(id)}
            onStop={(id) => speech?.onStop(id)}
          />
          <CellAutoplayToggle
            sessionId={session.id}
            armedSessionId={speech?.armedSessionId ?? null}
            onArm={(id) => speech?.onArm(id)}
          />
          <CellIconButton
            testId={`terminal-cell-eye-${session.id}`}
            title={`View viewport text (read aloud / print) — ${navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}U`}
            onClick={(e) => {
              e.stopPropagation();
              openViewport();
            }}
          >
            <Eye size={11} />
          </CellIconButton>
          <CellIconButton
            testId={`terminal-cell-kill-${session.id}`}
            title="Kill session"
            onClick={(e) => {
              e.stopPropagation();
              onRequestExit(session.id);
            }}
            hoverColor="var(--red, #f7768e)"
          >
            <X size={11} />
          </CellIconButton>
        </div>
      </div>
      {/* Terminal area + inactive-dim / hover glow overlays */}
      <div className="relative flex-1 min-h-0">
        <TerminalView
          sessionId={session.id}
          focused={focused}
          onExit={() => onExit(session.id)}
          onReady={(h) => {
            handleRef.current = h;
            onReady?.(session.id, h);
          }}
        />
        {!focused && (
          <div
            className="absolute inset-0 pointer-events-none transition-opacity group-hover:opacity-0"
            style={{ background: "rgba(0,0,0,0.28)" }}
          />
        )}
        <div
          className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            background: focused
              ? "transparent"
              : "radial-gradient(ellipse at top, rgba(240,198,116,0.04) 0%, transparent 60%)",
          }}
        />
      </div>
      <TerminalViewportModal
        sessionName={session.name}
        snapshot={snapshot}
        onClose={() => setSnapshot(null)}
      />
    </div>
  );
}

function CellIconButton({
  children,
  onClick,
  title,
  hoverColor,
  testId,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  hoverColor?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      data-testid={testId}
      className="p-1 rounded transition-colors"
      style={{ color: "var(--text-muted)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = hoverColor || "var(--text-primary)";
        e.currentTarget.style.background = "rgba(255,255,255,0.06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-muted)";
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

export default TerminalLayoutGrid;
