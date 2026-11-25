/**
 * Which PR stories are being written right now — kept OUTSIDE React, per
 * project, for the life of the tab.
 *
 * A launch only types a line into a terminal; the story lands as a file some
 * minutes later. The row's spinner has to outlast the component that started
 * it: the QA tab unmounts the PRs view, and coming back mid-run must still show
 * the run in flight. So the state lives at module level and React reads it
 * through {@link useExplaining}.
 *
 * Keys are the caller's (the PRs view uses `repo#n`); `settleExplaining`
 * receives each story's index `modified` time under the same key. An entry is
 * added only after a launch resolves, and leaves when:
 *
 * - `explain`: its story exists at all — there was none when it started;
 * - `rebuild`: its story's `modified` is newer than `startedAt` — the old file
 *   was already there, so only a rewrite counts;
 * - {@link EXPLAIN_TIMEOUT_MS} passes first: it becomes `{ timedOut: true }`,
 *   which stays (the row's "No story after 15 min" note) until the next launch
 *   on that row replaces it.
 */
import { useSyncExternalStore } from "react";

import type { StoryLanguage } from "../../preferences/declarations";

type Running = { startedAt: number; lang: StoryLanguage; kind: "explain" | "rebuild" };

export type Explaining = Running | { timedOut: true };

/** How long a run may take before the row stops waiting for its story. */
export const EXPLAIN_TIMEOUT_MS = 15 * 60_000;

const EMPTY: ReadonlyMap<string, Explaining> = new Map();

/**
 * project → key → entry. Each project's map is replaced, never mutated, so a
 * snapshot handed to `useSyncExternalStore` changes identity exactly when its
 * contents do.
 */
const byProject = new Map<string, ReadonlyMap<string, Explaining>>();
const listeners = new Set<() => void>();

function publish(project: string, next: ReadonlyMap<string, Explaining>): void {
  if (next.size === 0) byProject.delete(project);
  else byProject.set(project, next);
  for (const listener of listeners) listener();
}

/** Records a launch that resolved; replaces whatever the row held, a timed-out note included. */
export function startExplaining(
  project: string,
  key: string,
  e: { lang: StoryLanguage; kind: "explain" | "rebuild" },
  now: number = Date.now(),
): void {
  const next = new Map(byProject.get(project) ?? EMPTY);
  next.set(key, { startedAt: now, lang: e.lang, kind: e.kind });
  publish(project, next);
}

/**
 * Clears every entry of `project` whose story has landed, and times out the
 * ones still waiting after {@link EXPLAIN_TIMEOUT_MS}. `storyModified` maps a
 * key to its story file's index `modified` time; a key absent from it has no
 * story yet. A landed story wins over a timeout decided in the same pass.
 */
export function settleExplaining(
  project: string,
  storyModified: Map<string, number>,
  now: number = Date.now(),
): void {
  const current = byProject.get(project);
  if (!current) return;
  let changed = false;
  const next = new Map(current);
  for (const [key, entry] of current) {
    if ("timedOut" in entry) continue;
    const modified = storyModified.get(key);
    const landed =
      modified !== undefined && (entry.kind === "explain" || modified > entry.startedAt);
    if (landed) {
      next.delete(key);
      changed = true;
    } else if (now - entry.startedAt >= EXPLAIN_TIMEOUT_MS) {
      next.set(key, { timedOut: true });
      changed = true;
    }
  }
  if (changed) publish(project, next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The project's live entries; re-renders when they change, and never shows another project's. */
export function useExplaining(project: string): ReadonlyMap<string, Explaining> {
  const snapshot = () => byProject.get(project) ?? EMPTY;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Drops every entry, for test isolation only. */
export function __resetExplainingForTests(): void {
  byProject.clear();
  for (const listener of listeners) listener();
}
