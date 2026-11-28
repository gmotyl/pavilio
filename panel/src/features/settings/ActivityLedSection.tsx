import { useState } from "react";
import { AlertTriangle, Check, Lightbulb } from "lucide-react";
import {
  ACTIVITY_LED_BOUNDS,
  clampActivityLedNumber,
  preferences,
  type ActivityLedSettings,
} from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";

type NumericField = keyof typeof ACTIVITY_LED_BOUNDS;

const inputStyle = {
  background: "var(--bg-base, var(--bg-surface))",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
} as const;

/**
 * Text drafted locally, committed on blur / Enter, so a half-typed host or
 * number is never saved. Follows the stored value while not focused.
 */
function useDraft(stored: string, commit: (draft: string) => string) {
  const [draft, setDraft] = useState(stored);
  const [base, setBase] = useState(stored);
  const [focused, setFocused] = useState(false);
  if (stored !== base && !focused) {
    setBase(stored);
    setDraft(stored);
  }
  return {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (draft === base) return;
      const shown = commit(draft);
      setBase(shown);
      setDraft(shown);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") e.currentTarget.blur();
    },
  };
}

function NumberField({
  id,
  label,
  field,
  led,
  save,
}: {
  id: string;
  label: string;
  field: NumericField;
  led: ActivityLedSettings;
  save: (patch: Partial<ActivityLedSettings>) => void;
}) {
  const [min, max] = ACTIVITY_LED_BOUNDS[field];
  const draft = useDraft(String(led[field]), (text) => {
    const n = Number(text);
    // Blank / non-number restores the stored value.
    if (text.trim() === "" || !Number.isFinite(n)) return String(led[field]);
    const clamped = clampActivityLedNumber(field, n);
    save({ [field]: clamped });
    return String(clamped);
  });
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        data-testid={id}
        type="number"
        min={min}
        max={max}
        step={1}
        {...draft}
        className="text-sm px-2 py-1 rounded"
        style={{ ...inputStyle, width: 96 }}
      />
    </>
  );
}

/**
 * Settings → "Activity LED": this machine's `activityLed` preference, saved
 * whole on every change; the server re-sends a report at once. Test asks the
 * server for one sample cycle (1 attention + 1 busy) with the saved settings.
 */
export function ActivityLedSection() {
  const [led, setLed] = usePreference(preferences.activityLed);
  // `sent` holds the target; a 204 means the UDP send left this machine, not that the board got it.
  const [testState, setTestState] = useState<{ sent: string } | string>("idle");
  const [testing, setTesting] = useState(false);

  const save = (patch: Partial<ActivityLedSettings>) => setLed((prev) => ({ ...prev, ...patch }));

  const host = useDraft(led.host, (text) => {
    const trimmed = text.trim();
    // A blank host names nothing.
    if (trimmed === "") return led.host;
    save({ host: trimmed });
    return trimmed;
  });

  const test = async (): Promise<void> => {
    if (testing) return;
    setTesting(true);
    const target = `${led.host}:${led.port}`;
    try {
      const res = await fetch("/api/activity-led/test", { method: "POST" });
      if (res.ok) {
        setTestState({ sent: target });
      } else {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        const reason = typeof body?.error === "string" && body.error ? body.error : `server answered ${res.status}`;
        setTestState(`Test failed: ${reason}`);
      }
    } catch (err) {
      setTestState(`Test failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  const [bMin, bMax] = ACTIVITY_LED_BOUNDS.brightness;

  return (
    <div data-testid="activity-led">
      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Activity LED
      </h3>
      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
        Sends this machine&apos;s attention / busy session counts over UDP to an LED board, which blinks them.
      </p>
      <div
        className="rounded p-4 mt-2"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", maxWidth: 640 }}
      >
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-primary)" }}>
          <input
            type="checkbox"
            data-testid="activity-led-enabled"
            checked={led.enabled}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
          Report activity
        </label>
        <div
          className="grid items-center gap-x-3 gap-y-2 mt-3 text-sm"
          style={{ gridTemplateColumns: "auto 1fr", color: "var(--text-primary)" }}
        >
          <label htmlFor="activity-led-host">Host</label>
          <input
            id="activity-led-host"
            data-testid="activity-led-host"
            type="text"
            spellCheck={false}
            {...host}
            className="text-sm px-2 py-1 rounded"
            style={{ ...inputStyle, width: 180 }}
          />
          <NumberField id="activity-led-port" label="Port" field="port" led={led} save={save} />
          <label htmlFor="activity-led-attention">Attention colour</label>
          <input
            id="activity-led-attention"
            data-testid="activity-led-attention"
            type="color"
            value={led.colourAttention}
            onChange={(e) => save({ colourAttention: e.target.value.toUpperCase() })}
          />
          <label htmlFor="activity-led-busy">Busy colour</label>
          <input
            id="activity-led-busy"
            data-testid="activity-led-busy"
            type="color"
            value={led.colourBusy}
            onChange={(e) => save({ colourBusy: e.target.value.toUpperCase() })}
          />
          <label htmlFor="activity-led-brightness">Brightness</label>
          <div className="flex items-center gap-2">
            <input
              id="activity-led-brightness"
              data-testid="activity-led-brightness"
              type="range"
              min={bMin}
              max={bMax}
              step={1}
              value={led.brightness}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) save({ brightness: clampActivityLedNumber("brightness", n) });
              }}
            />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {led.brightness}%
            </span>
          </div>
          <NumberField id="activity-led-blink" label="Blink (ms)" field="blinkMs" led={led} save={save} />
          <NumberField id="activity-led-pause" label="Pause (ms)" field="pauseMs" led={led} save={save} />
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            data-testid="activity-led-test"
            onClick={() => void test()}
            disabled={testing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50"
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <Lightbulb size={11} />
            Test
          </button>
          {typeof testState === "object" && (
            <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
              <Check size={12} />
              Test report sent to {testState.sent}
            </span>
          )}
          {typeof testState === "string" && testState !== "idle" && (
            <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--red)" }}>
              <AlertTriangle size={12} />
              {testState}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
