/** What a preference's value is remembered per: one value, one per project, or one per repo. */
export type PreferenceScope = "global" | "project" | "repo";

export interface PreferenceCodec<T> {
  /** Throws on malformed input, so the caller can fall back to the declared default. */
  parse(raw: string): T;
  serialize(value: T): string;
}

interface PreferenceDefBase<T> {
  /** Dotted path, e.g. "shell.leftSidebar.expanded". No scope suffix here. */
  key: string;
  scope: PreferenceScope;
  default: T;
  codec: PreferenceCodec<T>;
}

/**
 * `portable` stays a boolean rather than becoming a three-way enum: the
 * workspace-file guard is binary, and a boolean keeps it so. The browser tier
 * is a second, narrower axis that only a non-portable value can have — spelt
 * as a two-arm union, with `browserStore?: never` on the portable arm, so
 * "portable + session" is a type error rather than a convention. Both arms
 * carry the property, so `def.browserStore` still reads off an unnarrowed
 * `PreferenceDef<unknown>` without a cast.
 */
export type PreferenceDef<T> = PreferenceDefBase<T> &
  (
    | {
        /** true → workspace preferences file. */
        portable: true;
        browserStore?: never;
      }
    | {
        /** false → browser storage on this machine only. */
        portable: false;
        /** Which browser store backs a non-portable value. Default "local". */
        browserStore?: "local" | "session";
      }
  );

/** Identity — it exists so a declaration infers `T` from its own default and codec. */
export function definePreference<T>(def: PreferenceDef<T>): PreferenceDef<T> {
  return def;
}

declare global {
  /**
   * The server's home directory, injected into the page by
   * `GET /api/preferences.js` alongside `window.__PAVILIO_PREFS__`.
   * Absent in node, and absent in any page that did not load that script.
   */
  // `var`, not `const`/`let`: only a `var` declaration puts the name on
  // `globalThis`, which is how this is read (there may be no `window`).
  var __PAVILIO_HOME__: string | undefined;
}

/**
 * The home directory this runtime can see, or `undefined` when it has none.
 *
 * A browser bundle has no `process`: vite emits `globalThis.process?.env?.HOME`
 * untouched, so that branch is dead in the panel and the injected global is the
 * real source there. Node — and so vitest, and any server-side use — still has
 * `process.env.HOME`, and it is the fallback. With neither, a `~` is left alone
 * rather than mangled.
 *
 * Everything is reached through `globalThis` (never a bare `window`) so an
 * absent global is `undefined` instead of a ReferenceError, and read per call so
 * no value is baked in at import time.
 */
function homeDir(): string | undefined {
  const injected = (globalThis as { __PAVILIO_HOME__?: unknown }).__PAVILIO_HOME__;
  if (typeof injected === "string" && injected !== "") return injected;
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
  // An empty scope is missing, not a scope. Callers pass route params through
  // the `name ?? ""` idiom, and an unresolved one would otherwise key every
  // project onto the same `key@` and let the last writer win.
  if (scopeArg === undefined || scopeArg.trim() === "") {
    throw new Error(`preference "${def.key}" is ${def.scope}-scoped and needs a scope argument`);
  }
  return `${def.key}@${def.scope === "repo" ? normalizeRepoScope(scopeArg) : scopeArg}`;
}
