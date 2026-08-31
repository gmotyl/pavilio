import { useEffect, useState } from "react";
import { ChevronDown, LayoutGrid } from "lucide-react";
import { getLayoutPresets } from "./columnLayout";

interface Props {
  count: number; // sessions.length — determines which presets to offer
  onApply: (sizes: number[]) => void;
}

// Modeled on ProjectTabsMenu's backdrop-click-to-close pattern
// (panel/src/features/projects/ProjectTabs.tsx): `open` state, a full-screen
// invisible backdrop that closes the menu on click, and an absolutely
// positioned panel anchored to the trigger.
export function LayoutPresetMenu({ count, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const presets = getLayoutPresets(count);
  const disabled = presets.length === 0;

  // Escape closes the menu — the backdrop click alone doesn't cover keyboard use.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative flex items-stretch">
      <button
        type="button"
        data-testid="layout-preset-toggle"
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 text-[11px] transition-colors disabled:opacity-40"
        style={{ color: "var(--text-secondary)" }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "transparent")
        }
        title="Grid layout presets"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <LayoutGrid size={12} />
        <span className="uppercase tracking-widest">Layout</span>
        <ChevronDown size={12} />
      </button>
      {open && !disabled && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div
            data-testid="layout-preset-menu"
            role="menu"
            className="absolute right-0 top-full z-40 mt-1 min-w-[140px] rounded-md py-1 shadow-lg"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {presets.map((preset, i) => (
              <button
                key={preset.label}
                type="button"
                role="menuitem"
                data-testid={`layout-preset-option-${i}`}
                onClick={() => {
                  onApply(preset.sizes);
                  setOpen(false);
                }}
                className="flex items-center w-full text-left px-3 py-1.5 text-[12px] transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--bg-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                {preset.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default LayoutPresetMenu;
