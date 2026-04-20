import { useState, useRef, useEffect } from "react";
import { Plus, Maximize2, Minimize2, X, ChevronDown, FolderGit2 } from "lucide-react";
import type { SessionMeta, CreateSessionOpts } from "./useTerminalSessions";
import { nextProjectName } from "./useTerminalSessions";
import { displayColor } from "./sessionColors";
import { TerminalActivityLed } from "./TerminalActivityLed";

const COLOR_PRESETS = [
  { name: "Off", hex: null as string | null },
  { name: "Gold", hex: "#f0c674" },
  { name: "Coral", hex: "#e06c75" },
  { name: "Purple", hex: "#c678dd" },
  { name: "Blue", hex: "#61afef" },
  { name: "Teal", hex: "#56b6c2" },
  { name: "Green", hex: "#98c379" },
];

interface Props {
  sessions: SessionMeta[];
  focusedId: string | null;
  maximized: boolean;
  currentProject: string;
  projects: { name: string }[];
  repos?: { name: string; path: string }[];
  onFocus: (id: string) => void;
  onCreate: (opts?: CreateSessionOpts) => void;
  onDelete: (id: string) => void;
  onColorChange: (id: string, color: string | null) => void;
  onRename: (id: string, name: string) => void;
  onToggleMaximize: () => void;
}

