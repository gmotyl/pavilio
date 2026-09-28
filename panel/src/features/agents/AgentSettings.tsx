import { useState, useEffect, useCallback, useRef } from "react";
import { ExternalLink, Copy, Check, FileText, ChevronDown, ChevronRight, Save, Pencil, X, Play, AlertTriangle } from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";
import { openInVSCode as openPathInVSCode } from "../shell/vscode";
import { VoiceSelect } from "../speech/VoiceSelect";
import { AutoOpenAnswerToggle } from "../speech/AutoOpenAnswerToggle";
import { LauncherSettings } from "./LauncherSettings";

interface SettingsFile {
  name: string;
  path: string;
  exists: boolean;
  size?: number;
  modified?: number;
  editable?: boolean;
}

interface AgentConfig {
  agent: string;
  icon: string;
  files: SettingsFile[];
}

/**
 * One Workspace Action, exactly as `GET /api/agent-settings/actions` sends it.
 *
 * The server owns the catalogue — which actions exist, what they are called and
 * what they do — and offers only the ones this workspace's own package.json
 * actually defines. Nothing about an action is described here, or the page
 * would once again show buttons a fresh clone cannot run.
 */
interface WorkspaceAction {
  id: string;
  script: string;
  label: string;
  description: string;
}

/**
 * Which actions get the destructive treatment: a red button and an extra
 * warning in the confirm step.
 *
 * This is presentation, not catalogue — it says how an action is *shown*, never
 * that it exists or what it does. An id the server did not send is simply never
 * rendered, so a stale entry here shows nothing.
 */
const DESTRUCTIVE_ACTION_IDS = new Set(["setup:restore"]);

function isDestructive(action: WorkspaceAction): boolean {
  return DESTRUCTIVE_ACTION_IDS.has(action.id);
}

/** The script the server will run, shown so the user sees it before saying yes. */
function commandFor(action: WorkspaceAction): string {
  return `pm_in . ${action.script}`;
}

