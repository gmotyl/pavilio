import { useState } from "react";
import { Smartphone } from "lucide-react";
import { MobileAccessModal } from "./MobileAccessModal";
import { useMobileAccessStatus } from "./useMobileAccessStatus";

export function MobileAccessButton() {
  const [open, setOpen] = useState(false);
  // When the modal is closed we only need a loose "is it on?" signal — poll slowly.
  const { status } = useMobileAccessStatus(!open, 30000);
  const isOn = status?.tailscale.state === "on";

  return (
    <>
      <button
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
        }}
        onClick={() => setOpen(true)}
      >
        <Smartphone size={14} />
        <span>Mobile access</span>
        {isOn && (
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: "#4ade80" }}
            aria-label="on"
          />
        )}
      </button>
      {open && <MobileAccessModal onClose={() => setOpen(false)} />}
    </>
  );
}
