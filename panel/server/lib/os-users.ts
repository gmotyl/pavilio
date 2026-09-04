import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Discovers the host's real (human) login accounts once at process startup,
 * from `/etc/passwd`, and caches the result for the server's lifetime — a
 * new account requires a panel restart to appear, matching how `/etc/passwd`
 * itself only changes on `useradd`. Never re-read per request.
 */

export interface OsUser {
  username: string;
  homeDir: string;
  shell: string;
}

const NON_LOGIN_SHELLS = new Set([
  "/usr/sbin/nologin",
  "/sbin/nologin",
  "/bin/false",
  "/usr/bin/false",
]);

/** Parses /etc/passwd-format text. Exported so tests don't need a real /etc/passwd. */
export function parsePasswd(content: string): OsUser[] {
  const users: OsUser[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const fields = line.split(":");
    if (fields.length < 7) continue;

    const [username, , uidField, , , homeDir, shell] = fields;
    const uid = Number(uidField);
    if (!Number.isFinite(uid)) continue;
    // uid 0 (root) is the one exception below the 1000 floor: it's the
    // panel-owner account on most setups, and offering it lets
    // terminal-manager.ts's owner-equality check match a real discovered
    // user instead of silently falling back to "unknown runAsUser". Every
    // other system account (daemon, sync, www-data, ...) stays excluded.
    if (uid !== 0 && uid < 1000) continue;
    if (NON_LOGIN_SHELLS.has(shell)) continue;

    users.push({ username, homeDir, shell });
  }
  return users;
}

let cache: OsUser[] | undefined;

/** uid >= 1000 (plus root), shell not in {/usr/sbin/nologin, /sbin/nologin, /bin/false, /usr/bin/false}. */
export function listOsUsers(): OsUser[] {
  if (cache !== undefined) return cache;
  try {
    cache = parsePasswd(readFileSync("/etc/passwd", "utf8"));
  } catch {
    cache = [];
  }
  return cache;
}

export function hostSpawnKind(): "wsl" | "posix" {
  return process.env.WSL_DISTRO_NAME ? "wsl" : "posix";
}

/**
 * Whether `homeDir` reaches the shared multi-account tree via its own
 * `~/git` — a symlink to the bind mount, per `workspace-setup`'s own account
 * provisioning (ADR 0001). A missing link means a `runAsUser` session's
 * `translateCwd`-rewritten path won't exist under that account no matter how
 * the owner-side path was constructed — true for a pre-existing account
 * whose `~/git` is its own unrelated directory, never set up with the
 * shared tree.
 */
export function hasGitBindMount(homeDir: string): boolean {
  return existsSync(join(homeDir, "git"));
}

/** Test-only: clears the module-level cache. Never called from production code. */
export function _resetOsUsersCacheForTests(): void {
  cache = undefined;
}
