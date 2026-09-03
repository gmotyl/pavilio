import { useEffect, useRef, useState } from "react";
import { ExternalLink, Copy, ClipboardCopy, Check } from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";
import { openInVSCode } from "../shell/vscode";

const BUTTON_CLASS =
  "flex items-center gap-1.5 text-sm px-2 py-1 rounded-md transition-colors";

/** Which button, if any, is currently showing its "Copied" confirmation. */
type Feedback = "path" | "content" | null;

/** Viewer toolbar actions: the buttons above an open file that operate on it. */
export function ViewerActions({
  absolutePath,
  content,
}: {
  absolutePath: string;
  /** Open file's source. Null/undefined/empty means nothing to copy — the button is disabled. */
  content?: string | null;
}) {
  const [copied, setCopied] = useState<Feedback>(null);
  // A single revert timer for the whole toolbar: only one button shows feedback
  // at a time, so a new copy restarts the countdown rather than racing the old
  // one. Held in a ref so it survives re-renders and can be cleared on unmount.
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Both call sites unmount this toolbar on every file switch and tab change,
  // so a pending timer would otherwise outlive the component.
  useEffect(
    () => () => {
      if (revertTimer.current !== null) clearTimeout(revertTimer.current);
    },
    [],
  );

  const copy = async (what: Exclude<Feedback, null>, text: string) => {
    if (!(await copyToClipboard(text))) return;
    setCopied(what);
    // Restart the countdown so this click gets the full duration, whichever
    // button (if any) was showing feedback before.
    if (revertTimer.current !== null) clearTimeout(revertTimer.current);
    revertTimer.current = setTimeout(() => {
      revertTimer.current = null;
      setCopied(null);
    }, 1500);
  };

  const canCopyContent = Boolean(content);

  return (
    <>
      <button
        data-testid="file-viewer-vscode"
        onClick={() => openInVSCode(absolutePath)}
        className={BUTTON_CLASS}
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
        onClick={() => copy("path", absolutePath)}
        className={BUTTON_CLASS}
        style={{
          color: copied === "path" ? "var(--green)" : "var(--text-secondary)",
        }}
      >
        {copied === "path" ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
        {copied === "path" ? "Copied" : "Path"}
      </button>
      <button
        data-testid="file-viewer-copy-content"
        onClick={() => copy("content", content ?? "")}
        disabled={!canCopyContent}
        className={BUTTON_CLASS}
        style={{
          color:
            copied === "content" ? "var(--green)" : "var(--text-secondary)",
          opacity: canCopyContent ? 1 : 0.4,
        }}
      >
        {copied === "content" ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <ClipboardCopy className="w-3.5 h-3.5" />
        )}
        {copied === "content" ? "Copied" : "Copy"}
      </button>
    </>
  );
}

export default ViewerActions;
