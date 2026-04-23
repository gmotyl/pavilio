import { useEffect, useState } from "react";
import { Smartphone, RotateCw } from "lucide-react";
import { renderQrSvg } from "../qr";
import type { MobileAccessState } from "../useMobileAccessStatus";
import { Toggle } from "./Toggle";

type OnState = Extract<MobileAccessState, { state: "on" }>;
type OffState = Extract<MobileAccessState, { state: "off" }>;

export function AccessPane({
  status,
  onEnable,
  onDisable,
  onRegenerate,
}: {
  status: OnState | OffState;
  onEnable: () => void;
  onDisable: () => void;
  onRegenerate: () => void;
}) {
  const isOn = status.state === "on";
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    if (!isOn) {
      setSvg("");
      return;
    }
    let alive = true;
    renderQrSvg(status.qrUrl).then((out) => {
      if (alive) setSvg(out);
    });
    return () => {
      alive = false;
    };
  }, [isOn, isOn && status.qrUrl]);

  return (
    <div className="p-6 pt-7">
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            color: isOn ? "var(--accent)" : "var(--text-tertiary)",
          }}
        >
          <Smartphone size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[11px] uppercase tracking-[0.18em] mb-0.5"
            style={{ color: "var(--text-tertiary)" }}
          >
            Mobile access
          </div>
          <div
            className="text-base font-medium leading-tight"
            style={{ color: "var(--text-primary)" }}
          >
            {isOn ? "Paired and reachable" : "Not active"}
          </div>
        </div>
        <Toggle
          on={isOn}
          onChange={(next) => (next ? onEnable() : onDisable())}
          label="Mobile access"
          size="md"
        />
      </div>

      {/* QR stage */}
      <div
        className="rounded-xl p-4 flex flex-col items-center"
        style={{
          background: "var(--bg-base)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="relative rounded-lg overflow-hidden"
          style={{
            width: 208,
            height: 208,
            background: isOn ? "#ffffff" : "var(--bg-surface)",
            border: isOn
              ? "1px solid var(--border-default)"
              : "1px dashed var(--border-default)",
            transition: "background 200ms, border 200ms",
          }}
        >
          {isOn && svg ? (
            <div
              className="w-full h-full p-2.5"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-xs text-center px-6"
              style={{ color: "var(--text-tertiary)" }}
            >
              {isOn ? "Generating QR…" : "Toggle on to pair your phone"}
            </div>
          )}
        </div>

        {isOn ? (
          <>
            <div
              className="mt-3 text-[11px] font-mono select-all text-center break-all w-full px-2"
              style={{ color: "var(--text-secondary)" }}
            >
              {status.url}
            </div>
            <button
              onClick={onRegenerate}
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md transition-colors"
              style={{
                color: "var(--text-secondary)",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-surface)";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <RotateCw size={12} />
              Rotate pairing token
            </button>
          </>
        ) : (
          <div
            className="mt-3 text-[11px] text-center px-2"
            style={{ color: "var(--text-muted)" }}
          >
            Enabling runs{" "}
            <code
              className="px-1 py-0.5 rounded"
              style={{
                background: "var(--bg-surface)",
                color: "var(--text-secondary)",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              tailscale serve
            </code>
            . Your pairing token stays the same — rotate it only when you
            want to invalidate paired devices.
          </div>
        )}
      </div>

      {/* Instructions */}
      <ol
        className="mt-5 space-y-1.5 text-[12px] leading-relaxed pl-0"
        style={{
          color: isOn ? "var(--text-secondary)" : "var(--text-muted)",
          counterReset: "step",
        }}
      >
        {[
          "Install Tailscale on your phone and sign in with the same account.",
          "Allow the VPN profile when prompted.",
          "Scan the QR above — the panel opens, paired.",
        ].map((t, i) => (
          <li
            key={i}
            className="flex gap-2.5 items-start"
            style={{ counterIncrement: "step" }}
          >
            <span
              className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-semibold mt-[1px]"
              style={{
                background: "var(--bg-surface)",
                color: "var(--text-tertiary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {i + 1}
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
