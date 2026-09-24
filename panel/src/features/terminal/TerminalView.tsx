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
   * Whether the speech row is shown. On by DEFAULT — it is a standing control,
   * not something to be found — and it is a ROW IN FLOW above the xterm, whose
   * height is therefore reserved from mount. Hiding it hands that height back
   * to the terminal, which is the one place a refit is the correct response.
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
    // Spread, not nested: `previous` is a list of up to five answers, and a
    // list dropped into this array as one element survives the null filter and
    // maps to `undefined` — which records nothing, and leaves every answer in
    // the history to come back as an arrival the next time it is offered.
    const ids = [...queue.previous, queue.current, ...queue.pending]
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

  // The row is in the cell's column, so showing or hiding it genuinely changes
  // the terminal's height — and that is the ONLY thing left that does. So the
  // toggle fits deliberately, through `followBottomAcrossResize`, which keeps
  // the viewport where it was; a hide that scrolled the live prompt out of view
  // is the failure this avoids.
  //
  // This is NOT the only fit a toggle produces in a browser. The uncoalesced
  // `new ResizeObserver(() => inst.fit())` above observes the container, sees it
  // change — a hide grows it, a show shrinks it again — and fires a SECOND,
  // bare `fit()` just after this one, bare meaning it does not follow the
  // bottom. That is accepted, on two grounds: this effect runs first, so the
  // bottom is already followed and the viewport is already right by the time
  // the observer's fit lands; and the observer only fires on a deliberate user
  // toggle, never on an utterance, which is the resize this change exists to
  // remove. Coalescing the observer is deliberately out of this change's scope
  // (see the change's design.md and proposal.md).
  //
  // So "exactly once" is what jsdom can observe — it lays nothing out, so no
  // observer ever fires there — and not a guarantee this code makes in a
  // browser. What this code does guarantee is the DELIBERATE fit: one per
  // toggle, before any observer's, and none at all without a toggle.
  //
  // Skipped on mount: the height is reserved before the first fit runs, so
  // there is nothing to respond to. `lastBarVisible` is a ref rather than a
  // dependency so a re-render that did not toggle anything fits nothing.
  const lastBarVisible = useRef(speechBarVisible);
  useEffect(() => {
    if (lastBarVisible.current === speechBarVisible) return;
    lastBarVisible.current = speechBarVisible;
    const inst = instRef.current;
    if (!inst) return;
    followBottomAcrossResize(inst.terminal, inst.fit);
  }, [speechBarVisible]);

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

  /**
   * The cell's PTY write, for the bar's launcher pills.
   *
   * Read off `instRef` at call time rather than captured: the instance is
   * created inside the mount effect and swapped by `reopen()`, so a value
   * closed over at render would be null on the first pass and stale after a
   * reconnect. This is the same `inst.send` the view already hands out through
   * `onReady` — one transport, reached two ways.
   */
  const send = useCallback((data: string): boolean => {
    // No instance is no delivery, and the callers of this — the composer and
    // the launcher pills — have to be able to tell. `?? false` rather than a
    // non-null assertion: the window between mount and the effect that creates
    // the instance is real, and a reply written into it went nowhere.
    return instRef.current?.send(data) ?? false;
  }, []);

  const isViewportBlank = useCallback(() => {
    const inst = instRef.current;
    // No instance yet is not evidence of a blank screen — don't ask for a nudge.
    return inst ? viewportLooksBlank(inst.terminal) : false;
  }, []);

  useMobileReconnect({ ws, getDims, reopen, isViewportBlank });

  return (
    // A COLUMN: the speech row first, the terminal area under it — the
    // observed xterm container plus the answer pane overlaying it.
    //
    // `resizeObserver.observe(container)` above watches the inner div only, and
    // `inst.fit()` — which refreshes the terminal AND sends a PTY resize
    // unconditionally — is the thing that must not be provoked by a control
    // appearing. What buys that is no longer absolute positioning but the row
    // being present FROM MOUNT: the container's height is settled before the
    // cell has anything to say, so a first utterance changes no box. The row is
    // still a SIBLING of the container, never a child, so nothing inside the
    // observed box moves when its contents change.
    <div className="w-full h-full relative flex flex-col">
      {speech && speechBarVisible ? (
        <SpeechControlBar
          sessionId={sessionId}
          speech={speech}
          answerOpen={answerOpen}
          onToggleAnswer={() => setAnswerPaneOpen(sessionId, !answerOpen)}
          send={send}
        />
      ) : null}
      {/* THE TERMINAL AREA: the column cell the xterm fills, and the pane's
          positioning context.

          The pane overlays the terminal and nothing else — not the row above
          it, not the cell header above that — and the only honest way to say
          "the terminal area" to an absolutely positioned box is to make it a
          box. So the container gets a positioned wrapper, and the pane's
          `top: 0` is the row's bottom edge by construction. It used to be
          `top: 68px` — the floating bar's 6 + 56 + 6 — measured from the CELL,
          which turned into a 12px gap the moment the row joined the flow.

          The wrapper takes the flex sizing the container used to carry, so the
          terminal's height is unchanged; and the pane stays a SIBLING of the
          observed container rather than becoming a child of it, so the
          uncoalesced `ResizeObserver` above still never sees it appear. */}
      <div className="w-full flex-1 min-h-0 relative">
        <div
          ref={containerRef}
          className="w-full h-full"
          style={{
            opacity: focused ? 1 : 0.82,
            transition: "opacity 150ms ease",
            background: "#1a1b26",
          }}
        />
        {/* The bar's visibility outranks the eye: a pane without its bar has no
            eye to close it, so hiding the bar unmounts the pane too. */}
        {speech && speechBarVisible && answerOpen ? (
          <AnswerPane
            sessionId={sessionId}
            speech={speech}
            onClose={closeAnswer}
            autoOpen={autoOpen}
            onAutoOpenChange={(on) => setAnswerPaneAutoOpen(sessionId, on)}
            // The same `send` the row's pills take — one transport to the PTY,
            // reached from the two places the user can type into this cell
            // without touching the terminal.
            send={send}
          />
        ) : null}
      </div>
    </div>
  );
}

export default TerminalView;
