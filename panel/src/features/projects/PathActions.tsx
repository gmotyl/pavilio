import { useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";
import { openInVSCode } from "../shell/vscode";

/** "VS Code" + "Copy path" buttons shared by the file viewers. */
export function PathActions({ absolutePath }: { absolutePath: string }) {
  const [copied, setCopied] = useState(false);

  const copyPath = async () => {
    if (!(await copyToClipboard(absolutePath))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <button
        data-testid="file-viewer-vscode"
        onClick={() => openInVSCode(absolutePath)}
        className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors"
        style={{ color: "var(--text-secondary)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text-primary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
        }}
      >
        <ExternalLink className="w-3.5 h-3.5" /> VS Code
      </button>
      <button
        data-testid="file-viewer-copy-path"
        onClick={copyPath}
        className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors"
        style={{
          color: copied ? "var(--green)" : "var(--text-secondary)",
        }}
      >
        {copied ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
        {copied ? "Copied" : "Path"}
      </button>
    </>
  );
}

export default PathActions;
