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
