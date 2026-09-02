import { Plus, Menu, RotateCw } from "lucide-react";
import type { SessionMeta, CreateSessionOpts } from "./useTerminalSessions";
import { mobileShortName } from "./useTerminalSessions";
import { displayColor } from "./sessionColors";
import { TerminalActivityLed } from "./TerminalActivityLed";
import { TerminalDisconnectedBadge } from "./TerminalDisconnectedBadge";
import { useAggregateActivity } from "../favicon/useAggregateActivity";

interface Props {
  sessions: SessionMeta[];
  focusedId: string | null;
  currentProject: string;
  onFocus: (id: string) => void;
  onCreate: (opts?: CreateSessionOpts) => void;
  onOpenDrawer: () => void;
  onReconnect?: () => void;
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
}: Props) {
  const activity = useAggregateActivity();
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-2 shrink-0 overflow-x-auto scrollbar-none"
      style={{
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
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

      {sessions.map((s) => {
        const active = s.id === focusedId;
        const accent = displayColor(s, sessions);
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
                border: active
                  ? `1px solid ${s.color || accent}`
                  : "1px solid var(--border-subtle)",
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

      <div className="flex-1" />

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
          title="Reconnect focused terminal"
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

export default TerminalMobileRail;
