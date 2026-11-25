import hljs from "highlight.js";
import { MAX_HIGHLIGHT_CHARS } from "./highlightLimit";

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin",
  css: "css", scss: "scss", html: "xml", xml: "xml", vue: "xml", svelte: "xml",
  json: "json", yaml: "yaml", yml: "yaml", toml: "ini",
  md: "markdown", sh: "bash", zsh: "bash", bash: "bash",
  sql: "sql", graphql: "graphql", dockerfile: "dockerfile",
};

/** highlight.js language for a path, by extension (or a bare `Dockerfile`). */
export function detectLang(path: string): string | undefined {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  return EXT_TO_LANG[name.split(".").pop() ?? ""];
}

export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Highlight `lines` as one text so multi-line tokens (comments, template strings) stay right, then split back per line.
 * `tokens` is false when the text rendered plain, so no token classes exist.
 */
export function highlightLines(lines: string[], lang: string | undefined): { html: string[]; tokens: boolean } {
  // An empty text still highlights to one (empty) line; keep the counts equal.
  if (lines.length === 0) return { html: [], tokens: true };
  const text = lines.join("\n");
  const plain = () => ({ html: lines.map(escapeHtml), tokens: false });
  if (!lang || text.length > MAX_HIGHLIGHT_CHARS) return plain();
  let html: string;
  try {
    html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return plain();
  }
  const out: string[] = [];
  const open: string[] = [];
  let cur = "";
  let last = 0;
  // Spans crossing a newline are closed at the line end and reopened on the next line.
  for (const m of html.matchAll(/<span[^>]*>|<\/span>|\n/g)) {
    cur += html.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0] === "\n") {
      out.push(cur + "</span>".repeat(open.length));
      cur = open.join("");
    } else {
      if (m[0] === "</span>") open.pop();
      else open.push(m[0]);
      cur += m[0];
    }
  }
  out.push(cur + html.slice(last) + "</span>".repeat(open.length));
  return { html: out, tokens: true };
}
