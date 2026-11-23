import type ts from "typescript";
import { createRequire } from "module";
import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "path";

export interface DefinitionLocation {
  /** Repo-relative POSIX path. */
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based, UTF-16 code units. */
  col: number;
}

export interface TsNav {
  /** Definitions of the symbol at `line`/`col` (1-based) in `relPath`; `[]` when there is none or the service fails. */
  definition(root: string, relPath: string, line: number, col: number): Promise<DefinitionLocation[]>;
  /** Repo roots with a live service. */
  activeRoots(): string[];
  dispose(): void;
}

export interface TsNavOptions {
  idleMs?: number;
  /** The TypeScript to run; `tsPath` is the repo's own install serving the file, undefined for the panel's. */
  loadTypeScript?: (root: string, tsPath: string | undefined) => typeof ts;
  /** Live services kept at once; the least recently used goes first. */
  maxServices?: number;
}

const IDLE_MS = 10 * 60_000;
const MAX_SERVICES = 3;
// Bounds the walk through solution-style `references`.
const MAX_REFERENCE_DEPTH = 4;
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

// Loaded on first use so panel boot never pays for TypeScript.
const panelRequire = createRequire(import.meta.url);
const panelTypeScript = (): typeof ts => panelRequire("typescript");

/** Used when no tsconfig.json governs the file: JS stays navigable too. Bundler resolution only exists on TS>=5. */
function fallbackOptions(tsx: typeof ts): ts.CompilerOptions {
  const kinds = tsx.ModuleResolutionKind as unknown as Record<string, number | undefined>;
  return {
    allowJs: true,
    target: tsx.ScriptTarget.ESNext,
    module: tsx.ModuleKind.ESNext,
    moduleResolution: (kinds.Bundler ?? kinds.NodeJs ?? kinds.Node10) as ts.ModuleResolutionKind,
    jsx: tsx.JsxEmit.Preserve,
  };
}

// Same rule as discovery.isContainedPath; importing discovery would pull in the panel config.
const isContainedPath = (rel: string): boolean =>
  rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);

export const isNavigable = (path: string): boolean => SOURCE_EXT.has(extname(path).toLowerCase());

/**
 * The `typescript` a file in `fromDir` would load, when installed inside `realRoot`: resolved from
 * the file's dir, so a workspace package's own install wins over the root's.
 */
export function repoTypeScriptPath(realRoot: string, fromDir: string): string | undefined {
  try {
    const path = createRequire(join(fromDir, "package.json")).resolve("typescript");
    return isContainedPath(relative(realRoot, path)) ? path : undefined;
  } catch {
    // Not installed in the repo.
    return undefined;
  }
}

// Runs the linked repo's own compiler in-process: linked repos are trusted code.
const loadRepoTypeScript = (_root: string, tsPath: string | undefined): typeof ts =>
  tsPath ? panelRequire(tsPath) : panelTypeScript();

interface Config {
  /** mtime of the tsconfig file when parsed; a change re-parses it. */
  mtimeMs: number;
  options: ts.CompilerOptions;
  fileNames: string[];
  references: string[];
  projectReferences: readonly ts.ProjectReference[] | undefined;
}

/** One language service per (root, tsconfig); `configPath` is "" for the no-tsconfig fallback. */
interface Entry {
  root: string;
  state: RootState;
  /** The parsed config the service was built from; a re-parse replaces the service. */
  config: Config | undefined;
  service: ts.LanguageService;
  timer: ReturnType<typeof setTimeout> | undefined;
  fileNames: string[];
}

/** Per-(root, compiler) state shared by its services. */
interface RootState {
  key: string;
  /** The repo's own compiler module, dropped from the require cache with the state. */
  tsPath: string | undefined;
  ts: typeof ts;
  /** Parsed tsconfig files by path. */
  configs: Map<string, Config>;
}

const toPosix = (p: string): string => (sep === "/" ? p : p.split(sep).join("/"));

