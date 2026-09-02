import { useEffect, useMemo, useRef, useState } from "react";
import { Palette } from "lucide-react";

import { toast } from "../../lib/toast";
import { useProjectColors } from "./useProjectColors";

/**
 * The palette offered in the picker.
 *
 * **Source of truth is `server/lib/project-colors.ts`** — the server assigns
 * from that list, this one only offers it. It is duplicated rather than served
 * because it is a design constant that changes about never, and serving it
 * would mean a second endpoint, a second fetch and a loading state in front of
 * twelve literals; `useProjectColors` already owns the one request this feature
 * makes.
 *
 * **Drift risk:** the two lists can fall out of step, and nothing at runtime
 * would say so — a preset missing here is simply unofferable, and one only here
 * is a colour the server never auto-assigns. `ProjectColorPicker.test.tsx`
 * asserts the two arrays are equal, so a change to either side fails the suite;
 * if you edit one, edit both.
 */
export const PROJECT_COLOR_PRESETS: readonly { name: string; hex: string }[] = [
  { name: "Gold", hex: "#f0c674" },
  { name: "Coral", hex: "#e06c75" },
  { name: "Purple", hex: "#c678dd" },
  { name: "Blue", hex: "#61afef" },
  { name: "Teal", hex: "#56b6c2" },
  { name: "Green", hex: "#98c379" },
  { name: "Orange", hex: "#d19a66" },
  { name: "Olive", hex: "#b5bd68" },
  { name: "Emerald", hex: "#5fd7a7" },
  { name: "Indigo", hex: "#7d8ff5" },
  { name: "Pink", hex: "#ec7fa9" },
  { name: "Slate", hex: "#8fa3bf" },
];

/**
 * Format only — `#rgb` or `#rrggbb`. Deliberately *not* a contrast or
 * legibility check: a hand-picked colour that reads badly is the user's call,
 * but an unvalidated string reaching a `style` attribute is not.
 * Mirrors the server's guard, which rejects the same shapes with a 400.
 */
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const HEX_HINT = "Use #rgb or #rrggbb, e.g. #f0c674";

