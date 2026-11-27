import { SkipBack, SkipForward } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { RateButton } from "./RateButton";
import { SpeechTransport } from "./SpeechTransport";
import type { GridSpeech } from "./types";

/** Previous/next around play/pause — the cell walks its answer queue; a page has none. */
export interface SpeechRowStepControls {
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
}

export interface SpeechRowProps {
  /** The host key the row speaks for — a session id on a cell, a `doc:` key on a page. */
  speechKey: string;
  /**
   * The panel's one speech host. Passed rather than read from context because
   * the cell bar is handed its host as a prop (and its suites mount it bare);
   * a page adapter passes `usePanelSpeech()`.
   */
  speech: GridSpeech;
  /**
   * The voice the key's units were synthesized in. Resolved by the adapter:
   * a cell's voice comes from terminal-side state speech may not import.
   */
  voice: string;
  /** The row's first control: the cell's speech-mode switch, the page's cache toggle. */
  lead: ReactNode;
  /** The row's last control(s): the cell's eye (+ queue pill), the page's clear-cache icon. */
  trail: ReactNode;
  /**
   * The project whose playback speed the row's rate button shows, right after
   * the scrubber. Resolved by the adapter (a cell's comes from terminal-side
   * state); absent — a page outside any project — means no button.
   */
  project?: string;
  /** Between the scrubber and the trail: the cell's launchers, the page's cached share. */
  middleExtra?: ReactNode;
  /** Transport extras: the cell passes previous/next; a page passes none. */
  stepControls?: SpeechRowStepControls;
  /** The unit a hovered block would start at (`PlayFromHere`): its segment is outlined. */
  hintUnit?: number | null;
  /**
   * Prefix of the row's own test ids — the root is `<prefix>-<key>`, the step
   * controls `<prefix>-previous-<key>` / `<prefix>-next-<key>`. `"speech-bar"`
   * keeps the cell's ids.
   */
  testIdPrefix: string;
  /** Every play/pause press, before its intent resolves — see `SpeechTransport`. */
  onPress?: () => void;
  /** Whether the play button pulses. */
  pulse?: boolean;
  /** Whether a reply is on its way. */
  pending?: boolean;
  /**
   * Whether an answer pane sits under the row (`data-answer-open`): the
   * stylesheet drops the hairline against the terminal on it. Cell only.
   */
  answerOpen?: boolean;
}

/**
 * The one speech row: `.speech-bar` / `.speech-bar-row`, the gesture isolation
 * that keeps a press on the row from reaching a draggable/focusing container,
 * and the transport + scrubber read from the host by `speechKey`.
 *
 * Order inside the row: lead, separator, [previous], play/pause, [next,
 * separator], scrubber, [rate button], middleExtra, trail. The surfaces are slot-filling
 * adapters — `SpeechControlBar` on a cell, `DocumentSpeechBar` on a page.
 */
export function SpeechRow({
  speechKey,
  speech,
  voice,
  lead,
  trail,
  middleExtra,
  project,
  stepControls,
  hintUnit = null,
  testIdPrefix,
  onPress,
  pulse,
  pending,
  answerOpen,
}: SpeechRowProps) {
  const state = speech.stateFor(speechKey);
  const units = speech.unitsFor(speechKey);
  // External stores, not fields: the playhead moves ~4 times a second and one
  // host serves the whole panel, so each row takes its own snapshot and an
  // unchanged one re-renders nothing.
  const progress = useSyncExternalStore(speech.subscribeProgress, () =>
    speech.progressFor(speechKey),
  );
  // Sourced apart from `progress`: a finished run has no playhead and still
  // has a timeline.
  const durations = useSyncExternalStore(speech.subscribeProgress, () =>
    speech.unitDurationsFor(speechKey),
  );

  return (
    <div
      className="speech-bar"
      data-testid={`${testIdPrefix}-${speechKey}`}
      data-answer-open={answerOpen === undefined ? undefined : answerOpen ? "1" : "0"}
      // A cell header is `draggable` and a cell root focuses on click, so every
      // gesture that could reach either stops here.
      draggable={false}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="speech-bar-row">
        {lead}

        <span className="speech-bar-sep" />

        {stepControls ? (
          <button
            type="button"
            title="Previous answer"
            aria-label="Previous answer"
            data-testid={`${testIdPrefix}-previous-${speechKey}`}
            className="speech-bar-btn"
            disabled={!stepControls.canPrevious}
            onClick={stepControls.onPrevious}
          >
            <SkipBack size={16} />
          </button>
        ) : null}

        <SpeechTransport
          id={speechKey}
          state={state}
          units={units}
          durations={durations}
          progress={progress}
          voice={voice}
          onPlay={() => speech.onSpeak(speechKey)}
          onPause={() => speech.onPause(speechKey)}
          onResume={() => speech.onResume(speechKey)}
          onJumpToUnit={(index) => speech.onJumpToUnit(speechKey, index)}
          onSeekWithinUnit={(seconds) => speech.onSeekWithinUnit(speechKey, seconds)}
          onPress={onPress}
          pulse={pulse}
          pending={pending}
          hintUnit={hintUnit}
          // `next` sits between play/pause and the scrubber, so it rides in the
          // transport's slot and the cell row's DOM order is what it was.
          between={
            stepControls ? (
              <>
                <button
                  type="button"
                  title="Next answer"
                  aria-label="Next answer"
                  data-testid={`${testIdPrefix}-next-${speechKey}`}
                  className="speech-bar-btn"
                  disabled={!stepControls.canNext}
                  onClick={stepControls.onNext}
                >
                  <SkipForward size={16} />
                </button>

                <span className="speech-bar-sep" />
              </>
            ) : undefined
          }
        />

        {project ? <RateButton project={project} /> : null}

        {middleExtra}

        {trail}
      </div>
    </div>
  );
}

export default SpeechRow;
