import { isWsl } from "./lan.js";

// The host the panel process itself runs on. `wsl` is a Linux distro inside
// WSL — a distinct platform for setup guidance, since its daemons, browser,
// and package manager behave differently from a plain Linux host.
export type HostPlatform = "darwin" | "linux" | "wsl" | "win32";

export function detectHostPlatform(
  platform: NodeJS.Platform = process.platform,
  wslCheck: () => boolean = isWsl,
): HostPlatform {
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "win32";
  if (platform === "linux") return wslCheck() ? "wsl" : "linux";
  // Anything else (freebsd, sunos, …) gets the generic Linux guidance —
  // the same shell installer applies.
  return "linux";
}
