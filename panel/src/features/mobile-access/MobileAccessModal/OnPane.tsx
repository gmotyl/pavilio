import { useEffect, useState } from "react";
import { renderQrSvg } from "../qr";
import type { MobileAccessState } from "../useMobileAccessStatus";

type OnState = Extract<MobileAccessState, { state: "on" }>;

export function OnPane({
  status,
  onDisable,
  onRegenerate,
}: {
  status: OnState;
  onDisable: () => void;
  onRegenerate: () => void;
}) {
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let alive = true;
    renderQrSvg(status.qrUrl).then((out) => {
      if (alive) setSvg(out);
    });
    return () => {
      alive = false;
    };
  }, [status.qrUrl]);

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">Mobile access is on</h2>
      <div
        className="w-64 h-64 bg-white p-2 rounded"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="text-sm select-all font-mono break-all">{status.url}</p>
      <ol className="text-sm list-decimal pl-5 space-y-1 opacity-90">
        <li>Install Tailscale on your phone (App Store / Play Store).</li>
        <li>Sign in with the same account as this Mac.</li>
        <li>Allow the VPN profile when prompted.</li>
        <li>Scan the QR above. The token rotates on next Disable or Regenerate.</li>
      </ol>
      <div className="flex gap-2">
        <button
          className="px-3 py-1 rounded border text-sm"
          onClick={onRegenerate}
        >
          Regenerate QR
        </button>
        <button
          className="px-3 py-1 rounded bg-red-600/80 text-white text-sm"
          onClick={onDisable}
        >
          Disable mobile access
        </button>
      </div>
    </div>
  );
}
