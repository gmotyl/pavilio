import { useNavigate } from "react-router-dom";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  /** Current file path relative to projectsDir, e.g. "my-project/PROJECT.md" */
  basePath?: string;
}

function resolveRelativeHref(href: string, basePath: string): string | null {
  if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("vscode:")) return null;

  const parts = basePath.split("/");
  parts.pop(); // remove filename → directory
  const dir = parts.join("/");

  const segments = (dir ? dir + "/" + href : href).split("/");
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") { resolved.pop(); continue; }
    resolved.push(seg);
  }

  return resolved.join("/");
}

export default function MarkdownRenderer({ content, basePath }: MarkdownRendererProps) {
  const navigate = useNavigate();

  const components = useMemo<Components>(() => {
    if (!basePath) return {};

    return {
      a: ({ href, children, ...props }) => {
        if (!href) return <a {...props}>{children}</a>;

        const resolved = resolveRelativeHref(href, basePath);
        if (!resolved) return <a href={href} {...props}>{children}</a>;

        const viewPath = `/view/${resolved}`;

        return (
          <a
            href={viewPath}
            onClick={(e) => {
              e.preventDefault();
              navigate(viewPath);
            }}
            {...props}
          >
            {children}
          </a>
        );
      },
    };
  }, [basePath, navigate]);

  return (
    <div className="prose prose-invert prose-zinc max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeRaw]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
