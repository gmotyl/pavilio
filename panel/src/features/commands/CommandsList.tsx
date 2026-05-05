import { useNavigate, useLocation } from "react-router-dom";
import { FileText } from "lucide-react";
import { useCommands } from "./useCommands";

export default function CommandsList() {
  const commands = useCommands();
  const navigate = useNavigate();
  const location = useLocation();

  if (commands.length === 0) {
    return (
      <p className="text-xs px-1" style={{ color: "var(--text-muted)" }}>
        No commands found
      </p>
    );
  }

  return (
    <div className="text-sm">
      {commands.map((cmd) => {
        const viewPath = `/view/_commands/${cmd.name}`;
        const isActive = location.pathname === viewPath;
        return (
          <button
            key={cmd.name}
            data-testid={`commands-list-${cmd.name}`}
            onClick={() => navigate(viewPath)}
            title={cmd.description || cmd.name}
            className="flex items-center gap-1 w-full px-1 py-0.5 rounded-md text-xs truncate transition-colors duration-100"
            style={{
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              background: isActive ? "var(--bg-active)" : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!isActive)
                e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              if (!isActive)
                e.currentTarget.style.background = isActive
                  ? "var(--bg-active)"
                  : "transparent";
            }}
          >
            <FileText
              size={13}
              className="shrink-0"
              style={{ color: "var(--text-tertiary)" }}
            />
            <span className="truncate">{cmd.name.replace(/\.md$/, "")}</span>
          </button>
        );
      })}
    </div>
  );
}
