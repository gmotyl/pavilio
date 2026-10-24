/**
 * A page's speech key: `doc:` plus the file's path relative to the PROJECTS
 * directory, so `doc:pavilio/wiki/x.md` belongs to project `pavilio`. A file
 * outside the projects directory is written with a leading `..`
 * (`doc:../AGENTS.md`), and has no project.
 *
 * The prefix is what keeps a page apart from a terminal cell in the one speech
 * host: terminal session ids never start with it, so every per-key record —
 * the channel's queue, its `local` flag, the voice — can tell the two apart by
 * the key alone.
 */
const DOC_KEY_PREFIX = "doc:";

/** The speech key of the page at `projectsRelativePath`. */
export function docSpeechKey(projectsRelativePath: string): string {
  return DOC_KEY_PREFIX + projectsRelativePath;
}

/** Whether `key` names a page rather than a terminal cell. */
export function isDocSpeechKey(key: string): boolean {
  return key.startsWith(DOC_KEY_PREFIX);
}

/**
 * The project a page's key belongs to: its path's first segment. Null for a
 * key that is not a page's, and for a file outside projects — one with no
 * directory, or whose first segment is a path step (`..`, `.`) or empty.
 */
export function projectOfDocKey(key: string): string | null {
  if (!isDocSpeechKey(key)) return null;

  const path = key.slice(DOC_KEY_PREFIX.length);
  const slash = path.indexOf("/");
  if (slash < 0) return null;

  const project = path.slice(0, slash);
  return project === "" || project === "." || project === ".." ? null : project;
}
