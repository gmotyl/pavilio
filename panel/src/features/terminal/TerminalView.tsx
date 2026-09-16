import { useCallback, useEffect, useRef, useState } from "react";
import {
  acquireTerminal,
  followBottomAcrossResize,
  releaseTerminal,
  type LiveTerminal,
} from "./terminalInstances";
import { AnswerPane } from "./AnswerPane";
import {
  markSeenUtterances,
  setAnswerPaneAutoOpen,
  setAnswerPaneOpen,
  useAnswerPaneState,
} from "./answerPaneState";
import { captureBufferSnapshot } from "./bufferSnapshot";
import { SpeechControlBar } from "./SpeechControlBar";
import { useMobileReconnect } from "./useMobileReconnect";
import { viewportLooksBlank } from "./viewportBlank";
import type { GridSpeech } from "../speech/types";
import type { UtteranceQueue } from "../speech/utteranceQueue";

interface TerminalViewProps {
  sessionId: string;
  focused?: boolean;
  onExit?: () => void;
  onReady?: (api: TerminalHandle) => void;
  /**
   * The panel's speech host. Passed by every grid cell; absent only where a
   * terminal is shown outside one (the quick-terminal modal), which is the one
   * place with no cell transport to offer.
   */
  speech?: GridSpeech;
  /**
   * Whether the speech bar is shown. On by DEFAULT — it is a standing control,
   * not something to be found — and safe to be so because it sits at the TOP of
   * the cell, over the oldest rows, while a TUI's live prompt is at the bottom.
   */
  speechBarVisible?: boolean;
}

export interface ColoredRun {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  strike?: boolean;
}

export type ColoredLine = ColoredRun[];

export interface BufferSnapshot {
  lines: ColoredLine[];
  /** Index of the first line currently visible in the terminal viewport. */
  viewportTopIndex: number;
  /** Index of the last line currently visible in the terminal viewport. */
  viewportBottomIndex: number;
  /** Number of rows per page (= terminal.rows). */
  pageSize: number;
  /** Pixel width of the terminal container at snapshot time. */
  pixelWidth: number;
  /** Pixel font-size used by the terminal. */
  fontSize: number;
  /** Default foreground color from the theme. */
  defaultFg: string;
  /** Default background color from the theme. */
  defaultBg: string;
}

export interface TerminalHandle {
  sessionId: string;
  send: (data: string) => void;
  focus: () => void;
  getBufferSnapshot: () => BufferSnapshot;
}

