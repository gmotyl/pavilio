import { existsSync, realpathSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { cloneRepo } from "./clone-repo";
import { loadWikiConfig, readWikiConfig, type WikiConfig } from "./config";
import { fetchArticle } from "./fetch-article";
import { buildIndex } from "./index-md";
import { pendingRecords, recordIngested } from "./ledger";
import { lintWiki } from "./lint";
import { releaseLock, takeLock } from "./lock";
import { countMentions } from "./mentions";
import { resolveProject, type FetchLike } from "./project";

/**
 * `scripts/wiki <command>` — the wiki's deterministic half, for skills and agents.
 *
 * Every command prints exactly one JSON object on stdout and exits 0 (ok), 1 (error, `{error}`)
 * or 2 (ask the user, `{ask: true, reason}`). Diagnostics and usage go to stderr only.
 *
 * Paths in receipts: `pending` and `record` paths are project-relative; `index` `written`,
 * `fetch-article` `raw`, `clone-repo` `clonePath` and every page in `mentions`/`lint` are
 * wiki-relative (relative to `projects/<p>/wiki/`), except `lint`'s own `wiki/…` page keys.
 *
 * The workspace root (the dir holding `projects/` and `.projects.local.md`) comes from
 * `PAVILIO_WORKSPACE_ROOT`, defaulting to the dir above `panel/` — in an installed workspace
 * `scripts/` and `panel/` are both synced to the workspace root, so that IS the workspace.
 */

const USAGE = `usage: scripts/wiki <command> [args]

  project [--name <p>] [--cwd <dir>]        {project, via} | exit 2 {ask, reason}
  pending <p> [--only <path>]               {pending: [{path, hash, status}]}
  record <p> <path> <hash>                  {ok: true}
  lock take|release <p> --session <id>      {held, takenOver} (release adds released)
  mentions <p> [--touched a,b]              {slugs, qualifying}; slugs are entities/x, concepts/x
  index <p>                                 {written} | exit 1 {error, page}
  lint <p>                                  {broken, orphans, untyped, stale, codeIdentifiers}
  config                                    {sessionStartIngest, writerModel}
  fetch-article <p> <url>                   {raw, title, warning?}
  clone-repo <p> <url>                      {clonePath, commitSha, action}

<p> is a project dir under <workspace>/projects/. Paths in receipts are wiki-relative except
pending/record paths (project-relative). Exit: 0 ok, 1 error {error}, 2 ask the user.
Workspace: $PAVILIO_WORKSPACE_ROOT, default the dir that contains scripts/ and panel/.
`;

type Writable = { write(chunk: string): unknown };

export type CliDeps = {
  stdout: Writable;
  stderr: Writable;
  cwd: string;
  env: Record<string, string | undefined>;
  /** Overrides `env.PAVILIO_WORKSPACE_ROOT` and the default. */
  workspaceRoot?: string;
  fetch?: FetchLike;
};

/** The dir above `panel/`: `panel/server/lib/wiki/cli.ts` → four levels up. */
const DEFAULT_WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** A usage mistake: exit 1 with `{error}` and the usage on stderr. */
class CliError extends Error {}
class UnknownCommand extends Error {}

type Parsed = { positional: string[]; flags: Map<string, string> };

/** `--flag value` and `--flag=value`; a flag without a value is an error. */
function parseArgs(args: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const value = args[i + 1];
    if (value === undefined) throw new CliError(`${arg} needs a value`);
    flags.set(arg.slice(2), value);
    i++;
  }
  return { positional, flags };
}

function only(parsed: Parsed, count: number, what: string, allowed: string[] = []): string[] {
  if (parsed.positional.length !== count) throw new CliError(`expected ${what}`);
  for (const key of parsed.flags.keys()) {
    if (!allowed.includes(key)) throw new CliError(`unknown flag --${key}`);
  }
  return parsed.positional;
}

/** `<workspaceRoot>/projects/<name>`, which must be an existing dir; the name is a plain dir name. */
function projectDir(workspaceRoot: string, name: string): string {
  if (!name || name === "." || name.includes("..") || /[/\\]/.test(name)) {
    throw new CliError(`invalid project name: ${JSON.stringify(name)}`);
  }
  const dir = join(workspaceRoot, "projects", name);
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    // missing
  }
  if (!isDir) throw new CliError(`no project dir: projects/${name}`);
  return dir;
}

