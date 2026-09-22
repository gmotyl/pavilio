/** What a preference's value is remembered per: one value, one per project, or one per repo. */
export type PreferenceScope = "global" | "project" | "repo";

export interface PreferenceCodec<T> {
  /** Throws on malformed input, so the caller can fall back to the declared default. */
  parse(raw: string): T;
  serialize(value: T): string;
  /**
   * True when `serialize` emits the stored text itself rather than JSON — `str`
   * and `oneOf`, today. The store's portable tier needs to know: a text codec's
   * output is stored verbatim, so a `str` preference holding "true" stays a
   * string, while every other codec's output is JSON and is stored in its own
   * shape so the workspace file stays hand-readable.
   *
   * It is declared on the CODEC rather than inferred from the declared default,
   * which is only a proxy for it: a `json<string | null>` codec with a
   * non-string default is the counter-example, and a proxy would lose its data.
   */
  storesText?: boolean;
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

/**
 * Whether `value` can serve as a SCOPE ARGUMENT — the one predicate that keeps
 * a call site away from `storageKey`'s throw below.
 *
 * It lives here, beside the throw it exists to avoid, because every surface
 * that scopes a preference needs it and each had grown its own copy: eleven of
 * them, under five names, two of which shared a name and disagreed on whether
 * "no scope" was `undefined` or `null`. One pair of functions, two shapes — the
 * boolean for a guard, `asPreferenceScope` for a value.
 *
 * BOTH HALVES EARN THEIR KEEP.
 *
 * `x.trim() !== ""`, because a blank scope is a MISSING scope, not a scope.
 * Callers reach these with route params and discovered paths through the
 * `name ?? ""` idiom, and an unresolved one would otherwise key every project
 * onto the same `key@` and let the last writer win. An unresolved scope must
 * read the declared default and write nothing.
 *
 * `typeof x === "string"` first, and it is not decoration. Every blank-scope
 * guard written as a bare `value.trim() === ""` became a NEW throw site the
 * moment the value was `undefined` rather than `""` — and it reaches here
 * `undefined` often, because `server/lib/discovery.ts` validates nothing: a
 * `repos.json` entry with no `path`, or a project with no `name`, ships
 * straight through to the client. The bare form has already cost two
 * regressions in this change — a TypeError during `GitBranchDiff`'s render
 * that took the whole RepoBlock subtree down, and a rejected `Promise.all`
 * that silently emptied `useRepoSearch` for every healthy repository beside
 * the malformed one. The parameter is `unknown` rather than `string` for the
 * same reason: TypeScript believes the `?? ""` chains and the runtime does not.
 */
export function isPreferenceScope(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * The same judgement as a value: the scope argument, or `undefined` when there
 * is none. For call sites that carry a scope around rather than branching on it
 * at once — `usePreference(def, scope ?? placeholder)` and friends.
 */
export function asPreferenceScope(value: unknown): string | undefined {
  return isPreferenceScope(value) ? value : undefined;
}

/** Global scope returns `key`; other scopes return `key@<scopeArg>`. */
export function storageKey(def: PreferenceDef<unknown>, scopeArg?: string): string {
  if (def.scope === "global") return def.key;
  // An empty scope is missing, not a scope — see `isPreferenceScope`, which is
  // the one predicate every call site uses to stay out of this throw.
  if (!isPreferenceScope(scopeArg)) {
    throw new Error(`preference "${def.key}" is ${def.scope}-scoped and needs a scope argument`);
  }
  return `${def.key}@${def.scope === "repo" ? normalizeRepoScope(scopeArg) : scopeArg}`;
}
