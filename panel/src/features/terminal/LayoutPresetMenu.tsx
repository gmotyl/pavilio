import { useEffect, useState } from "react";
import { ChevronDown, LayoutGrid } from "lucide-react";
import { GRID, getLayoutPresets, type LayoutPreset } from "./tileLayout";

interface Props {
  count: number; // sessions.length — determines which presets to offer
  onApply: (preset: LayoutPreset) => void;
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
                aria-label={preset.label}
                title={preset.label}
                onClick={() => {
                  onApply(preset);
                  setOpen(false);
                }}
                className="flex items-center w-full px-2 py-1.5 transition-colors"
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--bg-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <PresetThumbnail preset={preset} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A miniature of the shape, drawn from the preset's own rectangles — the same data
 * `onApply` commits, so the picture cannot drift from the result. The descriptive
 * text lives on the button's `aria-label`/`title` instead of beside the thumbnail:
 * "Alt 1" told the user nothing, and the shape tells them everything.
 */
function PresetThumbnail({ preset }: { preset: LayoutPreset }) {
  return (
    <span
      aria-hidden
      data-testid={`layout-preset-thumb-${preset.label}`}
      style={{
        position: "relative",
        display: "block",
        width: "32px",
        height: "24px",
        borderRadius: "3px",
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-base)",
      }}
    >
      {preset.slots.map((slot, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${(slot.x / GRID) * 100}%`,
            top: `${(slot.y / GRID) * 100}%`,
            width: `${(slot.w / GRID) * 100}%`,
            height: `${(slot.h / GRID) * 100}%`,
            padding: "1px",
          }}
        >
          <span
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              borderRadius: "1px",
              background: "var(--text-tertiary)",
              opacity: 0.55,
            }}
          />
        </span>
      ))}
    </span>
  );
}

export default LayoutPresetMenu;
