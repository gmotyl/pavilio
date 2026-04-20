export function NotLoggedInPane({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-semibold">Sign in to Tailscale</h2>
      <p className="text-sm">Tailscale is installed but not signed in. Run in a terminal:</p>
      <pre className="p-2 rounded bg-black/40 text-sm">
        <code>tailscale up</code>
      </pre>
      <button
        className="px-3 py-1 rounded border text-sm"
        onClick={onRefresh}
      >
        I've signed in — recheck
      </button>
    </div>
  );
}
