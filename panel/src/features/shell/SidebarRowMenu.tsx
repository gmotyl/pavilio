import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "./useIsMobile";
import { refreshProjects } from "../projects/useProjects";
import { alerts } from "../alerts/store";
import { itemCls, labelCls, menuStyle } from "../terminal/SessionContextMenu";
import { ownFlag, renameGroupCollapsed, renameGroupInOrder, type SidebarOrder } from "./sidebarOrder";

interface Item {
  key: string;
  label: string;
  role?: "menuitem" | "menuitemradio";
  checked?: boolean;
  disabled?: boolean;
  sub?: boolean;
  sepBefore?: boolean;
  run: () => void;
}

/** One menu panel: arrow keys move, Enter/Space activate, Escape dismisses. */
function MenuPanel({
  label,
  title,
  items,
  x,
  y,
  panelRef,
  onEscape,
}: {
  label: string;
  title?: string;
  items: Item[];
  x: number;
  y: number;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onEscape: () => void;
}) {
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((i) => !i.disabled)));
  useEffect(() => panelRef.current?.focus(), [panelRef]);
  const step = (dir: 1 | -1) =>
    setActive((i) => {
      let n = i;
      for (let k = 0; k < items.length; k++) {
        n = (n + dir + items.length) % items.length;
        if (!items[n].disabled) return n;
      }
      return i;
    });
  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{ ...menuStyle, left: x, top: y, outline: "none", maxHeight: "70vh", overflowY: "auto" }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        const it = items[active];
        if (e.key === "ArrowDown") step(1);
        else if (e.key === "ArrowUp") step(-1);
        else if (e.key === "Enter" || e.key === " " || (e.key === "ArrowRight" && it?.sub)) {
          if (it && !it.disabled) it.run();
        } else if (e.key === "Escape" || e.key === "ArrowLeft") onEscape();
        else return;
        e.preventDefault();
      }}
    >
      {title && (
        <div className={`${labelCls} font-mono`} style={{ color: "var(--text-tertiary)" }}>
          {title}
        </div>
      )}
      {items.map((it, i) => (
        <div key={it.key}>
          {it.sepBefore && (
            <div role="separator" style={{ borderTop: "1px solid var(--border-subtle)", margin: "4px 0" }} />
          )}
          <div
            role={it.role ?? "menuitem"}
            aria-checked={it.role === "menuitemradio" ? (it.checked ? "true" : "false") : undefined}
            aria-disabled={it.disabled ? "true" : undefined}
            className={itemCls}
            style={{
              color: it.disabled ? "var(--text-muted)" : "var(--text-secondary)",
              opacity: it.disabled ? 0.5 : 1,
              background: i === active ? "var(--bg-hover)" : "transparent",
            }}
            onMouseEnter={() => !it.disabled && setActive(i)}
            onClick={() => !it.disabled && it.run()}
          >
            {it.role === "menuitemradio" && <span className="w-3">{it.checked ? "✓" : ""}</span>}
            <span className="flex-1">{it.label}</span>
            {it.sub && <span>▸</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A small in-panel name prompt (no `window.prompt`). */
function NamePrompt({
  title,
  initial,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  const submit = () => trimmed && onSubmit(trimmed);
  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 70, background: "rgba(0,0,0,.4)" }}
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <form
        role="dialog"
        aria-label={title}
        className="flex flex-col gap-2 p-3 rounded-md"
        style={{ ...menuStyle, position: "static", minWidth: 260, padding: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <label className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          {title}
          <input
            autoFocus
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full px-2 py-1 rounded text-[12px] font-mono"
            style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }}
          />
        </label>
        <div className="flex justify-end gap-2 text-[12px]">
          <button type="button" data-testid="sidebar-row-prompt-cancel" onClick={onCancel} style={{ color: "var(--text-tertiary)" }}>
            Cancel
          </button>
          <button type="submit" data-testid="sidebar-row-prompt-submit" disabled={!trimmed} style={{ color: "var(--text-primary)" }}>
            OK
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

type MenuState =
  | { kind: "project"; project: string; group: string | null; x: number; y: number }
  | { kind: "group"; group: string; toggle: () => void; x: number; y: number };

async function failure(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${res.status}`;
}

/**
 * Right-click menus for the sidebar's project and group rows: Group ▸
 * (existing groups, ✓ current, New group…, Remove from group) on a project;
 * Rename… and Collapse/Expand on a group. Inert on mobile. A knowledge wiki
 * (`groupWiki`: a group's wiki or the shared ungrouped `knowledge`) has no
 * Group ▸ entries: its group is what makes it a harvest target, fixed by its
 * card, so its menu has nothing to offer and does not open.
 */
export function useSidebarRowMenu({
  groups,
  order,
  setOrder,
  collapsed,
  setCollapsed,
}: {
  groups: readonly string[];
  order: SidebarOrder;
  setOrder: (o: SidebarOrder) => void;
  collapsed: Record<string, boolean>;
  setCollapsed: (c: Record<string, boolean>) => void;
}): {
  onProjectContextMenu: (
    e: React.MouseEvent,
    project: string,
    group: string | null,
    opts?: { groupWiki?: boolean },
  ) => void;
  onGroupContextMenu: (e: React.MouseEvent, group: string, toggle: () => void) => void;
  element: ReactNode;
} {
  const isMobile = useIsMobile();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [subOpen, setSubOpen] = useState(false);
  const [ask, setAsk] = useState<{ title: string; initial: string; done: (n: string) => void } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setMenu(null);
    setSubOpen(false);
  };
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || subRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const open = (e: React.MouseEvent, m: MenuState) => {
    if (isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    setSubOpen(false);
    setMenu(m);
  };

  const setGroup = async (project: string, group: string | null) => {
    close();
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project)}/group`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group }),
      });
      if (!res.ok) {
        alerts.error(`Could not regroup ${project}`, { detail: await failure(res) });
        return;
      }
      refreshProjects();
    } catch (err) {
      alerts.error(`Could not regroup ${project}`, { detail: String(err) });
    }
  };

  const rename = async (from: string, to: string) => {
    if (from === to) return;
    try {
      const res = await fetch("/api/projects/groups/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      if (res.status === 409) {
        alerts.error(`A group named “${to}” already exists`, {
          detail: `Pick another name for ${from}, or move its projects into ${to}.`,
        });
        return;
      }
      if (!res.ok) {
        alerts.error(`Could not rename ${from}`, { detail: await failure(res) });
        return;
      }
      refreshProjects();
      setOrder(renameGroupInOrder(order, from, to));
      setCollapsed(renameGroupCollapsed(collapsed, from, to));
    } catch (err) {
      alerts.error(`Could not rename ${from}`, { detail: String(err) });
    }
  };

  let items: Item[] = [];
  let subItems: Item[] = [];
  if (menu?.kind === "project") {
    const m = menu;
    items = [{ key: "group", label: "Group", sub: true, run: () => setSubOpen(true) }];
    subItems = [
      ...[...groups].sort((a, b) => a.localeCompare(b)).map<Item>((g) => ({
        key: `g:${g}`,
        label: g,
        role: "menuitemradio",
        checked: g === m.group,
        run: () => (g === m.group ? close() : void setGroup(m.project, g)),
      })),
      {
        key: "new",
        label: "New group…",
        sepBefore: groups.length > 0,
        run: () => {
          close();
          setAsk({ title: `New group for ${m.project}`, initial: "", done: (n) => void setGroup(m.project, n) });
        },
      },
      {
        key: "remove",
        label: "Remove from group",
        disabled: m.group === null,
        run: () => void setGroup(m.project, null),
      },
    ];
  } else if (menu?.kind === "group") {
    const m = menu;
    items = [
      {
        key: "rename",
        label: "Rename…",
        run: () => {
          close();
          setAsk({ title: `Rename ${m.group}`, initial: m.group, done: (n) => void rename(m.group, n) });
        },
      },
      {
        key: "toggle",
        label: ownFlag(collapsed, m.group) ? "Expand" : "Collapse",
        run: () => {
          close();
          m.toggle();
        },
      },
    ];
  }

  const element = (
    <>
      {menu &&
        createPortal(
          <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <MenuPanel
              label={menu.kind === "project" ? "Project menu" : "Group menu"}
              title={menu.kind === "project" ? menu.project : menu.group}
              items={items}
              x={menu.x}
              y={menu.y}
              panelRef={rootRef}
              onEscape={close}
            />
            {subOpen && (
              <MenuPanel
                label="Group"
                items={subItems}
                x={menu.x + 184}
                y={menu.y}
                panelRef={subRef}
                onEscape={() => {
                  setSubOpen(false);
                  rootRef.current?.focus();
                }}
              />
            )}
          </div>,
          document.body,
        )}
      {ask && (
        <NamePrompt
          title={ask.title}
          initial={ask.initial}
          onCancel={() => setAsk(null)}
          onSubmit={(n) => {
            setAsk(null);
            ask.done(n);
          }}
        />
      )}
    </>
  );

  return {
    onProjectContextMenu: (e, project, group, opts) => {
      if (opts?.groupWiki) return;
      open(e, { kind: "project", project, group, x: e.clientX, y: e.clientY });
    },
    onGroupContextMenu: (e, group, toggle) => open(e, { kind: "group", group, toggle, x: e.clientX, y: e.clientY }),
    element,
  };
}
