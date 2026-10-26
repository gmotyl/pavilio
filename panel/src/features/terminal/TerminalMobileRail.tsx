import { Plus, Menu, RotateCw } from "lucide-react";
import type { SessionMeta, CreateSessionOpts } from "./useTerminalSessions";
import { mobileShortName } from "./useTerminalSessions";
import { useProjectColors } from "./useProjectColors";
import { TerminalActivityLed } from "./TerminalActivityLed";
import { TerminalDisconnectedBadge } from "./TerminalDisconnectedBadge";
import { useAggregateActivity } from "../favicon/useAggregateActivity";
import { MinimisedCounter } from "./MinimisedCounter";

interface Props {
  sessions: SessionMeta[];
  focusedId: string | null;
  currentProject: string;
  onFocus: (id: string) => void;
  onCreate: (opts?: CreateSessionOpts) => void;
  onOpenDrawer: () => void;
  onReconnect?: () => void;
  /** Sessions minimised on this surface, in session order — the aggregate's contents. */
  minimisedIds?: string[];
  /** Bring a minimised session back into the grid (and focus it). */
  onRestore?: (id: string) => void;
}

/**
 * Option A — Color Dot Rail. A horizontal pill row at the top of the
 * iTerm tab on mobile. Shows ONLY sessions for the current project.
 * Active pill displays a short name; inactive pills are compact dots.
 */
export function TerminalMobileRail({
  sessions,
  focusedId,
  currentProject,
  onFocus,
  onCreate,
  onOpenDrawer,
  onReconnect,
  minimisedIds = NONE,
  onRestore,
}: Props) {
  const activity = useAggregateActivity();
  const { colorFor } = useProjectColors();
  // Dots are for visible sessions only; minimised ones live in the aggregate.
  const visible =
    minimisedIds.length === 0
      ? sessions
      : sessions.filter((s) => !minimisedIds.includes(s.id));
  const minimised = sessions.filter((s) => minimisedIds.includes(s.id));
  return (
    <div
      data-testid="terminal-mobile-rail"
      className="flex items-center gap-2 px-2.5 py-2 shrink-0 overflow-x-auto scrollbar-none"
      style={{
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {visible.map((s) => {
        const active = s.id === focusedId;
        const accent = colorFor(s.project);
        const label = mobileShortName(s, sessions);
        return (
          // The pill is itself a button, so the badge cannot nest inside it.
          // It rides on the corner instead — the same idiom as the drawer
          // button's activity dot lower down this file.
          <span key={s.id} className="relative shrink-0 flex items-center">
            <button
              type="button"
              data-testid={`terminal-mobile-rail-session-${s.id}`}
              onClick={() => onFocus(s.id)}
              className={`shrink-0 rounded-full flex items-center transition-all active:scale-95 ${
                active ? "px-2.5 py-1 gap-1.5" : "w-7 h-7 justify-center"
              }`}
              style={{
                background: active
                  ? "var(--bg-elevated, var(--bg-active))"
                  : "var(--bg-base)",
                // The unselected dot is 28px, and the rail is the one surface
                // that lists sessions from *every* project side by side. At
                // that size a 1px ring of Orange against Gold is
                // indistinguishable, so the ring is deliberately 2px — a
                // border, not a box-shadow, so the rail's overflow-x-auto
                // scroller cannot clip it.
                border: active
                  ? `1px solid ${accent}`
                  : `2px solid ${accent}`,
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              <TerminalActivityLed sessionId={s.id} />
              {active && (
                <span
                  className="text-[10px] font-mono"
                  style={{ letterSpacing: "0.02em" }}
                >
                  {label}
                </span>
              )}
            </button>
            <span className="absolute -top-1 -right-1">
              <TerminalDisconnectedBadge sessionId={s.id} size="lg" />
            </span>
          </span>
        );
      })}

      <button
        type="button"
        data-testid="terminal-mobile-rail-new"
        onClick={() => onCreate()}
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center active:scale-95 transition-transform"
        style={{
          border: "1.5px dashed var(--text-muted)",
          color: "var(--text-muted)",
        }}
        title={`New terminal in ${currentProject}`}
      >
        <Plus size={14} />
      </button>

      <div className="flex-1" />

      {minimised.length > 0 && (
        <MinimisedCounter
          sessions={minimised}
          onRestore={(id) => onRestore?.(id)}
          testId="terminal-mobile-rail-minimised"
          variant="rail"
        />
      )}

      {focusedId && onReconnect && (
        <button
          type="button"
          data-testid="terminal-mobile-rail-reconnect"
          onClick={() => onReconnect()}
          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center active:scale-95 transition-transform"
          style={{
            background: "var(--bg-base)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
          title="Reconnect every disconnected terminal"
        >
          <RotateCw size={13} />
        </button>
      )}

      <div className="relative shrink-0">
        <button
          type="button"
          data-testid="terminal-mobile-rail-drawer"
          onClick={onOpenDrawer}
          className="w-7 h-7 rounded-md flex items-center justify-center active:scale-95 transition-transform"
          style={{
            background: "var(--bg-base)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
          title="All terminals"
        >
          <Menu size={13} />
        </button>
        {activity !== "idle" && (
          <span
            aria-hidden
            className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full"
            style={{
              background: activity === "busy" ? "#f9e2af" : "#a6e3a1",
              boxShadow: "0 0 0 1px var(--bg-surface)",
            }}
          />
        )}
      </div>
    </div>
  );
}

const NONE: string[] = [];

export default TerminalMobileRail;
