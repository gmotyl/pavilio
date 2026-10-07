/**
 * Split a path into its normalised segments the way POSIX `path.resolve` would
 * read it: backslashes become separators, empty and `.` segments vanish, and a
 * `..` eats the segment before it (never climbing above the root).
 */
function segments(path: string): string[] {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out;
}

/**
 * The path to paste into an agent conversation: `absolutePath` relative to the
 * workspace root (the parent of the configured projects directory), with POSIX
 * separators — the same answer POSIX `path.relative(workspaceRoot, absolutePath)`
 * gives, after normalising backslashes on both sides.
 *
 * - A file inside the workspace → `projects/<p>/…`. The projects directory's
 *   name comes out of the absolute path, so a renamed one stays correct.
 * - A file in a linked repo outside it → a `../` path, which an agent running at
 *   the workspace root resolves directly.
 *
 * Both inputs are expected absolute; matching is per whole segment, so
 * `/w/projects-old` is a sibling of `/w/projects`, not inside it.
 */
export function relativeToWorkspace(
  absolutePath: string,
  workspaceRoot: string,
): string {
  const from = segments(workspaceRoot);
  const to = segments(absolutePath);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common++;
  }
  const up = from.slice(common).map(() => "..");
  return [...up, ...to.slice(common)].join("/");
}