type Outcome = { code: 0 | 1 | 2; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Outcome => ({ code: 0, body });

async function readConfig(workspaceRoot: string): Promise<WikiConfig> {
  // A workspace other than the one this panel lives in has its own preferences document.
  if (resolve(workspaceRoot) !== DEFAULT_WORKSPACE_ROOT) {
    return readWikiConfig(join(workspaceRoot, ".pavilio", "preferences.json"));
  }
  return loadWikiConfig();
}

async function dispatch(command: string, args: string[], deps: CliDeps, workspaceRoot: string): Promise<Outcome> {
  const parsed = parseArgs(args);
  const flag = (name: string) => parsed.flags.get(name);
  switch (command) {
    case "project": {
      only(parsed, 0, "no positional arguments", ["name", "cwd"]);
      const cwd = flag("cwd");
      const result = await resolveProject({
        workspaceRoot,
        name: flag("name"),
        cwd: cwd === undefined ? deps.cwd : resolve(deps.cwd, cwd),
        env: deps.env,
        fetch: deps.fetch ?? (globalThis.fetch as FetchLike),
      });
      if (result.ok) return ok({ project: result.project, via: result.via });
      return { code: 2, body: { ask: true, reason: result.reason } };
    }
    case "pending": {
      const [p] = only(parsed, 1, "pending <p> [--only <path>]", ["only"]);
      const dir = projectDir(workspaceRoot, p);
      const onlyPath = flag("only");
      return ok({ pending: pendingRecords(dir, onlyPath === undefined ? {} : { only: onlyPath }) });
    }
    case "record": {
      const [p, path, hash] = only(parsed, 3, "record <p> <path> <hash>");
      recordIngested(projectDir(workspaceRoot, p), path, hash);
      return ok({ ok: true });
    }
    case "lock": {
      const [action, p] = only(parsed, 2, "lock take|release <p> --session <id>", ["session"]);
      const session = flag("session");
      if (!session) throw new CliError("lock needs --session <id>");
      const dir = projectDir(workspaceRoot, p);
      if (action === "take") return ok({ ...takeLock(dir, session) });
      if (action === "release") {
        const { released } = releaseLock(dir, session);
        return ok({ held: false, takenOver: false, released });
      }
      throw new CliError(`unknown lock action: ${action}`);
    }
    case "mentions": {
      const [p] = only(parsed, 1, "mentions <p> [--touched a,b]", ["touched"]);
      const dir = projectDir(workspaceRoot, p);
      const raw = flag("touched");
      const touched = raw === undefined ? undefined : raw.split(",").map((s) => s.trim()).filter(Boolean);
      for (const slug of touched ?? []) {
        if (!/^(entities|concepts)\/./.test(slug)) {
          deps.stderr.write(`wiki: --touched "${slug}" is not namespaced (entities/<slug> or concepts/<slug>)\n`);
        }
      }
      return ok({ ...countMentions(dir, { touched }) });
    }
    case "index": {
      const [p] = only(parsed, 1, "index <p>");
      const result = buildIndex(join(projectDir(workspaceRoot, p), "wiki"));
      if (result.ok) return ok({ written: result.written });
      return { code: 1, body: { error: result.error, page: result.page } };
    }
    case "lint": {
      const [p] = only(parsed, 1, "lint <p>");
      projectDir(workspaceRoot, p);
      return ok({ ...lintWiki(workspaceRoot, p) });
    }
    case "config": {
      only(parsed, 0, "no arguments");
      return ok({ ...(await readConfig(workspaceRoot)) });
    }
    case "fetch-article": {
      const [p, url] = only(parsed, 2, "fetch-article <p> <url>");
      const options = deps.fetch ? { fetch: deps.fetch as typeof fetch } : {};
      return ok({ ...(await fetchArticle(projectDir(workspaceRoot, p), url, options)) });
    }
    case "clone-repo": {
      const [p, url] = only(parsed, 2, "clone-repo <p> <url>");
      return ok({ ...(await cloneRepo(projectDir(workspaceRoot, p), url)) });
    }
    default:
      throw new UnknownCommand(command);
  }
}

/** Run one CLI invocation; returns the exit code. Never throws. */
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  const print = (body: Record<string, unknown>) => deps.stdout.write(JSON.stringify(body) + "\n");
  const [command, ...args] = argv;
  if (command === "help" || command === "--help" || command === "-h") {
    deps.stderr.write(USAGE);
    print({ usage: USAGE });
    return 0;
  }
  const workspaceRoot = resolve(deps.workspaceRoot ?? (deps.env.PAVILIO_WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT));
  try {
    if (command === undefined) throw new UnknownCommand("");
    const outcome = await dispatch(command, args, deps, workspaceRoot);
    print(outcome.body);
    return outcome.code;
  } catch (err) {
    if (err instanceof UnknownCommand) {
      print({ error: command === undefined ? "missing command" : `unknown command: ${command}` });
      deps.stderr.write(USAGE);
      return 1;
    }
    print({ error: (err as Error)?.message ?? String(err) });
    if (err instanceof CliError) deps.stderr.write(USAGE);
    return 1;
  }
}

/** True when this module is the process entry (`tsx cli.ts …`), not an import. */
function isEntry(): boolean {
  const entry = process.argv[1];
  if (!entry || !existsSync(entry)) return false;
  return pathToFileURL(realpathSync(entry)).href === pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
}

if (isEntry()) {
  void main(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
  }).then((code) => {
    process.exitCode = code;
  });
}
