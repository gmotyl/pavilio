export const STORAGE_PREFIX = "panel:lastPath:";
const SECTION_FILE_PREFIX = "panel:lastFile:";
const REPOS_QUERY_PREFIX = "panel:lastReposQuery:";

export function readLastPath(project: string): string | null {
  try {
    return sessionStorage.getItem(`${STORAGE_PREFIX}${project}`);
  } catch {
    return null;
  }
}

export function writeLastPath(project: string, path: string): void {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${project}`, path);
  } catch {
    /* sessionStorage disabled — silent no-op */
  }
}

export function readLastSectionFile(project: string, section: string): string | null {
  try {
    return sessionStorage.getItem(`${SECTION_FILE_PREFIX}${project}:${section}`);
  } catch {
    return null;
  }
}

export function writeLastSectionFile(project: string, section: string, file: string): void {
  try {
    sessionStorage.setItem(`${SECTION_FILE_PREFIX}${project}:${section}`, file);
  } catch {
    /* sessionStorage disabled — silent no-op */
  }
}

export function clearLastSectionFile(project: string, section: string): void {
  try {
    sessionStorage.removeItem(`${SECTION_FILE_PREFIX}${project}:${section}`);
  } catch {
    /* sessionStorage disabled — silent no-op */
  }
}

export function readLastReposQuery(project: string): string | null {
  try {
    return sessionStorage.getItem(`${REPOS_QUERY_PREFIX}${project}`);
  } catch {
    return null;
  }
}

export function writeLastReposQuery(project: string, query: string): void {
  try {
    sessionStorage.setItem(`${REPOS_QUERY_PREFIX}${project}`, query);
  } catch {
    /* sessionStorage disabled — silent no-op */
  }
}

export function clearLastReposQuery(project: string): void {
  try {
    sessionStorage.removeItem(`${REPOS_QUERY_PREFIX}${project}`);
  } catch {
    /* sessionStorage disabled — silent no-op */
  }
}
