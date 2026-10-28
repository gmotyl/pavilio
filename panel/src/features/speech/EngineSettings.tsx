import { useMemo, useRef, useState, type CSSProperties } from "react";
import { listEngines, listVoices } from "anytts";

import { preferences, type CascadeEntry } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { groupVoices } from "./voiceGroups";
import { SPEECH_ROWS_NARROW_BELOW, usePaneWidth } from "./usePaneWidth";
import {
  getCascadeOrder,
  getStoredVoices,
  catalogDefaultVoice,
  setCascadeOrder,
  setEngineVoice,
  setEnginePronunciation,
} from "./voices";
import {
  ENGINE_KEY_VARS,
  isKeyedEngine,
  isKeyless,
  statusChip,
  useEngineInfo,
  type ChipTone,
  type EngineInfo,
} from "./useEngineInfo";

/** Each provider's free tier, as the row's limit note (mockup copy). */
const LIMIT_NOTES: Readonly<Record<string, string>> = {
  elevenlabs: "free · 10K chars/mo",
  cartesia: "free · 20K credits/mo",
  speechify: "free · 500K chars/mo",
  azure: "free · 0.5M chars/mo",
  edge: "no key needed",
};

const CHIP_COLORS: Readonly<Record<ChipTone, string>> = {
  ok: "var(--green)",
  warn: "var(--yellow)",
  off: "var(--text-tertiary)",
  err: "var(--red)",
};

const CONTROL_CLASS = "text-sm px-2 py-1.5 rounded";
const CONTROL_STYLE: CSSProperties = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
  width: "100%",
  minWidth: 0,
};
const BUTTON_CLASS = "text-xs px-2.5 py-1 rounded";
const BUTTON_STYLE: CSSProperties = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
};
const GHOST_STYLE: CSSProperties = {
  background: "transparent",
  color: "var(--text-secondary)",
  border: "1px solid transparent",
};
const CELL_LABEL_CLASS = "block text-xs mb-1";
const MUTED: CSSProperties = { color: "var(--text-muted)" };

/** The error a key route answered with, as one line for the row. */
async function keyRequest(engine: string, init: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(`/api/speech/keys/${encodeURIComponent(engine)}`, init);
    if (res.ok) return null;
    let message = "";
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Not JSON: the status line below has to do.
    }
    return message || `Could not save the key (HTTP ${res.status}).`;
  } catch {
    return "Could not reach the panel server.";
  }
}

/**
 * Settings → Speech → *Engines and cascade order*: one row per cascade member
 * in `speech.cascadeOrder`, each with its position and ↑/↓, the API key, a
 * status chip, its voice, the *Pronunciation map* and *In cascade* switches.
 *
 * Each engine's voice here is the one it speaks with both on its own and as a
 * cascade member, so this list — not a single "Default voice" select — is
 * where Settings picks voices. Keys go to the server (`/api/speech/keys`) and
 * are never shown again; everything else is a portable preference.
 */
