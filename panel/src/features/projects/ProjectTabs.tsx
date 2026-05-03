import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Search, Terminal } from "lucide-react";
import type { ProjectTab } from "./useProjectTabs";

interface MenuProps {
  tabs: ProjectTab[];
  activeTab: ProjectTab;
}

export function ProjectTabsMenu({ tabs, activeTab }: MenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
        style={{
          background: "var(--bg-base)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-subtle)",
        }}
        title={activeTab.label === "iterm" ? "iTerm" : undefined}
      >
        <span className="capitalize">
          {activeTab.label === "iterm" ? (
            <Terminal className="w-3 h-3" />
          ) : (
            activeTab.label
          )}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 top-full z-40 mt-1 min-w-[140px] rounded-md py-1 shadow-lg"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {tabs.map((tab) => (
              <Link
                key={tab.label}
                to={tab.to}
                state={tab.state}
                onClick={() => setOpen(false)}
                title={tab.label === "iterm" ? "iTerm" : undefined}
                className="flex items-center gap-2 px-3 py-2 capitalize"
                style={{
                  background: tab.active ? "var(--bg-active)" : "transparent",
                  color: tab.active
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                }}
              >
                {tab.label === "iterm" ? (
                  <Terminal className="w-4 h-4" />
                ) : (
                  tab.label
                )}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface BarProps {
  tabs: ProjectTab[];
  searchActive: boolean;
  onToggleSearch: () => void;
}

export function ProjectTabsBar({ tabs, searchActive, onToggleSearch }: BarProps) {
  return (
    <div
      className="hidden md:flex gap-2 mb-4 text-sm relative items-center sticky top-0 z-10 py-2"
      style={{
        background: "var(--bg-base)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <div className="flex gap-1">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            to={tab.to}
            state={tab.state}
            title={tab.label === "iterm" ? "iTerm" : undefined}
            className="px-3 py-1.5 rounded-md capitalize transition-colors flex items-center gap-1.5"
            style={{
              background: tab.active ? "var(--bg-active)" : "transparent",
              color: tab.active
                ? "var(--text-primary)"
                : "var(--text-tertiary)",
            }}
            onMouseEnter={(e) => {
              if (!tab.active)
                e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              if (!tab.active)
                e.currentTarget.style.background = tab.active
                  ? "var(--bg-active)"
                  : "transparent";
            }}
          >
            {tab.label === "iterm" ? (
              <Terminal className="w-4 h-4" />
            ) : (
              tab.label
            )}
          </Link>
        ))}
      </div>
      <button
        onClick={onToggleSearch}
        className="ml-auto hidden md:block px-2 py-1.5 rounded-md transition-colors"
        style={{
          color: searchActive ? "var(--accent)" : "var(--text-tertiary)",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--bg-hover)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "transparent")
        }
        title="Search in project (Cmd+F)"
      >
        <Search size={14} />
      </button>
    </div>
  );
}
