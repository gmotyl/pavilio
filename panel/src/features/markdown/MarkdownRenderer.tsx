import { useNavigate } from "react-router-dom";
import { lazy, Suspense, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";

const MermaidDiagram = lazy(() => import("./MermaidDiagram"));

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

/** Extract plain text from React children (handles nested spans from rehype-highlight leftovers) */
function extractText(children: any): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children?.props?.children) return extractText(children.props.children);
  return String(children ?? "");
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
      img: ({ src, alt, ...props }) => {
        if (!src || src.startsWith("http") || src.startsWith("data:")) {
          return <img src={src} alt={alt} {...props} />;
        }
        const resolved = resolveRelativeHref(src, basePath);
        if (!resolved) return <img src={src} alt={alt} {...props} />;
        return <img src={`/api/files/raw/${resolved}`} alt={alt} {...props} />;
      },
      code: ({ className, children, ...props }) => {
        if (/language-mermaid/.test(className || "")) {
          const chart = extractText(children).replace(/\n$/, "");
          return (
            <span className="mermaid-block">
              <Suspense fallback={<div className="animate-pulse rounded bg-zinc-800 p-8 text-center text-zinc-500">Loading diagram…</div>}>
                <MermaidDiagram chart={chart} />
              </Suspense>
            </span>
          );
        }
        return <code className={className} {...props}>{children}</code>;
      },
      pre: ({ children, ...props }) => {
        const child = (Array.isArray(children) ? children[0] : children) as any;
        if (child?.props?.className === "mermaid-block") {
          return <>{children}</>;
        }
        return <pre {...props}>{children}</pre>;
      },
    };
  }, [basePath, navigate]);

  return (
    <div className="prose prose-invert prose-zinc max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { plainText: ["mermaid"] }], rehypeRaw]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
