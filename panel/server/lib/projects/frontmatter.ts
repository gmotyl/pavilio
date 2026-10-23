import { parse as parseYaml } from "yaml";

const FENCE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/**
 * Splits leading `---` frontmatter from a project markdown file. A UTF-8 BOM is dropped first
 * (editors on Windows may save one, which would hide the opening fence). No fence, broken YAML
 * and a non-mapping all yield `data: {}`; a duplicated key keeps its last value.
 */
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const match = FENCE.exec(text);
  if (!match) return { data: {}, body: text };
  const body = text.slice(match[0].length);
  try {
    const data = parseYaml(match[1] ?? "", { uniqueKeys: false });
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return { data: data as Record<string, unknown>, body };
    }
  } catch {
    // fall through: unreadable frontmatter carries no fields
  }
  return { data: {}, body };
}
