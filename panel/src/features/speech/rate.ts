/**
 * Per-project playback speed. A rate is the audio element's `playbackRate`
 * and nothing else: it is never sent to synthesis, so changing it never
 * re-synthesizes and never restarts a unit.
 */

import { clampRate, preferences } from "../../preferences/declarations";
import { readPreference, writePreference } from "../../preferences/store";

export const RATE_PRESETS = [0.8, 1.0, 1.2, 1.5, 2.0] as const;

/** The first preset above `rate`, wrapping to the slowest. */
export function nextRatePreset(rate: number): number {
  return RATE_PRESETS.find((preset) => preset > rate) ?? RATE_PRESETS[0];
}

/** The project's rate; 1.0 for no project or none stored. */
export function rateFor(project: string | undefined | null): number {
  if (!project) return 1;
  const stored = readPreference(preferences.speechRateByProject);
  return Object.hasOwn(stored, project) ? clampRate(stored[project]) : 1;
}

/** Stores the project's rate, clamped; 1.0 deletes the entry. A blank project is ignored. */
export function setProjectRate(project: string, rate: number): void {
  if (project.trim() === "") return;
  const next = clampRate(rate);
  const others = Object.entries(readPreference(preferences.speechRateByProject)).filter(
    ([key]) => key !== project,
  );
  writePreference(
    preferences.speechRateByProject,
    Object.fromEntries(next === 1 ? others : [...others, [project, next]]),
  );
}
