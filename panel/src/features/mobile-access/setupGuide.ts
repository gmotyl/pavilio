// Single home for the published setup-guide links, so the panes never hardcode the URL.
export const SETUP_GUIDE_URL =
  "https://github.com/gmotyl/pavilio/blob/main/docs/mobile-access-tailscale.md";
export const SETUP_GUIDE_WSL_URL = `${SETUP_GUIDE_URL}#wsl-setup`;
// Windows Tailscale has no `serve --https`, so a Windows host is pointed at the
// guide's "Windows hosts" section rather than at an install command.
export const SETUP_GUIDE_WINDOWS_URL = `${SETUP_GUIDE_URL}#windows-hosts`;

// Mirrors server/lib/host-platform.ts — WSL is its own platform because the guidance differs.
export type HostPlatform = "darwin" | "linux" | "wsl" | "win32";
