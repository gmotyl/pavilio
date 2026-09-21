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

/**
 * The scope argument for a project-keyed bookmark, or `null` when no project
 * has resolved yet.
 *
 * The store rejects an empty scope rather than letting every project share one
 * key, and `useProjectTabs` reaches these helpers through the
 * `projectName ?? ""` idiom. An unresolved project therefore reads as "nothing
 * remembered" and writes nothing — which is what the raw helpers did in
 * practice, since the key they wrote under was never read back by anything.
 */
function projectScope(project: string): string | null {
  return project.trim() === "" ? null : project;
}

/** `<project>:<section>`, mirroring the old `panel:lastFile:` key exactly. */
function sectionScope(project: string, section: string): string | null {
  if (projectScope(project) === null || section.trim() === "") return null;
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
  const scope = projectScope(project);
  return scope === null ? null : asPath(readPreference(preferences.lastPath, scope));
}

export function writeLastPath(project: string, path: string): void {
  const scope = projectScope(project);
  if (scope === null) return;
  writePreference(preferences.lastPath, path, scope);
}

export function readLastSectionFile(project: string, section: string): string | null {
  const scope = sectionScope(project, section);
  return scope === null ? null : asPath(readPreference(preferences.lastSectionFile, scope));
}

export function writeLastSectionFile(project: string, section: string, file: string): void {
  const scope = sectionScope(project, section);
  if (scope === null) return;
  writePreference(preferences.lastSectionFile, file, scope);
}

export function clearLastSectionFile(project: string, section: string): void {
  const scope = sectionScope(project, section);
  if (scope === null) return;
  clearPreference(preferences.lastSectionFile, scope);
}

export function readLastReposQuery(project: string): string | null {
  const scope = projectScope(project);
  return scope === null ? null : asPath(readPreference(preferences.lastReposQuery, scope));
}

export function writeLastReposQuery(project: string, query: string): void {
  const scope = projectScope(project);
  if (scope === null) return;
  writePreference(preferences.lastReposQuery, query, scope);
}

export function clearLastReposQuery(project: string): void {
  const scope = projectScope(project);
  if (scope === null) return;
  clearPreference(preferences.lastReposQuery, scope);
}
