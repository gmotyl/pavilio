import { Maximize, Minimize } from "lucide-react";

interface WideToggleProps {
  wide: boolean;
  onToggle: () => void;
}

export default function WideToggle({ wide, onToggle }: WideToggleProps) {
  return (
    <button
      onClick={onToggle}
      data-testid="wide-toggle"
      className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg shadow-lg backdrop-blur-sm transition-all duration-150 hover:scale-110"
      style={{
        background: "color-mix(in srgb, var(--bg-surface) 80%, transparent)",
        border: "1px solid var(--border-subtle)",
        color: "var(--text-muted)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "var(--text-muted)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
      title={wide ? "Compact view" : "Wide view"}
    >
      {wide ? <Minimize size={15} /> : <Maximize size={15} />}
    </button>
  );
}
