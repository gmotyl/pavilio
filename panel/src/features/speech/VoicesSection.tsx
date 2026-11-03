import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { preferences, type EngineVoices } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { AddVoiceForm } from "./AddVoiceForm";
import { VoiceRow } from "./VoiceRow";
import { OPENAI_VOICE_MAP, resolveVoiceMap, type OmniVoiceInfo } from "./openaiVoices";
import { useOpenaiVoices } from "./useOpenaiVoices";
import { SPEECH_ROWS_NARROW_BELOW, usePaneWidth } from "./usePaneWidth";
import { BUTTON_CLASS, BUTTON_STYLE, PANEL_DOWN, RED, VOICES_URL, failureOf } from "./voicesSectionUi";

/** Below this section width a row drops its locale (mockup: 480 px). */
const LOCALE_HIDDEN_BELOW = 480;
const OPENAI = "openai";

const BANNER_CLASS = "text-xs rounded-md px-2.5 py-2 mb-2";
const BANNER_STYLE: CSSProperties = { ...RED, border: "1px solid currentColor" };
const CODE: CSSProperties = { color: "var(--text-primary)" };

/**
 * The voices that carry the `default` badge: what {@link OPENAI_VOICE_MAP} resolves to against
 * this list. It is the voice the engine speaks with when nothing is picked, and the one a use of
 * a deleted voice falls back to — the "default" the delete confirm names. A picked voice is not
 * badged: the Voice select above already shows it.
 */
function defaultVoiceIds(voices: readonly OmniVoiceInfo[]): Set<string> {
  if (voices.length === 0) return new Set();
  return new Set(Object.values(resolveVoiceMap(OPENAI_VOICE_MAP, voices)));
}

/**
 * Where `id` is picked for the OpenAI-compatible engine: the global voice (`speech.voice`) and
 * each project override (`speech.voiceByProject`). Computed here from the stored preferences, not
 * by the server: `voices.ts` drops a stale id on read, so a deleted voice needs no preference write.
 */
function usesOf(id: string, global: EngineVoices, byProject: Record<string, EngineVoices>): ReactNode[] {
  const uses: ReactNode[] = [];
  if (global[OPENAI] === id) uses.push("Settings");
  for (const project of Object.keys(byProject).sort()) {
    if (byProject[project]?.[OPENAI] === id)
      uses.push(
        <>
          project <b>{project}</b>
        </>,
      );
  }
  return uses;
}

/** One sample at a time: `toggle` starts a voice's sample (stopping any other) or stops it. */
function useSamplePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => {
    const current = audio;
    return () => current.current?.pause();
  }, []);

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };
  const toggle = (id: string) => {
    const wasPlaying = playing === id;
    stop();
    if (wasPlaying) return;
    const sample = new Audio(`${VOICES_URL}/${encodeURIComponent(id)}/sample`);
    const finish = () => {
      if (audio.current !== sample) return;
      audio.current = null;
      setPlaying(null);
    };
    sample.onended = finish;
    audio.current = sample;
    setPlaying(id);
    sample.play().catch(finish);
  };
  return { playing, toggle, stop };
}

/**
 * Settings → Speech, the OpenAI-compatible row: every voice the OmniVoice server has, with ▶ to
 * play its sample and 🗑 (custom voices only) to delete it, and the inline {@link AddVoiceForm}.
 * Rendered by `EngineSettings` once the row has an address.
 */
