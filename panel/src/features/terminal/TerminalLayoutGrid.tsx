import React, { useEffect, useRef, useState } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { TerminalView } from "./TerminalView";
import type { TerminalHandle } from "./TerminalView";
import type { SessionMeta } from "./useTerminalSessions";
import { displayColor } from "./sessionColors";
import { TerminalActivityLed } from "./TerminalActivityLed";
import { ConfirmCloseTerminalModal } from "./ConfirmCloseTerminalModal";

interface Props {
  sessions: SessionMeta[];
  focusedId: string | null;
  maximized: boolean;
  onFocus: (id: string) => void;
  onExit: (id: string) => void;
  onToggleMaximize: () => void;
  onReady?: (sessionId: string, handle: TerminalHandle) => void;
  onSwap?: (idA: string, idB: string) => void;
}

export function TerminalLayoutGrid({
  sessions,
  focusedId,
  maximized,
  onFocus,
  onExit,
  onToggleMaximize,
  onReady,
  onSwap,
}: Props) {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  const draggedCellRef = useRef<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const pendingSession = sessions.find((s) => s.id === pendingCloseId);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const count = sessions.length;

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
      allSessions={sessions}
      focused={session.id === focusedId}
      maximized={maximized}
      isDropTarget={dropTargetId === session.id}
      onFocus={onFocus}
      onExit={onExit}
      onRequestExit={setPendingCloseId}
      onToggleMaximize={onToggleMaximize}
      onReady={onReady}
      onDragStart={() => { draggedCellRef.current = session.id; }}
      onDragOver={() => {
        if (draggedCellRef.current && draggedCellRef.current !== session.id) {
          setDropTargetId(session.id);
        }
      }}
      onDrop={() => {
        if (draggedCellRef.current && draggedCellRef.current !== session.id) {
          onSwap?.(draggedCellRef.current, session.id);
        }
        draggedCellRef.current = null;
        setDropTargetId(null);
      }}
      onDragEnd={() => {
        draggedCellRef.current = null;
        setDropTargetId(null);
      }}
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
  } else if (count === 1) {
    body = <div className="w-full h-full">{cell(sessions[0])}</div>;
  } else if (count === 2) {
    body = (
      <div className="h-full grid grid-cols-2" style={{ gap: "4px" }}>
        {cell(sessions[0])}
        {cell(sessions[1])}
      </div>
    );
  } else if (count === 3) {
    body = (
      <div className="h-full grid grid-cols-2" style={{ gap: "4px" }}>
        {cell(sessions[0], { gridRow: "1 / 3" })}
        {cell(sessions[1])}
        {cell(sessions[2])}
      </div>
    );
  } else if (count === 4) {
    body = (
      <div
        className="h-full grid grid-cols-2 grid-rows-2"
        style={{ gap: "4px" }}
      >
        {sessions.map((s) => cell(s))}
      </div>
    );
  } else if (count === 5) {
    body = (
      <div
        className="h-full grid grid-cols-2"
        style={{ gap: "4px", gridTemplateRows: "1fr 1fr 1fr" }}
      >
        {cell(sessions[0], { gridRow: "1 / 2" })}
        {cell(sessions[2], { gridRow: "1 / 2" })}
        {cell(sessions[1], { gridRow: "2 / 4" })}
        {cell(sessions[3], { gridRow: "2 / 3" })}
        {cell(sessions[4], { gridRow: "3 / 4" })}
      </div>
    );
  } else if (count === 6) {
    body = (
      <div
        className="h-full grid grid-cols-3 grid-rows-2"
        style={{ gap: "4px" }}
      >
        {sessions.map((s) => cell(s))}
      </div>
    );
  } else {
    body = (
      <div
        className="h-full grid grid-cols-3"
        style={{ gap: "4px", gridAutoRows: "1fr" }}
      >
        {sessions.map((s) => cell(s))}
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
  allSessions: SessionMeta[];
  focused: boolean;
  maximized: boolean;
  isDropTarget: boolean;
  onFocus: (id: string) => void;
  onExit: (id: string) => void;
  onRequestExit: (id: string) => void;
  onToggleMaximize: () => void;
  onReady?: (id: string, handle: TerminalHandle) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  style?: React.CSSProperties;
}

function TerminalCell({
  session,
  allSessions,
  focused,
  maximized,
  isDropTarget,
  onFocus,
  onExit,
  onRequestExit,
  onToggleMaximize,
  onReady,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  style,
}: CellProps) {
  const accentColor = displayColor(session, allSessions);
  const headerBg = `color-mix(in srgb, ${accentColor} 22%, rgb(15,16,20))`;
  return (
    <div
      className="relative w-full overflow-hidden rounded-md group flex flex-col"
      style={{
        height: "100%",
        ...style,
        cursor: "pointer",
        outline: isDropTarget
          ? "2px solid rgba(97,175,239,0.8)"
          : focused
            ? `1.5px solid ${accentColor}`
            : "1px solid var(--border-subtle)",
        outlineOffset: focused ? "-1.5px" : "-1px",
        transition: "outline-color 150ms, outline-width 150ms",
      }}
      onClick={() => onFocus(session.id)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      {/* Cell header — the whole row is a drag handle for swapping cells */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 shrink-0"
        style={{ background: headerBg, cursor: "grab" }}
        title="Drag to swap"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
      >
        <TerminalActivityLed sessionId={session.id} />
        <span
          className="text-[10.5px] font-mono tracking-wide uppercase truncate flex-1"
          style={{ color: "var(--text-secondary)", letterSpacing: "0.08em" }}
        >
          {session.name}
        </span>
        <div className="flex gap-0.5">
          <CellIconButton
            title={maximized ? "Restore" : "Maximize"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMaximize();
            }}
          >
            {maximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </CellIconButton>
          <CellIconButton
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
          onReady={(h) => onReady?.(session.id, h)}
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
    </div>
  );
}

function CellIconButton({
  children,
  onClick,
  title,
  hoverColor,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  hoverColor?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
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
