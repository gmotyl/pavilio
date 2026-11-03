import type { CSSProperties, ReactNode } from "react";

import type { OmniVoiceInfo } from "./openaiVoices";
import { BUTTON_CLASS, BUTTON_STYLE } from "./voicesSectionUi";

const GHOST_CLASS = "inline-grid place-items-center rounded";
const GHOST_STYLE: CSSProperties = {
  width: 26,
  height: 26,
  background: "transparent",
  color: "var(--text-secondary)",
  border: "1px solid transparent",
};
const BADGE_CLASS = "rounded-full";
const BADGE_STYLE: CSSProperties = {
  fontSize: 11,
  padding: "0 6px",
  border: "1px solid var(--border-default)",
  color: "var(--text-secondary)",
};
const DEFAULT_BADGE_STYLE: CSSProperties = { ...BADGE_STYLE, borderColor: "var(--accent)", color: "var(--accent)" };

/** "in A, in B and in C" */
function joinUses(uses: readonly ReactNode[]): ReactNode {
  return uses.map((use, i) => (
    <span key={i}>
      {i === 0 ? "" : i === uses.length - 1 ? " and " : ", "}in {use}
    </span>
  ));
}

interface VoiceRowProps {
  voice: OmniVoiceInfo;
  compact: boolean;
  isDefault: boolean;
  playing: boolean;
  /** The inline delete confirm, with the voice's uses; `null` while the row is a row. */
  confirm: { uses: ReactNode[]; busy: boolean } | null;
  onPlay: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

/** ▶ | label + mono name | locale · gender · badges | 🗑 (custom only), or its confirm bar. */
export function VoiceRow({ voice, compact, isDefault, playing, confirm, ...on }: VoiceRowProps) {
  const custom = voice.source === "custom";
  return (
    <li
      data-testid={`voice-row-${voice.id}`}
      data-playing={playing ? "true" : "false"}
      style={{
        display: "grid",
        // The meta column takes what it needs up to half the row, then wraps its badges: an
        // `auto` column kept them on one line and, in a narrow pane, squeezed the label to
        // nothing and pushed 🗑 past the list's edge (a horizontal scroll inside the list).
        gridTemplateColumns: "26px minmax(0, 1fr) fit-content(50%) 26px",
        alignItems: "center",
        gap: 8,
        padding: "5px 8px",
        borderBottom: "1px solid var(--border-subtle)",
        background: confirm ? "#2a1d1f" : playing ? "var(--bg-active)" : undefined,
      }}
    >
      {confirm ? (
        <>
          <span />
          <span
            data-testid="voice-confirm"
            className="flex items-center justify-end flex-wrap gap-2 text-xs"
            style={{ gridColumn: "2 / -1", color: "var(--text-primary)" }}
          >
            <span>
              Delete “{voice.label}”?
              {confirm.uses.length > 0 && (
                <> It is the voice {joinUses(confirm.uses)} — that falls back to the default.</>
              )}
            </span>
            <button type="button" className={BUTTON_CLASS} style={BUTTON_STYLE} disabled={confirm.busy} onClick={on.onCancelDelete}>
              Cancel
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              style={{ ...BUTTON_STYLE, color: "var(--red)", borderColor: "var(--red)" }}
              disabled={confirm.busy}
              onClick={on.onConfirmDelete}
            >
              Delete
            </button>
          </span>
        </>
      ) : (
        <>
          <button
            type="button"
            aria-label={`${playing ? "Stop" : "Play"} sample of ${voice.label}`}
            className={GHOST_CLASS}
            style={{ ...GHOST_STYLE, color: playing ? "var(--accent)" : GHOST_STYLE.color }}
            onClick={on.onPlay}
          >
            {playing ? "■" : "▶"}
          </button>
          <span style={{ minWidth: 0 }}>
            <span className="block text-sm" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-primary)" }}>
              {voice.label}
            </span>
            <span className="font-mono" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              {voice.id}
            </span>
          </span>
          <span
            data-testid="voice-meta"
            className="flex items-center justify-end flex-wrap gap-1.5 text-xs"
            style={{ whiteSpace: "nowrap", minWidth: 0, color: "var(--text-secondary)" }}
          >
            {!compact && <span data-testid="voice-locale">{voice.locale}</span>}
            <span>{voice.gender}</span>
            {voice.multilingual && (
              <span className={BADGE_CLASS} style={BADGE_STYLE}>
                multilingual
              </span>
            )}
            <span className={BADGE_CLASS} style={BADGE_STYLE}>
              {voice.source}
            </span>
            {isDefault && (
              <span className={BADGE_CLASS} style={DEFAULT_BADGE_STYLE} title="What the engine speaks with when no voice is picked">
                default
              </span>
            )}
          </span>
          {custom ? (
            <button type="button" aria-label={`Delete ${voice.label}`} className={GHOST_CLASS} style={GHOST_STYLE} onClick={on.onDelete}>
              🗑
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
        </>
      )}
    </li>
  );
}
