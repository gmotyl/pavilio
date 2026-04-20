export function NotInstalledPane({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-semibold">Install Tailscale on this Mac</h2>
      <p className="text-sm">Tailscale isn't installed. Run:</p>
      <pre className="p-2 rounded bg-black/40 text-sm">
        <code>brew install --cask tailscale</code>
      </pre>
      <button
        className="px-3 py-1 rounded border text-sm"
        onClick={onRefresh}
      >
        I've installed it — recheck
      </button>
    </div>
  );
}
