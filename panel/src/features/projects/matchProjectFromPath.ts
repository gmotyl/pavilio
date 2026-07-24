export function matchProjectFromPath(
  pathname: string,
): { name: string; section: string | null } | null {
  const m = /^\/project\/([^/]+)(?:\/([^/]+))?/.exec(pathname);
  if (!m) return null;
  return { name: decodeURIComponent(m[1]), section: m[2] ?? null };
}
