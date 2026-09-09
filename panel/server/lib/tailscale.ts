// Use node: protocol imports so vitest vi.mock("node:child_process") intercepts them.
// The callback-based wrappers below avoid promisify (which captures the reference at
// module-load time) so the mocked execFile is always used at call time.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

export type TailscaleState =
  | { state: "not_installed" }
  | { state: "not_logged_in" }
  | { state: "off"; selfHost: string }
  | { state: "on"; selfHost: string; url: string }
  | { state: "error"; error: string; hint?: "https_not_enabled" | "daemon_down" };

// macOS-only install locations: the GUI app bundle, Homebrew on Apple silicon,
// Homebrew on Intel. The Mac app never registers a PATH entry, which is why we
// probe at all — on Linux and WSL the package installs into PATH, so probing
// these three is three guaranteed-ENOENT syscalls on every status poll.
const DARWIN_CANDIDATE_PATHS = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
];

let cachedBinary: string | null | undefined;

// The modal polls status every 2000 ms; a window just wider than that collapses
// each poll cycle to at most one CLI pair while still being short enough that
// anything the user changes out-of-band (installing the CLI, starting the
// daemon) shows up on the next poll. Explicit rechecks pass `fresh: true`.
const SNAPSHOT_TTL_MS = 2500;

let snapshot: { port: number; at: number; state: TailscaleState } | null = null;

export function invalidateTailscaleCache(): void {
  snapshot = null;
}

export const __testing = {
  resetBinaryCache: () => {
    cachedBinary = undefined;
  },
  resetSnapshotCache: () => {
    invalidateTailscaleCache();
  },
};

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) {
        (err as any).stderr = stderr as string;
        reject(err);
      } else resolve({ stdout: stdout as string, stderr: stderr as string });
    });
  });
}

async function resolveBinary(): Promise<string | null> {
  if (cachedBinary) return cachedBinary;
  // Read the platform at call time, not at module load, so the cached binary
  // and the probe strategy cannot disagree about which host we are on.
  if (process.platform === "darwin") {
    for (const p of DARWIN_CANDIDATE_PATHS) {
      if (existsSync(p)) {
        cachedBinary = p;
        return p;
      }
    }
  }
  try {
    const { stdout } = await run("which", ["tailscale"]);
    const p = stdout.trim();
    if (p) {
      cachedBinary = p;
      return p;
    }
  } catch {
    // which returns non-zero → not found
  }
  // Do NOT cache "not found" here — the user may install Tailscale while the
  // server is running. `detectTailscale` holds the resulting `not_installed`
  // only for the snapshot TTL, so the next poll probes for the binary again.
  return null;
}

