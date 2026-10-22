import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { pageBacklog } from "./backlog";
import { cloneRepo } from "./clone-repo";
import { loadWikiConfig, readWikiConfig, type WikiConfig } from "./config";
import { fetchArticle } from "./fetch-article";
import { fetchYoutube, UvMissingError, type Runner } from "./fetch-youtube";
import { addBacklink, clearCandidates, harvestStatus, listCandidates } from "./harvest";
import { buildIndex } from "./index-md";
import { pendingRecords, recordIngested } from "./ledger";
import { lintWiki } from "./lint";
import { releaseLock, takeLock } from "./lock";
import { countMentions } from "./mentions";
import { projectKind } from "../projects/kind";
import { panelLink } from "./panel-link";
import { resolveProject, type FetchLike } from "./project";

/**
 * `scripts/wiki <command>` — the wiki's deterministic half, for skills and agents.
 *
 * Every command prints exactly one JSON object on stdout and exits 0 (ok), 1 (error, `{error}`)
 * or 2 (ask the user, `{ask: true, reason}`). Diagnostics and usage go to stderr only.
 *
 * Paths in receipts: `pending` and `record` paths are project-relative; `index` `written`/`removed`,
 * `fetch-article`/`fetch-youtube` `raw`, `clone-repo` `clonePath` and every page in `mentions`/`lint` are
 * wiki-relative (relative to `projects/<p>/wiki/`), except `lint`'s own `wiki/…` page keys and
 * `backlog`'s source paths, which are project-root `wiki/…` paths ready for a page writer.
 *
 * The workspace root (the dir holding `projects/` and `.projects.local.md`) comes from
 * `PAVILIO_WORKSPACE_ROOT`, defaulting to the dir above `panel/` — in an installed workspace
 * `scripts/` and `panel/` are both synced to the workspace root, so that IS the workspace.
 */

const USAGE = `usage: scripts/wiki <command> [args]

  project [--name <p>] [--cwd <dir>]        {project, via, kind} | exit 2 {ask, reason}
                                            kind: project | research | knowledge
  panel-link <path>                         {link}: panel route (/project/<p>/wiki?file=… or
                                            /view/…) for a projects-relative path, no host
  pending <p> [--only <path>]               {pending: [{path, hash, status}]}
  record <p> <path> <hash>                  {ok: true}
  lock take|release <p> --session <id>      {held, takenOver[, busy]} (release adds released;
                                            busy: guard still busy, nothing decided — retry)
  mentions <p> [--touched a,b]              {slugs, qualifying}; slugs are entities/x, concepts/x
  backlog <p> [--touched a,b]               {create, update, waiting}: what page writers still owe;
                                            create/update map slug → wiki/sources/… paths
  index <p>                                 {written, removed} | exit 1 {error, page}
  lint <p>                                  {broken, orphans, malformed, untyped, stale, codeIdentifiers}
  config                                    {sessionStartIngest, writerModel}
  fetch-article <p> <url>                   {raw, title, warning?}
  fetch-youtube <p> <url>                   {raw, title, track}: transcript via uvx yt-dlp into
                                            raw/youtube-<id>.md | exit 2 {ask, reason} without uv
  clone-repo <p> <url>                      {clonePath, commitSha, action}
  candidates                                {items: [{id, project, text, date, source}]}: the
                                            ## Knowledge candidates of every non-archived wiki
                                            except knowledge; source is wiki/sources/… or null
  clear-candidates --ids <file.json>        {removed}: drop exactly those candidate lines
                                            (file holds a JSON array of ids)
  backlink <p> <source page> <target>       {added}: - [[knowledge:<target>]] under the page's
                                            ## Knowledge (created at the end when absent)
  harvest-status                            {lastRun, daysAgo, waiting}: newest harvest entry in
                                            knowledge/wiki/log.md (null = never), candidates waiting

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
  /** Command runner for `fetch-youtube` (tests inject a fake yt-dlp). */
  run?: Runner;
  /** Clock for `harvest-status` (tests pin "today"). */
  now?: () => Date;
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

/** `--touched a,b` as a slug list (undefined when absent); warns about a slug without a namespace. */
function touchedSlugs(raw: string | undefined, deps: CliDeps): string[] | undefined {
  if (raw === undefined) return undefined;
  const touched = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const slug of touched) {
    if (!/^(entities|concepts)\/./.test(slug)) {
      deps.stderr.write(`wiki: --touched "${slug}" is not namespaced (entities/<slug> or concepts/<slug>)\n`);
    }
  }
  return touched;
}

/** The `--ids` file: a JSON array of candidate ids (or `{ids: [...]}`). */
function readIds(path: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`cannot read ids file ${path}: ${(err as Error).message}`);
  }
  const ids = Array.isArray(data) ? data : (data as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    throw new Error("ids file must hold a JSON array of candidate ids");
  }
  return ids;
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
      if (result.ok) {
        const kind = projectKind(join(workspaceRoot, "projects"), result.project);
        return ok({ project: result.project, via: result.via, kind });
      }
      return { code: 2, body: { ask: true, reason: result.reason } };
    }
    case "panel-link": {
      const [path] = only(parsed, 1, "panel-link <projects-relative path>");
      return ok({ link: panelLink(path) });
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
      return ok({ ...countMentions(projectDir(workspaceRoot, p), { touched: touchedSlugs(flag("touched"), deps) }) });
    }
    case "backlog": {
      const [p] = only(parsed, 1, "backlog <p> [--touched a,b]", ["touched"]);
      return ok({ ...pageBacklog(projectDir(workspaceRoot, p), { touched: touchedSlugs(flag("touched"), deps) }) });
    }
    case "index": {
      const [p] = only(parsed, 1, "index <p>");
      const result = buildIndex(join(projectDir(workspaceRoot, p), "wiki"));
      if (result.ok) return ok({ written: result.written, removed: result.removed });
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
    case "fetch-youtube": {
      const [p, url] = only(parsed, 2, "fetch-youtube <p> <url>");
      const dir = projectDir(workspaceRoot, p);
      try {
        return ok({ ...(await fetchYoutube(dir, url, deps.run ? { run: deps.run } : {})) });
      } catch (err) {
        if (err instanceof UvMissingError) return { code: 2, body: { ask: true, reason: err.message } };
        throw err;
      }
    }
    case "clone-repo": {
      const [p, url] = only(parsed, 2, "clone-repo <p> <url>");
      return ok({ ...(await cloneRepo(projectDir(workspaceRoot, p), url)) });
    }
    case "candidates": {
      only(parsed, 0, "no arguments");
      return ok({ ...listCandidates(workspaceRoot) });
    }
    case "clear-candidates": {
      only(parsed, 0, "clear-candidates --ids <file.json>", ["ids"]);
      const file = flag("ids");
      if (!file) throw new CliError("clear-candidates needs --ids <file.json>");
      return ok({ ...clearCandidates(workspaceRoot, readIds(resolve(deps.cwd, file))) });
    }
    case "backlink": {
      const [p, page, target] = only(parsed, 3, "backlink <p> <source page> <knowledge target>");
      projectDir(workspaceRoot, p);
      return ok({ ...addBacklink(workspaceRoot, p, page, target) });
    }
    case "harvest-status": {
      only(parsed, 0, "no arguments");
      return ok({ ...harvestStatus(workspaceRoot, (deps.now ?? (() => new Date()))()) });
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