export function EngineSettings() {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = usePaneWidth(rootRef);
  const narrow = width > 0 && width < SPEECH_ROWS_NARROW_BELOW;
  const { engines, failed, refresh } = useEngineInfo();
  // Subscriptions: each value below is read through `voices.ts`, which repairs
  // and catalog-checks it; the hooks are here so a write re-renders the rows.
  usePreference(preferences.speechCascadeOrder);
  usePreference(preferences.speechVoice);
  const [pronunciation] = usePreference(preferences.speechPronunciationByEngine);

  const order = getCascadeOrder();
  const voices = getStoredVoices();
  const labels = useMemo(() => new Map(listEngines().map((engine) => [engine.id, engine.label])), []);
  const inCascade = order.filter((entry) => entry.on).length;

  const move = (index: number, by: -1 | 1) => {
    const next = [...order];
    const [entry] = next.splice(index, 1);
    next.splice(index + by, 0, entry!);
    setCascadeOrder(next);
  };
  const toggle = (id: string, on: boolean) => {
    setCascadeOrder(order.map((entry: CascadeEntry) => (entry.id === id ? { ...entry, on } : entry)));
  };

  return (
    <div
      ref={rootRef}
      data-testid="engine-settings"
      data-narrow={narrow ? "true" : "false"}
      style={{ minWidth: 0 }}
    >
      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Engines and cascade order
      </h3>
      <p className="text-xs mt-1" style={MUTED}>
        Cascade tries engines top to bottom and moves on when one is out of quota, rate-limited or
        has a bad key. Each engine speaks with the voice set here — the same voice it uses when
        picked directly. Multilingual voices read both Polish and English; a single-language voice
        reads every answer in its own language.
      </p>
      {failed && (
        <div
          role="alert"
          data-testid="engine-status-error"
          className="flex items-center flex-wrap gap-2 text-xs mt-3 px-3 py-2 rounded"
          style={{ border: "1px solid var(--red)", color: "var(--text-primary)" }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            Could not load engine status from the panel server. Keys can still be saved.
          </span>
          <button type="button" data-testid="engine-status-retry" className={BUTTON_CLASS} style={BUTTON_STYLE} onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      <ol className="mt-3 grid gap-2.5" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {order.map((entry, index) => (
          <EngineRow
            key={entry.id}
            id={entry.id}
            label={labels.get(entry.id) ?? entry.id}
            position={index + 1}
            first={index === 0}
            last={index === order.length - 1}
            narrow={narrow}
            info={engines?.[entry.id]}
            unavailable={failed && !engines?.[entry.id]}
            voice={voices[entry.id] ?? catalogDefaultVoice(entry.id) ?? ""}
            pronunciation={pronunciation[entry.id] ?? entry.id === "edge"}
            inCascade={entry.on}
            lastInCascade={entry.on && inCascade === 1}
            onMove={(by) => move(index, by)}
            onToggleCascade={(on) => toggle(entry.id, on)}
            onKeyChanged={refresh}
          />
        ))}
      </ol>
      <p
        data-testid="engine-secrets-notice"
        className="text-xs mt-3 px-3 py-2 rounded"
        style={{ background: "var(--accent-dim)", color: "var(--text-primary)" }}
      >
        <b style={{ color: "var(--accent)" }}>Keys stay on this machine.</b> Saved to{" "}
        <code>~/.panel/secrets.env</code> — outside every repository, so auto-sync never commits
        them. A changed key applies immediately; no restart.
      </p>
    </div>
  );
}

interface EngineRowProps {
  id: string;
  label: string;
  position: number;
  first: boolean;
  last: boolean;
  narrow: boolean;
  info: EngineInfo | undefined;
  /** The engines list failed to load and has no entry for this row. */
  unavailable: boolean;
  voice: string;
  pronunciation: boolean;
  inCascade: boolean;
  lastInCascade: boolean;
  onMove: (by: -1 | 1) => void;
  onToggleCascade: (on: boolean) => void;
  onKeyChanged: () => Promise<void>;
}

function EngineRow(props: EngineRowProps) {
  const { id, label, info, narrow } = props;
  const keyed = isKeyedEngine(id);
  const skipped = isKeyless(info);
  const chip = info ? statusChip(info.status) : null;
  const groups = useMemo(
    () => groupVoices(listVoices(id), typeof navigator === "undefined" ? "" : navigator.language),
    [id],
  );
  const voiceId = `speech-voice-${id}`;

  return (
    <li
      data-testid={`engine-row-${id}`}
      data-skipped={skipped ? "true" : "false"}
      className="rounded-lg p-3"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-default)",
        borderStyle: skipped ? "dashed" : "solid",
        opacity: skipped ? 0.62 : 1,
        minWidth: 0,
      }}
    >
      <div className="flex items-center flex-wrap gap-2.5">
        <span
          data-testid="engine-position"
          className="inline-grid place-items-center text-xs rounded-full"
          style={{ width: 22, height: 22, flex: "none", background: "var(--bg-active)", color: "var(--text-secondary)" }}
        >
          {props.position}
        </span>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {label}
        </span>
        <span data-testid="engine-limit" className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {LIMIT_NOTES[id] ?? ""}
        </span>
        <span style={{ flex: 1 }} />
        <span
          data-testid="engine-status"
          className="text-xs rounded-full"
          style={{
            padding: "1px 8px",
            border: "1px solid currentColor",
            whiteSpace: "nowrap",
            color: chip ? CHIP_COLORS[chip.tone] : "var(--text-tertiary)",
          }}
        >
          {chip ? chip.text : props.unavailable ? "status unavailable" : "checking…"}
        </span>
        <span className="flex gap-1">
          {props.first ? (
            <span aria-hidden="true" style={{ width: 26 }} />
          ) : (
            <button type="button" data-testid={`engine-move-up-${id}`} aria-label={`Move ${label} up`} className={BUTTON_CLASS} style={GHOST_STYLE} onClick={() => props.onMove(-1)}>
              ↑
            </button>
          )}
          {props.last ? (
            <span aria-hidden="true" style={{ width: 26 }} />
          ) : (
            <button type="button" data-testid={`engine-move-down-${id}`} aria-label={`Move ${label} down`} className={BUTTON_CLASS} style={GHOST_STYLE} onClick={() => props.onMove(1)}>
              ↓
            </button>
          )}
        </span>
      </div>
      <div
        data-testid="engine-cells"
        className="mt-3"
        style={{
          display: "grid",
          gridTemplateColumns: narrow ? "1fr" : "1fr 1fr",
          gap: "10px 16px",
          minWidth: 0,
        }}
      >
        {keyed && <KeyCell id={id} label={label} info={info} unavailable={props.unavailable} onKeyChanged={props.onKeyChanged} />}
        <div style={{ minWidth: 0 }}>
          <label htmlFor={voiceId} className={CELL_LABEL_CLASS} style={MUTED}>
            Voice
          </label>
          <select
            id={voiceId}
            value={props.voice}
            onChange={(e) => setEngineVoice(id, e.target.value)}
            className={CONTROL_CLASS}
            style={CONTROL_STYLE}
          >
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.voices.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--text-primary)" }}>
          <input
            type="checkbox"
            checked={props.pronunciation}
            onChange={(e) => setEnginePronunciation(id, e.target.checked)}
            style={{ accentColor: "var(--accent)", width: 16, height: 16 }}
          />
          Pronunciation map
        </label>
        <label
          className="inline-flex items-center gap-2 text-sm cursor-pointer"
          style={{ color: "var(--text-primary)" }}
          title={props.lastInCascade ? "At least one engine stays in the cascade." : undefined}
        >
          <input
            type="checkbox"
            checked={props.inCascade}
            disabled={props.lastInCascade}
            onChange={(e) => props.onToggleCascade(e.target.checked)}
            style={{ accentColor: "var(--accent)", width: 16, height: 16 }}
          />
          In cascade
        </label>
      </div>
      {keyed && (
        <p data-testid="engine-overage-hint" className="text-xs mt-2" style={MUTED}>
          Turn off overage billing at {label} (or set a hard spend limit), so a used-up free tier is
          skipped instead of billed.
        </p>
      )}
    </li>
  );
}

