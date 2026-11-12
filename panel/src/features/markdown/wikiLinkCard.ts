import { useEffect, useState } from "react";
import { parseWikiLink } from "../../../server/lib/wiki/wikilinks";
import { encodePathSegments } from "./viewRoute";

/** What a wikilink hover card shows about its target page (design § Decisions 4). */
export type WikiLinkCardContent = { title?: string; description?: string; excerpt?: string };

const EXCERPT_MAX = 300;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
// A paragraph that, links removed, holds nothing but one of these lead words is "link-only".
const LINK_LEAD = /^(?:from|sources?|see(?: also)?|via|related)?$/i;
// Block starts that are not prose: headings, fences, quotes, lists, tables, HTML, rules.
const NON_PROSE = /^(?:#|```|~~~|>|[-*+]\s|\d+[.)]\s|\||<|---|\*\*\*|___)/;

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    return v.slice(1, -1);
  }
  return v;
}

function frontmatterDescription(yaml: string): string | undefined {
  const line = /^description:[ \t]*(.*)$/m.exec(yaml);
  const value = line ? unquote(line[1]) : "";
  return value || undefined;
}

/** Inline markdown reduced to the text a reader sees. */
function toPlainText(markdown: string): string {
  return markdown
    .replace(/\[\[([^\]]+)\]\]/g, (_, raw: string) => parseWikiLink(raw)?.label ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function isLinkOnly(paragraph: string): boolean {
  const rest = paragraph
    .replace(/!?\[\[[^\]]*\]\]/g, "")
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[\s\p{P}]+/gu, " ")
    .trim();
  return LINK_LEAD.test(rest);
}

function cap(text: string): string {
  if (text.length <= EXCERPT_MAX) return text;
  const space = text.lastIndexOf(" ", EXCERPT_MAX);
  const cut = space > 0 ? text.slice(0, space) : text.slice(0, EXCERPT_MAX);
  return `${cut.trimEnd()}…`;
}

/** Title, frontmatter description and first prose paragraph of a markdown page. */
export function parseCardContent(markdown: string): WikiLinkCardContent {
  const content: WikiLinkCardContent = {};
  let body = markdown;
  const fm = FRONTMATTER.exec(markdown);
  if (fm) {
    body = markdown.slice(fm[0].length);
    const description = frontmatterDescription(fm[1]);
    if (description) content.description = description;
  }

  const lines = body.split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1 !== -1) {
    const title = toPlainText(lines[h1].replace(/^#\s+/, "").replace(/\s+#+\s*$/, ""));
    if (title) content.title = title;
  }
  if (content.description) return content;

  // Paragraphs are runs of non-blank lines after the H1 (or from the top without one).
  let inFence = false;
  let current: string[] = [];
  const paragraphs: string[] = [];
  const flush = () => {
    if (current.length) paragraphs.push(current.join("\n"));
    current = [];
  };
  for (const line of lines.slice(h1 + 1)) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === "") flush();
    else current.push(line);
  }
  flush();

  for (const paragraph of paragraphs) {
    if (NON_PROSE.test(paragraph.trimStart()) || isLinkOnly(paragraph)) continue;
    const text = toPlainText(paragraph);
    if (text) {
      content.excerpt = cap(text);
      break;
    }
  }
  return content;
}

type CardState = { status: "idle" | "loading" | "ready" | "error"; content?: WikiLinkCardContent };

// Per-tab cache: a page's card is read once. A failed read is dropped so a later hover retries.
const cache = new Map<string, Promise<WikiLinkCardContent>>();
const resolved = new Map<string, WikiLinkCardContent>();

function loadCard(path: string): Promise<WikiLinkCardContent> {
  let pending = cache.get(path);
  if (!pending) {
    pending = fetch(`/api/files/read/${encodePathSegments(path)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Not found (${res.status})`);
        const data = (await res.json()) as { content?: unknown };
        if (typeof data?.content !== "string") throw new Error("No content");
        const content = parseCardContent(data.content);
        resolved.set(path, content);
        return content;
      })
      .catch((e: unknown) => {
        cache.delete(path);
        throw e;
      });
    cache.set(path, pending);
  }
  return pending;
}

/** Fetches `/api/files/read/<path>` once per path per tab (module-level cache); idle until `enabled`. */
export function useWikiLinkCard(path: string, enabled: boolean): CardState {
  const [state, setState] = useState<CardState & { path?: string }>({ status: "idle" });

  useEffect(() => {
    if (!enabled) return;
    const hit = resolved.get(path);
    if (hit) {
      setState({ status: "ready", content: hit, path });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", path });
    loadCard(path).then(
      (content) => {
        if (!cancelled) setState({ status: "ready", content, path });
      },
      () => {
        if (!cancelled) setState({ status: "error", path });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);

  // A state left over from another path is not this path's answer.
  if (state.path !== path) {
    if (!enabled) return { status: "idle" };
    const hit = resolved.get(path);
    return hit ? { status: "ready", content: hit } : { status: "loading" };
  }
  return state.content ? { status: state.status, content: state.content } : { status: state.status };
}

/** Empties the per-tab cache so each test starts from a fresh tab. */
export function __resetWikiLinkCardCacheForTests(): void {
  cache.clear();
  resolved.clear();
}
