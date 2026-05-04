import { networkInterfaces, type NetworkInterfaceInfo } from "os";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";

interface InterfaceCandidate {
  ifaceName: string;
  address: string;
}

type GetInterfaces = () => NodeJS.Dict<NetworkInterfaceInfo[]>;

// Interface name patterns preferred for default-route selection, in order.
// macOS: en0 (Wi-Fi/Ethernet), en1. Linux: eth0, wlan0, ens*, eno*, enp*.
const IFACE_PRIORITY: RegExp[] = [
  /^en0$/,
  /^eth0$/,
  /^wlan0$/,
  /^wlp\d+/,
  /^eno\d+/,
  /^ens\d+/,
  /^enp\d+/,
  /^en\d+$/,
  /^eth\d+$/,
  /^wlan\d+$/,
];

export function detectLanIp(
  getIfaces: GetInterfaces = networkInterfaces,
  getWslHostIp: () => string | null = getWindowsHostLanIp,
  wslCheck: () => boolean = isWsl,
): string | null {
  // Explicit user override wins.
  const fromEnv = process.env.PANEL_LAN_IP;
  if (fromEnv && /^\d+\.\d+\.\d+\.\d+$/.test(fromEnv)) return fromEnv;

  // On WSL2, os.networkInterfaces() only reports the WSL VM's NAT'd
  // interfaces (typically 172.x), which aren't reachable from LAN peers.
  // Ask the Windows host for its real LAN IP.
  if (wslCheck()) {
    const fromWsl = getWslHostIp();
    if (fromWsl) return fromWsl;
  }

  const candidates = collectCandidates(getIfaces);
  if (candidates.length === 0) return null;

  for (const pattern of IFACE_PRIORITY) {
    const match = candidates.find((c) => pattern.test(c.ifaceName));
    if (match) return match.address;
  }
  return candidates[0].address;
}

function collectCandidates(getIfaces: GetInterfaces): InterfaceCandidate[] {
  const out: InterfaceCandidate[] = [];
  const ifaces = getIfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4") continue;
      if (addr.internal) continue;
      if (!isUsableLanIp(addr.address)) continue;
      out.push({ ifaceName: name, address: addr.address });
    }
  }
  return out;
}

function isUsableLanIp(ip: string): boolean {
  // Skip link-local (169.254/16)
  if (ip.startsWith("169.254.")) return false;
  // Skip Tailscale CGNAT range 100.64.0.0/10
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 100 && b >= 64 && b <= 127) return false;
  // Keep RFC1918
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

let wslCached: boolean | null = null;
export function isWsl(): boolean {
  if (wslCached !== null) return wslCached;
  try {
    const release = readFileSync("/proc/sys/kernel/osrelease", "utf8");
    wslCached = /microsoft|WSL/i.test(release);
  } catch {
    wslCached = false;
  }
  return wslCached;
}

// Best-effort WSL VM's own eth0 IP (the `connectaddress` the Windows host
// needs for a netsh portproxy to forward LAN → WSL).
export function getWslVmIp(
  getIfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces,
): string | null {
  if (!isWsl()) return null;
  const ifaces = getIfaces();
  for (const name of ["eth0", "eth1"]) {
    const addrs = ifaces[name];
    if (!addrs) continue;
    const v4 = addrs.find(
      (a) => a.family === "IPv4" && !a.internal && a.address,
    );
    if (v4) return v4.address;
  }
  return null;
}

// The WSL VM's default gateway, which is the Windows host's WSL-side IP.
// Connections from a Windows-side browser arrive at the panel from this
// address (after wslrelay or netsh portproxy translates Windows-localhost
// traffic into the WSL VM), so for "host-only" management gates we treat
// it as equivalent to loopback.
let wslGatewayCache: string | null | undefined;
export function getWslHostGatewayIp(
  read: () => string = () => readFileSync("/proc/net/route", "utf8"),
  wslCheck: () => boolean = isWsl,
): string | null {
  if (!wslCheck()) return null;
  if (wslGatewayCache !== undefined) return wslGatewayCache;
  try {
    // /proc/net/route columns: Iface Destination Gateway Flags ...
    // The default route has Destination=00000000. Gateway is little-endian hex.
    const lines = read().split(/\r?\n/);
    for (const line of lines.slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 3) continue;
      if (cols[1] !== "00000000") continue;
      const hex = cols[2];
      if (!/^[0-9A-Fa-f]{8}$/.test(hex)) continue;
      const b1 = parseInt(hex.slice(6, 8), 16);
      const b2 = parseInt(hex.slice(4, 6), 16);
      const b3 = parseInt(hex.slice(2, 4), 16);
      const b4 = parseInt(hex.slice(0, 2), 16);
      wslGatewayCache = `${b1}.${b2}.${b3}.${b4}`;
      return wslGatewayCache;
    }
  } catch {
    // fall through to null
  }
  wslGatewayCache = null;
  return wslGatewayCache;
}

export function resetWslGatewayCacheForTests(): void {
  wslGatewayCache = undefined;
}

// Cache the PowerShell lookup — it takes up to a few hundred ms and /status
// polls every 2 seconds while the modal is open.
let wslHostCache: { ip: string | null; at: number } | null = null;
const WSL_HOST_CACHE_MS = 30_000;

export function resetWslHostCacheForTests(): void {
  wslHostCache = null;
  wslCached = null;
}

// Asks the Windows host (via powershell.exe on the WSL PATH) for the IPv4
// address of the connected adapter that has a working default gateway and
// falls in an RFC1918 range. Filters out Tailscale (100.64/10), link-local,
// and virtual adapters by selecting only interfaces with IPv4DefaultGateway.
function getWindowsHostLanIp(): string | null {
  const now = Date.now();
  if (wslHostCache && now - wslHostCache.at < WSL_HOST_CACHE_MS) {
    return wslHostCache.ip;
  }
  const ip = runPowerShellLookup();
  wslHostCache = { ip, at: now };
  return ip;
}

function runPowerShellLookup(): string | null {
  const script =
    "(Get-NetIPConfiguration " +
    "| Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } " +
    "| Select-Object -ExpandProperty IPv4Address " +
    "| Where-Object { $_.IPAddress -match '^(192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.)' } " +
    "| Select-Object -First 1).IPAddress";
  try {
    // Use execFileSync (array args) so bash doesn't eat the `$_` references
    // inside the PowerShell script when this is invoked from a shell-spawned
    // Node process.
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return /^\d+\.\d+\.\d+\.\d+$/.test(out) ? out : null;
  } catch {
    return null;
  }
}
