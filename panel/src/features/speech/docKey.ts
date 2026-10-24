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
 * The directory under PROJECTS an archived project moves into, so its pages'
 * keys read `doc:archived/<project>/…`. Mirrors the server's `archivedRoot`
 * (`panel/server/lib/discovery.ts`); `archived` is also a reserved slug
 * (`panel/server/lib/projects/slug.ts`), so no live project carries the name.
 */
const ARCHIVED_DIR = "archived";

/** A path's first segment, or null when it is empty, a path step, or not a directory. */
function firstDirSegment(path: string): string | null {
  const slash = path.indexOf("/");
  if (slash < 0) return null;

  const segment = path.slice(0, slash);
  return segment === "" || segment === "." || segment === ".." ? null : segment;
}

/**
 * The project a page's key belongs to: its path's first segment — or, for an
 * archived project's page (`doc:archived/<project>/…`), the segment after
 * `archived/`, so the page keeps its project's voice. Null for a key that is
 * not a page's, and for a file outside projects — one with no directory, or
 * whose project segment is a path step (`..`, `.`) or empty.
 */
export function projectOfDocKey(key: string): string | null {
  if (!isDocSpeechKey(key)) return null;

  const path = key.slice(DOC_KEY_PREFIX.length);
  const project = firstDirSegment(path);
  if (project !== ARCHIVED_DIR) return project;

  return firstDirSegment(path.slice(ARCHIVED_DIR.length + 1));
}
