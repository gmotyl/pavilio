import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "../shell/useIsMobile";
import { useProjects } from "../projects/useProjects";
import { ProjectMark } from "../projects/ProjectMark";
import { alerts } from "../alerts/store";
import { refreshSessions } from "./sessionStore";
import { SESSION_MOVED_EVENT } from "./useTerminalSessions";
import { getActivityState } from "./useTerminalActivityChannel";
import { ConfirmCloseTerminalModal, type BulkCloseTarget } from "./ConfirmCloseTerminalModal";
import { bulkCloseTargets, killEach, type BulkCloseMode } from "./bulkCloseTargets";

export interface MenuSession {
  id: string;
  name: string;
  project: string;
}

type Action = "close" | BulkCloseMode | "move";

interface MenuProps {
  session: MenuSession;
  x: number;
  y: number;
  canCloseOthers: boolean;
  onDismiss: () => void;
  onAction: (a: Exclude<Action, "move">) => void;
  onMove: (project: string) => void;
}

interface MoveRow {
  kind: "label" | "project" | "sep";
  text: string;
  project?: string;
}

/** Projects grouped by `group` (sorted), ungrouped last after a separator. */
function moveRows(projects: { name: string; group?: string | null }[], current: string): MoveRow[] {
  const groups = new Map<string, string[]>();
  const loose: string[] = [];
  for (const p of projects) {
    const g = typeof p.group === "string" && p.group ? p.group : null;
    if (g) groups.set(g, [...(groups.get(g) ?? []), p.name]);
    else loose.push(p.name);
  }
  const rows: MoveRow[] = [];
  const proj = (name: string): MoveRow => ({
    kind: "project",
    project: name,
    text: name === current ? `${name} (current)` : name,
  });
  for (const g of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
    rows.push({ kind: "label", text: g });
    rows.push(...groups.get(g)!.map(proj));
  }
  if (loose.length > 0) {
    if (rows.length > 0) rows.push({ kind: "sep", text: "" });
    rows.push(...loose.map(proj));
  }
  return rows;
}

/** Shared look for panel context menus (also the sidebar row menus). */
export const menuStyle = {
  position: "fixed" as const,
  zIndex: 60,
  minWidth: 180,
  background: "var(--bg-surface)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 6,
  padding: "4px 0",
  boxShadow: "0 8px 24px rgba(0,0,0,.35)",
};
export const labelCls = "px-3 py-1 text-[10px] tracking-[0.2em] uppercase";
export const itemCls =
  "flex items-center gap-2 w-full px-3 py-1.5 text-[12px] font-mono cursor-pointer select-none";

