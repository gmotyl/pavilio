/**
 * The boot legend: two callouts, on the two controls nothing else teaches.
 *
 * ## Why it is a CELL-LEVEL overlay and not pane content
 *
 * This is the one structural fact the component exists to honour, and getting
 * it wrong is silent rather than loud — the legend would render, look almost
 * right, and its leader lines would stop at an edge.
 *
 * The answer pane is `position: absolute` inside the terminal-area wrapper
 * (`.answer-pane { inset: 0 }`, and the wrapper is the nearest positioned
 * ancestor), so it cannot draw one pixel outside that box. Both controls this
 * legend names — the eye and the transport — are in the speech row, which is
 * the wrapper's PREVIOUS SIBLING in the cell's column. A leader drawn from
 * inside the pane would be clipped at the pane's own top edge, which is exactly
 * where the row begins.
 *
 * So `TerminalView` mounts this as a sibling of the row and of the terminal
 * area, at the cell level the row itself sits at, and the cell root's
 * `relative` is what this overlay's `inset: 0` resolves against. The row is
 * then INSIDE this component's coordinate space, and a leader can reach a
 * control in it. `BootLegend.test.tsx` holds the two halves together the way
 * `SidebarHamburger.test.tsx` holds the hamburger and its slot: a stylesheet
 * cannot assert that a line arrives somewhere.
 *
 * ## Why the endpoints are measured rather than written down
 *
 * The row's contents move. The scrubber collapses on a silent cell and takes
 * its width back on the first answer; the launcher pills occupy the rail until
 * then; a narrow cell wraps nothing but squeezes everything. Any constant
 * offset here would be a second opinion about a layout the flexbox already
 * owns, and would be wrong on the first cell that is not 720px wide.
 *
 * So each leader asks the DOM where its control actually is, once per layout,
 * and records which element it measured — `data-leads-to` plus
 * `data-resolved` — because that is the only part of "the line reaches the
 * eye" a test in jsdom can hold. jsdom lays nothing out and every rect is
 * zero there, which is why the assertion is about the ELEMENT the endpoint came
 * from and not about a coordinate.
 *
 * ## Why there is no callout on the composer
 *
 * There was one in design A of the mockup, and it is cut. The composer carries
 * `ENTER SENDS · SHIFT+ENTER NEWLINE · ESC CLOSES THE ANSWER` on its own hint
 * line, forty pixels under the field. A third callout would name, in a box that
 * has to be dismissed, what is already named in a line that does not.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface BootLegendProps {
  sessionId: string;
  /** Called by every gesture that counts as the legend having done its job. */
  onDismiss: () => void;
}

/** One callout, and the control its leader ends on. */
interface Callout {
  /** Stable within the legend — the class of control, not its session. */
  readonly key: "transport" | "eye";
  /** `data-testid` of the control in the speech row this leader terminates on. */
  readonly target: string;
  readonly title: string;
  readonly body: string;
}

/**
 * The two controls, and which element each leader lands on.
 *
 * The TRANSPORT is a group — previous, play/pause, next — and the row gives it
 * no wrapper of its own, so the leader is pointed at the middle control. That
 * is the honest choice rather than an arbitrary one: play/pause is the centre
 * of the group geometrically, and it is also the one whose meaning generalises
 * to the whole strip, so a line arriving there reads as naming the three
 * together rather than as naming `previous`.
 *
 * Careful with the WORDS. "Enter", "Esc" and "composer" must not appear in
 * either body — they are what the composer's own hint line already teaches, and
 * a test asserts their absence rather than trusting this comment.
 */
function calloutsFor(sessionId: string): readonly Callout[] {
  return [
    {
      key: "transport",
      target: `speech-bar-playpause-${sessionId}`,
      title: "Replay",
      body: "Step back and forward through the last five answers, or pause the voice.",
    },
    {
      key: "eye",
      target: `speech-bar-eye-${sessionId}`,
      title: "Show / hide answers",
      body: "The eye opens this panel over the terminal, and closes it again.",
    },
  ];
}

