import { useLocation } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import { useActiveFile } from "../explorer/useActiveFile";
import { useWebSocket } from "../realtime/useWebSocket";
import { useBreadcrumbActions } from "../shell/Breadcrumbs";
import { useFloatingAction } from "../shell/Layout";
import { useWideMode } from "../shell/useWideMode";
import WideToggle from "../shell/WideToggle";
import ImageDropZone from "./ImageDropZone";
import MarkdownRenderer from "./MarkdownRenderer";
import { copyToClipboard } from "../../lib/clipboard";
import { openInVSCode as openPathInVSCode } from "../../lib/vscode";

/**
 * Build the /api/files/read/... URL from a route path.
 * Paths starting with _root/<rootId>/ are cross-root references:
 * they map to /api/files/read/<rest>?root=<rootId>.
 */
export function buildReadUrl(routePath: string): string {
  const parts = routePath.split("/").filter(Boolean);
  if (parts[0] === "_root" && parts[1]) {
    const rootId = parts[1];
    const rest = parts.slice(2).join("/");
    return `/api/files/read/${rest}?root=${encodeURIComponent(rootId)}`;
  }
  return `/api/files/read/${routePath}`;
}

export default function MarkdownViewer() {
  const location = useLocation();
  const filePath = location.pathname.replace(/^\/view\//, "");
  const { setActiveFile } = useActiveFile();

  // Clear context active file — URL is the source of truth here
  useEffect(() => {
    setActiveFile(null);
  }, [filePath]);

  const [content, setContent] = useState("");
  const [absolutePath, setAbsolutePath] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [wide, toggleWide] = useWideMode("viewer");
  const { lastMessage } = useWebSocket();

  const fetchContent = async () => {
    const res = await fetch(buildReadUrl(filePath));
    if (res.ok) {
      const data = await res.json();
      setContent(data.content);
      setAbsolutePath(data.absolutePath);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchContent();
  }, [filePath]);

  useEffect(() => {
    if (lastMessage?.type === "file-change") {
      const changedPath = lastMessage.path as string;
      if (changedPath?.includes(filePath)) fetchContent();
    }
  }, [lastMessage]);

  const openInVSCode = useCallback(() => {
    void openPathInVSCode(absolutePath);
  }, [absolutePath]);

  const copyPath = useCallback(async () => {
    const ok = await copyToClipboard(absolutePath);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [absolutePath]);

  // Inject VS Code + Path buttons into the breadcrumb bar
  useBreadcrumbActions(
    absolutePath ? (
      <>
        <button
          data-testid="markdown-viewer-vscode"
          onClick={openInVSCode}
          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors"
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
          <ExternalLink className="w-3 h-3" />
          VS Code
        </button>
        <button
          data-testid="markdown-viewer-copy-path"
          onClick={copyPath}
          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors"
          style={{ color: copied ? "var(--green)" : "var(--text-secondary)" }}
          onMouseEnter={(e) => {
            if (!copied) {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text-primary)";
            }
          }}
          onMouseLeave={(e) => {
            if (!copied) {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-secondary)";
            }
          }}
        >
          {copied ? (
            <Check className="w-3 h-3" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
          {copied ? "Copied" : "Path"}
        </button>
      </>
    ) : null,
    [absolutePath, copied, openInVSCode, copyPath],
  );

  useFloatingAction(<WideToggle wide={wide} onToggle={toggleWide} />, [
    wide,
    toggleWide,
  ]);

  if (loading)
    return (
      <div className="p-6" style={{ color: "var(--text-muted)" }}>
        Loading...
      </div>
    );

  // _skills/<name> resolves to skills/<name>/SKILL.md on the server; _help/<x.md> is markdown.
  // Treat these virtual paths as markdown even without a .md suffix in the URL.
  const isMarkdown =
    filePath.endsWith(".md") ||
    (filePath.startsWith("_skills/") && !filePath.includes("."));
  const isJson = filePath.endsWith(".json");

  return (
    <div className={`p-6 ${wide ? "" : "max-w-5xl"}`}>
      <ImageDropZone targetMarkdown={filePath}>
        {isMarkdown ? (
          <MarkdownRenderer content={content} basePath={filePath} />
        ) : isJson ? (
          <pre
            className="text-sm font-mono p-4 rounded-lg overflow-auto"
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
            }}
          >
            {JSON.stringify(JSON.parse(content), null, 2)}
          </pre>
        ) : (
          <pre
            className="text-sm font-mono whitespace-pre-wrap"
            style={{ color: "var(--text-secondary)" }}
          >
            {content}
          </pre>
        )}
      </ImageDropZone>
    </div>
  );
}
