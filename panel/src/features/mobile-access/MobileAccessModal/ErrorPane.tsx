import {
  SETUP_GUIDE_URL,
  SETUP_GUIDE_WSL_URL,
  type HostPlatform,
} from "../setupGuide";

export function ErrorPane({
  error,
  hint,
  platform,
}: {
  error: string;
  hint?: "https_not_enabled" | "daemon_down";
  platform: HostPlatform;
}) {
  // The guide has a WSL section; every other host belongs at the guide root.
  const guideUrl = platform === "wsl" ? SETUP_GUIDE_WSL_URL : SETUP_GUIDE_URL;

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-semibold">
        {hint === "daemon_down"
          ? "tailscaled isn't running"
          : "Something went wrong"}
      </h2>
      <p className="text-sm opacity-80">{error}</p>
      {hint === "daemon_down" && (
        // ADR 0009: the panel links the documentation and never starts, supervises
        // or repairs the daemon — so the start command lives in the guide only.
        <p className="text-sm">
          Follow the start step in the{" "}
          <a
            className="underline"
            href={guideUrl}
            target="_blank"
            rel="noreferrer"
          >
            setup guide
          </a>{" "}
          for this host.
        </p>
      )}
      {hint === "https_not_enabled" && (
        <p className="text-sm">
          HTTPS certificates must be enabled for your tailnet.{" "}
          <a
            className="underline"
            href="https://login.tailscale.com/admin/dns"
            target="_blank"
            rel="noreferrer"
          >
            Open tailnet admin
          </a>
          , find the HTTPS Certificates toggle, enable it, then try again.
        </p>
      )}
      {hint === "https_not_enabled" && (
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
      )}
      {!hint && (
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
      )}
    </div>
  );
}
