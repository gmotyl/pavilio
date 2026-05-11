import { useEffect, useSyncExternalStore } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { subscribeToast, getToastSnapshot, dismissToast, type ToastMessage } from "../lib/toast";

const TOAST_VISIBLE_MS = 3500;

const palette = {
  success: { fg: "var(--green)", icon: CheckCircle2 },
  error: { fg: "var(--red)", icon: AlertCircle },
  info: { fg: "var(--text-secondary)", icon: Info },
};

export default function ToastHost() {
  const toast = useSyncExternalStore<ToastMessage | null>(subscribeToast, getToastSnapshot, getToastSnapshot);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, TOAST_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  const { fg, icon: Icon } = palette[toast.kind];

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast"
      className="fixed bottom-4 right-4 z-50 max-w-md flex items-start gap-2 rounded-lg shadow-lg px-3 py-2 text-sm animate-in fade-in"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        color: "var(--text-primary)",
      }}
    >
      <Icon size={16} style={{ color: fg, flexShrink: 0, marginTop: 2 }} />
      <span className="flex-1 break-words">{toast.text}</span>
      <button
        onClick={dismissToast}
        aria-label="Dismiss"
        className="ml-2 p-1 rounded transition-colors"
        style={{ color: "var(--text-muted)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
