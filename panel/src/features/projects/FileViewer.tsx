import { useState } from "react";
import { ArrowLeft, ExternalLink, Copy, Check } from "lucide-react";
import ImageDropZone from "../markdown/ImageDropZone";
import MarkdownRenderer from "../markdown/MarkdownRenderer";

interface Props {
  filePath: string;
  content: string;
  absolutePath: string;
  loading: boolean;
  onBack: () => void;
}

const isMarkdown = (p: string) => p.endsWith(".md");
const isJson = (p: string) => p.endsWith(".json");

const openInVSCode = (path: string) =>
  window.open(`vscode://file/${path}`, "_self");

export function FileViewer({
  filePath,
  content,
  absolutePath,
  loading,
  onBack,
}: Props) {
  const [copied, setCopied] = useState(false);

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <div
        className="flex items-center gap-2 mb-4 pb-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <button
          onClick={onBack}
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
          <ArrowLeft size={14} />
          Back
        </button>
        <span
          className="text-sm font-mono truncate flex-1"
          style={{ color: "var(--text-tertiary)" }}
        >
          {filePath.split("/").pop()}
        </span>
        {absolutePath && (
          <>
            <button
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
              onClick={() => copyPath(absolutePath)}
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
        )}
      </div>
      {loading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading...
        </p>
      ) : (
        <ImageDropZone targetMarkdown={filePath}>
          {isMarkdown(filePath) ? (
            <MarkdownRenderer content={content} basePath={filePath} />
          ) : isJson(filePath) ? (
            <pre
              className="text-sm font-mono p-4 rounded-lg overflow-auto"
              style={{ background: "var(--bg-surface)" }}
            >
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(content), null, 2);
                } catch {
                  return content;
                }
              })()}
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
      )}
    </div>
  );
}

export default FileViewer;
