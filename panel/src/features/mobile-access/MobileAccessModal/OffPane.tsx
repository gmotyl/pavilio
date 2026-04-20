export function OffPane({ onEnable }: { onEnable: () => void }) {
  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-semibold">Mobile access is off</h2>
      <p className="text-sm">
        Enabling will run <code>tailscale serve</code> and show a QR code to pair your phone.
        The pairing token rotates every Enable.
      </p>
      <button
        className="px-4 py-2 rounded bg-accent text-black font-medium"
        onClick={onEnable}
      >
        Enable mobile access
      </button>
    </div>
  );
}
