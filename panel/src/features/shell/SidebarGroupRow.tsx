import { useId, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ProjectMark } from "../projects/ProjectMark";
import { ProjectActivityLed } from "../terminal/ProjectActivityLed";
import { dropStyle, type SidebarRowDragProps } from "./useSidebarDrag";

/** The card-deck edges drawn behind the group icon (two cards, up and right). */
const SURFACE = "var(--bg-surface, var(--bg-base))";
const DECK_SHADOW = [
  `3px -2px 0 -1px ${SURFACE}`,
  "3px -2px 0 0 var(--border-subtle)",
  `5px -4px 0 -2px ${SURFACE}`,
  "5px -4px 0 -1px var(--border-subtle)",
].join(", ");

/**
 * One project group in the sidebar's Projects tree: chevron (an indicator
 * only; the whole row toggles and drags past a small threshold, see
 * `useSidebarDrag`), the aggregate activity slot, one deck icon (the first
 * member's mark), the bold name and the member count. The group wiki (`wikis`,
 * grouped `knowledge` projects) is a member but never the icon nor counted.
 * Expanded, its member rows sit beneath it under one vertical rule; collapsed,
 * the slot carries the most urgent member state (attention > busy > idle).
 */
export function SidebarGroupRow({
  name,
  members,
  wikis = [],
  sessionIds,
  collapsed,
  onToggle,
  isMobile,
  dragProps = {},
  onContextMenu,
  children,
}: {
  name: string;
  members: readonly string[];
  /** Members that are the group's wiki: excluded from the icon and the count. */
  wikis?: readonly string[];
  /** Every session of every member, for the collapsed aggregate. */
  sessionIds: readonly string[];
  collapsed: boolean;
  onToggle: () => void;
  isMobile: boolean;
  /** Pointer-drag handlers and `data-drop` from `useSidebarDrag`. */
  dragProps?: SidebarRowDragProps;
  /** Opens the group row menu (desktop). */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** The member project rows, rendered by the sidebar. */
  children: ReactNode;
}) {
  const tileSize = isMobile ? 24 : 22;
  const counted = members.filter((m) => !wikis.includes(m));
  // The row has an explicit aria-label, which hides descendants from the
  // accessible name; describe it by the status slot instead.
  const statusId = useId();
  return (
    <li data-group={name}>
      <div
        data-testid={`sidebar-group-row-${name}`}
        {...dragProps}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-describedby={statusId}
        aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            if (e.key === " ") e.preventDefault();
            onToggle();
          }
        }}
        onContextMenu={onContextMenu}
        className="group flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-[var(--bg-hover)]"
        style={{
          cursor: "pointer",
          ...dropStyle(dragProps["data-drop"], dragProps["data-dragging"] === "true"),
        }}
      >
        <span
          data-testid={`sidebar-group-toggle-${name}`}
          aria-hidden="true"
          className="w-4 h-4 flex items-center justify-center shrink-0"
          style={{ color: "var(--text-tertiary)" }}
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        </span>
        <span id={statusId} data-testid={`sidebar-group-slot-${name}`} className="contents">
          <ProjectActivityLed sessionIds={collapsed ? sessionIds : []} />
        </span>
        <span
          data-testid={`sidebar-group-icon-${name}`}
          data-deck="true"
          className="flex shrink-0"
        >
          {counted[0] !== undefined && (
            <ProjectMark
              project={counted[0]}
              size={tileSize}
              style={{ boxShadow: DECK_SHADOW }}
            />
          )}
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
          {counted.length}
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
