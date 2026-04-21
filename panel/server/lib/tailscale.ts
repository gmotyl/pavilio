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
  | { state: "error"; error: string; hint?: "https_not_enabled" };

const CANDIDATE_PATHS = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
];

let cachedBinary: string | null | undefined;

export const __testing = {
  resetBinaryCache: () => {
    cachedBinary = undefined;
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
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) {
      cachedBinary = p;
      return p;
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
  // Do NOT cache "not found" — user may install Tailscale while the server is running.
  return null;
}

function stripTrailingDot(host: string): string {
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

export async function detectTailscale(port: number): Promise<TailscaleState> {
  const bin = await resolveBinary();
  if (!bin) return { state: "not_installed" };

  let statusJson: any;
  try {
    const { stdout } = await run(bin, ["status", "--json"]);
    statusJson = JSON.parse(stdout);
  } catch (e) {
    return { state: "error", error: `tailscale status failed: ${(e as Error).message}` };
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
  return detectTailscale(port);
}
