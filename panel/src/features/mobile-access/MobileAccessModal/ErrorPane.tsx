export function ErrorPane({
  error,
  hint,
}: {
  error: string;
  hint?: "https_not_enabled";
}) {
  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm opacity-80">{error}</p>
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
    </div>
  );
}
