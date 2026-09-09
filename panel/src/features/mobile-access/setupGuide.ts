// Single home for the published setup-guide links, so the panes never hardcode the URL.
export const SETUP_GUIDE_URL =
  "https://github.com/gmotyl/pavilio/blob/main/docs/mobile-access-tailscale.md";
export const SETUP_GUIDE_WSL_URL = `${SETUP_GUIDE_URL}#wsl-setup`;

// Mirrors server/lib/host-platform.ts — WSL is its own platform because the guidance differs.
export type HostPlatform = "darwin" | "linux" | "wsl" | "win32";
