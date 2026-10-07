import { useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { useActiveFile } from "../explorer/useActiveFile";
import MockupFrame from "../projects/MockupFrame";
import { isMockupFile, MOCKUP_MAX_SOURCE_BYTES, viewerReadUrl } from "../projects/mockupFiles";
import ViewerActions from "../projects/ViewerActions";
import { relativeToWorkspace } from "../projects/relativeToWorkspace";
import { useWorkspaceRoot } from "../projects/useWorkspaceRoot";
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
  const [tooLarge, setTooLarge] = useState(false);
  const workspaceRoot = useWorkspaceRoot();
  const [loading, setLoading] = useState(true);
  const [wide, toggleWide] = useWideMode("viewer");
  const { lastMessage } = useWebSocket();

  // The path the latest read is for: a slower read of the previous file must
  // not land on top of this one.
  const currentPath = useRef(filePath);
  currentPath.current = filePath;

  const fetchContent = async () => {
    const path = filePath;
    // A raster image only needs its absolute path — the frame loads it from
    // the raw route — so its bytes are never read as text. An HTML/SVG file is
    // text and is read for Copy content, up to a size cap. Cross-root, where it
    // is shown as source text, the same cap applies: above it the server
    // answers `tooLarge` and the pane says so instead of reading the file.
    const res = await fetch(viewerReadUrl(path, buildReadUrl(path)));
    if (currentPath.current !== path) return;
    if (res.ok) {
      const data = await res.json();
      if (currentPath.current !== path) return;
      setContent(data.content);
      setTooLarge(data.tooLarge === true);
      setAbsolutePath(data.absolutePath);
    }
    setLoading(false);
  };

  useEffect(() => {
    // A switch drops the previous file's text first, so neither the mockup
    // frame's Copy content nor the breadcrumb toolbar can copy it meanwhile.
    setLoading(true);
    setContent("");
    setTooLarge(false);
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
  // A mockup frame is only honest for a path the raw route can actually serve.
  // `/raw/*path` resolves against the projects dir (with a repo-root fallback)
  // and takes no `root` query, so a cross-root `_root/<rootId>/…` path would
  // load an empty frame with no error. Those fall through to the source text.
  const isCrossRoot = filePath.split("/")[0] === "_root";
  // Image mockups (SVG, PNG, JPEG, WebP) take the same frame, which renders
  // them through `<img>`; QuickFinder and the file tree link them here.
  const isMockup = isMockupFile(filePath) && !isCrossRoot;

  // The toolbar above an open file is `ViewerActions`, the same component the
  // project file viewer and the plans tab mount — VS Code, copy-path (relative
  // to the workspace root), copy-absolute and copy-content, with one shared revert timer so only one confirms at a time.
  // The prefix keeps this screen's published `markdown-viewer-*` test ids.
  // While a file switch is in flight `content` still holds the previous file's
  // text, so it is withheld until this one has loaded.
  // A mockup is the exception: `MockupFrame` brings its own toolbar above the
  // frame (the width picker belongs next to it), so the breadcrumb slot stays
  // empty rather than mounting a second copy of the same buttons.
  useBreadcrumbActions(
    absolutePath && !isMockup ? (
      <ViewerActions
        absolutePath={absolutePath}
        relativePath={
          workspaceRoot ? relativeToWorkspace(absolutePath, workspaceRoot) : null
        }
        content={loading ? null : content}
        testIdPrefix="markdown-viewer"
      />
    ) : null,
    [absolutePath, workspaceRoot, content, loading, isMockup],
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

  // An html or image file is a mockup: render it, do not show its source (an
  // image's bytes are not even fetched as text). Same frame
  // component the mockups tab mounts, so both copy the same workspace-relative
  // path. It owns the full pane height and skips the image drop zone, which
  // only means something for markdown.
  if (isMockup)
    return (
      <div className="p-6 h-full min-h-0">
        <MockupFrame
          filePath={filePath}
          absolutePath={absolutePath}
          content={content}
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
        ) : tooLarge ? (
          <p
            data-testid="markdown-viewer-too-large"
            className="text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            This file is too large to show here (over{" "}
            {MOCKUP_MAX_SOURCE_BYTES / (1024 * 1024)} MB). Open it in VS Code instead.
          </p>
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