interface KeyCellProps {
  id: string;
  label: string;
  info: EngineInfo | undefined;
  unavailable: boolean;
  onKeyChanged: () => Promise<void>;
}

/**
 * The API key: "set •••• 3f9a" with Change and Remove; a password input with
 * Save; or "from environment" naming the variable that wins. Azure adds its
 * Region, sent with the key. When the engines list could not be loaded the
 * key's source is unknown, so the cell offers the input: the server refuses
 * (409) when an environment variable wins, and that shows inline. A failed request leaves the row as it was — the
 * typed key stays in the input — and says why inline.
 */
function KeyCell({ id, label, info, unavailable, onKeyChanged }: KeyCellProps) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [region, setRegion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const source = info?.keySource;
  const showInput =
    source === "none" || (source === "file" && editing) || (source === undefined && unavailable);
  const keyInputId = `speech-key-${id}`;
  const regionId = `speech-region-${id}`;

  const finish = async (failure: string | null) => {
    setBusy(false);
    setError(failure);
    if (failure !== null) return;
    setEditing(false);
    setApiKey("");
    setRegion(null);
    await onKeyChanged();
  };

  const save = async () => {
    setBusy(true);
    const body: { apiKey: string; region?: string } = { apiKey };
    if (id === "azure") body.region = region ?? info?.region ?? "";
    await finish(
      await keyRequest(id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  };

  const remove = async () => {
    setBusy(true);
    await finish(await keyRequest(id, { method: "DELETE" }));
  };

  return (
    <>
      <div data-testid="engine-key" style={{ minWidth: 0 }}>
        {showInput ? (
          <label htmlFor={keyInputId} className={CELL_LABEL_CLASS} style={MUTED}>
            API key
          </label>
        ) : (
          <span className={CELL_LABEL_CLASS} style={MUTED}>
            API key
          </span>
        )}
        {source === undefined && !unavailable && (
          <span className="text-xs" style={MUTED}>
            …
          </span>
        )}
        {source === "env" && (
          <>
            <code className="text-xs px-2 py-1 rounded" style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)" }}>
              from environment
            </code>
            <p className="text-xs mt-1" style={MUTED}>
              <code style={{ color: "var(--text-primary)" }}>{ENGINE_KEY_VARS[id]}</code> is set on the
              server and wins over a saved key.
            </p>
          </>
        )}
        {source === "file" && !editing && (
          <div className="flex items-center flex-wrap gap-1.5">
            <code className="text-xs px-2 py-1 rounded" style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)" }}>
              {info?.keyLast4 ? `set •••• ${info.keyLast4}` : "set"}
            </code>
            <button type="button" data-testid={`engine-key-change-${id}`} aria-label={`Change ${label} key`} className={BUTTON_CLASS} style={BUTTON_STYLE} onClick={() => setEditing(true)} disabled={busy}>
              Change
            </button>
            <button type="button" data-testid={`engine-key-remove-${id}`} aria-label={`Remove ${label} key`} className={BUTTON_CLASS} style={GHOST_STYLE} onClick={() => void remove()} disabled={busy}>
              Remove
            </button>
          </div>
        )}
        {showInput && (
          <form
            className="flex items-center flex-wrap gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              id={keyInputId}
              type="password"
              autoComplete="new-password"
              placeholder={`Paste ${label} API key`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={CONTROL_CLASS}
              style={{ ...CONTROL_STYLE, width: "auto", flex: "1 1 10rem" }}
            />
            <button type="submit" data-testid={`engine-key-save-${id}`} aria-label={`Save ${label} key`} className={BUTTON_CLASS} style={BUTTON_STYLE} disabled={busy || apiKey.trim() === ""}>
              Save
            </button>
            {editing && (
              <button
                type="button"
                data-testid={`engine-key-cancel-${id}`}
                className={BUTTON_CLASS}
                style={GHOST_STYLE}
                onClick={() => {
                  setEditing(false);
                  setApiKey("");
                  setRegion(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
            )}
          </form>
        )}
        {error !== null && (
          <p role="alert" className="text-xs mt-1" style={{ color: "var(--red)" }}>
            {error}
          </p>
        )}
      </div>
      {id === "azure" && (
        <div style={{ minWidth: 0 }}>
          <label htmlFor={regionId} className={CELL_LABEL_CLASS} style={MUTED}>
            Region
          </label>
          <input
            id={regionId}
            type="text"
            placeholder="westeurope"
            value={region ?? info?.region ?? ""}
            // The region travels with the key: it is edited while a key is typed.
            disabled={!showInput}
            onChange={(e) => setRegion(e.target.value)}
            className={CONTROL_CLASS}
            style={CONTROL_STYLE}
          />
        </div>
      )}
    </>
  );
}