export function TerminalToolbar({
  sessions,
  focusedId,
  maximized,
  currentProject,
  projects,
  repos,
  onFocus,
  onCreate,
  onDelete,
  onColorChange,
  onRename,
  onToggleMaximize,
}: Props) {
  const [newOpen, setNewOpen] = useState(false);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setNewOpen(false);
        setRepoMenuOpen(false);
        setColorPickerFor(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex items-stretch shrink-0 relative"
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--bg-surface)",
        height: "36px",
      }}
    >
      {/* Split "+ New" button: main click = current project; chevron = project picker */}
      <div
        className="relative flex items-stretch"
        style={{ borderRight: "1px solid var(--border-subtle)" }}
      >
        <button
          type="button"
          onClick={() => onCreate()}
          className="flex items-center gap-1.5 pl-3 pr-2 text-[12px] transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
          title={`New terminal in ${currentProject}`}
        >
          <Plus size={13} />
          <span className="font-mono">{currentProject}</span>
        </button>
        <button
          type="button"
          onClick={() => setNewOpen((o) => !o)}
          className="flex items-center px-1.5 transition-colors"
          style={{
            color: "var(--text-muted)",
            borderLeft: "1px solid var(--border-subtle)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
          title="Open in another project"
        >
          <ChevronDown size={12} />
        </button>
        {newOpen && (
          <div
            className="absolute left-0 top-full z-50 mt-[1px] min-w-[200px] rounded-md py-1 shadow-lg"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              className="px-3 py-1 text-[10px] tracking-[0.2em] uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              New terminal in…
            </div>
            {projects.map((p) => (
              <button
                key={p.name}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  console.info("[terminal] toolbar picker clicked", {
                    project: p.name,
                  });
                  onCreate({ project: p.name });
                  setNewOpen(false);
                }}
                className="flex items-center justify-between w-full text-left px-3 py-1.5 text-[12px] font-mono transition-colors"
                style={{
                  color:
                    p.name === currentProject
                      ? "var(--accent, #f0c674)"
                      : "var(--text-secondary)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--bg-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <span>{p.name}</span>
                {p.name === currentProject && (
                  <span
                    className="text-[9px] tracking-widest"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    HERE
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {/* Repo picker: only shown when the current project has repos */}
        {repos && repos.length > 0 && (
          <div className="relative flex items-stretch">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setRepoMenuOpen((v) => !v);
                setNewOpen(false);
              }}
              className="flex items-center px-1.5 transition-colors"
              style={{
                color: "var(--text-muted)",
                borderLeft: "1px solid var(--border-subtle)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--bg-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
              title="New terminal in repo"
            >
              <FolderGit2 size={12} />
            </button>
            {repoMenuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute left-0 top-full z-50 mt-[1px] min-w-[240px] rounded-md py-1 shadow-lg"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div
                  className="px-3 py-1 text-[10px] tracking-[0.2em] uppercase"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  New terminal in repo…
                </div>
                {repos.map((repo) => (
                  <button
                    key={repo.path}
                    type="button"
                    onClick={() => {
                      setRepoMenuOpen(false);
                      const name = nextProjectName(repo.name, sessions);
                      onCreate({ cwd: repo.path, name });
                    }}
                    className="flex flex-col items-start w-full px-3 py-2 text-left transition-colors"
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--bg-hover)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <span
                      className="text-[12px] font-mono"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {repo.name}
                    </span>
                    <span
                      className="text-[10px] font-mono truncate w-full"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {repo.path}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Session chips */}
      <div className="flex-1 flex items-stretch overflow-x-auto min-w-0 scrollbar-none">
        {sessions.map((s) => {
          const focused = s.id === focusedId;
          const editing = editingId === s.id;
          const dotColor = displayColor(s, sessions);
          return (
            <div
              key={s.id}
              className="group relative flex items-center gap-1.5 px-2.5 text-[12px] shrink-0 cursor-pointer transition-colors"
              style={{
                borderRight: "1px solid var(--border-subtle)",
                background: focused ? "var(--bg-base)" : "transparent",
                borderTop: focused
                  ? `1.5px solid ${dotColor}`
                  : "1.5px solid transparent",
                color: focused
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
              }}
              onClick={() => onFocus(s.id)}
              onMouseEnter={(e) => {
                if (!focused)
                  e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (!focused)
                  e.currentTarget.style.background = "transparent";
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setColorPickerFor(
                    colorPickerFor === s.id ? null : s.id,
                  );
                }}
                className="shrink-0 flex items-center"
                title={
                  s.color
                    ? "Group color — click to change"
                    : "Click to pin a group color"
                }
              >
                <TerminalActivityLed sessionId={s.id} />
              </button>
              {editing ? (
                <input
                  autoFocus
                  defaultValue={s.name}
                  className="bg-transparent outline-none text-[12px] min-w-[60px]"
                  style={{ color: "var(--text-primary)" }}
                  onBlur={(e) => {
                    onRename(s.id, e.target.value.trim() || s.name);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="font-mono truncate max-w-[140px]"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(s.id);
                  }}
                  title={`${s.name} — double-click to rename`}
                >
                  {s.name}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--red, #f7768e)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
                title="Kill session"
              >
                <X size={10} />
              </button>

              {colorPickerFor === s.id && (
                <div
                  className="absolute top-full left-0 mt-[1px] z-50 flex gap-1 p-1.5 rounded-md shadow-lg"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        onColorChange(s.id, c.hex);
                        setColorPickerFor(null);
                      }}
                      className="w-4 h-4 rounded-full transition-transform hover:scale-110"
                      style={{
                        background: c.hex || "transparent",
                        border: c.hex
                          ? "none"
                          : "1.5px solid var(--text-muted)",
                      }}
                      title={c.name}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right actions */}
      <div
        className="flex items-stretch shrink-0"
        style={{ borderLeft: "1px solid var(--border-subtle)" }}
      >
        <button
          type="button"
          onClick={onToggleMaximize}
          disabled={sessions.length === 0}
          className="flex items-center gap-1.5 px-3 text-[11px] transition-colors disabled:opacity-40"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => {
            if (sessions.length > 0)
              e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
          title={
            maximized
              ? "Restore grid (Esc or Cmd+Shift+Enter)"
              : "Maximize focused (Cmd+Shift+Enter)"
          }
        >
          {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          <span className="uppercase tracking-widest">
            {maximized ? "Grid" : "Max"}
          </span>
        </button>
      </div>
    </div>
  );
}

export default TerminalToolbar;
