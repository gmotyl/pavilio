import type { CSSProperties } from "react";
import * as Icons from "lucide-react";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import { useRunProjectScript } from "./useRunProjectScript";
import type { ScriptEntry } from "./useWorkspaceScripts";

type IconComponent = React.ComponentType<{ className?: string }>;

function getLucideIcon(name: string | undefined): IconComponent | null {
  if (!name) return null;
  const found = (Icons as unknown as Record<string, IconComponent | undefined>)[name];
  return found ?? null;
}

interface ScriptButtonProps {
  entry: ScriptEntry;
  projectName: string;
}

export default function ScriptButton({ entry, projectName }: ScriptButtonProps) {
  const { run, pending } = useRunProjectScript(projectName);
  const isPending = pending === entry.id;
  const IconComp = getLucideIcon(entry.icon);
  const popoverId = `script-info-${entry.id}`;
  const anchorName = `--script-info-${entry.id}`;

  // CSS anchor positioning — not yet typed in CSSProperties for all React versions.
  const wrapperStyle = { anchorName } as CSSProperties;
  const popoverStyle = {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-subtle)",
    color: "var(--text-primary)",
    positionAnchor: anchorName,
    top: "anchor(bottom)",
    left: "anchor(left)",
    margin: 0,
  } as CSSProperties;

  return (
    <div className="relative inline-flex items-center gap-1" style={wrapperStyle}>
      <button
        data-testid={`script-run-${entry.id}`}
        onClick={() => run(entry)}
        disabled={isPending}
        className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors"
        style={{ color: "var(--text-secondary)" }}
        onMouseEnter={(e) => {
          if (isPending) return;
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text-primary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
        }}
      >
        {IconComp ? <IconComp className="w-3.5 h-3.5" /> : null}
        {isPending ? "Running…" : entry.label}
      </button>
      <button
        data-testid={`script-info-${entry.id}`}
        {...{ popovertarget: popoverId }}
        aria-label={`About ${entry.label}`}
        className="p-1 rounded-md transition-colors"
        style={{ color: "var(--text-muted)" }}
      >
        <Icons.Info className="w-3.5 h-3.5" />
      </button>
      <div
        id={popoverId}
        {...{ popover: "auto" }}
        className="max-w-sm p-3 rounded-md text-sm"
        style={popoverStyle}
      >
        <MarkdownRenderer content={entry.description} />
      </div>
    </div>
  );
}
