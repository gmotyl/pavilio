import { useCallback, useEffect, useRef, useState } from "react";
import {
  acquireTerminal,
  followBottomAcrossResize,
  releaseTerminal,
  type LiveTerminal,
} from "./terminalInstances";
import { AnswerPane } from "./AnswerPane";
import {
  closeAnswerPaneOpenedForWait,
  keepAnswerPaneOpen,
  markSeenUtterances,
  setAnswerPaneAutoOpen,
  setAnswerPaneOpen,
  useAnswerPaneState,
} from "./answerPaneState";
import { useAnswerWaiting } from "./answerWaiting";
import { BootLegend } from "./BootLegend";
import { hasSeenBootLegend, markBootLegendSeen } from "./bootLegendSeen";
import { useLauncherUsed } from "./launcherUse";
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

  // Whether this cell is currently showing the boot legend. Declared up here,
  // with the rest of the view's state, because three effects below turn it off
  // — an answer arriving, the wait ending, and the legend's own dismissal —
  // and the first of them is written before the effect that ever turns it ON.
  // What ARMS it, and why it cannot be read off the waiting snapshot, is the
  // long note further down.
  const [legendUp, setLegendUp] = useState(false);

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
    // There is something behind the wave now. Said on EVERY arrival, ahead of
    // the switch and of the bar alike, because it is a fact about the cell and
    // not a decision about the pane: a pane a launcher press opened is no
    // longer the press's to close once the agent it asked for has spoken, and
    // the effect below must not take the answer away when that agent later
    // goes quiet. Unconditional for the same reason the recording above is —
    // the answer exists whether or not this cell is currently showing it.
    if (arrived) keepAnswerPaneOpen(sessionId);
    // The bar's visibility outranks the switch, as it outranks the eye. The
    // arrival is still recorded above: it is not held back for the bar's return.
    if (arrived && autoOpen && speechBarVisible) setAnswerPaneOpen(sessionId, true);
    // The legend stood in for a pane with nothing in it. There is something in
    // it now, and a teaching overlay across the answer the user asked for is
    // the legend outstaying the moment it was for.
    if (arrived) setLegendUp(false);
  }, [sessionId, queue, autoOpen, speechBarVisible]);

  // The press's opener has no closer of its own, and needs one. A pane opened
  // by a launcher press was opened to show the wave and nothing else, so when
  // the wave goes with no answer behind it — the agent booted, worked and
  // finished without ever speaking, which is the exit `answerWaiting` calls
  // the silent-agent one — what is left is an empty box over a terminal the
  // user wants to see.
  //
  // It is OBSERVED here rather than driven from the state machine, and that is
  // the whole reason it lives in this file. `answerWaiting` owns when a wait
  // ends and `answerPaneState` owns whether the pane is open; neither may
  // reach into the other (see the header of `answerWaiting`, where every arrow
  // points the same way), and this view is the one place that reads both. So
  // the end of a wait arrives here as an ordinary render and the pane is put
  // back exactly as the press found it.
  //
  // `closeAnswerPaneOpenedForWait` is a no-op for every pane the press did not
  // open, which is what keeps this from closing a pane the user opened with
  // the eye, or one showing an answer that has since landed. Declared AFTER
  // the arrival effect above so that, in a commit carrying both, the arrival
  // has already said the pane is no longer the press's.
  const { waiting, pending } = useAnswerWaiting(sessionId);
  useEffect(() => {
    if (waiting) return;
    closeAnswerPaneOpenedForWait(sessionId);
    // The wave is what the legend was drawn over. With the wait finished there
    // is either an answer (dismissed by the arrival above) or an empty pane on
    // its way closed, and a legend over either is an overlay with no subject.
    setLegendUp(false);
  }, [sessionId, waiting]);

  /**
   * THE BOOT LEGEND'S TRIGGER — and why it is this signal and not the snapshot.
   *
   * The waiting state has three triggers and the legend must fire on exactly
   * one: the user pressing a launcher pill on a cell whose controls they have
   * never met. The snapshot cannot tell them apart. A send yields
   * `{waiting: true, pending: true}` — distinguishable — but a launcher press
   * and a debounced busy spell BOTH yield the one frozen `AGENT_HAS_THE_BODY`
   * object, by construction (`answerWaiting`'s `derive` returns it for
   * `entry.starting || agentHasTheBody`), and `starting` is deliberately not
   * exported. `answerPaneState`'s `openedForWait` is not readable either.
   *
   * So the trigger is read from the module that owns the fact itself:
   * `launcherUse` records a launcher command that was DELIVERED — it is set
   * from `LauncherPills`' `onDelivered`, the same callback that calls
   * `noteAgentStarting`. That is not a proxy for the press; it IS the press,
   * reported by the only code that knows the frame landed.
   *
   * It is armed on the RISING EDGE rather than on the level, and that is
   * load-bearing rather than tidy. The flag stays true for the life of the
   * cell, so a level test would also be satisfied by a busy spell arming the
   * body an hour later on the same cell — and it would then be `bootLegendSeen`
   * alone stopping the legend from appearing on the wrong trigger. The
   * discrimination must not lean on the seen flag: one of them decides WHICH
   * event teaches, the other decides HOW OFTEN, and a rule that conflates them
   * shows the legend on a busy transition the first time a browser meets one.
   *
   * `waiting && !pending` is asked as well, at the moment of the edge: a
   * delivered press that somehow left no wait behind has nothing to draw over,
   * and a press made while a draft is still outstanding belongs to the send.
   *
   * ON A REMOUNT MID-BOOT the legend does not come back, and that is the
   * intended reading. `lastLauncherUsed` is seeded from the CURRENT value at
   * mount, so a view remounted by a maximize or a preset while the agent is
   * still booting sees no edge. The user made a gesture; the overlay goes, like
   * it does for Escape. It could not return anyway — the browser was marked
   * taught the moment it was first shown, which is the whole cost of the
   * feature.
   */
  const launcherUsed = useLauncherUsed(sessionId);
  const lastLauncherUsed = useRef(launcherUsed);
  useEffect(() => {
    const rose = launcherUsed && !lastLauncherUsed.current;
    lastLauncherUsed.current = launcherUsed;
    if (!rose || !waiting || pending) return;
    if (hasSeenBootLegend()) return;
    // Written on SHOWING, not on dismissing — see `bootLegendSeen`, where the
    // reason lives: every way out of the legend is the user having seen it, and
    // picking one of them as the real one would teach a maximized cell twice.
    markBootLegendSeen();
    setLegendUp(true);
  }, [launcherUsed, waiting, pending]);

  const dismissLegend = useCallback(() => setLegendUp(false), []);

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
      {/* THE BOOT LEGEND — a SIBLING of the row above and of the terminal area
          below, which is the entire reason it is mounted here rather than
          inside the pane.

          The pane is absolutely positioned inside the terminal-area wrapper
          and cannot draw one pixel outside that box; both controls the legend
          names — the eye and the transport — are in the row ABOVE that box. A
          legend rendered as pane content would have its leader lines clipped at
          the pane's own top edge, which is exactly where the row begins. At
          this level the cell root's `relative` is what the overlay's `inset: 0`
          resolves against, so the row is inside its coordinate space and a
          leader can arrive on a control in it.

          Gated on the bar the same way the pane is, and for a sharper reason
          than the pane's: with the row hidden the two controls the legend
          points at are not on screen at all, so the callouts would name
          nothing and the leaders would end in the cell's own margin. */}
      {speech && speechBarVisible && legendUp ? (
        <BootLegend sessionId={sessionId} onDismiss={dismissLegend} />
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
