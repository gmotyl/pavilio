import { useNavigate } from "react-router-dom";
import { Children, cloneElement, isValidElement, lazy, Suspense, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";
import CopyIconButton from "../shell/CopyIconButton";

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

/**
 * The prop the `pre` override puts on its `code` child, so the `code` override
 * knows it is rendering a block. A prop, not an attribute: the `code` override
 * takes it out before anything reaches the DOM.
 *
 * camelCase on purpose: rehype-raw passes a note's own HTML attributes through
 * as props, but the HTML parser lowercases their names, so no `<code …>` in a
 * note can produce this one. A `data-*` name could, and would make inline code
 * a block (and lose the author's attribute).
 */
const BLOCK_PROP = "isFencedBlock";

/** Mark every `code` element directly under a `pre` as a block. */
function markBlockCode(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement<{ node?: { tagName?: string } }>(child)) return child;
    if (child.props.node?.tagName !== "code") return child;
    return cloneElement(child, { [BLOCK_PROP]: true } as Record<string, unknown>);
  });
}

export default function MarkdownRenderer({ content, basePath }: MarkdownRendererProps) {
  const navigate = useNavigate();

  const components = useMemo<Components>(() => {
    // Fenced-code handling does not depend on where the file lives. Keep it out
    // of the basePath guard below — a document from an OpenSpec backend outside
    // projectsDir has no relative path, and used to lose every override with it,
    // which left its mermaid diagrams rendered as plain code blocks.
    const codeBlocks: Components = {
      code: ({ className, children, ...rest }) => {
        // Out of the props before they are spread, so the marker never
        // becomes an attribute on the `code` element.
        const { [BLOCK_PROP]: isBlock, ...props } = rest as typeof rest & {
          [BLOCK_PROP]?: boolean;
        };
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
        const code = <code className={className} {...props}>{children}</code>;
        // react-markdown no longer says whether a `code` is inline, and gives
        // it no parent to ask, but the `pre` override sees its `code` child
        // before this runs and marks it (see `markBlockCode`). That holds for
        // the cases the text cannot tell apart: an empty fence, whose `code`
        // has no text at all, and a raw `<pre><code>` on one line. Unmarked
        // code is a span, and gets its own copy chip; a block's `code` keeps
        // only the `pre`'s button.
        if (isBlock === true) return code;
        const text = extractText(children);
        return (
          // An inline wrapper, so the sentence keeps flowing; the chip is
          // positioned against it, out of the text flow (see `index.css`).
          <span className="inline-code-wrap">
            {code}
            <span className="inline-code-copy">
              <CopyIconButton value={text} label="Copy" />
            </span>
          </span>
        );
      },
      pre: ({ children: rawChildren, ...props }) => {
        const children = markBlockCode(rawChildren);
        const child = (Array.isArray(children) ? children[0] : children) as any;
        // DEAD BRANCH — this is NOT the mermaid path. react-markdown hands
        // `pre` the *unrendered* element for the `code` node, so `child` here
        // carries the fence's own `language-mermaid` class; the
        // `mermaid-block` span is what the `code` override below returns
        // later, and it is never visible from here. Kept only because
        // deleting it is an unrelated cleanup — the live mermaid path is the
        // language-class check underneath.
        if (child?.props?.className === "mermaid-block") {
          return <>{children}</>;
        }
        // A mermaid fence renders as a diagram, so there is no text to copy.
        // This is the check that actually fires, for the reason above.
        if (/language-mermaid/.test(child?.props?.className ?? "")) {
          return <pre {...props}>{children}</pre>;
        }
        // `extractText` walks `props.children` only, so the language class is
        // not in the result; the fence contributes one trailing newline that a
        // reader never wants pasted, the same trim mermaid does above.
        const text = extractText(children).replace(/\n$/, "");
        return (
          // The button is a SIBLING of the `pre`, not a child of it, because
          // nothing inside the fence is a stable anchor. In a highlighted fence
          // the horizontal scroll box is the `code` INSIDE the `pre`: the
          // highlight.js theme makes `pre code.hljs` `display: block` +
          // `overflow-x: auto`, so wide code slides inside the `code` while the
          // `pre` stays at its container width. An unlabelled fence gets no
          // `hljs` class, and then the `pre`'s own `overflow-x: auto` (from
          // `@tailwindcss/typography`) is what scrolls. This wrapper scrolls in
          // neither case, so the button is positioned against it and stays in
          // the corner.
          <div className="code-block">
            <pre {...props}>{children}</pre>
            <CopyIconButton value={text} label="Copy code" />
          </div>
        );
      },
    };

    // Relative links and images can only be resolved against a known base.
    if (!basePath) return codeBlocks;

    return {
      ...codeBlocks,
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