function stripTrailingDot(host: string): string {
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

export async function detectTailscale(
  port: number,
  opts?: { fresh?: boolean },
): Promise<TailscaleState> {
  // Keyed by port: the same host can serve a different panel port, and a
  // snapshot taken for one says nothing about the serve config of another.
  if (
    !opts?.fresh &&
    snapshot &&
    snapshot.port === port &&
    Date.now() - snapshot.at < SNAPSHOT_TTL_MS
  ) {
    return snapshot.state;
  }
  const state = await probeTailscale(port);
  snapshot = { port, at: Date.now(), state };
  return state;
}

async function probeTailscale(port: number): Promise<TailscaleState> {
  const bin = await resolveBinary();
  if (!bin) return { state: "not_installed" };

  let statusJson: any;
  try {
    const { stdout } = await run(bin, ["status", "--json"]);
    statusJson = JSON.parse(stdout);
  } catch (e: any) {
    const msg = (e as Error).message ?? "";
    const stderr = e?.stderr ?? "";
    const combined = `${msg} ${stderr}`.toLowerCase();
    // Log every status failure, the way `enableServe` logs every enable
    // failure. The CLI's own words are the only diagnostic either path has,
    // and an unhinted failure is precisely the one nobody can guess at later.
    console.error("[tailscale] status failed", { msg, stderr });
    // The CLI is installed but its daemon is not answering — common on a WSL
    // distro, where nothing starts tailscaled at boot. Matched narrowly on the
    // CLI's own two connect-failure phrasings for the same reason `enableServe`
    // keeps its `https_not_enabled` match narrow: a broad pattern would relabel
    // unrelated failures and send the user chasing the wrong fix.
    if (
      combined.includes("failed to connect to local tailscaled") ||
      combined.includes("is tailscaled running")
    ) {
      // Keep the CLI's own words. The same connect-failure wording appears when
      // the daemon IS up but its socket is not readable by this user (the
      // `tailscale set --operator=$USER` case, entirely plausible in a WSL
      // distro), where "start it" is the wrong advice — the detail and the log
      // are what let anyone tell the two apart afterwards.
      const detail = stderr.trim() || msg;
      return {
        state: "error",
        error: `tailscaled is not running on this host. Start it, then try again. (${detail})`,
        hint: "daemon_down",
      };
    }
    return { state: "error", error: `tailscale status failed: ${msg}` };
  }

  if (statusJson?.BackendState === "NeedsLogin" || statusJson?.BackendState === "Stopped") {
    return { state: "not_logged_in" };
  }
  if (statusJson?.BackendState !== "Running") {
    return { state: "error", error: `unexpected backend state: ${statusJson?.BackendState}` };
  }

  const selfHost = stripTrailingDot(statusJson?.Self?.DNSName ?? "");
  if (!selfHost) {
    return { state: "error", error: "tailscale status missing Self.DNSName" };
  }

  let serveJson: any;
  try {
    const { stdout } = await run(bin, ["serve", "status", "--json"]);
    serveJson = stdout.trim() ? JSON.parse(stdout) : {};
  } catch {
    serveJson = {};
  }

  const ourProxy = `http://127.0.0.1:${port}`;
  const web = serveJson?.Web ?? {};
  for (const host of Object.keys(web)) {
    const handlers = web[host]?.Handlers ?? {};
    for (const path of Object.keys(handlers)) {
      if (handlers[path]?.Proxy === ourProxy) {
        return { state: "on", selfHost, url: `https://${selfHost}` };
      }
    }
  }

  return { state: "off", selfHost };
}

export async function enableServe(port: number): Promise<TailscaleState> {
  const bin = await resolveBinary();
  if (!bin) return { state: "not_installed" };
  try {
    await run(bin, ["serve", "--bg", "--https=443", `http://127.0.0.1:${port}`]);
  } catch (e: any) {
    const stderr = e?.stderr ?? "";
    const msg = (e as Error).message ?? "";
    const combined = `${msg} ${stderr}`.toLowerCase();
    console.error("[tailscale] enable failed", { msg, stderr });
    // Only map to the `https_not_enabled` hint on the explicit CLI message.
    // Broader patterns (e.g. "feature/query") can catch unrelated transient
    // control-plane errors and mislead the user after they've already
    // enabled HTTPS in the admin.
    if (combined.includes("https is not enabled")) {
      return {
        state: "error",
        error:
          "HTTPS certificates are not enabled for this tailnet. Enable them in the Tailscale admin, then try again.",
        hint: "https_not_enabled",
      };
    }
    const detail = stderr.trim() || msg;
    return { state: "error", error: detail };
  }
  // The serve config just changed, so any snapshot describes the old world.
  invalidateTailscaleCache();
  return detectTailscale(port);
}

export async function disableServe(port: number): Promise<TailscaleState> {
  const bin = await resolveBinary();
  if (!bin) return { state: "not_installed" };
  try {
    await run(bin, ["serve", "reset"]);
  } catch (e) {
    return { state: "error", error: (e as Error).message };
  }
  invalidateTailscaleCache();
  return detectTailscale(port);
}
