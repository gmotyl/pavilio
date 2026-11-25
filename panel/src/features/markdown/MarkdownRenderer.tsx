import { useNavigate } from "react-router-dom";
import { Children, cloneElement, createContext, isValidElement, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";
import CopyIconButton from "../shell/CopyIconButton";
import WikiLinkHoverCard from "./WikiLinkHoverCard";
import { highlightLines } from "./highlight";
import { HLJS_CLASS, numberStoryDiff, storyDiffLanguage, type StoryDiffLine } from "./storyDiff";
import { noteHits, noteTarget, type NoteTarget } from "./noteTarget";
import { extractWikiLinks } from "../../../server/lib/wiki/wikilinks";
import remarkWikiLinks, {
  owningProject,
  wikiLinkPath,
  WIKILINK_ATTR,
  WIKILINK_MISSING_CLASS,
} from "./remarkWikiLinks";

const MermaidDiagram = lazy(() => import("./MermaidDiagram"));

interface MarkdownRendererProps {
  content: string;
  /** Current file path relative to projectsDir, e.g. "my-project/PROJECT.md" */
  basePath?: string;
  /**
   * Markdown written by a third party (a GitHub PR body): no raw HTML, no
   * wikilinks, and every link and image resolved against `linkBase` (the page
   * the text came from) and opened outside the panel — never a panel route.
   * `imageBase`, when given, is what images resolve against instead (a file's
   * raw bytes, where `linkBase` is its HTML page).
   */
  untrusted?: { linkBase: string; imageBase?: string };
}

/** `url` made safe (`defaultUrlTransform`) and absolute against `base`; "" when it can't be. */
function resolveUntrustedUrl(url: string, base: string): string {
  const safe = defaultUrlTransform(url);
  if (!safe) return "";
  try {
    const resolved = new URL(safe, base);
    return resolved.protocol === "http:" || resolved.protocol === "https:" || resolved.protocol === "mailto:" ? resolved.href : "";
  } catch {
    return "";
  }
}

/**
 * A host-relative href (`/project/...`, but not protocol-relative `//host/...`)
 * is a panel route, not a file path: it is navigated to as-is, query included.
 */
function isAppRoute(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/**
 * A click the SPA should handle itself. Modifier and non-primary clicks keep
 * the browser default (new tab / window / download) on the real `href`.
 */
function isPlainLeftClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * A raw-HTML link that asks for another browsing context (`target="_blank"`,
 * a named frame) or a download keeps the browser's own behaviour.
 */
function wantsBrowserNavigation(a: HTMLAnchorElement): boolean {
  const target = a.getAttribute("target");
  return a.hasAttribute("download") || (!!target && target.toLowerCase() !== "_self");
}

function resolveRelativeHref(href: string, basePath: string): string | null {
  if (!href || href.startsWith("//") || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("vscode:")) return null;

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

/**
 * The raw-file URL for a resolved route path. A cross-root `_root/<id>/rest`
 * path is a viewer-route prefix, not a file under projectsDir: the raw route
 * selects that root with `?root=<id>`, as the read route does.
 */
function rawFileUrl(resolved: string): string {
  // The href may carry its own query and fragment: `root` joins that query,
  // and the fragment stays last.
  const hashAt = resolved.indexOf("#");
  const fragment = hashAt >= 0 ? resolved.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? resolved.slice(0, hashAt) : resolved;
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const query = queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "";

  const parts = path.split("/");
  if (parts[0] === "_root" && parts[1]) {
    const params = new URLSearchParams(query);
    params.set("root", parts[1]);
    return `/api/files/raw/${parts.slice(2).join("/")}?${params.toString()}${fragment}`;
  }
  return `/api/files/raw/${resolved}`;
}

/** Kinds whose first character is a diff prefix, so the rest is code. */
const CODE_KINDS = new Set<StoryDiffLine["kind"]>(["context", "added", "removed"]);

/**
 * Highlighted HTML per story line (null for a header or other non-code line), or null when the block
 * keeps the whole-line diff colouring: an unknown language, or a block too large to highlight. The code
 * lines, without their prefix, are highlighted as one text so multi-line tokens stay right.
 */
function colourStoryDiff(lines: StoryDiffLine[]): Array<string | null> | null {
  const lang = storyDiffLanguage(lines);
  if (!lang) return null;
  const code = lines.filter((line) => CODE_KINDS.has(line.kind));
  const { html, tokens } = highlightLines(code.map((line) => line.text.slice(1)), lang);
  if (!tokens) return null;
  let next = 0;
  return lines.map((line) => (CODE_KINDS.has(line.kind) ? html[next++] : null));
}

/** A hast node as the story-note binding reads and marks it. */
interface StoryHast {
  type?: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: StoryHast[];
  data?: { storyBlock?: number; storyNote?: StoryNote; storyNoteLabel?: boolean };
}

/** A line note bound to a story block: the block's id within the document and the rows its label names. */
interface StoryNote {
  block: number;
  label: string;
  target: NoteTarget;
}

/** The first child that is not whitespace-only text. */
function firstContent(node: StoryHast): StoryHast | undefined {
  return (node.children ?? []).find((c) => !(c.type === "text" && !(c.value ?? "").trim()));
}

/** The `code` of a `pre` holding a numbered story `diff` block, else null. */
function storyCode(pre: StoryHast): StoryHast | null {
  if (pre.tagName !== "pre") return null;
  const code = (pre.children ?? []).find((c) => c.type === "element");
  if (code?.tagName !== "code") return null;
  const cls = code.properties?.className;
  const classes = Array.isArray(cls) ? cls.map(String) : typeof cls === "string" ? cls.split(/\s+/) : [];
  if (!classes.includes("language-diff")) return null;
  return numberStoryDiff(hastText(code)) ? code : null;
}

/** Mark each item of a bound note list whose content starts with a bold line label, and that label. */
function bindNotes(ol: StoryHast, block: number): void {
  for (const li of ol.children ?? []) {
    if (li.tagName !== "li") continue;
    let first = firstContent(li);
    // A loose list wraps the item's text in a paragraph.
    if (first?.tagName === "p") first = firstContent(first);
    if (first?.type !== "element" || first.tagName !== "strong") continue;
    const label = hastText(first);
    const target = noteTarget(label);
    if (!target) continue;
    li.data = { ...li.data, storyNote: { block, label: label.trim(), target } };
    first.data = { ...first.data, storyNoteLabel: true };
  }
}

/**
 * Rehype plugin, run after rehype-raw so the nodes it marks are the ones the components get: gives each
 * numbered story `diff` block an id (on its `code`) and binds the ordered list directly after it — only
 * whitespace between — to that id. The marks live in hast `data`, which no authored HTML can set.
 */
function rehypeStoryNotes() {
  return (tree: StoryHast) => {
    let nextBlock = 0;
    const walk = (parent: StoryHast) => {
      let previous: number | null = null;
      for (const child of parent.children ?? []) {
        if (child.type === "text" && !(child.value ?? "").trim()) continue;
        if (child.type !== "element") {
          previous = null;
          continue;
        }
        if (previous !== null && child.tagName === "ol") bindNotes(child, previous);
        const code = storyCode(child);
        if (code) {
          code.data = { ...code.data, storyBlock: nextBlock };
          previous = nextBlock++;
        } else {
          previous = null;
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

/** The note whose rows are lit: at most one in the document at a time. */
interface NoteHit {
  block: number;
  target: NoteTarget;
}

/**
 * Which note is lit, outside React state: a hover re-renders only the story blocks that subscribe
 * to it, not the whole document (re-parsing the Markdown on every pointer move).
 */
function createNoteHitStore() {
  let hit: NoteHit | null = null;
  const listeners = new Set<() => void>();
  const set = (next: NoteHit | null) => {
    if (next === hit) return;
    hit = next;
    listeners.forEach((l) => l());
  };
  return {
    get: () => hit,
    set,
    /** Clears only `mine`, so leaving one note does not unlight another that has since taken over. */
    clear: (mine: NoteHit) => {
      if (hit === mine) set(null);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type NoteHitStore = ReturnType<typeof createNoteHitStore>;

const NoteHitContext = createContext<NoteHitStore | null>(null);

const NO_STORE: NoteHitStore = createNoteHitStore();

/** The lit target in this block, or null. */
function useBlockHit(block: number | undefined): NoteTarget | null {
  const store = useContext(NoteHitContext) ?? NO_STORE;
  return useSyncExternalStore(store.subscribe, () => {
    const hit = store.get();
    return hit && block !== undefined && hit.block === block ? hit.target : null;
  });
}

const HIT_CLASS = " story-line-hit";

/**
 * A numbered story `diff` block. The numbers live in `data-line` and are drawn by CSS
 * (`.diff-line::before`), so selecting and copying the code never picks them up; the copy button
 * reads the original children in the `pre` override. Rows a hovered note names get `story-line-hit`.
 */
function StoryDiffCode({ text, block, className, codeProps }: { text: string; block: number | undefined; className?: string; codeProps: Record<string, unknown> }) {
  // Highlighting is the costly part, so it runs again only when the block's text changes.
  const { lines, coloured } = useMemo(() => {
    const numbered = numberStoryDiff(text) ?? [];
    return { lines: numbered, coloured: colourStoryDiff(numbered) };
  }, [text]);
  const target = useBlockHit(block);
  const hitClass = (line: StoryDiffLine) => (target && noteHits(target, line) ? HIT_CLASS : "");
  if (coloured) {
    return (
      <code className={className} {...codeProps}>
        {lines.map((line, i) => {
          const code = coloured[i];
          if (code === null) {
            return (
              <span key={i} className={`diff-line${hitClass(line)}`} data-line={line.number ?? ""}>
                {line.text}
                {"\n"}
              </span>
            );
          }
          const tint = line.kind === "added" ? " story-line-added" : line.kind === "removed" ? " story-line-removed" : "";
          return (
            <span key={i} className={`diff-line story-line${tint}${hitClass(line)}`} data-line={line.number ?? ""} data-base={line.base ?? ""}>
              {/* The sign is the line's own prefix, as text, so selecting the block still copies the diff. */}
              <span className="story-line-sign">{line.text.slice(0, 1)}</span>
              <span className="story-line-code" dangerouslySetInnerHTML={{ __html: code }} />
              {"\n"}
            </span>
          );
        })}
      </code>
    );
  }
  return (
    <code className={className} {...codeProps}>
      {lines.map((line, i) => {
        const hljs = HLJS_CLASS[line.kind];
        return (
          <span key={i} className={`diff-line${hitClass(line)}`} data-line={line.number ?? ""} data-base={line.base ?? ""}>
            {hljs ? <span className={hljs}>{line.text}</span> : line.text}
            {"\n"}
          </span>
        );
      })}
    </code>
  );
}

/**
 * A note bound to the story block above it: hovering it, or focusing inside it (its bold label is
 * focusable), lights the rows its label names; leaving or blurring clears them.
 */
function StoryNoteItem({ note, children, liProps }: { note: StoryNote; children: ReactNode; liProps: Record<string, unknown> }) {
  const store = useContext(NoteHitContext) ?? NO_STORE;
  const { block } = note;
  const { side, from, to } = note.target;
  const hit = useMemo<NoteHit>(() => ({ block, target: { side, from, to } }), [block, side, from, to]);
  const light = () => store.set(hit);
  const clear = () => store.clear(hit);
  return (
    <li {...liProps} data-note-target={note.label} onMouseEnter={light} onMouseLeave={clear} onFocus={light} onBlur={clear}>
      {children}
    </li>
  );
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

interface HastLike {
  type?: string;
  value?: string;
  children?: HastLike[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

/** Text content of a hast node — the fallback when there is no Markdown source to cut. */
function hastText(node: HastLike | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

/**
 * What a blockquote's copy button puts on the clipboard: the quote's own
 * Markdown source with one level of `>` markers (and any list indentation in
 * front of them) taken off each line, so it pastes as the message it quotes —
 * the same Markdown the "Copy answer" button gives, minus the quoting. A nested
 * quote keeps its inner markers. A raw `<blockquote>` has no Markdown markers
 * to strip, so it copies its text instead of its tags.
 */
function quoteSource(node: HastLike | undefined, source: string): string {
  const start = node?.position?.start?.offset;
  const end = node?.position?.end?.offset;
  const slice = typeof start === "number" && typeof end === "number" ? source.slice(start, end) : "";
  if (!slice.startsWith(">")) return hastText(node).trim();
  // The slice starts at this quote's own marker, but its later lines still
  // carry every enclosing quote's marker too: count them from what precedes
  // the start on its line, and take those off before this quote's own.
  const lineStart = source.lastIndexOf("\n", start! - 1) + 1;
  const ancestors = (source.slice(lineStart, start).match(/>/g) ?? []).length;
  const continuation = new RegExp(`^(?:[ \\t]*> ?){0,${ancestors}}[ \\t]*> ?`);
  return slice
    .split("\n")
    .map((line, i) => line.replace(i === 0 ? /^> ?/ : continuation, ""))
    .join("\n")
    // Boundary blank lines only: leading spaces can be Markdown (an indented
    // code block), so the first line keeps its indentation.
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .trimEnd();
}

/**
 * The projectsDir-relative paths of every wikilink target in `content`, deduplicated and
 * sorted — joined with newlines so it is a stable effect dependency.
 */
function wikiLinkTargets(content: string, basePath: string | undefined): string {
  // Typed as a string, but it comes straight from a JSON response: a reply without
  // `content` must render as nothing (as react-markdown does), not crash the tab.
  if (typeof content !== "string" || !content.includes("[[")) return "";
  const fromProject = owningProject(basePath);
  const paths = new Set<string>();
  for (const link of extractWikiLinks(content)) {
    const path = wikiLinkPath(link, fromProject);
    if (path) paths.add(path);
  }
  return [...paths].sort().join("\n");
}

/** Quiet period before an existence check, so typing in a live preview does not fire a request per keystroke. */
const WIKILINK_CHECK_DEBOUNCE_MS = 250;

const NO_MISSING: ReadonlySet<string> = new Set();

/**
 * Which wikilink targets do not exist. Links render optimistically; once the server answers,
 * the missing ones turn into warning text. The previous answer stays until the next one
 * arrives (no flashing while editing), and a failed check leaves the current marks in place.
 */
function useMissingWikiLinks(targets: string): ReadonlySet<string> {
  const [missing, setMissing] = useState<ReadonlySet<string>>(NO_MISSING);
  useEffect(() => {
    if (!targets) {
      // Same identity when already empty, so a document without wikilinks never re-renders.
      setMissing(NO_MISSING);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/files/exists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: targets.split("\n") }),
        });
        if (!res.ok) return;
        const { exists } = (await res.json()) as { exists?: Record<string, boolean> };
        if (cancelled || !exists) return;
        const next = Object.keys(exists).filter((p) => exists[p] === false);
        setMissing(next.length ? new Set(next) : NO_MISSING);
      } catch {
        // Offline or no endpoint: keep the current marks.
      }
    }, WIKILINK_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [targets]);
  return missing;
}

export default function MarkdownRenderer({ content, basePath, untrusted }: MarkdownRendererProps) {
  if (untrusted) return <UntrustedMarkdown content={content} linkBase={untrusted.linkBase} imageBase={untrusted.imageBase} />;
  return <TrustedMarkdown content={content} basePath={basePath} />;
}

/**
 * Third-party markdown. Raw HTML is skipped outright (comments included), the
 * wikilink plugin is off, and URLs go through `resolveUntrustedUrl`, so a link
 * can neither run script nor land on a panel route. Fenced code is highlighted
 * but gets none of the trusted overrides (copy buttons, mermaid diagrams).
 */
function UntrustedMarkdown({ content, linkBase, imageBase }: { content: string; linkBase: string; imageBase?: string }) {
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, node: _node, ...props }) => (
        <a {...props} href={href || undefined} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
    }),
    [],
  );
  return (
    <div className="prose prose-invert prose-zinc max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { plainText: ["mermaid"] }]]}
        skipHtml
        urlTransform={(url, key) => resolveUntrustedUrl(url, key === "src" && imageBase ? imageBase : linkBase)}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function TrustedMarkdown({ content, basePath }: { content: string; basePath?: string }) {
  const navigate = useNavigate();
  const targets = useMemo(() => wikiLinkTargets(content, basePath), [content, basePath]);
  const missingWikiLinks = useMissingWikiLinks(targets);
  // Only paths the remark plugin generated from `[[…]]` are wikilinks: raw HTML can carry an
  // authored `data-wikilink`, which must not get a card (and a read of an arbitrary path).
  // `targets` is no allowlist — it scans the raw source, comments and link text included — so
  // the plugin fills this set itself while ReactMarkdown parses, before any anchor renders.
  // A fresh set per document, so a path dropped from the source drops out of it too; refilling
  // it on a re-render of the same document only re-adds the same paths. Read through a ref for
  // the same reason as `contentRef` below.
  const generatedWikiLinks = useMemo(() => new Set<string>(), [content, basePath]);
  const wikiLinkTargetsRef = useRef(generatedWikiLinks);
  wikiLinkTargetsRef.current = generatedWikiLinks;
  // Read through a ref, not a memo dependency: new override functions are new
  // component types, so every keystroke in a live preview would remount the
  // whole tree (mermaid diagrams included) just to refresh the quote text.
  const contentRef = useRef(content);
  contentRef.current = content;
  // One per renderer, so a note lights rows only in its own document.
  const noteHitStore = useMemo(createNoteHitStore, []);

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
        // A PR-explain story's diff block: numbered rows, coloured by language, lit by its notes.
        if (isBlock === true && /language-diff/.test(className || "")) {
          const text = extractText(children);
          if (numberStoryDiff(text)) {
            const block = (rest as { node?: StoryHast }).node?.data?.storyBlock;
            return <StoryDiffCode text={text} block={block} className={className} codeProps={props} />;
          }
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
      // A quoted message (a reply the answer proposes) is meant to be pasted
      // somewhere else; copying it by selection drags the `>` markers along.
      // Sibling button, positioned like the code block's.
      // A story line note: the item lights its block's rows, and its bold label is focusable so the
      // keyboard can do the same. Both marks come from `rehypeStoryNotes`; anything else renders as usual.
      li: ({ node, children, ...props }) => {
        const note = (node as StoryHast | undefined)?.data?.storyNote;
        if (!note) return <li {...props}>{children}</li>;
        return <StoryNoteItem note={note} liProps={props}>{children}</StoryNoteItem>;
      },
      strong: ({ node, ...props }) => {
        if ((node as StoryHast | undefined)?.data?.storyNoteLabel) return <strong tabIndex={0} {...props} />;
        return <strong {...props} />;
      },
      blockquote: ({ node, children, ...props }) => (
        <div className="code-block quote-block">
          <blockquote {...props}>{children}</blockquote>
          <CopyIconButton value={quoteSource(node as HastLike, contentRef.current ?? "")} label="Copy quote" />
        </div>
      ),
    };

    const inAppLink = (to: string, children: ReactNode, props: Record<string, unknown>) => (
      <a
        href={to}
        onClick={(e) => {
          if (!isPlainLeftClick(e) || wantsBrowserNavigation(e.currentTarget)) return;
          e.preventDefault();
          navigate(to);
        }}
        {...props}
      >
        {children}
      </a>
    );

    // App routes do not depend on where the file lives, so they work without a
    // basePath too (e.g. a design doc from an OpenSpec backend outside projectsDir).
    const linkElement = (href: string, children: ReactNode, props: Record<string, unknown>) => {
      if (isAppRoute(href)) return inAppLink(href, children, props);
      if (!basePath) return <a href={href} {...props}>{children}</a>;

      const resolved = resolveRelativeHref(href, basePath);
      if (!resolved) return <a href={href} {...props}>{children}</a>;

      // A download saves whatever the href answers, and `/view/*` is answered
      // with the SPA shell — so it gets the raw file, as images do.
      if (props.download !== undefined && props.download !== false) {
        return <a href={rawFileUrl(resolved)} {...props}>{children}</a>;
      }

      return inAppLink(`/view/${resolved}`, children, props);
    };

    const a: Components["a"] = ({ href, children, ...props }) => {
      if (!href) return <a {...props}>{children}</a>;
      const wikiTarget = (props as Record<string, unknown>)[WIKILINK_ATTR];
      if (typeof wikiTarget === "string" && wikiLinkTargetsRef.current.has(wikiTarget)) {
        if (missingWikiLinks.has(wikiTarget)) {
          return (
            <span className={WIKILINK_MISSING_CLASS} title={`Missing: ${wikiTarget}`}>
              {children}
            </span>
          );
        }
        // A resolved wikilink gets the hover card around the anchor it would have rendered anyway.
        return (
          <WikiLinkHoverCard path={wikiTarget} label={extractText(children)}>
            {linkElement(href, children, props)}
          </WikiLinkHoverCard>
        );
      }
      return linkElement(href, children, props);
    };

    // Relative links and images can only be resolved against a known base.
    if (!basePath) return { ...codeBlocks, a };

    return {
      ...codeBlocks,
      a,
      img: ({ src, alt, ...props }) => {
        if (!src || src.startsWith("http") || src.startsWith("data:")) {
          return <img src={src} alt={alt} {...props} />;
        }
        const resolved = resolveRelativeHref(src, basePath);
        if (!resolved) return <img src={src} alt={alt} {...props} />;
        return <img src={rawFileUrl(resolved)} alt={alt} {...props} />;
      },
    };
  }, [basePath, navigate, missingWikiLinks]);

  return (
    <div className="prose prose-invert prose-zinc max-w-none">
      <NoteHitContext.Provider value={noteHitStore}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, [remarkWikiLinks, { basePath, generated: generatedWikiLinks }]]}
          rehypePlugins={[[rehypeHighlight, { plainText: ["mermaid"] }], rehypeRaw, rehypeStoryNotes]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </NoteHitContext.Provider>
    </div>
  );
}
