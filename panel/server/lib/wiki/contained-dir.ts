import { existsSync, lstatSync, mkdirSync, realpathSync } from "fs";
import { isAbsolute, join, relative, sep } from "path";

/**
 * Create `<projectDir>/<segments…>` (e.g. `wiki/raw/repos`) and return it, refusing when any
 * segment is a symlink or a non-directory, or resolves outside `projectDir`. Runs before any
 * write, rm or clone, so a planted `wiki` → `/elsewhere` link can never redirect them.
 */
export function ensureContainedDir(projectDir: string, segments: string[]): string {
  assertContainedDir(projectDir, segments);
  const target = join(projectDir, ...segments);
  mkdirSync(target, { recursive: true });
  assertContainedDir(projectDir, segments);
  return target;
}

/**
 * The check behind {@link ensureContainedDir}, without creating anything: every existing segment of
 * `<baseDir>/<segments…>` must be a real directory (not a symlink) that resolves inside `baseDir`.
 * Segments past the first missing one are not checked — they do not exist yet.
 */
export function assertContainedDir(baseDir: string, segments: string[]): void {
  const base = realpathSync(baseDir);
  let dir = baseDir;
  for (const segment of segments) {
    dir = join(dir, segment);
    if (!existsSync(dir) && !isDanglingLink(dir)) return;
    const label = relative(baseDir, dir).split(sep).join("/");
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink()) throw new Error(`refusing a symlinked ${label}`);
    if (!stat.isDirectory()) throw new Error(`not a directory: ${label}`);
    const rel = relative(base, realpathSync(dir));
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} resolves outside the project`);
  }
}

export function isDanglingLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