/** A measured leader: where the line starts, where it ends, and on what. */
interface Leader {
  readonly key: Callout["key"];
  readonly target: string;
  /** Null when the control is not in the document — see `measure`. */
  readonly end: { x: number; y: number } | null;
}

/**
 * How far below a control its line starts, in px.
 *
 * The callouts sit under the row and the lines go UP into it, so a leader is a
 * short vertical run from the callout's own top edge to the control's centre.
 * One constant rather than two: the drop is the same on both sides, and the
 * horizontal position is the control's own.
 *
 * It is also where the CALLOUT goes. The box's `top` is written inline from
 * this same number, so the line starts exactly at the edge of the box it
 * leaves — the connection is arithmetic rather than agreement between two
 * files. It was agreement, and they disagreed by 18px at every width: the
 * stylesheet parked the box at 82px from a comment that reasoned "56px of row
 * plus its hairline" as though the row's padding were outside its declared
 * height. Preflight makes every box `border-box`, so it is not: the row is 56px
 * in total and a control centred in it is 28px down. `index.css` carries the
 * corrected arithmetic beside the fallback it still needs.
 */
const LEADER_DROP = 26;

/**
 * The three numbers `index.css` parks the callouts with, and the narrowest cell
 * that can hold both of them.
 *
 * WHY THIS IS MEASURED AND NOT A MEDIA QUERY. It was `@media (max-width: 520px)`
 * and that could never work, because a media query asks about the WINDOW and
 * the thing that has to hold two boxes is the CELL. A 2x2 grid on a 2560px
 * monitor gives each cell ~600px; a 3x2 gives ~420px — narrow cells at a
 * viewport no `max-width` fires on. Measured in Chrome at a wide viewport with
 * the cell narrowed, the two callouts overlapped by 4px at 440, 44px at 400 and
 * 124px at 320, both still `display: block`, sitting on top of each other.
 *
 * So the legend measures its own root. The root IS the cell — `inset: 0`
 * against the cell's positioning context — so its width is the number the
 * question is actually about, and below the threshold the transport callout is
 * not RENDERED rather than hidden by a rule that may or may not apply.
 *
 * The gutter is the only free number here: two boxes that merely touch read as
 * one wide box, and 16px is the smallest gap that still reads as two.
 */
const CALLOUT_INSET = 10;
const CALLOUT_MAX_WIDTH = 190;
const CALLOUT_GUTTER = 16;
export const BOTH_CALLOUTS_MIN_CELL =
  CALLOUT_INSET * 2 + CALLOUT_MAX_WIDTH * 2 + CALLOUT_GUTTER;

