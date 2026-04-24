import { useMobileAccessStatus } from "../../mobile-access/useMobileAccessStatus";
import { LanAccessPane } from "./LanAccessPane";

export function LanAccessModal({ onClose }: { onClose: () => void }) {
  const { status, enableLan, disableLan, rotate } = useMobileAccessStatus(true);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 backdrop-blur-sm"
      style={{ background: "rgba(10, 10, 12, 0.72)" }}
      onClick={onClose}
    >
      <div
        className="relative rounded-2xl w-[26rem] max-w-[92vw] max-h-[86vh] overflow-hidden"
        style={{
          background: "var(--bg-elevated)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-default)",
          boxShadow:
            "0 24px 60px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.02)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2 left-2 text-[10px] w-5 h-5 rounded-full flex items-center justify-center transition-colors"
          style={{
            color: "var(--text-tertiary)",
            background: "transparent",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-primary)";
            e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-tertiary)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          ✕
        </button>

        <div className="overflow-auto max-h-[86vh]">
          {!status && (
            <div
              className="p-8 text-sm"
              style={{ color: "var(--text-tertiary)" }}
            >
              Loading…
            </div>
          )}
          {status && (
            <LanAccessPane
              lan={status.lan}
              host={status.host}
              onEnable={enableLan}
              onDisable={disableLan}
              onRegenerate={rotate}
            />
          )}
        </div>
      </div>
    </div>
  );
}
