import { join, relative, resolve, sep } from "path";

import { readActiveProjects } from "../registry";

/** Same default the speech hooks use when the panel did not publish its URL. */
const DEFAULT_PANEL_URL = "http://127.0.0.1:3010";
const SESSIONS_TIMEOUT_MS = 2000;

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export type ResolveProjectInput = {
  workspaceRoot: string; // the dir that contains `projects/` and `.projects.local.md`
  name?: string; // explicit `--name`, optionally in `<project>:` form
  cwd: string;
  env: Record<string, string | undefined>;
  fetch: FetchLike;
};

export type ProjectResolution =
  | { ok: true; project: string; via: "arg" | "cwd" | "cell" }
  | { ok: false; ask: true; reason: string }; // the CLI maps this to exit 2 — never a guess

const ask = (reason: string): ProjectResolution => ({ ok: false, ask: true, reason });

/** `projects/<name>/…` → `<name>` when cwd sits inside the workspace's projects dir. */
function projectFromCwd(workspaceRoot: string, cwd: string): string | null {
  const rel = relative(join(resolve(workspaceRoot), "projects"), resolve(cwd));
  if (!rel || rel.startsWith("..") || rel.startsWith(sep)) return null;
  return rel.split(sep)[0] || null;
}

/** The project of the panel cell `terminalId`, or a reason it could not be read. */
async function projectFromCell(
  env: ResolveProjectInput["env"],
  terminalId: string,
  fetch: FetchLike,
): Promise<{ project: string } | { reason: string }> {
  const base = (env.PAVILIO_PANEL_URL || DEFAULT_PANEL_URL).replace(/\/+$/, "");
  let sessions: unknown;
  try {
    const res = await fetch(`${base}/api/terminal/sessions`, {
      signal: AbortSignal.timeout(SESSIONS_TIMEOUT_MS),
    });
    if (!res.ok) return { reason: `sessions api answered ${res.status}` };
    sessions = await res.json();
  } catch (err) {
    return { reason: `sessions api failed: ${(err as Error).message}` };
  }
  if (!Array.isArray(sessions)) return { reason: "sessions api returned no list" };
  const cell = sessions.find((s) => s && typeof s === "object" && s.id === terminalId);
  if (!cell) return { reason: `panel cell ${terminalId} is not listed` };
  if (typeof cell.project !== "string" || !cell.project) {
    return { reason: `panel cell ${terminalId} has no project` };
  }
  return { project: cell.project };
}

/**
 * Resolve the target project: explicit name → cwd under `projects/<name>/` → the panel cell
 * (`PAVILIO_TERMINAL_ID` looked up in `GET <PAVILIO_PANEL_URL>/api/terminal/sessions`). Every
 * candidate must be an active project in `.projects.local.md`. An explicit name that does not
 * match asks rather than falling through, and so does a failed sessions call.
 */
export async function resolveProject(input: ResolveProjectInput): Promise<ProjectResolution> {
  const registered = readActiveProjects(join(input.workspaceRoot, "projects"));
  const isRegistered = (p: string) => registered.includes(p);

  if (input.name !== undefined) {
    const name = input.name.trim().replace(/:$/, "");
    return isRegistered(name)
      ? { ok: true, project: name, via: "arg" }
      : ask(`"${input.name}" is not a registered project`);
  }

  const fromCwd = projectFromCwd(input.workspaceRoot, input.cwd);
  if (fromCwd && isRegistered(fromCwd)) return { ok: true, project: fromCwd, via: "cwd" };

  const terminalId = input.env.PAVILIO_TERMINAL_ID;
  if (!terminalId) return ask("no --name, cwd is not inside a project, and no panel cell");

  const cell = await projectFromCell(input.env, terminalId, input.fetch);
  if ("reason" in cell) return ask(cell.reason);
  return isRegistered(cell.project)
    ? { ok: true, project: cell.project, via: "cell" }
    : ask(`panel cell project "${cell.project}" is not registered`);
}
