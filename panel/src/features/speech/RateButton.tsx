import { preferences } from "../../preferences/declarations";
import { usePreference } from "../../preferences/usePreference";
import { nextRatePreset, rateFor, setProjectRate } from "./rate";

/** `1.0×`-style label: one decimal, so 1 reads `1.0×` and 1.3 reads `1.3×`. */
export function rateLabel(rate: number): string {
  return `${rate.toFixed(1)}×`;
}

/**
 * The project's playback speed on a speech row or in the picker: shows the
 * speed and a click steps to the next preset. Read through `usePreference` so
 * every mounted button for the project follows a change from anywhere.
 */
export function RateButton({ project, testId }: { project: string; testId?: string }) {
  // Subscription only: the value is read through `rate.ts`, which clamps it.
  usePreference(preferences.speechRateByProject);
  const rate = rateFor(project);
  const label = rateLabel(rate);
  const name = `Playback speed ${label} — click to change`;
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      data-testid={testId ?? `speech-bar-rate-${project}`}
      className="speech-bar-btn"
      style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}
      onClick={() => setProjectRate(project, nextRatePreset(rate))}
    >
      {label}
    </button>
  );
}

export default RateButton;