export function TerminalView({
  sessionId,
  focused = true,
  onExit,
  onReady,
  speech,
  speechBarVisible = true,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<LiveTerminal | null>(null);
  // Track the current ws as React state so useMobileReconnect gets the
  // fresh reference after inst.reopen() swaps inst.ws. Initialised lazily
  // inside the mount effect below.
  const [ws, setWs] = useState<WebSocket | null>(null);

  // Whether the cell's answer pane is open, and the cell's own "Open on new
  // answer" switch. Both live in `answerPaneState`, a module-level store keyed
  // by session, NOT in component state: maximize, grid presets, drag and seam
  // resize all remount this view (the grid swaps its body subtree), and the
  // xterm survives that only because `terminalInstances` keeps it outside
  // React — the pane's state has to survive the same way. The store is in
  // memory, so a reload still starts closed. The bar's eye toggles `open`; the
  // pane itself mounts here, as a sibling of the observed container, exactly
  // like the bar. `autoOpen` is seeded once, from the browser-wide default
  // Settings keeps, when the session's entry is first created, and never
  // written back to it.
  const { open: answerOpen, autoOpen } = useAnswerPaneState(sessionId);

  // Hiding the bar CLOSES the pane rather than merely covering it — a pane
  // without its bar has no eye to close it, and one that came back unasked
  // when the bar returned would be a surprise.
  useEffect(() => {
    if (!speechBarVisible) setAnswerPaneOpen(sessionId, false);
  }, [sessionId, speechBarVisible]);

  // Arrival detection. Every utterance id the queue has ever shown this cell
  // is recorded in the store; an id not seen before is a new answer. The first
  // call for a session seeds the set silently — the utterance the server hands
  // a freshly mounted tab is old news, not an answer to the question just
  // asked — and because the set outlives the view, a remount is not an
  // arrival either. Cursor moves (previous / next) and playback introduce no
  // new ids and so open nothing.
  const queue: UtteranceQueue | undefined = speech?.queueFor(sessionId);
  useEffect(() => {
    if (!queue) return;
    const ids = [queue.previous, queue.current, ...queue.pending]
      .filter((u) => u !== null)
      .map((u) => u.id);
    const arrived = markSeenUtterances(sessionId, ids).length > 0;
    // The bar's visibility outranks the switch, as it outranks the eye. The
    // arrival is still recorded above: it is not held back for the bar's return.
    if (arrived && autoOpen && speechBarVisible) setAnswerPaneOpen(sessionId, true);
  }, [sessionId, queue, autoOpen, speechBarVisible]);

  // Escape in the pane: close it and put the keyboard back in the terminal,
  // so the next question can be typed at once. `LiveTerminal.terminal` is the
  // xterm `Terminal`; its own `focus()` is what lands the caret in the PTY.
  const closeAnswer = useCallback(() => {
    setAnswerPaneOpen(sessionId, false);
    instRef.current?.terminal.focus();
  }, [sessionId]);

  // Latest-refs so changing callbacks don't blow away the mount effect.
  // Parent re-renders (e.g. a session opened, killed or renamed anywhere in
  // the tab — the shared session store republishes and every grid re-renders)
  // create new inline lambdas for onExit/onReady; without this the effect would
  // re-run on each one, detaching the xterm DOM node to the hidden root and
  // back — which silently drops keyboard focus every time.
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
    setWs(inst.ws);

    const rafId = requestAnimationFrame(() => {
      // Follow the bottom on tab re-entry unless the user was scrolling back.
      followBottomAcrossResize(inst.terminal, inst.fit);
    });

    // After a page refresh, the first fit runs before the PTY has
    // streamed its initial replay bytes; xterm writes them into the
    // buffer but the canvas can stay blank until the next fit. Schedule
    // a second fit so that content shows up without the user having to
    // toggle layout manually.
    const settleTimer = setTimeout(() => {
      followBottomAcrossResize(inst.terminal, inst.fit);
    }, 300);

    const resizeObserver = new ResizeObserver(() => inst.fit());
    resizeObserver.observe(container);

    const removeExit = inst.addExitListener(() => onExitRef.current?.());
    // Subscribe to ws replacement so useMobileReconnect sees the new ws
    // identity after reopen(). The instance pushes the new reference to
    // us synchronously from reopen().
    const removeWsChange = inst.onWsChange((next) => setWs(next));

    onReadyRef.current?.({
      sessionId,
      send: inst.send,
      focus: inst.focus,
      getBufferSnapshot: () => {
        const rect = container.getBoundingClientRect();
        return captureBufferSnapshot(inst.terminal, rect.width, 13);
      },
    });

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(settleTimer);
      resizeObserver.disconnect();
      removeExit?.();
      removeWsChange?.();
      releaseTerminal(sessionId);
      instRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const inst = instRef.current;
    if (!focused || !inst) return;
    // Re-fit + focus when becoming visible (e.g., maximize toggle).
    const rafId = requestAnimationFrame(() => {
      followBottomAcrossResize(inst.terminal, inst.fit);
      inst.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [focused]);

  const getDims = useCallback(() => {
    const inst = instRef.current;
    if (!inst) return { cols: 80, rows: 24 };
    return { cols: inst.terminal.cols, rows: inst.terminal.rows };
  }, []);

  const reopen = useCallback(() => {
    instRef.current?.reopen();
  }, []);

  const isViewportBlank = useCallback(() => {
    const inst = instRef.current;
    // No instance yet is not evidence of a blank screen — don't ask for a nudge.
    return inst ? viewportLooksBlank(inst.terminal) : false;
  }, []);

  useMobileReconnect({ ws, getDims, reopen, isViewportBlank });

  return (
    // The bar — and the answer pane under it — are SIBLINGS of the observed
    // container, never children of it and never in its flow.
    // `resizeObserver.observe(container)` above watches the inner div only,
    // and `inst.fit()` — which refreshes the terminal AND sends a PTY resize
    // unconditionally — is the thing that must not be provoked by a control
    // appearing. Absolute positioning over the xterm is what buys that:
    // showing or hiding the bar, opening or closing the pane, changes no box
    // that anything measures.
    <div className="w-full h-full relative">
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{
          opacity: focused ? 1 : 0.82,
          transition: "opacity 150ms ease",
          background: "#1a1b26",
        }}
      />
      {speech && speechBarVisible ? (
        <SpeechControlBar
          sessionId={sessionId}
          speech={speech}
          answerOpen={answerOpen}
          onToggleAnswer={() => setAnswerPaneOpen(sessionId, !answerOpen)}
        />
      ) : null}
      {/* The bar's visibility outranks the eye: a pane without its bar has no
          eye to close it, so hiding the bar unmounts the pane too. */}
      {speech && speechBarVisible && answerOpen ? (
        <AnswerPane
          sessionId={sessionId}
          speech={speech}
          onClose={closeAnswer}
          autoOpen={autoOpen}
          onAutoOpenChange={(on) => setAnswerPaneAutoOpen(sessionId, on)}
        />
      ) : null}
    </div>
  );
}

export default TerminalView;
