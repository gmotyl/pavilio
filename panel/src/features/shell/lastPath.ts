/**
 * Navigation bookmarks: where the user was inside a project, and which file
 * each of its sections had open.
 *
 * All three declarations ask for `browserStore: "session"`, which is what keeps
 * these in `sessionStorage` now that they route through the registry. The
 * panel-shell spec makes that normative — a second browser tab keeps its own
 * independent bookmark, and a fully closed browser starts fresh — so neither
 * the workspace file nor `localStorage` would do.
 */
import { preferences } from "../../preferences/declarations";
import { clearPreference, readPreference, writePreference } from "../../preferences/store";
import { asPreferenceScope, isPreferenceScope } from "../../preferences/types";

/**
 * `<project>:<section>`, mirroring the old `panel:lastFile:` key exactly, or
 * `undefined` when either half is unresolved.
 *
 * The composite is judged one half at a time: `<project>:` with a blank section
 * IS a non-blank string, so `isPreferenceScope` would wave the pair through and
 * every section of a project would share one key. `useProjectTabs` reaches
 * these helpers through the `projectName ?? ""` idiom, so that is a real case,
 * not a hypothetical.
 */
function sectionScope(project: string, section: string): string | undefined {
  if (!isPreferenceScope(project) || !isPreferenceScope(section)) return undefined;
  return `${project}:${section}`;
}

/**
 * A bookmark is always text. The `json` codec would hand back whatever a
 * crossed write or a hand-edit left behind, and every reader here feeds a URL,
 * so anything that is not a string reads as "nothing remembered".
 */
function asPath(value: string | null): string | null {
  return typeof value === "string" ? value : null;
}

export function readLastPath(project: string): string | null {
  const scope = asPreferenceScope(project);
  return scope === undefined ? null : asPath(readPreference(preferences.lastPath, scope));
}

export function writeLastPath(project: string, path: string): void {
  const scope = asPreferenceScope(project);
  if (scope === undefined) return;
  writePreference(preferences.lastPath, path, scope);
}

export function readLastSectionFile(project: string, section: string): string | null {
  const scope = sectionScope(project, section);
  return scope === undefined ? null : asPath(readPreference(preferences.lastSectionFile, scope));
}

export function writeLastSectionFile(project: string, section: string, file: string): void {
  const scope = sectionScope(project, section);
  if (scope === undefined) return;
  writePreference(preferences.lastSectionFile, file, scope);
}

export function clearLastSectionFile(project: string, section: string): void {
  const scope = sectionScope(project, section);
  if (scope === undefined) return;
  clearPreference(preferences.lastSectionFile, scope);
}

export function readLastReposQuery(project: string): string | null {
  const scope = asPreferenceScope(project);
  return scope === undefined ? null : asPath(readPreference(preferences.lastReposQuery, scope));
}

export function writeLastReposQuery(project: string, query: string): void {
  const scope = asPreferenceScope(project);
  if (scope === undefined) return;
  writePreference(preferences.lastReposQuery, query, scope);
}

export function clearLastReposQuery(project: string): void {
  const scope = asPreferenceScope(project);
  if (scope === undefined) return;
  clearPreference(preferences.lastReposQuery, scope);
}
