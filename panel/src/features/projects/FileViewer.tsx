import ImageDropZone from "../markdown/ImageDropZone";
import MarkdownRenderer from "../markdown/MarkdownRenderer";
import ViewerActions from "./ViewerActions";
import { usePeekTriggerProps } from "./peekTrigger";

interface Props {
  filePath: string;
  content: string;
  absolutePath: string;
  loading: boolean;
}

const isMarkdown = (p: string) => p.endsWith(".md");
const isJson = (p: string) => p.endsWith(".json");

export function FileViewer({
  filePath,
  content,
  absolutePath,
  loading,
}: Props) {
  const peekTrigger = usePeekTriggerProps();
  return (
    <div>
      <div
        className="flex items-center gap-2 mb-4 pb-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span
          {...peekTrigger}
          data-testid="file-list-peek-trigger"
          className="text-sm font-mono truncate flex-1 cursor-default"
          style={{ color: "var(--text-tertiary)" }}
        >
          {filePath.split("/").pop()}
        </span>
        {absolutePath && <ViewerActions absolutePath={absolutePath} />}
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
