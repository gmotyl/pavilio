import { useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useActiveFile } from "../explorer/useActiveFile";
import MockupFrame from "../projects/MockupFrame";
import ViewerActions from "../projects/ViewerActions";
import { useWebSocket } from "../realtime/useWebSocket";
import { useBreadcrumbActions } from "../shell/Breadcrumbs";
import { useFloatingAction } from "../shell/Layout";
import { useWideMode } from "../shell/useWideMode";
import WideToggle from "../shell/WideToggle";
import ImageDropZone from "./ImageDropZone";
import MarkdownRenderer from "./MarkdownRenderer";

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

  // _skills/<name> resolves to skills/<name>/SKILL.md on the server; _help/<x.md> is markdown.
  // Treat these virtual paths as markdown even without a .md suffix in the URL.
  const isMarkdown =
    filePath.endsWith(".md") ||
    (filePath.startsWith("_skills/") && !filePath.includes("."));
  const isJson = filePath.endsWith(".json");
  const isHtml = filePath.endsWith(".html");

  // The toolbar above an open file is `ViewerActions`, the same component the
  // project file viewer and the plans tab mount — VS Code, copy-path and
  // copy-content, with one shared revert timer so only one confirms at a time.
  // The prefix keeps this screen's published `markdown-viewer-*` test ids.
  // While a file switch is in flight `content` still holds the previous file's
  // text, so it is withheld until this one has loaded.
  // A mockup is the exception: `MockupFrame` brings its own toolbar above the
  // frame (the width picker belongs next to it), so the breadcrumb slot stays
  // empty rather than mounting a second copy of the same buttons.
  useBreadcrumbActions(
    absolutePath && !isHtml ? (
      <ViewerActions
        absolutePath={absolutePath}
        content={loading ? null : content}
        testIdPrefix="markdown-viewer"
      />
    ) : null,
    [absolutePath, content, loading, isHtml],
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

  // An html file is a mockup: render it, do not show its source. Same frame
  // component the mockups tab mounts, so both copy the same workspace-relative
  // path. It owns the full pane height and skips the image drop zone, which
  // only means something for markdown.
  if (isHtml)
    return (
      <div className="p-6 h-full min-h-0">
        <MockupFrame
          filePath={filePath}
          absolutePath={absolutePath}
          testIdPrefix="markdown-viewer"
        />
      </div>
    );

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