export function SessionContextMenu({ session, x, y, canCloseOthers, onDismiss, onAction, onMove }: MenuProps) {
  const projects = useProjects();
  const rootRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const items: { action: Action; label: string; disabled?: boolean; hint?: string }[] = [
    { action: "close", label: "Close", hint: "Alt+Shift+W" },
    { action: "others", label: "Close others", disabled: !canCloseOthers },
    { action: "all", label: "Close all" },
    { action: "move", label: "Move to…" },
  ];
  const [active, setActive] = useState(0);

  useEffect(() => {
    rootRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || subRef.current?.contains(t)) return;
      onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onDismiss]);

  const activate = (a: Action) => {
    if (a === "move") setMoveOpen(true);
    else onAction(a);
  };
  const step = (dir: 1 | -1) => {
    setActive((i) => {
      let n = i;
      for (let k = 0; k < items.length; k++) {
        n = (n + dir + items.length) % items.length;
        if (!items[n].disabled) return n;
      }
      return i;
    });
  };

  const rows = moveRows(projects, session.project);
  // React events bubble through portals to the chip / cell — keep them here.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <>
      <div
        ref={rootRef}
        role="menu"
        aria-label="Session menu"
        tabIndex={-1}
        style={{ ...menuStyle, left: x, top: y, outline: "none" }}
        onClick={stop}
        onMouseDown={stop}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            step(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            step(-1);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate(items[active].action);
          } else if (e.key === "ArrowRight" && items[active].action === "move") {
            e.preventDefault();
            setMoveOpen(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            if (moveOpen) setMoveOpen(false);
            else onDismiss();
          }
        }}
      >
        <div className={`${labelCls} font-mono`} style={{ color: "var(--text-tertiary)" }}>
          {session.name}
        </div>
        {items.map((it, i) => (
          <div key={it.action}>
            {it.action === "move" && (
              <div role="separator" style={{ borderTop: "1px solid var(--border-subtle)", margin: "4px 0" }} />
            )}
            <div
              role="menuitem"
              aria-disabled={it.disabled ? "true" : undefined}
              className={itemCls}
              style={{
                color: it.disabled ? "var(--text-muted)" : "var(--text-secondary)",
                opacity: it.disabled ? 0.5 : 1,
                background: i === active ? "var(--bg-hover)" : "transparent",
              }}
              onMouseEnter={() => !it.disabled && setActive(i)}
              onClick={() => !it.disabled && activate(it.action)}
            >
              <span className="flex-1">{it.label}</span>
              {it.hint && (
                <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                  {it.hint}
                </span>
              )}
              {it.action === "move" && <span>▸</span>}
            </div>
          </div>
        ))}
      </div>
      {moveOpen && (
        <div
          ref={subRef}
          role="menu"
          aria-label="Move to"
          style={{ ...menuStyle, left: x + 184, top: y, maxHeight: "70vh", overflowY: "auto" }}
          onClick={stop}
          onMouseDown={stop}
        >
          {rows.map((r, i) => {
            if (r.kind === "sep")
              return (
                <div
                  key={`sep-${i}`}
                  data-move-row="sep"
                  role="separator"
                  style={{ borderTop: "1px solid var(--border-subtle)", margin: "4px 0" }}
                />
              );
            if (r.kind === "label")
              return (
                <div key={`l-${r.text}`} data-move-row="label" className={labelCls} style={{ color: "var(--text-tertiary)" }}>
                  {r.text}
                </div>
              );
            const current = r.project === session.project;
            return (
              <div
                key={`p-${r.project}`}
                data-move-row="project"
                role="menuitem"
                aria-disabled={current ? "true" : undefined}
                className={itemCls}
                style={{ color: "var(--text-secondary)", opacity: current ? 0.5 : 1 }}
                onMouseEnter={(e) => !current && (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                onClick={() => !current && onMove(r.project!)}
              >
                <ProjectMark project={r.project!} size={16} />
                <span>{r.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </>,
    document.body,
  );
}

/**
 * The session menu and its close confirmations, shared by the tab-strip chip
 * and the cell header. `strip` is the surface's full session list (minimised
 * included); `kill` resolves `false` when a DELETE fails.
 */
export function useSessionContextMenu({
  strip,
  kill,
}: {
  strip: readonly MenuSession[];
  kill: (id: string) => Promise<boolean | void> | boolean | void;
}): { onContextMenu: (e: React.MouseEvent, session: MenuSession) => void; element: ReactNode } {
  const isMobile = useIsMobile();
  const [menu, setMenu] = useState<{ session: MenuSession; x: number; y: number } | null>(null);
  const [single, setSingle] = useState<{ id: string; name: string } | null>(null);
  const [bulk, setBulk] = useState<BulkCloseTarget | null>(null);
  const nameOf = (id: string) => strip.find((s) => s.id === id)?.name ?? id;

  const onContextMenu = (e: React.MouseEvent, session: MenuSession) => {
    if (isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ session, x: e.clientX, y: e.clientY });
  };

  const dismiss = useRef(() => setMenu(null)).current;

  const move = async (session: MenuSession, project: string) => {
    setMenu(null);
    try {
      const res = await fetch(`/api/terminal/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alerts.error(`Couldn't move ${session.name}`, { detail: body.error ?? `HTTP ${res.status}` });
        return;
      }
      window.dispatchEvent(new Event(SESSION_MOVED_EVENT));
      await refreshSessions();
    } catch (err) {
      alerts.error(`Couldn't move ${session.name}`, { detail: String(err) });
    }
  };

  const element = (
    <>
      {menu && (
        <SessionContextMenu
          session={menu.session}
          x={menu.x}
          y={menu.y}
          canCloseOthers={strip.some((s) => s.id !== menu.session.id)}
          onDismiss={dismiss}
          onAction={(a) => {
            const s = menu.session;
            setMenu(null);
            if (a === "close") {
              setSingle({ id: s.id, name: s.name });
              return;
            }
            setBulk({
              others: a === "others",
              sessions: bulkCloseTargets(strip, s.id, a).map((id) => ({
                id,
                name: nameOf(id),
                working: getActivityState(id) === "busy",
              })),
            });
          }}
          onMove={(p) => void move(menu.session, p)}
        />
      )}
      <ConfirmCloseTerminalModal
        session={single}
        bulk={bulk}
        onCancel={() => {
          setSingle(null);
          setBulk(null);
        }}
        onConfirm={(ids) => {
          setSingle(null);
          setBulk(null);
          void killEach(ids, kill).then((failed) =>
            failed.forEach((id) => alerts.error(`Couldn't close ${nameOf(id)}`, { detail: "The session could not be killed." })),
          );
        }}
      />
    </>
  );

  return { onContextMenu, element };
}

export default SessionContextMenu;