export function createTsNav(opts: TsNavOptions = {}): TsNav {
  const idleMs = opts.idleMs ?? IDLE_MS;
  const maxServices = opts.maxServices ?? MAX_SERVICES;
  const loadTypeScript = opts.loadTypeScript ?? loadRepoTypeScript;
  // Insertion order is recency order: a hit is re-inserted at the end.
  const entries = new Map<string, Entry>();
  const roots = new Map<string, RootState>();

  const keyOf = (state: RootState, configPath: string): string => `${state.key}\0${configPath}`;

  function dropState(state: RootState): void {
    roots.delete(state.key);
    // Node caches modules independently: without this an upgraded compiler never reloads.
    if (state.tsPath && ![...roots.values()].some((r) => r.tsPath === state.tsPath)) delete panelRequire.cache[state.tsPath];
  }

  function disposeKey(key: string, keepState = false): void {
    const e = entries.get(key);
    if (!e) return;
    entries.delete(key);
    if (e.timer) clearTimeout(e.timer);
    try {
      e.service.dispose();
    } catch {
      // Already broken; dropping it is all that matters.
    }
    // The state goes with its last service.
    if (!keepState && ![...entries.values()].some((x) => x.state === e.state)) dropState(e.state);
  }

  function touch(key: string, e: Entry): void {
    entries.delete(key);
    entries.set(key, e);
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(() => disposeKey(key), idleMs);
    e.timer.unref?.();
  }

  function rootState(root: string, tsPath: string | undefined): RootState {
    const key = `${root}\0${tsPath ?? ""}`;
    let r = roots.get(key);
    if (!r) {
      r = { key, tsPath, ts: loadTypeScript(root, tsPath), configs: new Map() };
      roots.set(key, r);
    }
    return r;
  }

  function create(root: string, state: RootState, config: Config | undefined): Entry {
    const tsx = state.ts;
    const options = config?.options ?? fallbackOptions(tsx);
    const version = (f: string): string => {
      try {
        return String(statSync(f).mtimeMs);
      } catch {
        return "0";
      }
    };
    const entry: Entry = {
      root,
      state,
      config,
      service: undefined as unknown as ts.LanguageService,
      timer: undefined,
      fileNames: [...(config?.fileNames ?? [])],
    };
    // useSourceOfProjectReferenceRedirect is tsserver's (untyped) hook: referenced projects resolve
    // to their sources, so an unbuilt composite project still navigates.
    const host: ts.LanguageServiceHost & { useSourceOfProjectReferenceRedirect(): boolean } = {
      getCompilationSettings: () => options,
      getProjectReferences: () => config?.projectReferences,
      useSourceOfProjectReferenceRedirect: () => true,
      getScriptFileNames: () => entry.fileNames,
      // Working tree only: the file's mtime is its version.
      getScriptVersion: version,
      getScriptSnapshot: (f) => (existsSync(f) ? tsx.ScriptSnapshot.fromString(readFileSync(f, "utf-8")) : undefined),
      getCurrentDirectory: () => root,
      getDefaultLibFileName: (o) => tsx.getDefaultLibFilePath(o),
      fileExists: tsx.sys.fileExists,
      readFile: tsx.sys.readFile,
      readDirectory: tsx.sys.readDirectory,
      directoryExists: tsx.sys.directoryExists,
      getDirectories: tsx.sys.getDirectories,
      realpath: tsx.sys.realpath,
    };
    entry.service = tsx.createLanguageService(host, tsx.createDocumentRegistry());
    return entry;
  }

  function readConfig(state: RootState, path: string): Config | undefined {
    const mtimeMs = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
    if (mtimeMs === undefined) return undefined;
    let cfg = state.configs.get(path);
    if (cfg && cfg.mtimeMs === mtimeMs) return cfg;
    const tsx = state.ts;
    const read = tsx.readConfigFile(path, tsx.sys.readFile);
    const parsed = tsx.parseJsonConfigFileContent(read.config ?? {}, tsx.sys, dirname(path), undefined, path);
    cfg = {
      mtimeMs,
      options: parsed.options,
      fileNames: parsed.fileNames.map((f) => resolve(f)),
      references: (parsed.projectReferences ?? []).map((r) => resolve(tsx.resolveProjectReferencePath(r))),
      projectReferences: parsed.projectReferences,
    };
    state.configs.set(path, cfg);
    return cfg;
  }

  /** A config listing `file`, searched through `references` (solution-style tsconfigs list no files themselves). */
  function owningConfig(state: RootState, path: string, file: string, depth: number, seen: Set<string>): string | undefined {
    if (seen.has(path)) return undefined;
    seen.add(path);
    const cfg = readConfig(state, path);
    if (!cfg) return undefined;
    if (cfg.fileNames.includes(file)) return path;
    if (depth >= MAX_REFERENCE_DEPTH) return undefined;
    for (const ref of cfg.references) {
      const hit = owningConfig(state, ref, file, depth + 1, seen);
      if (hit) return hit;
    }
    return undefined;
  }

  /**
   * The tsconfig governing `file`: the nearest one from its dir up to the repo root that lists it
   * (directly or through references), else the nearest one; "" when none.
   */
  function configPathFor(state: RootState, root: string, file: string): string {
    let dir = dirname(file);
    let nearest = "";
    for (;;) {
      const candidate = join(dir, "tsconfig.json");
      if (existsSync(candidate)) {
        const owner = owningConfig(state, candidate, file, 0, new Set());
        if (owner) return owner;
        nearest ||= candidate;
      }
      if (dir === root) break;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return nearest;
  }

  /** 0-based offset of a 1-based line/col, or -1 when it lies outside the text. */
  function offsetOf(text: string, line: number, col: number): number {
    const starts = [0];
    for (const m of text.matchAll(/\r\n|\r|\n/g)) starts.push(m.index + m[0].length);
    if (line > starts.length) return -1;
    // End of the line's text, excluding its line break.
    const end = line < starts.length ? text.slice(0, starts[line]).replace(/(\r\n|\r|\n)$/, "").length : text.length;
    const pos = starts[line - 1] + col - 1;
    return pos < end ? pos : -1;
  }

  async function definition(root: string, relPath: string, line: number, col: number): Promise<DefinitionLocation[]> {
    if (!isNavigable(relPath)) return [];
    const file = resolve(root, relPath);
    if (!isContainedPath(relative(root, file)) || !existsSync(file)) return [];
    let realRoot: string;
    try {
      realRoot = realpathSync(root);
      if (!isContainedPath(relative(realRoot, realpathSync(file)))) return [];
    } catch {
      return [];
    }

    let key: string | undefined;
    let state: RootState | undefined;
    try {
      state = rootState(root, repoTypeScriptPath(realRoot, dirname(realpathSync(file))));
      const configPath = configPathFor(state, root, file);
      key = keyOf(state, configPath);
      const cfg = configPath ? readConfig(state, configPath) : undefined;
      let entry = entries.get(key);
      // A tsconfig edit re-parsed the config: rebuild the service on it.
      if (entry && entry.config !== cfg) {
        disposeKey(key, true);
        entry = undefined;
      }
      if (!entry) {
        entry = create(root, state, cfg);
        entries.set(key, entry);
        for (const old of [...entries.keys()].slice(0, Math.max(0, entries.size - maxServices))) disposeKey(old);
      }
      touch(key, entry);
      // A file outside the config's include still gets served as an extra root.
      if (!entry.fileNames.includes(file)) entry.fileNames = [...entry.fileNames, file];

      const pos = offsetOf(readFileSync(file, "utf-8"), line, col);
      if (pos < 0) return [];
      const defs = entry.service.getDefinitionAtPosition(file, pos) ?? [];
      const program = entry.service.getProgram();
      const out: DefinitionLocation[] = [];
      const seen = new Set<string>();
      for (const d of defs) {
        // Keep anything inside the repo (its node_modules included); drop the rest, e.g. the panel's own lib.d.ts.
        let rel: string;
        try {
          rel = relative(realRoot, realpathSync(d.fileName));
        } catch {
          continue;
        }
        if (!isContainedPath(rel)) continue;
        const sf = program?.getSourceFile(d.fileName);
        if (!sf) continue;
        const lc = sf.getLineAndCharacterOfPosition(d.textSpan.start);
        const loc = { path: toPosix(rel), line: lc.line + 1, col: lc.character + 1 };
        const k = `${loc.path}:${loc.line}:${loc.col}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(loc);
      }
      return out;
    } catch (e) {
      // A broken service is dropped; the next request starts a fresh one.
      console.warn(`[ts-nav] ${root}: ${e instanceof Error ? e.message : String(e)}`);
      if (key && entries.has(key)) disposeKey(key);
      else if (state && ![...entries.values()].some((x) => x.state === state)) dropState(state);
      return [];
    }
  }

  return {
    definition,
    activeRoots: () => [...new Set([...entries.values()].map((e) => e.root))],
    dispose: () => {
      for (const key of [...entries.keys()]) disposeKey(key);
      for (const state of [...roots.values()]) dropState(state);
    },
  };
}
