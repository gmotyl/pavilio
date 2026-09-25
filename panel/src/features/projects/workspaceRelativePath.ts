/**
 * The path to paste into an agent conversation: the file's path relative to the
 * workspace repo root, e.g. "projects/pavilio/mockups/x.html".
 *
 * `relativePath` is relative to the configured projects directory, so it is missing
 * that directory's own name. Recover it from `absolutePath` rather than hardcoding
 * "projects" — the projects directory is configurable.
 *
 * Returns `absolutePath` unchanged when the two paths are inconsistent, so a caller
 * never copies an empty string. Note that fallback returns the raw input while the
 * success path returns normalized separators, so a caller that string-compares the
 * result gets whichever separator style the branch that fired produced.
 */
export function workspaceRelativePath(
  absolutePath: string,
  relativePath: string,
): string {
  if (!absolutePath || !relativePath) return absolutePath;
  const absolute = absolutePath.replace(/\\/g, "/");
  const relative = relativePath.replace(/\\/g, "/");
  const suffix = `/${relative}`;
  if (!absolute.endsWith(suffix)) return absolutePath;
  const head = absolute.slice(0, absolute.length - suffix.length);
  const projectsDir = head.slice(head.lastIndexOf("/") + 1);
  // Reachable: a root-level file or a double slash leaves no dir name to recover.
  if (!projectsDir) return absolutePath;
  return `${projectsDir}/${relative}`;
}
