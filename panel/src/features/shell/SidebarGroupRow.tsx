import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { ProjectMark } from "../projects/ProjectMark";
import { ProjectActivityLed } from "../terminal/ProjectActivityLed";

/** At most this many member marks are stacked on a group row. */
const STACK_MAX = 4;

/**
 * One project group in the sidebar's Projects tree: a hover grip (desktop
 * only — the drag itself lands with the reorder work), chevron, the aggregate
 * activity slot, stacked member marks, the bold name and the member count.
 * Expanded, its member rows sit beneath it under one vertical rule; collapsed,
 * the slot carries the most urgent member state (attention > busy > idle).
 */
export function SidebarGroupRow({
  name,
  members,
  sessionIds,
  collapsed,
  onToggle,
  isMobile,
  children,
}: {
  name: string;
  members: readonly string[];
  /** Every session of every member, for the collapsed aggregate. */
  sessionIds: readonly string[];
  collapsed: boolean;
  onToggle: () => void;
  isMobile: boolean;
  /** The member project rows, rendered by the sidebar. */
  children: ReactNode;
}) {
  return (
    <li data-group={name}>
      <div
        data-testid={`sidebar-group-row-${name}`}
        className="group flex items-center gap-1 rounded-md px-1 py-0.5"
      >
        {!isMobile && (
          <span
            data-testid={`sidebar-group-grip-${name}`}
            aria-hidden="true"
            className="opacity-0 group-hover:opacity-90 transition-opacity w-2.5 flex items-center justify-center shrink-0 cursor-grab"
            style={{ color: "var(--text-muted)" }}
          >
            <GripVertical size={11} />
          </span>
        )}
        <button
          type="button"
          data-testid={`sidebar-group-toggle-${name}`}
          onClick={onToggle}
          className="w-4 h-4 flex items-center justify-center shrink-0 rounded hover:bg-[var(--bg-hover)]"
          style={{ color: "var(--text-tertiary)" }}
          title={collapsed ? "Expand group" : "Collapse group"}
          aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        </button>
        <span data-testid={`sidebar-group-slot-${name}`} className="contents">
          <ProjectActivityLed sessionIds={collapsed ? sessionIds : []} />
        </span>
        <span
          data-testid={`sidebar-group-marks-${name}`}
          className="flex shrink-0"
        >
          {members.slice(0, STACK_MAX).map((m, i) => (
            <ProjectMark
              key={m}
              project={m}
              size={16}
              style={{
                marginLeft: i === 0 ? 0 : -5,
                boxShadow: "0 0 0 2px var(--bg-surface, var(--bg-base))",
              }}
            />
          ))}
        </span>
        <strong
          data-testid={`sidebar-group-name-${name}`}
          className="flex-1 truncate text-[13px] py-0.5 font-semibold"
          style={{ color: "var(--text-primary)", letterSpacing: "0.01em" }}
        >
          {name}
        </strong>
        <span
          data-testid={`sidebar-group-count-${name}`}
          className="text-[11px] tabular-nums shrink-0"
          style={{ color: "var(--text-muted)" }}
        >
          {members.length}
        </span>
      </div>
      {!collapsed && (
        <ul
          data-testid={`sidebar-group-members-${name}`}
          data-rule="true"
          className="mt-0.5 space-y-0.5 border-l pl-1"
          style={{ marginLeft: isMobile ? 9 : 13, borderColor: "var(--border-subtle)" }}
        >
          {children}
        </ul>
      )}
    </li>
  );
}
