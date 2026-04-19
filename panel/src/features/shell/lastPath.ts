export const STORAGE_PREFIX = "panel:lastPath:";

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
