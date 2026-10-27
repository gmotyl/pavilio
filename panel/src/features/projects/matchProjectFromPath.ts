export function matchProjectFromPath(
  pathname: string,
): { name: string; section: string | null } | null {
  const m = /^\/project\/([^/]+)(?:\/([^/]+))?/.exec(pathname);
  if (!m) return null;
  return { name: decodeURIComponent(m[1]), section: m[2] ?? null };
}

/**
 * The project a file-view route (`/view/<project>/…`) belongs to, decoded —
 * the same reading Breadcrumbs gives that route. A virtual root (`/view/_…`,
 * e.g. `_root/<rootId>/…` or `_skills/…`) belongs to no project, and a
 * malformed escape is no project rather than a thrown error.
 */
export function matchProjectFromViewPath(pathname: string): string | null {
  const m = /^\/view\/([^/]+)/.exec(pathname);
  if (!m || m[1].startsWith("_")) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}
