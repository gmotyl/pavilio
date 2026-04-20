import { useEffect, useRef } from "react";
import {
  acquireTerminal,
  releaseTerminal,
  type LiveTerminal,
} from "./terminalInstances";

interface TerminalViewProps {
  sessionId: string;
  focused?: boolean;
  onExit?: () => void;
  onReady?: (api: TerminalHandle) => void;
}

export interface TerminalHandle {
  sessionId: string;
  send: (data: string) => void;
  focus: () => void;
}

export function TerminalView({
  sessionId,
  focused = true,
  onExit,
  onReady,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<LiveTerminal | null>(null);

  // Latest-refs so changing callbacks don't blow away the mount effect.
  // Parent re-renders (e.g. the 8s poll in useAllTerminalSessions) create
  // new inline lambdas for onExit/onReady; without this the effect would
  // re-run every poll tick, detaching the xterm DOM node to the hidden
  // root and back — which silently drops keyboard focus every cycle.
  const onExitRef = useRef(onExit);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const inst = acquireTerminal(sessionId);
    instRef.current = inst;
    container.appendChild(inst.holder);

    const rafId = requestAnimationFrame(() => {
      inst.fit();
      // Follow the bottom on tab re-entry unless the user was scrolling back.
      const buf = inst.terminal.buffer.active;
      if (buf.viewportY >= buf.baseY) inst.terminal.scrollToBottom();
    });

    const resizeObserver = new ResizeObserver(() => inst.fit());
    resizeObserver.observe(container);

    const removeExit = inst.addExitListener(() => onExitRef.current?.());

    onReadyRef.current?.({
      sessionId,
      send: inst.send,
      focus: inst.focus,
    });

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      removeExit?.();
      releaseTerminal(sessionId);
      instRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const inst = instRef.current;
    if (!focused || !inst) return;
    // Re-fit + focus when becoming visible (e.g., maximize toggle).
    const rafId = requestAnimationFrame(() => {
      inst.fit();
      const buf = inst.terminal.buffer.active;
      if (buf.viewportY >= buf.baseY) inst.terminal.scrollToBottom();
      inst.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [focused]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{
        opacity: focused ? 1 : 0.82,
        transition: "opacity 150ms ease",
        background: "#1a1b26",
      }}
    />
  );
}

export default TerminalView;
