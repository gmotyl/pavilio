export function PairingGate({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 text-center">
      <div className="max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">This device isn't paired</h1>
        <p className="opacity-80">
          Scan a fresh QR from the Mobile access button on your Mac. The pairing token rotates on
          every Enable/Disable, so an old QR won't work.
        </p>
        <button
          className="px-3 py-1 rounded border"
          onClick={onRetry}
        >
          I scanned — try again
        </button>
      </div>
    </div>
  );
}
