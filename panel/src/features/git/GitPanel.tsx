import { useState } from "react";
import { Download } from "lucide-react";
import GitChanges from "./GitChanges";

export default function GitPanel() {
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);

  const pull = async () => {
    setPulling(true);
    setPullMsg(null);
    try {
      const res = await fetch("/api/git/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPullMsg(`Pull failed: ${data.error ?? res.statusText}`);
      } else {
        const out = (data.output ?? "").trim();
        setPullMsg(out || "Already up to date.");
      }
    } catch (e: any) {
      setPullMsg(`Pull failed: ${e.message ?? e}`);
    } finally {
      setPulling(false);
      setTimeout(() => setPullMsg(null), 5000);
    }
  };

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Changes</h1>
        <button
          data-testid="git-pull"
          onClick={pull}
          disabled={pulling}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
          style={{
            color: "var(--text-secondary)",
            background: "var(--bg-hover)",
          }}
        >
          <Download className="w-3.5 h-3.5" />
          {pulling ? "Pulling…" : "Pull"}
        </button>
      </div>
      {pullMsg && (
        <pre
          data-testid="git-pull-output"
          className="mb-4 text-xs px-3 py-2 rounded-md whitespace-pre-wrap"
          style={{
            background: "var(--bg-hover)",
            color: "var(--text-secondary)",
          }}
        >
          {pullMsg}
        </pre>
      )}
      <GitChanges showCommit />
    </div>
  );
}
