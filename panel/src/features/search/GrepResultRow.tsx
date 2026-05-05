import { FileText } from "lucide-react";
import type { GrepResult } from "./grep";

function highlightMatch(text: string, query: string): React.ReactNode {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: "var(--accent)", fontWeight: 600 }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

interface Props {
  result: GrepResult;
  query: string;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  projectColor?: { bg: string; fg: string };
}

export default function GrepResultRow({
  result,
  query,
  isSelected,
  onClick,
  onMouseEnter,
  projectColor,
}: Props) {
  const fileName = result.relativePath.split("/").pop() ?? result.relativePath;
  const dir = result.relativePath.slice(
    0,
    result.relativePath.length - fileName.length,
  );

  return (
    <button
      data-testid={`grep-result-${result.relativePath}`}
      data-selected={isSelected}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className="w-full px-4 py-2 text-left transition-colors duration-75"
      style={{ background: isSelected ? "var(--bg-active)" : "transparent" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <FileText size={13} style={{ color: "var(--text-muted)" }} />
        <span
          className="text-sm font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {fileName}
        </span>
        {projectColor && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: projectColor.bg, color: projectColor.fg }}
          >
            {result.project}
          </span>
        )}
        <span
          className="text-[11px] font-mono"
          style={{ color: "var(--text-muted)" }}
        >
          {dir}
        </span>
      </div>
      {result.matches.map((m) => (
        <div
          key={m.line}
          className="flex gap-2 ml-5 text-xs"
          style={{ color: "var(--text-tertiary)" }}
        >
          <span
            className="shrink-0 w-8 text-right font-mono"
            style={{ color: "var(--text-muted)" }}
          >
            {m.line}
          </span>
          <span className="truncate font-mono">
            {highlightMatch(m.text, query)}
          </span>
        </div>
      ))}
    </button>
  );
}
