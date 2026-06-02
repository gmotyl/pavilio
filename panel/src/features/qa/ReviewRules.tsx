import { useEffect, useState, useCallback } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus } from "lucide-react";
import MarkdownRenderer from "../markdown/MarkdownRenderer";

const template = (project: string) =>
  `# Code Review Rules — ${project}\n\n` +
  `## Conventions\n\n` +
  `## Preferred libraries\n\n` +
  `## Code patterns to follow\n\n` +
  `## Anti-patterns to flag\n`;

export default function ReviewRules({ project }: { project: string }) {
  const path = `${project}/qa/REVIEW_RULES.md`;
  const [content, setContent] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/files/read/${path}`);
    if (res.ok) {
      const data = await res.json();
      setContent(data.content);
      setExists(true);
    } else {
      setContent(null);
      setExists(false);
    }
    setEditing(false);
    setError(null);
    setCollapsed(false);
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  const write = async (text: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content: text }),
      });
      if (!res.ok) {
        setError("Failed to save rules.");
        return;
      }
      setContent(text);
      setExists(true);
      setEditing(false);
      setCollapsed(false);
    } catch {
      setError("Failed to save rules.");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => { setDraft(content ?? template(project)); setEditing(true); };

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <button
          data-testid="review-rules-toggle"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <span className="text-[11px] font-semibold uppercase tracking-widest">Review Rules</span>
        </button>
        <div className="flex-1" />
        {exists && !editing && (
          <button
            data-testid="review-rules-edit"
            onClick={startEdit}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={16}
                className="w-full text-sm font-mono p-3 rounded-md"
                style={{
                  background: "var(--bg-input, var(--bg-elevated))",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-subtle)",
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  data-testid="review-rules-save"
                  onClick={() => void write(draft)}
                  disabled={busy}
                  className="text-xs px-3 py-1 rounded-md"
                  style={{ background: "var(--accent)", color: "var(--bg-base, #1a1a1a)" }}
                >
                  Save
                </button>
                <button
                  data-testid="review-rules-cancel"
                  onClick={() => setEditing(false)}
                  className="text-xs px-3 py-1 rounded-md"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Cancel
                </button>
              </div>
              {error && <p className="text-xs" style={{ color: "var(--red)" }}>{error}</p>}
            </div>
          ) : exists ? (
            <MarkdownRenderer content={content ?? ""} basePath={path} />
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>No review rules yet.</p>
              <button
                data-testid="review-rules-create"
                onClick={() => void write(template(project))}
                disabled={busy}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Plus size={12} /> Create rules file
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
