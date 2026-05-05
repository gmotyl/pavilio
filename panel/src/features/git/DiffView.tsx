import { useMemo, useState, useEffect, useRef } from "react";
import hljs from "highlight.js";

export type DiffMode = "inline" | "side-by-side";

interface DiffViewProps {
  diff: string;
  mode: DiffMode;
  /** Filename hint for syntax highlighting (e.g. "app.tsx") */
  filename?: string;
  /** Text to highlight in the diff (e.g. search query) */
  highlight?: string;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  css: "css", scss: "scss", html: "xml", vue: "xml", svelte: "xml",
  json: "json", yaml: "yaml", yml: "yaml", toml: "ini",
  md: "markdown", sh: "bash", zsh: "bash", bash: "bash",
  sql: "sql", graphql: "graphql", dockerfile: "dockerfile",
};

export function detectLang(filename?: string): string | undefined {
  if (!filename) return undefined;
  const name = filename.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  const ext = name.split(".").pop() ?? "";
  return EXT_TO_LANG[ext];
}

function highlightLine(code: string, lang?: string): string {
  if (!code.trim()) return escapeHtml(code);
  try {
    const result = lang
      ? hljs.highlight(code, { language: lang, ignoreIllegals: true })
      : hljs.highlightAuto(code);
    return result.value;
  } catch {
    return escapeHtml(code);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function injectHighlight(html: string, term: string): string {
  if (!term) return html;
  // Only highlight text outside HTML tags
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  return html.replace(/(<[^>]*>)|([^<]+)/g, (match, tag, text) => {
    if (tag) return tag;
    return text.replace(re, '<mark style="background:#ca8a0460;color:var(--text-primary);border-radius:2px">$1</mark>');
  });
}

export default function DiffView({ diff, mode, filename, highlight }: DiffViewProps) {
  const [localSearch, setLocalSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !searchOpen && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchOpen]);

  const activeHighlight = searchOpen && localSearch ? localSearch : highlight ?? "";

  if (!diff) return <p className="text-xs" style={{ color: "var(--text-muted)" }}>No changes (binary or new file)</p>;

  const lang = detectLang(filename);

  const lines = useMemo(() => diff.split("\n"), [diff]);

  const searchBar = searchOpen && (
    <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg text-xs" style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)" }}>
      <span style={{ color: "var(--text-muted)" }}>/</span>
      <input
        ref={searchRef}
        value={localSearch}
        onChange={(e) => setLocalSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { setSearchOpen(false); setLocalSearch(""); } }}
        placeholder="highlight..."
        className="flex-1 bg-transparent outline-none font-mono"
        style={{ color: "var(--text-primary)" }}
        spellCheck={false}
      />
      {localSearch && (
        <span style={{ color: "var(--text-muted)" }}>{(diff.match(new RegExp(localSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) || []).length} matches</span>
      )}
      <button data-testid="diff-view-search-close" onClick={() => { setSearchOpen(false); setLocalSearch(""); }} style={{ color: "var(--text-muted)" }}>ESC</button>
    </div>
  );

  if (mode === "inline") {
    return (
      <div>
      {searchBar}
      <pre className="text-xs font-mono overflow-auto rounded-lg p-3 leading-relaxed" style={{ background: "var(--bg-base)" }}>
        {lines.map((line, i) => {
          let cls = "";
          let content = line;
          if (line.startsWith("+") && !line.startsWith("+++")) {
            cls = "diff-line-add";
            content = line.slice(1);
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            cls = "diff-line-remove";
            content = line.slice(1);
          } else if (line.startsWith("@@")) {
            cls = "diff-line-header";
            return <div key={i} className={`px-2 ${cls}`}>{line}</div>;
          } else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
            return <div key={i} className="px-2" style={{ color: "var(--text-muted)" }}>{line}</div>;
          } else {
            content = line.startsWith(" ") ? line.slice(1) : line;
          }

          const prefix = line.startsWith("+") && !line.startsWith("+++") ? "+" : line.startsWith("-") && !line.startsWith("---") ? "-" : " ";
          const highlighted = injectHighlight(highlightLine(content, lang), activeHighlight);

          return (
            <div key={i} className={`px-2 ${cls}`}>
              <span style={{ color: "var(--text-muted)", userSelect: "none" }}>{prefix}</span>
              <span dangerouslySetInnerHTML={{ __html: highlighted }} />
            </div>
          );
        })}
      </pre>
      </div>
    );
  }

  // Side-by-side
  const left: { line: string; type: string; html: string }[] = [];
  const right: { line: string; type: string; html: string }[] = [];
  let li = 0, ri = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      while (li < ri) { left.push({ line: "", type: "pad", html: "" }); li++; }
      while (ri < li) { right.push({ line: "", type: "pad", html: "" }); ri++; }
      left.push({ line, type: "header", html: escapeHtml(line) }); li++;
      right.push({ line, type: "header", html: escapeHtml(line) }); ri++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      const code = line.slice(1);
      left.push({ line: code, type: "remove", html: injectHighlight(highlightLine(code, lang), activeHighlight) }); li++;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      const code = line.slice(1);
      right.push({ line: code, type: "add", html: injectHighlight(highlightLine(code, lang), activeHighlight) }); ri++;
    } else if (!line.startsWith("diff ") && !line.startsWith("index ") && !line.startsWith("---") && !line.startsWith("+++")) {
      while (li < ri) { left.push({ line: "", type: "pad", html: "" }); li++; }
      while (ri < li) { right.push({ line: "", type: "pad", html: "" }); ri++; }
      const code = line.startsWith(" ") ? line.slice(1) : line;
      const html = injectHighlight(highlightLine(code, lang), activeHighlight);
      left.push({ line: code, type: "context", html }); li++;
      right.push({ line: code, type: "context", html }); ri++;
    }
  }
  while (li < ri) { left.push({ line: "", type: "pad", html: "" }); li++; }
  while (ri < li) { right.push({ line: "", type: "pad", html: "" }); ri++; }

  const typeClass = (t: string) =>
    t === "add" ? "diff-line-add" : t === "remove" ? "diff-line-remove" : t === "header" ? "diff-line-header" : "";

  return (
    <div>
      {searchBar}
      <div className="flex gap-0 overflow-auto rounded-lg w-full" style={{ background: "var(--bg-base)" }}>
        <pre className="text-xs font-mono w-1/2 min-w-0 leading-relaxed p-2 overflow-x-auto" style={{ borderRight: "1px solid var(--border-subtle)" }}>
          {left.map((l, i) => (
            <div key={i} className={`px-2 ${typeClass(l.type)}`}>
              {l.html ? <span dangerouslySetInnerHTML={{ __html: l.html }} /> : "\u00a0"}
            </div>
          ))}
        </pre>
        <pre className="text-xs font-mono w-1/2 min-w-0 leading-relaxed p-2 overflow-x-auto">
          {right.map((l, i) => (
            <div key={i} className={`px-2 ${typeClass(l.type)}`}>
              {l.html ? <span dangerouslySetInnerHTML={{ __html: l.html }} /> : "\u00a0"}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
