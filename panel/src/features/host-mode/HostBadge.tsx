import { useHostMode } from "./useHostMode";

// Small pill rendered in the breadcrumb header. Green when the panel
// was opened from the same machine ("local"), yellow when from a
// remote device ("remote"). Hidden on mobile viewports — phones reach
// the panel by QR pairing, so the answer is always "remote" there and
// the pill would be visual noise.
export function HostBadge() {
  const { mode, hostname } = useHostMode();
  const isLocal = mode === "local";

  return (
    <span
      className="hidden md:inline-flex items-center gap-1.5 text-[10.5px] font-mono px-2 py-[2px] rounded-full"
      style={{
        background: isLocal ? "var(--green-dim)" : "var(--yellow-dim)",
        border: `1px solid ${isLocal ? "var(--green)" : "var(--yellow)"}`,
        color: isLocal ? "var(--green)" : "var(--yellow)",
      }}
      title={isLocal ? "Local panel" : "Remote panel"}
      data-testid="host-badge"
      data-host-mode={mode}
    >
      <span
        className="inline-block rounded-full"
        style={{
          width: 6,
          height: 6,
          background: isLocal ? "var(--green)" : "var(--yellow)",
          boxShadow: `0 0 6px ${isLocal ? "var(--green)" : "var(--yellow)"}`,
        }}
      />
      <span>{hostname || (isLocal ? "localhost" : "remote")}</span>
    </span>
  );
}
