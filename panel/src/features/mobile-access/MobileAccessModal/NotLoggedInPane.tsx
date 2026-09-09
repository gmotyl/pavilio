import {
  SETUP_GUIDE_URL,
  SETUP_GUIDE_WSL_URL,
  type HostPlatform,
} from "../setupGuide";

export function NotLoggedInPane({
  platform,
  onRefresh,
}: {
  platform: HostPlatform;
  onRefresh: () => void;
}) {
  const isWsl = platform === "wsl";

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-semibold">Sign in to Tailscale</h2>
      <p className="text-sm">Tailscale is installed but not signed in. Run in a terminal:</p>
      <pre className="p-2 rounded bg-black/40 text-sm">
        <code>{isWsl ? "sudo tailscale up" : "tailscale up"}</code>
      </pre>
      {isWsl && (
        <p className="text-sm">
          It prints an authentication URL — open it in the Windows browser to
          finish signing in.
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
        data-testid="mobile-access-not-logged-in-refresh"
        className="px-3 py-1 rounded border text-sm"
        onClick={onRefresh}
      >
        I've signed in — recheck
      </button>
    </div>
  );
}
