import ts from "typescript";
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
  /** The TypeScript to run for `root`; defaults to the repo's own, else the panel's. */
  loadTypeScript?: (root: string) => typeof ts;
}

const IDLE_MS = 10 * 60_000;
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

// Used when no tsconfig.json governs the file: JS stays navigable too.
const FALLBACK_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
};

// Same rule as discovery.isContainedPath; importing discovery would pull in the panel config.
const isContainedPath = (rel: string): boolean =>
  rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);

export const isNavigable = (path: string): boolean => SOURCE_EXT.has(extname(path).toLowerCase());

/** The repo's own `typescript` when installed inside it, so its version and lib match; else the panel's. */
export function loadRepoTypeScript(root: string): typeof ts {
  try {
    const resolved = createRequire(join(root, "package.json")).resolve("typescript");
    if (isContainedPath(relative(root, resolved))) return createRequire(join(root, "package.json"))("typescript");
  } catch {
    // Not installed in the repo.
  }
  return ts;
}

interface Config {
  options: ts.CompilerOptions;
  fileNames: string[];
}

interface Entry {
  ts: typeof ts;
  service: ts.LanguageService;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Parsed tsconfig.json files by path. */
  configs: Map<string, Config>;
  current: Config;
}

const toPosix = (p: string): string => (sep === "/" ? p : p.split(sep).join("/"));

export function createTsNav(opts: TsNavOptions = {}): TsNav {
  const idleMs = opts.idleMs ?? IDLE_MS;
  const loadTypeScript = opts.loadTypeScript ?? loadRepoTypeScript;
  const entries = new Map<string, Entry>();

  function disposeRoot(root: string): void {
    const e = entries.get(root);
    if (!e) return;
    entries.delete(root);
    if (e.timer) clearTimeout(e.timer);
    try {
      e.service.dispose();
    } catch {
      // Already broken; dropping it is all that matters.
    }
  }

  function touch(root: string, e: Entry): void {
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(() => disposeRoot(root), idleMs);
    e.timer.unref?.();
  }

  function create(root: string): Entry {
    const tsx = loadTypeScript(root);
    const state: Pick<Entry, "configs" | "current"> = {
      configs: new Map(),
      current: { options: FALLBACK_OPTIONS, fileNames: [] },
    };
    const version = (f: string): string => {
      try {
        return String(statSync(f).mtimeMs);
      } catch {
        return "0";
      }
    };
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => state.current.options,
      getScriptFileNames: () => state.current.fileNames,
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
    // `state` is the entry itself, so configFor's switches reach the host.
    const entry = state as Entry;
    entry.ts = tsx;
    entry.timer = undefined;
    entry.service = tsx.createLanguageService(host, tsx.createDocumentRegistry());
    return entry;
  }

  /** The nearest tsconfig.json from the file's dir up to the repo root; one service follows whichever governs the request. */
  function configFor(tsx: typeof ts, root: string, entry: Entry, file: string): Config {
    let dir = dirname(file);
    for (;;) {
      const candidate = join(dir, "tsconfig.json");
      if (existsSync(candidate)) {
        let cfg = entry.configs.get(candidate);
        if (!cfg) {
          const read = tsx.readConfigFile(candidate, tsx.sys.readFile);
          const parsed = tsx.parseJsonConfigFileContent(read.config ?? {}, tsx.sys, dirname(candidate));
          cfg = { options: parsed.options, fileNames: parsed.fileNames };
          entry.configs.set(candidate, cfg);
        }
        return cfg.fileNames.includes(file) ? cfg : { ...cfg, fileNames: [...cfg.fileNames, file] };
      }
      if (dir === root) break;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return { options: FALLBACK_OPTIONS, fileNames: [file] };
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

    try {
      let entry = entries.get(root);
      if (!entry) {
        entry = create(root);
        entries.set(root, entry);
      }
      touch(root, entry);
      const tsx = entry.ts;
      entry.current = configFor(tsx, root, entry, file);

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
        const key = `${loc.path}:${loc.line}:${loc.col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(loc);
      }
      return out;
    } catch (e) {
      // A broken service is dropped; the next request starts a fresh one.
      console.warn(`[ts-nav] ${root}: ${e instanceof Error ? e.message : String(e)}`);
      disposeRoot(root);
      return [];
    }
  }

  return {
    definition,
    activeRoots: () => [...entries.keys()],
    dispose: () => {
      for (const root of [...entries.keys()]) disposeRoot(root);
    },
  };
}
