import { useRef } from "react";
import type { SessionMeta } from "./useTerminalSessions";
import { useProjectColors } from "./useProjectColors";

interface Props {
  sessions: SessionMeta[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  onOpenDrawer: () => void;
}

// Swipe-right from the spine opens the cross-project drawer. Touching
// the spine first also blocks iOS/Android's edge-swipe back navigation
// because the first touch lands on our handler instead of the browser.
function useEdgeSwipe(onOpenDrawer: () => void) {
  const startX = useRef<number | null>(null);
  const fired = useRef(false);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      startX.current = e.touches[0]?.clientX ?? null;
      fired.current = false;
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (startX.current == null || fired.current) return;
      const dx = (e.touches[0]?.clientX ?? startX.current) - startX.current;
      if (dx > 24) {
        fired.current = true;
        onOpenDrawer();
      }
    },
    onTouchEnd: () => {
      startX.current = null;
    },
  };
}

/**
 * Option D — the ambient 16px spine showing colored bars for sessions in
 * the current project. Active bar is taller/brighter. Tapping the spine
 * opens the cross-project drawer.
 */
export function TerminalSpine({
  sessions,
  focusedId,
  onFocus,
  onOpenDrawer,
}: Props) {
  const swipe = useEdgeSwipe(onOpenDrawer);
  const { colorFor } = useProjectColors();

  if (sessions.length === 0) {
    return (
      <div
        className="shrink-0 flex flex-col items-center py-2"
        style={{
          width: "16px",
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border-subtle)",
          touchAction: "pan-y",
        }}
        onClick={onOpenDrawer}
        {...swipe}
      />
    );
  }

  return (
    <div
      className="shrink-0 flex flex-col items-center gap-[3px] py-2"
      style={{
        width: "16px",
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border-subtle)",
        touchAction: "pan-y",
      }}
      onDoubleClick={onOpenDrawer}
      {...swipe}
    >
      {sessions.map((s) => {
        const active = s.id === focusedId;
        const color = colorFor(s.project);
        return (
          <button
            key={s.id}
            type="button"
            data-testid={`terminal-spine-session-${s.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onFocus(s.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onOpenDrawer();
            }}
            title={s.name}
            style={{
              display: "block",
              width: active ? "5px" : "4px",
              height: active ? "36px" : "22px",
              background: color,
              opacity: active ? 1 : 0.4,
              borderRadius: "2px",
              transition: "all 150ms ease",
            }}
          />
        );
      })}
    </div>
  );
}

export default TerminalSpine;
