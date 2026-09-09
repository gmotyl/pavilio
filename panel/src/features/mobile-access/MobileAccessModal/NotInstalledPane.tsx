import {
  SETUP_GUIDE_URL,
  SETUP_GUIDE_WSL_URL,
  type HostPlatform,
} from "../setupGuide";

// One copy table so the per-platform strings live in a single place.
const INSTALL_COPY: Record<
  HostPlatform,
  { heading: string; command: string }
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
    heading: "Install Tailscale on Windows",
    command: "winget install tailscale.tailscale",
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

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-semibold">{heading}</h2>
      <p className="text-sm">Tailscale isn't installed. Run:</p>
      <pre className="p-2 rounded bg-black/40 text-sm">
        <code>{command}</code>
      </pre>
      {isWsl && (
        <p className="text-sm">
          This distro has no systemd, so <code>tailscaled</code> needs a boot
          hook to come back after a restart.
        </p>
      )}
      <p className="text-sm">
        <a
          className="underline"
          href={isWsl ? SETUP_GUIDE_WSL_URL : SETUP_GUIDE_URL}
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