export function VoicesSection({ address }: { address: string }) {
  const rootRef = useRef<HTMLElement>(null);
  const width = usePaneWidth(rootRef);
  const compact = width > 0 && width < LOCALE_HIDDEN_BELOW;
  const narrow = width > 0 && width < SPEECH_ROWS_NARROW_BELOW;
  const { voices, unreachable, workspaceOnly, loaded, failed, reload } = useOpenaiVoices();
  const [globalVoice] = usePreference(preferences.speechVoice);
  const [byProject] = usePreference(preferences.speechVoiceByProject);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const player = useSamplePlayer();

  const defaults = useMemo(() => defaultVoiceIds(voices), [voices]);
  const custom = voices.filter((voice) => voice.source === "custom").length;
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? voices.filter((voice) => voice.label.toLowerCase().includes(needle) || voice.id.includes(needle))
    : voices;

  // While the add form is open a refusal shows right above it: the form sits below the 300 px
  // list, so a banner at the top of the section can be scrolled out of sight.
  const errorBanner = error !== null && (
    <div role="alert" data-testid="voices-error" className={adding ? `${BANNER_CLASS} mt-2.5` : BANNER_CLASS} style={BANNER_STYLE}>
      {error}
    </div>
  );

  const remove = async (id: string) => {
    setDeleting(true);
    setError(null);
    let failure: string | null;
    try {
      const res = await fetch(`${VOICES_URL}/${encodeURIComponent(id)}`, { method: "DELETE" });
      failure = res.ok ? null : await failureOf(res);
    } catch {
      failure = PANEL_DOWN;
    }
    setDeleting(false);
    if (failure !== null) {
      setError(failure);
      return;
    }
    setConfirming(null);
    if (player.playing === id) player.stop();
    await reload();
  };

  return (
    <section
      ref={rootRef}
      data-testid="voices-section"
      data-compact={compact ? "true" : "false"}
      aria-labelledby="voices-heading"
      style={{ marginTop: 14, borderTop: "1px solid var(--border-default)", paddingTop: 12, minWidth: 0 }}
    >
      <div className="flex items-center flex-wrap gap-2.5 mb-2">
        <h4 id="voices-heading" className="font-semibold" style={{ fontSize: 13, margin: 0, color: "var(--text-primary)" }}>
          Voices
        </h4>
        {!unreachable && loaded && (
          <span data-testid="voices-count" className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            {voices.length - custom} bundled · {custom} custom
          </span>
        )}
        <span style={{ flex: 1 }} />
        {!unreachable && (
          <input
            type="search"
            aria-label="Filter voices"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs rounded"
            style={{ ...BUTTON_STYLE, width: 160, maxWidth: "100%", padding: "3px 8px" }}
          />
        )}
        <button
          data-testid="voices-add"
          type="button"
          className={BUTTON_CLASS}
          style={BUTTON_STYLE}
          disabled={unreachable || adding}
          onClick={() => {
            setError(null);
            setAdding(true);
          }}
        >
          ＋ Add voice
        </button>
      </div>
      {unreachable && (
        <div role="alert" data-testid="voices-unreachable" className={BANNER_CLASS} style={BANNER_STYLE}>
          Can't reach the OmniVoice server at <code style={CODE}>{address}</code>. Start it (
          <code style={CODE}>omnivoicectl start</code>) — speech picks it up within about a minute; this list
          reloads when you return to the window or press Retry.
          <button data-testid="voices-retry" type="button" className={BUTTON_CLASS} style={{ ...BUTTON_STYLE, marginLeft: 6 }} onClick={() => void reload()}>
            Retry
          </button>
        </div>
      )}
      {failed && !unreachable && (
        <div role="alert" data-testid="voices-failed" className={BANNER_CLASS} style={BANNER_STYLE}>
          Couldn't load the voices from the panel server.
          <button data-testid="voices-failed-retry" type="button" className={BUTTON_CLASS} style={{ ...BUTTON_STYLE, marginLeft: 6 }} onClick={() => void reload()}>
            Retry
          </button>
        </div>
      )}
      {!adding && errorBanner}
      {!unreachable && (
        <ul
          data-testid="voices-list"
          className="rounded-md"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            maxHeight: 300,
            overflowY: "auto",
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-surface)",
          }}
        >
          {shown.map((voice) => (
            <VoiceRow
              key={voice.id}
              voice={voice}
              compact={compact}
              isDefault={defaults.has(voice.id)}
              playing={player.playing === voice.id}
              onPlay={() => player.toggle(voice.id)}
              confirm={
                confirming === voice.id
                  ? { uses: usesOf(voice.id, globalVoice, byProject), busy: deleting }
                  : null
              }
              onDelete={() => setConfirming(voice.id)}
              onCancelDelete={() => {
                setConfirming(null);
                setError(null);
              }}
              onConfirmDelete={() => void remove(voice.id)}
            />
          ))}
          {needle !== "" && shown.length === 0 && voices.length > 0 && (
            <li className="text-xs px-3 py-3 text-center" style={{ color: "var(--text-secondary)" }}>
              No voice matches “{filter.trim()}”.
            </li>
          )}
          {!loaded && (
            <li data-testid="voices-loading" className="text-xs px-3 py-3 text-center" style={{ color: "var(--text-tertiary)" }}>
              Loading voices…
            </li>
          )}
          {loaded && !failed && custom === 0 && (
            <li data-testid="voices-empty" className="text-center" style={{ padding: "18px 12px", fontSize: 13, color: "var(--text-secondary)" }}>
              No custom voices on this server yet.
              {workspaceOnly > 0 && (
                <>
                  <br />
                  {workspaceOnly} {workspaceOnly === 1 ? "voice is" : "voices are"} saved in this workspace — run{" "}
                  <code style={CODE}>pnpm install:speech</code> to put {workspaceOnly === 1 ? "it" : "them"} back.
                </>
              )}
            </li>
          )}
        </ul>
      )}
      {adding && errorBanner}
      {adding && (
        <AddVoiceForm
          voices={voices}
          narrow={narrow}
          onError={setError}
          onCancel={() => {
            setAdding(false);
            setError(null);
          }}
          onAdded={async () => {
            await reload();
            setAdding(false);
          }}
        />
      )}
    </section>
  );
}
