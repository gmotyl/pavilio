import { existsSync, realpathSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { localISODate } from "../dateLocal";
import { PROJECT_KINDS, type ProjectKind } from "./kind";
import { scaffoldProject } from "./scaffold";
import { ensureSpikeRepo } from "./spikeRepo";
import { loadSpikesRoot } from "./spikesRoot";

/**
 * `scripts/project <command>` — project lifecycle for skills and agents, in the `scripts/wiki`
 * conventions: exactly one JSON object on stdout, exit 0 (ok), 1 (error, `{error}`) or 2 (ask the
 * user, `{ask: true, reason}`). Diagnostics and usage go to stderr only.
 *
 * The workspace root (the dir holding `projects/` and `.projects.local.md`) comes from
 * `PAVILIO_WORKSPACE_ROOT`, defaulting to the dir above `panel/`.
 */

const USAGE = `usage: scripts/project <command> [args]

  new <name> [--kind project|research|knowledge] [--topic "…"]
                                            {created}: project-relative paths written
                                            | exit 2 {ask, reason: exists | archived}
                                            <name>: a slug, [a-z0-9][a-z0-9._-]*; --topic is
                                            required for --kind research
  spike-repo <name>                         {path, repo: created | existing, registered}
                                            creates or reuses the git repo
                                            <research.spikesRoot>/<name> and lists it in
                                            projects/<name>/repos.json; <name> must be a
                                            kind: research project
                                            | exit 2 {ask, reason: occupied, path}

Exit: 0 ok, 1 error {error}, 2 ask the user.
Workspace: $PAVILIO_WORKSPACE_ROOT, default the dir that contains scripts/ and panel/.
`;

type Writable = { write(chunk: string): unknown };

export type CliDeps = {
  stdout: Writable;
  stderr: Writable;
  env: Record<string, string | undefined>;
  /** Overrides `env.PAVILIO_WORKSPACE_ROOT` and the default. */
  workspaceRoot?: string;
  /** Local `YYYY-MM-DD`; injectable for tests. */
  today?: () => string;
  /** What `~` in the spikes root expands to; default the OS home dir. Injectable for tests. */
  home?: string;
};

/** The dir above `panel/`: `panel/server/lib/projects/cli.ts` → four levels up. */
const DEFAULT_WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** A usage mistake: exit 1 with `{error}` and the usage on stderr. */
class CliError extends Error {}

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

type Outcome = { code: 0 | 1 | 2; body: Record<string, unknown> };

function runNew(args: string[], deps: CliDeps, workspaceRoot: string): Outcome {
  const parsed = parseArgs(args);
  if (parsed.positional.length !== 1) throw new CliError("expected new <name>");
  for (const key of parsed.flags.keys()) {
    if (key !== "kind" && key !== "topic") throw new CliError(`unknown flag --${key}`);
  }
  const kind = parsed.flags.get("kind") ?? "project";
  if (!(PROJECT_KINDS as readonly string[]).includes(kind)) {
    throw new CliError(`--kind must be one of ${PROJECT_KINDS.join(", ")}`);
  }
  const topic = parsed.flags.get("topic");
  if (topic !== undefined && kind !== "research") {
    deps.stderr.write("project: --topic is only recorded for --kind research\n");
  }
  const result = scaffoldProject({
    projectsDir: join(workspaceRoot, "projects"),
    name: parsed.positional[0],
    kind: kind as ProjectKind,
    topic,
    today: (deps.today ?? localISODate)(),
  });
  if (!result.ok) return { code: 2, body: { ask: true, reason: result.reason } };
  return { code: 0, body: { created: result.created } };
}

async function runSpikeRepo(args: string[], deps: CliDeps, workspaceRoot: string): Promise<Outcome> {
  const parsed = parseArgs(args);
  if (parsed.positional.length !== 1) throw new CliError("expected spike-repo <name>");
  for (const key of parsed.flags.keys()) throw new CliError(`unknown flag --${key}`);
  const result = ensureSpikeRepo({
    projectsDir: join(workspaceRoot, "projects"),
    project: parsed.positional[0],
    spikesRoot: await loadSpikesRoot(workspaceRoot),
    home: deps.home ?? homedir(),
  });
  if (result.ok) {
    return { code: 0, body: { path: result.path, repo: result.repo, registered: result.registered } };
  }
  if (result.code === 2) return { code: 2, body: { ask: true, reason: result.reason, path: result.path } };
  return { code: 1, body: { error: result.error } };
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
    if (command !== "new" && command !== "spike-repo") {
      print({ error: command === undefined ? "missing command" : `unknown command: ${command}` });
      deps.stderr.write(USAGE);
      return 1;
    }
    const outcome =
      command === "new" ? runNew(args, deps, workspaceRoot) : await runSpikeRepo(args, deps, workspaceRoot);
    print(outcome.body);
    return outcome.code;
  } catch (err) {
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
    env: process.env,
  }).then((code) => {
    process.exitCode = code;
  });
}
