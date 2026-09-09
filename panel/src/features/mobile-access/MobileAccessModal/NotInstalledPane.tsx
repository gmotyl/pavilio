import {
  SETUP_GUIDE_URL,
  SETUP_GUIDE_WINDOWS_URL,
  SETUP_GUIDE_WSL_URL,
  type HostPlatform,
} from "../setupGuide";

// One copy table so the per-platform strings live in a single place. A platform
// with no `command` cannot get there by installing (win32): the pane explains
// the route instead of printing an install line that leads nowhere.
const INSTALL_COPY: Record<
  HostPlatform,
  { heading: string; command?: string }
> = {
  darwin: {
    heading: "Install Tailscale on this Mac",
    command: "brew install --cask tailscale",
  },
  linux: {
    heading: "Install Tailscale on this host",
    command: "curl -fsSL https://tailscale.com/install.sh | sh",
  },
  wsl: {
    heading: "Install Tailscale in this WSL distro",
    command: "curl -fsSL https://tailscale.com/install.sh | sh",
  },
  win32: {
    // Installing the Windows client does not help: it has no `serve --https`,
    // so the modal would only advance to an error state with no way forward.
    heading: "Mobile access needs the panel inside WSL",
  },
};

export function NotInstalledPane({
  platform,
  onRefresh,
}: {
  platform: HostPlatform;
  onRefresh: () => void;
}) {
  const { heading, command } = INSTALL_COPY[platform];
  const isWsl = platform === "wsl";
  const isWindows = platform === "win32";
  const guideUrl = isWsl
    ? SETUP_GUIDE_WSL_URL
    : isWindows
      ? SETUP_GUIDE_WINDOWS_URL
      : SETUP_GUIDE_URL;

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-semibold">{heading}</h2>
      {command ? (
        <>
          <p className="text-sm">Tailscale isn't installed. Run:</p>
          <pre className="p-2 rounded bg-black/40 text-sm">
            <code>{command}</code>
          </pre>
        </>
      ) : (
        <p className="text-sm">
          Windows Tailscale cannot serve HTTPS, so installing it here will not
          enable mobile access. Run the panel inside a WSL distro and install
          Tailscale in that distro instead.
        </p>
      )}
      {isWsl && (
        <p className="text-sm">
          If this distro has no systemd, <code>tailscaled</code> needs a boot
          hook to come back after a restart.
        </p>
      )}
      <p className="text-sm">
        <a
          className="underline"
          href={guideUrl}
          target="_blank"
          rel="noreferrer"
        >
          Setup guide
        </a>
      </p>
      <button
        data-testid="mobile-access-not-installed-refresh"
        className="px-3 py-1 rounded border text-sm"
        onClick={onRefresh}
      >
        I've installed it — recheck
      </button>
    </div>
  );
}
