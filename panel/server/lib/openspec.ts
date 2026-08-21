import { resolve, relative, isAbsolute, join, sep } from "path";

/**
 * Where a project's OpenSpec artifacts live.
 *  - "native": the OpenSpec tree lives inside a linked repository (default: repo root).
 *  - "store":  the tree is mirrored into the project itself, under plans/.
 * `root` is an optional override, always resolved against — and confined to — the
 * boundary implied by the mode (the repo for native, the project for store).
 */
export type OpenSpecConfig =
  | { mode: "native"; root?: string }
  | { mode: "store"; root?: string };

export type ResolvedOpenSpecRoot = {
  mode: "native" | "store";
  root: string; // dir containing the openspec/ subtree
  openspecDir: string; // <root>/openspec
};

/** Missing configuration is an explicit result, never an implicit default. */
export type OpenSpecResolution = ResolvedOpenSpecRoot | { mode: "unconfigured" };

/**
 * Parse the optional `openspec` object off a repos.json entry.
 * Returns undefined when the key is absent (unconfigured), throws on an unknown
 * mode or a malformed shape — we never silently widen to a default backend.
 */
export function parseOpenSpecConfig(entry: unknown): OpenSpecConfig | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const raw = (entry as { openspec?: unknown }).openspec;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") throw new Error("openspec must be an object");
  const { mode, root } = raw as { mode?: unknown; root?: unknown };
  if (mode !== "native" && mode !== "store") {
    throw new Error(`Unknown OpenSpec mode: ${JSON.stringify(mode)}`);
  }
  if (root !== undefined && typeof root !== "string") {
    throw new Error("openspec.root must be a string");
  }
  return root === undefined ? { mode } : { mode, root };
}

/** Confine `target` to `base`; throw on any path that escapes it. */
function assertWithin(base: string, target: string): string {
  const normBase = resolve(base);
  const normTarget = resolve(target);
  const rel = relative(normBase, normTarget);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(`OpenSpec root escapes its boundary: ${normTarget} is not under ${normBase}`);
  }
  return normTarget;
}

export interface ResolveOpenSpecInput {
  /** Absolute path to projects/<project>. */
  projectPath: string;
  /** The linked repository, when resolving against a repo (native or repo-store). */
  repo?: { name: string; path: string };
  /** The parsed config, or undefined when unconfigured. */
  config: OpenSpecConfig | undefined;
}

/**
 * Resolve the normalized OpenSpec root for a project.
 *  - unconfigured config → { mode: "unconfigured" }
 *  - native  → repo root by default; a custom root is confined to the repo
 *  - store   → plans/<repo> when a repo is bound, else plans/; a custom root is
 *              confined to the project-local store root (the project directory)
 * Throws on an unknown mode or a root that escapes its boundary.
 */
export function resolveOpenSpecRoot(input: ResolveOpenSpecInput): OpenSpecResolution {
  const { projectPath, repo, config } = input;
  if (!config) return { mode: "unconfigured" };

  let root: string;
  if (config.mode === "native") {
    if (!repo) throw new Error("native OpenSpec mode requires a linked repository");
    const base = resolve(repo.path);
    root = config.root ? assertWithin(base, resolve(base, config.root)) : base;
  } else if (config.mode === "store") {
    if (config.root) {
      // Confine a custom store root to the project itself.
      root = assertWithin(projectPath, resolve(projectPath, config.root));
    } else {
      const plans = join(projectPath, "plans");
      root = repo ? join(plans, repo.name) : plans;
    }
  } else {
    throw new Error(`Unknown OpenSpec mode: ${JSON.stringify((config as { mode?: unknown }).mode)}`);
  }

  return { mode: config.mode, root, openspecDir: join(root, "openspec") };
}