type ModalState =
  | { status: "confirm"; action: WorkspaceAction }
  | { status: "running"; action: WorkspaceAction }
  | { status: "done"; action: WorkspaceAction; ok: boolean; output: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ActionModal({ state, onClose, onConfirm }: {
  state: ModalState;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { action } = state;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget && state.status !== "running") onClose(); }}
    >
      <div
        className="rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          {isDestructive(action) && <AlertTriangle size={16} style={{ color: "var(--red)", flexShrink: 0 }} />}
          <span className="font-semibold text-sm flex-1" style={{ color: "var(--text-primary)" }}>
            {action.label}
          </span>
          {state.status !== "running" && (
            <button
              data-testid={`agent-action-modal-close-${action.id}`}
              onClick={onClose}
              className="rounded p-1 transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{action.description}</p>
          <code className="block text-xs px-3 py-2 rounded" style={{ background: "var(--bg-base)", color: "var(--text-muted)", fontFamily: "monospace" }}>
            {commandFor(action)}
          </code>

          {isDestructive(action) && state.status === "confirm" && (
            <div
              className="flex items-start gap-2 text-xs px-3 py-2 rounded"
              style={{ background: "color-mix(in srgb, var(--red) 10%, transparent)", color: "var(--red)", border: "1px solid color-mix(in srgb, var(--red) 25%, transparent)" }}
            >
              <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
              This will overwrite existing configuration files. Existing files are skipped by default, but verify your backup is current before proceeding.
            </div>
          )}

          {state.status === "running" && (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Running...
            </div>
          )}

          {state.status === "done" && (
            <div>
              <div className="text-xs mb-2 font-medium" style={{ color: state.ok ? "var(--green)" : "var(--red)" }}>
                {state.ok ? "Completed successfully" : "Completed with errors"}
              </div>
              <pre
                className="text-xs font-mono p-3 rounded overflow-auto"
                style={{ background: "var(--bg-base)", color: "var(--text-secondary)", maxHeight: "240px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {state.output || "(no output)"}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          {state.status === "confirm" && (
            <>
              <button
                data-testid={`agent-action-cancel-${action.id}`}
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                Cancel
              </button>
              <button
                data-testid={`agent-action-confirm-${action.id}`}
                onClick={onConfirm}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors"
                style={{
                  background: isDestructive(action) ? "color-mix(in srgb, var(--red) 15%, transparent)" : "color-mix(in srgb, var(--accent) 15%, transparent)",
                  color: isDestructive(action) ? "var(--red)" : "var(--accent)",
                  border: `1px solid ${isDestructive(action) ? "color-mix(in srgb, var(--red) 30%, transparent)" : "color-mix(in srgb, var(--accent) 30%, transparent)"}`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isDestructive(action) ? "color-mix(in srgb, var(--red) 25%, transparent)" : "color-mix(in srgb, var(--accent) 25%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isDestructive(action) ? "color-mix(in srgb, var(--red) 15%, transparent)" : "color-mix(in srgb, var(--accent) 15%, transparent)";
                }}
              >
                <Play size={11} />
                Run
              </button>
            </>
          )}
          {state.status === "done" && (
            <button
              data-testid={`agent-action-close-${action.id}`}
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FileViewer({ file }: { file: SettingsFile }) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agent-settings/read?path=${encodeURIComponent(file.path)}`);
      if (res.ok) {
        const data = await res.json();
        setContent(data.content);
        setDraft(data.content);
      } else {
        setContent(`Error: ${res.status}`);
      }
    } catch {
      setContent("Failed to load file");
    }
    setLoading(false);
  }, [file.path]);

  const toggle = useCallback(async () => {
    if (expanded) { setExpanded(false); setEditing(false); return; }
    setExpanded(true);
    if (content !== null) return;
    fetchContent();
  }, [expanded, content, fetchContent]);

  const startEditing = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(content ?? "");
    setEditing(true);
    if (!expanded) {
      setExpanded(true);
      if (content === null) fetchContent();
    }
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [content, expanded, fetchContent]);

  const cancelEditing = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(false);
    setDraft(content ?? "");
    setSaveStatus("idle");
  }, [content]);

  const save = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSaving(true);
    setSaveStatus("idle");
    try {
      const res = await fetch("/api/agent-settings/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, content: draft }),
      });
      if (res.ok) {
        setContent(draft);
        setEditing(false);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
    setSaving(false);
  }, [file.path, draft]);

  const openInVSCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    void openPathInVSCode(file.path);
  };

  const copyPath = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(await copyToClipboard(file.path))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isAgent = file.editable;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-subtle)" }}>
      <button
        data-testid={`agent-settings-file-toggle-${file.path}`}
        onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
        style={{ background: expanded ? "var(--bg-active)" : "var(--bg-surface)" }}
        onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = "var(--bg-surface)"; }}
      >
        {expanded ? <ChevronDown size={14} style={{ color: "var(--text-muted)" }} /> : <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />}
        <FileText size={14} style={{ color: isAgent ? "var(--accent)" : "var(--text-tertiary)" }} />
        <span className="text-sm font-medium flex-1" style={{ color: "var(--text-primary)" }}>
          {file.name}
          {isAgent && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>agent</span>}
        </span>
        {saveStatus === "saved" && <span className="text-[11px]" style={{ color: "var(--green)" }}>Saved</span>}
        {saveStatus === "error" && <span className="text-[11px]" style={{ color: "var(--red)" }}>Error</span>}
        {file.size != null && (
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{formatSize(file.size)}</span>
        )}
        {file.modified != null && (
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{formatDate(file.modified)}</span>
        )}
        {isAgent && !editing && (
          <button
            data-testid={`agent-settings-file-edit-${file.path}`}
            onClick={startEditing}
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors"
            style={{ color: "var(--accent)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <Pencil size={11} />
            Edit
          </button>
        )}
        <button
          data-testid={`agent-settings-file-vscode-${file.path}`}
          onClick={openInVSCode}
          className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
        >
          <ExternalLink size={11} />
          VS Code
        </button>
        <button
          data-testid={`agent-settings-file-copy-${file.path}`}
          onClick={copyPath}
          className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors"
          style={{ color: copied ? "var(--green)" : "var(--text-secondary)" }}
          onMouseEnter={(e) => { if (!copied) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}}
          onMouseLeave={(e) => { if (!copied) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = copied ? "var(--green)" : "var(--text-secondary)"; }}}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Path"}
        </button>
      </button>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--bg-base)" }}>
          <div className="flex items-center px-2 py-1" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <span className="text-[11px] font-mono flex-1" style={{ color: "var(--text-muted)" }}>{file.path}</span>
            {editing && (
              <div className="flex items-center gap-1">
                <button
                  data-testid={`agent-settings-file-save-${file.path}`}
                  onClick={save}
                  disabled={saving}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors"
                  style={{ color: "var(--green)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <Save size={11} />
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  data-testid={`agent-settings-file-cancel-${file.path}`}
                  onClick={cancelEditing}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <X size={11} />
                  Cancel
                </button>
              </div>
            )}
          </div>
          {editing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full text-xs font-mono p-4 outline-none resize-y"
              style={{ color: "var(--text-secondary)", background: "var(--bg-base)", minHeight: "300px", maxHeight: "70vh", border: "none" }}
              spellCheck={false}
            />
          ) : (
            <pre
              className="text-xs font-mono p-4 overflow-auto"
              style={{ color: "var(--text-secondary)", maxHeight: "400px" }}
            >
              {loading ? "Loading..." : content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentSettings() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [actions, setActions] = useState<WorkspaceAction[]>([]);
  // null = fine. Otherwise the status the server answered with, or null inside
  // the object when nothing answered at all — the two need different advice.
  const [actionsUnavailable, setActionsUnavailable] = useState<{ status: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState | null>(null);

  useEffect(() => {
    fetch("/api/agent-settings")
      .then((r) => r.json())
      .then(setAgents)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // The actions this workspace can actually run. A workspace that offers none
  // renders no section at all — but a server that could not answer is a
  // different thing entirely, and swallowing the error made the two look
  // identical: an empty page with nothing to say why.
  useEffect(() => {
    fetch("/api/agent-settings/actions")
      .then((r) =>
        r.ok
          ? r.json()
          : Promise.reject(Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })),
      )
      .then((list) => {
        setActions(Array.isArray(list) ? list : []);
        setActionsUnavailable(null);
      })
      .catch((err: { status?: number }) => {
        setActions([]);
        // A thrown fetch has no status; a rejected response carries the one the
        // server answered with. Collapsing them lost the only detail that tells
        // the reader which of two unrelated problems they have.
        setActionsUnavailable({ status: typeof err?.status === "number" ? err.status : null });
      });
  }, []);

  const openConfirm = (action: WorkspaceAction) => {
    setModal({ status: "confirm", action });
  };

  const closeModal = () => setModal(null);

  const runAction = async () => {
    if (!modal || modal.status !== "confirm") return;
    const { action } = modal;
    setModal({ status: "running", action });
    try {
      const res = await fetch("/api/agent-settings/run-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action.id }),
      });
      const data = await res.json();
      setModal({ status: "done", action, ok: data.ok ?? res.ok, output: data.output ?? data.error ?? "" });
    } catch (e: unknown) {
      setModal({ status: "done", action, ok: false, output: e instanceof Error ? e.message : "Network error" });
    }
  };

  if (loading) return <div className="p-6" style={{ color: "var(--text-muted)" }}>Loading...</div>;

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>Settings</h1>
      <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
        Panel preferences, plus the configuration files for your AI coding agents. Click a file to expand and view, or open it in VS Code to edit.
      </p>

      {/* Speech */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Speech</h2>
        <VoiceSelect />
        <div className="mt-4">
          <AutoOpenAnswerToggle />
        </div>
        <div className="mt-4">
          <LauncherSettings />
        </div>
      </section>

      {/* Workspace actions — whatever this workspace's package.json defines */}
      {(actions.length > 0 || actionsUnavailable) && (
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Workspace Actions</h2>
        {actionsUnavailable && (
          <div
            data-testid="agent-settings-actions-error"
            className="flex items-start gap-2 text-xs px-3 py-2 rounded"
            style={{ background: "color-mix(in srgb, var(--red) 10%, transparent)", color: "var(--red)", border: "1px solid color-mix(in srgb, var(--red) 25%, transparent)" }}
          >
            <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            {actionsUnavailable.status === null
              ? "Could not load this workspace's actions — the panel server did not answer. Check that it is running, then reload."
              : `Could not load this workspace's actions — the panel server answered ${actionsUnavailable.status}. It is running, but it does not serve this endpoint: the bundle is newer than the server. Rebuild and restart it (pnpm build, then pnpm reboot).`}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.id}
              data-testid={`agent-settings-action-${action.id}`}
              onClick={() => openConfirm(action)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors"
              style={{
                background: isDestructive(action) ? "color-mix(in srgb, var(--red) 10%, transparent)" : "var(--bg-surface)",
                color: isDestructive(action) ? "var(--red)" : "var(--text-secondary)",
                border: `1px solid ${isDestructive(action) ? "color-mix(in srgb, var(--red) 25%, transparent)" : "var(--border-subtle)"}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isDestructive(action) ? "color-mix(in srgb, var(--red) 18%, transparent)" : "var(--bg-hover)";
                e.currentTarget.style.color = isDestructive(action) ? "var(--red)" : "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isDestructive(action) ? "color-mix(in srgb, var(--red) 10%, transparent)" : "var(--bg-surface)";
                e.currentTarget.style.color = isDestructive(action) ? "var(--red)" : "var(--text-secondary)";
              }}
            >
              {isDestructive(action) ? <AlertTriangle size={11} /> : <Play size={11} />}
              {action.label}
            </button>
          ))}
        </div>
      </section>
      )}

      <div className="space-y-8">
        {agents.map((agent) => (
          <section key={agent.agent}>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
              {agent.agent}
            </h2>
            <div className="space-y-2">
              {agent.files.map((file) => (
                <FileViewer key={file.path} file={file} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {agents.length === 0 && (
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>
          No agent configuration files found on this system.
        </div>
      )}

      {modal && (
        <ActionModal
          state={modal}
          onClose={closeModal}
          onConfirm={runAction}
        />
      )}
    </div>
  );
}