export function BootLegend({ sessionId, onDismiss }: BootLegendProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const callouts = calloutsFor(sessionId);
  const [leaders, setLeaders] = useState<readonly Leader[]>(() =>
    callouts.map((callout) => ({ key: callout.key, target: callout.target, end: null })),
  );
  /**
   * How wide the cell is, or 0 for "not measured".
   *
   * Zero is the honest answer and not a narrow cell: it is what every rect is
   * in an environment that lays nothing out, and it is the state this starts in
   * for the one frame before the layout effect runs. Both callouts are shown
   * for it — see `roomForBoth`.
   */
  const [cellWidth, setCellWidth] = useState(0);

  /**
   * Where each named control is, in this overlay's own coordinates.
   *
   * `getBoundingClientRect` on both sides and a subtraction, rather than
   * `offsetTop`/`offsetLeft`: the overlay and the row do not share an
   * `offsetParent` in every layout the cell can be in (a maximized stack nests
   * differently from the grid), and viewport coordinates are the one frame both
   * boxes are always expressed in.
   *
   * A control that is not in the document yields a `null` end. That is not
   * expected on this branch — the row carries the eye and the whole transport
   * strip from mount now — but it is the honest answer if the row ever hides
   * one again, and it renders a callout with no line rather than a line to the
   * corner.
   */
  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    // The cell's width, from the box that IS the cell. Taken in the same pass
    // as the endpoints because it is the same question — where things are —
    // and a second observer for it would be a second chance to disagree.
    setCellWidth(origin.width);
    setLeaders(
      callouts.map((callout) => {
        const control = document.querySelector(`[data-testid="${callout.target}"]`);
        if (!control) return { key: callout.key, target: callout.target, end: null };
        const box = control.getBoundingClientRect();
        return {
          key: callout.key,
          target: callout.target,
          end: {
            x: box.left + box.width / 2 - origin.left,
            y: box.top + box.height / 2 - origin.top,
          },
        };
      }),
    );
    // `callouts` is rebuilt per render from `sessionId` alone, so the id is the
    // real dependency; listing the array would re-measure on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Before paint, so the first frame the user sees already has its lines: a
  // legend that drew its callouts and then snapped its leaders into place one
  // frame later would read as a glitch on the very surface it is teaching.
  //
  // A `ResizeObserver` on the root as well as the window's `resize`, and the
  // two are not the same event. The CELL resizes without the window: a seam
  // drag, a maximize, a layout preset, a sibling cell closing. Those are
  // exactly the moments the legend's answer to "is there room for both
  // callouts" changes, and a window listener hears none of them. `TerminalView`
  // already runs an observer, but on the terminal container — a different box,
  // and one this component has no business reaching into.
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    const root = rootRef.current;
    // Guarded because the constructor is not in every environment the suite
    // renders this in, and a legend that throws on mount teaches nothing.
    const observer =
      root && typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(root!);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure]);

  /**
   * Every way out of the legend, in one listener pair.
   *
   * Escape, and a press on either control it names. Both are on the WINDOW in
   * the CAPTURE phase rather than on the elements, and each half of that is
   * load-bearing.
   *
   * On the window, not the elements: the controls are outside this component's
   * subtree — that is the whole point of it being an overlay — so attaching to
   * them would mean holding references that go stale the moment the row
   * re-renders, which it does on the first answer, the very event the legend is
   * waiting for.
   *
   * On the WINDOW and not `document`, which is where this started and where it
   * did not work. `AnswerPane` already listens for Escape in the window's
   * capture phase and calls `stopPropagation()` on it — deliberately, so the
   * key never reaches the xterm's own textarea (see the long note there). The
   * capture phase at the window runs BEFORE the at-target phase at `document`,
   * so a `document` listener here was killed by that call and Escape silently
   * did nothing. `stopPropagation` does not stop other listeners on the SAME
   * node, so a window listener is reached whichever of the two registered
   * first — which is exactly what `AnswerPane`'s note predicts ("only another
   * listener on `window` itself would need `stopImmediatePropagation`").
   *
   * Capture also means the dismissal is recorded before the control's own
   * handler runs and possibly unmounts something. It does not preventDefault or
   * stop anything: pressing the eye must still open the pane. Dismissing is a
   * side effect of the user having used the control, not a replacement for
   * using it.
   *
   * `closest` rather than an identity test, because a click lands on the lucide
   * `<svg>` inside the button as often as on the button itself.
   *
   * THE TRANSPORT ARM IS BELT-AND-BRACES, and knowingly so: all three transport
   * controls are `disabled` until the cell's first answer, so while the legend
   * is up there is no press to catch there. It is kept because the rule is "the
   * controls this legend names", not "the controls that happen to be live", and
   * a strip that enables under a legend still standing must dismiss it.
   */
  useEffect(() => {
    const targets = calloutsFor(sessionId).map((callout) => callout.target);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onDismiss();
    };
    const onClick = (event: MouseEvent): void => {
      const node = event.target as Element | null;
      if (!node || typeof node.closest !== "function") return;
      if (targets.some((testId) => node.closest(`[data-testid="${testId}"]`))) onDismiss();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("click", onClick, true);
    };
  }, [sessionId, onDismiss]);

  /**
   * Whether this cell can carry both boxes side by side.
   *
   * An UNMEASURED cell (`0`) counts as roomy. That is the safe way round: a
   * zero width means no layout has happened — the first frame, or an
   * environment that lays nothing out — and dropping a callout there would hide
   * it everywhere rather than only where it does not fit.
   */
  const roomForBoth = cellWidth === 0 || cellWidth >= BOTH_CALLOUTS_MIN_CELL;
  // The eye is the one that stays. It is the control with no other way in; the
  // transport is reachable by trying it, and does nothing harmful pressed early.
  const shown = roomForBoth ? callouts : callouts.filter((callout) => callout.key === "eye");
  const leaderFor = (key: Callout["key"]): Leader | undefined =>
    leaders.find((leader) => leader.key === key);

  return (
    <div
      ref={rootRef}
      className="boot-legend"
      data-testid={`boot-legend-${sessionId}`}
      // Announced as one thing, and as an aside rather than an alert: the cell
      // has just been asked to start an agent, and a status the screen reader
      // interrupts itself for would be the wrong weight for a hint.
      role="note"
      aria-label="What the controls above do"
    >
      {/* The leaders. `overflow: visible` in the stylesheet, because a curve
          drawn from a callout up into the row leaves this box's top edge by
          construction — the row is ABOVE the overlay's content area and the
          line has to be allowed out. */}
      <svg className="boot-legend-leads" aria-hidden="true">
        {leaders.map((leader) => {
          // A leader for a callout that is not on screen would be a line from
          // nowhere to a control nothing names.
          if (!shown.some((callout) => callout.key === leader.key)) return null;
          // The callout's own anchor: the corner of the box the line leaves
          // from, in the same coordinates the end is measured in. Kept beside
          // the end rather than in the stylesheet so that one function owns
          // both halves of a line.
          const start = leader.end
            ? { x: leader.end.x, y: leader.end.y + LEADER_DROP }
            : null;
          return (
            <g key={leader.key}>
              {start && leader.end ? (
                <path
                  data-testid={`boot-legend-lead-${sessionId}-${leader.key}`}
                  data-leads-to={leader.target}
                  d={`M ${start.x} ${start.y} L ${leader.end.x} ${leader.end.y}`}
                />
              ) : null}
              <circle
                data-testid={`boot-legend-dot-${sessionId}-${leader.key}`}
                // WHICH CONTROL THIS LINE ENDS ON, recorded on the element that
                // ends on it. jsdom lays nothing out, so this — not a
                // coordinate — is what a test can hold, and it is also what
                // makes a leader pointed at the wrong control a visible diff
                // rather than a pixel nobody checks.
                data-leads-to={leader.target}
                data-resolved={leader.end ? "1" : "0"}
                cx={leader.end?.x ?? 0}
                cy={leader.end?.y ?? 0}
                r={3}
                // No `animationDelay` here. There was one — staggering two
                // arrivals "so the two lines do not animate in lockstep" — and
                // it was dead: no rule gives `.boot-legend-leads circle` an
                // animation-name, so there was nothing to delay. The legend's
                // one animation is the callouts' arrival, which already reads
                // as the pair appearing together.
              />
            </g>
          );
        })}
      </svg>

      {shown.map((callout) => {
        const end = leaderFor(callout.key)?.end ?? null;
        return (
          <div
            key={callout.key}
            className="boot-legend-callout"
            data-testid={`boot-legend-callout-${sessionId}-${callout.key}`}
            // The stylesheet parks the two boxes at the ends of the row on this
            // attribute — left for the transport, right for the eye — which is
            // the side each control is actually on.
            data-leader={callout.key}
            data-leads-to={callout.target}
            // ...and this is the eye's callout standing alone in a cell too
            // narrow for two, which the stylesheet answers by letting it span.
            data-solo={roomForBoth ? undefined : "1"}
            // WHERE THE BAND IS, from the measurement rather than from a
            // constant in the stylesheet. The box's top edge is the leader's
            // start point, so the line always arrives at the box — see
            // `LEADER_DROP`, and the 18px gap that made this necessary. An
            // unmeasured control leaves the stylesheet's fallback in place,
            // which is the only case where the two can be written down apart.
            style={end ? { top: end.y + LEADER_DROP } : undefined}
          >
            <b>{callout.title}</b>
            {callout.body}
          </div>
        );
      })}
    </div>
  );
}

export default BootLegend;
