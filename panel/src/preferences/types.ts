/** What a preference's value is remembered per: one value, one per project, or one per repo. */
export type PreferenceScope = "global" | "project" | "repo";

export interface PreferenceCodec<T> {
  /** Throws on malformed input, so the caller can fall back to the declared default. */
  parse(raw: string): T;
  serialize(value: T): string;
}

export interface PreferenceDef<T> {
  /** Dotted path, e.g. "shell.leftSidebar.expanded". No scope suffix here. */
  key: string;
  scope: PreferenceScope;
  default: T;
  codec: PreferenceCodec<T>;
  /** true → workspace preferences file; false → localStorage. */
  portable: boolean;
}

/** Identity — it exists so a declaration infers `T` from its own default and codec. */
export function definePreference<T>(def: PreferenceDef<T>): PreferenceDef<T> {
  return def;
}

/**
 * The home directory this runtime can see, or `undefined` when it has none.
 * Node — and so vitest — carries it on `process.env`; a browser does not, and
 * the panel serves the client no home path today, so a `~` stays a `~` there.
 * Reached through `globalThis` so the browser bundle sees `undefined` instead
 * of a ReferenceError, and read per call so it is never baked in at import.
 */
function homeDir(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.HOME;
}

/**
 * Canonical form of a repo-scoped argument. A leading `~` is expanded and the
 * result is normalized, so `~/git/prv/pavilio` and `/root/git/prv/pavilio`
 * produce ONE key. Applied automatically by `storageKey` for `scope: "repo"`.
 */
export function normalizeRepoScope(repoPath: string): string {
  const home = homeDir();
  let path = repoPath;
  if (home !== undefined) {
    if (path === "~") path = home;
    else if (path.startsWith("~/")) path = `${home}/${path.slice(2)}`;
  }
  // Collapse redundant separators, then trailing ones — but never the lone
  // leading slash of a root path.
  return path.replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");
}

/** Global scope returns `key`; other scopes return `key@<scopeArg>`. */
export function storageKey(def: PreferenceDef<unknown>, scopeArg?: string): string {
  if (def.scope === "global") return def.key;
  if (scopeArg === undefined) {
    throw new Error(`preference "${def.key}" is ${def.scope}-scoped and needs a scope argument`);
  }
  return `${def.key}@${def.scope === "repo" ? normalizeRepoScope(scopeArg) : scopeArg}`;
}
