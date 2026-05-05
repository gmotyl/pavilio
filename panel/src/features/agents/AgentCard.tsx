import { useState, useEffect } from "react";
import { Terminal } from "lucide-react";

interface AgentEntry {
  pid: number;
  type: string;
  project: string;
  cwd: string;
  startedAt: string;
}

function formatDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export default function AgentCard({ agent }: { agent: AgentEntry }) {
  const [duration, setDuration] = useState(formatDuration(agent.startedAt));

  useEffect(() => {
    const interval = setInterval(() => setDuration(formatDuration(agent.startedAt)), 60000);
    return () => clearInterval(interval);
  }, [agent.startedAt]);

  const focusTerminal = async () => {
    await fetch("/api/agents/focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: agent.cwd }),
    });
  };

  const label = agent.type === "claude" ? "Claude" : agent.type === "opencode" ? "OpenCode" : "Qwen";

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors"
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--green)" }} />
        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "var(--green)" }} />
      </span>
      <div className="flex-1 min-w-0">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="text-[11px] ml-1.5" style={{ color: "var(--text-muted)" }}>{agent.project} · {duration}</span>
      </div>
      <button
        data-testid={`agent-card-focus-${agent.id}`}
        onClick={focusTerminal}
        className="p-0.5 rounded transition-colors"
        style={{ color: "var(--text-tertiary)" }}
        title="Focus terminal"
      >
        <Terminal className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