/** Tolerate a pasted `f0c674`; everything else must already be a valid hex. */
function normalizeHex(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

interface Props {
  /** The project whose colour this changes — every session of it, not one cell. */
  project: string;
  /** Test id for the trigger; hosts scope it per cell. */
  testId?: string;
}

/**
 * Set a *project's* colour, from wherever one of its sessions is shown.
 *
 * Self-contained: trigger, popover and outside-click in one component, so a
 * host only has to place it. The trigger is sized to match the cell header's
 * `CellIconButton` siblings (`p-1` around an 11px icon) — the control this
 * replaces hung off the 6x6px activity LED and was effectively unhittable.
 *
 * Uniqueness is advisory: a colour another project already holds is *marked*
 * with that project's name and stays selectable. There are more projects than
 * presets, so refusing duplicates would eventually leave a project colourless.
 */
export function ProjectColorPicker({ project, testId }: Props) {
  const { colors, colorFor, setColor } = useProjectColors();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Outside-click closes, the same idiom as the terminal toolbar's menus: one
  // document-level `mousedown` against a root ref that covers trigger *and*
  // popover, so clicking the trigger toggles rather than close-then-reopen.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const current = colorFor(project);

  /** hex (lowercased) → the other projects already flying it. */
  const owners = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [name, hex] of Object.entries(colors)) {
      if (name === project) continue;
      const key = hex.toLowerCase();
      const list = map.get(key);
      if (list) list.push(name);
      else map.set(key, [name]);
    }
    for (const list of map.values()) list.sort();
    return map;
  }, [colors, project]);

  const apply = (hex: string) => {
    setError(null);
    setOpen(false);
    // `setColor` rolls the optimistic value back and *rethrows* on failure, so
    // an uncaught call would surface as an unhandled rejection. The rollback is
    // silent on its own — a colour that quietly springs back looks like a bug —
    // so say what happened, in the app's usual failure channel.
    void setColor(project, hex).catch(() => {
      toast.error(`Could not save the colour for ${project}`);
    });
  };

  const applyCustom = () => {
    const hex = normalizeHex(custom);
    if (!HEX_RE.test(hex)) {
      setError(HEX_HINT);
      return;
    }
    setCustom("");
    apply(hex);
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      // The cell focuses on click, so the click is swallowed here the same way
      // the eye/maximize/kill controls beside it swallow theirs. One stop on
      // the wrapper covers the trigger and everything in the popover.
      onClick={(e) => e.stopPropagation()}
      // The cell header is `draggable`. Without this, mouse-selecting the hex
      // field's text starts a cell drag instead of a selection — HTML5 drag is
      // initiated by the browser from the nearest draggable ancestor, so only
      // cancelling `dragstart` stops it (a `mousedown` stop would not, and
      // `draggable={false}` here only makes the browser keep walking up).
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        data-testid={testId}
        title={`Set colour for ${project}`}
        aria-label={`Set colour for ${project}`}
        aria-expanded={open}
        onClick={() => {
          setError(null);
          setOpen((o) => !o);
        }}
        // Identical to CellIconButton in TerminalLayoutGrid.tsx — a test pins
        // the two together so the control cannot shrink away from its row.
        className="p-1 rounded transition-colors"
        style={{ color: "var(--text-muted)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--text-muted)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        <Palette size={11} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Colour for ${project}`}
          data-testid="project-color-picker"
          className="absolute right-0 top-full z-50 mt-[2px] w-[212px] rounded-md p-2 shadow-lg"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div
            className="px-0.5 pb-1.5 text-[10px] uppercase tracking-[0.16em] truncate"
            style={{ color: "var(--text-tertiary)" }}
          >
            Colour for <span className="font-mono normal-case">{project}</span>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {PROJECT_COLOR_PRESETS.map((preset) => {
              const taken = owners.get(preset.hex.toLowerCase());
              const label = taken
                ? `${preset.name} — used by ${taken.join(", ")}`
                : preset.name;
              const selected = current.toLowerCase() === preset.hex.toLowerCase();
              return (
                <button
                  key={preset.hex}
                  type="button"
                  data-testid={`project-color-preset-${project}-${preset.name.toLowerCase()}`}
                  title={label}
                  aria-label={label}
                  aria-pressed={selected}
                  onClick={() => apply(preset.hex)}
                  className="flex flex-col gap-1 rounded p-1 text-left transition-colors"
                  style={{
                    border: selected
                      ? "1px solid var(--text-secondary)"
                      : "1px solid transparent",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(255,255,255,0.06)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span
                    className="block h-3 w-full rounded-sm"
                    style={{ background: preset.hex }}
                  />
                  {/* Taken presets wear the other project's name instead of the
                      colour's — the name is what makes the clash readable. */}
                  <span
                    className="block truncate text-[9px] leading-none"
                    style={{
                      color: taken ? "var(--text-tertiary)" : "var(--text-muted)",
                    }}
                  >
                    {taken ? taken[0] : preset.name}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center gap-1">
            <input
              aria-label="Custom hex"
              value={custom}
              placeholder="#rrggbb"
              spellCheck={false}
              onChange={(e) => {
                setCustom(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyCustom();
                if (e.key === "Escape") setOpen(false);
              }}
              className="min-w-0 flex-1 rounded px-1.5 py-1 font-mono text-[11px]"
              style={{
                background: "var(--bg-base, rgba(0,0,0,0.25))",
                border: `1px solid ${error ? "var(--red, #f7768e)" : "var(--border-subtle)"}`,
                color: "var(--text-primary)",
              }}
            />
            <button
              type="button"
              data-testid={`project-color-apply-${project}`}
              onClick={applyCustom}
              className="rounded px-2 py-1 text-[11px] transition-colors"
              style={{
                border: "1px solid var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(255,255,255,0.06)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              Apply
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-1 text-[10px] leading-tight"
              style={{ color: "var(--red, #f7768e)" }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
