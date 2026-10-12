import { useCallback, useSyncExternalStore } from "react";

import { preferences } from "../../preferences/declarations";
import { readPreference, subscribePreference, writePreference } from "../../preferences/store";
import {
  PROJECT_COLOR_HEX_RE,
  derivedProjectColor,
} from "../projects/projectMark";

const KEY_PREFIX = `${preferences.projectColor.key}@`;
const EMPTY: Record<string, string> = Object.freeze({});

/**
 * A thin reader/writer over the `project.color` preference. A project with no
 * stored colour reads as the colour derived from its name; nothing is written
 * for it.
 *
 * `colors` (every stored colour, for the picker's "already used by" marks) is a
 * cached snapshot rebuilt only when a colour changes, because
 * `useSyncExternalStore` compares snapshots by identity.
 */
let snapshot: Record<string, string> = EMPTY;
let snapshotStale = true;
const listeners = new Set<() => void>();
/** Projects whose preference this module already listens to (cross-tab changes). */
const watched = new Map<string, () => void>();

function storedColors(): Record<string, string> {
  const doc = (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> }).__PAVILIO_PREFS__;
  const out: Record<string, string> = {};
  if (!doc) return out;
  for (const key of Object.keys(doc)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const name = key.slice(KEY_PREFIX.length);
    const hex = readPreference(preferences.projectColor, name);
    if (hex !== "") out[name] = hex;
  }
  return out;
}

function changed(): void {
  snapshotStale = true;
  for (const l of [...listeners]) l();
}

function watch(project: string): void {
  if (watched.has(project) || project.trim() === "") return;
  watched.set(project, subscribePreference(preferences.projectColor, project, changed));
}

function getSnapshot(): Record<string, string> {
  if (snapshotStale) {
    snapshot = storedColors();
    snapshotStale = false;
    for (const name of Object.keys(snapshot)) watch(name);
  }
  return snapshot;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** Rejects a colour that is not #rgb / #rrggbb; nothing is saved then. */
async function setProjectColor(project: string, hex: string): Promise<void> {
  if (!PROJECT_COLOR_HEX_RE.test(hex)) throw new Error(`Invalid colour: ${hex}`);
  watch(project);
  writePreference(preferences.projectColor, hex, project);
  changed();
}

/** Drop all shared state. Tests only. */
export function __resetProjectColorsForTests(): void {
  for (const off of watched.values()) off();
  watched.clear();
  snapshot = EMPTY;
  snapshotStale = true;
  listeners.clear();
}

/**
 * The workspace's project colours. `colorFor` never throws and never leaves a
 * project colourless; `setColor` is the write path.
 */
export function useProjectColors(): {
  colorFor: (project: string) => string;
  setColor: (project: string, hex: string) => Promise<void>;
  colors: Record<string, string>;
} {
  const colors = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const colorFor = useCallback(
    (project: string) => {
      // Asking about a project is what makes its key worth listening to: a
      // colour set later (another tab) for one with none stored here would
      // otherwise never rebuild the snapshot. Idempotent, and the preference
      // store has no wildcard subscription to use instead.
      watch(project);
      return colors[project] ?? derivedProjectColor(project);
    },
    [colors],
  );

  return { colorFor, setColor: setProjectColor, colors };
}
