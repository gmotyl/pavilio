import { useEffect, useState } from "react";
import { closesFence, fenceOpener, parseWikiLink } from "../../../server/lib/wiki/wikilinks";
import { encodePathSegments } from "./viewRoute";

/** What a wikilink hover card shows about its target page (design § Decisions 4). */
export type WikiLinkCardContent = { title?: string; description?: string; excerpt?: string };

const EXCERPT_MAX = 300;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
// A paragraph that, links removed, holds nothing but one of these lead words is "link-only".
const LINK_LEAD = /^(?:from|sources?|see(?: also)?|via|related)?$/i;
// Block starts that are not prose: headings, fences, quotes, lists, tables, HTML, rules.
const NON_PROSE = /^(?:#|```|~~~|>|[-*+]\s|\d+[.)]\s|\||<|---|\*\*\*|___)/;
// Lines that end the paragraph above them even without a blank line between.
const ATX_HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const BLOCK_START = /^ {0,3}(?:>|[-*+]\s|\d+[.)]\s|\||<)/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
// A YAML block scalar header: `>` or `|`, an optional chomping and indentation indicator, a comment.
const BLOCK_SCALAR = /^[>|](?:[+-]?\d?|\d[+-]?)[ \t]*(?:#.*)?$/;

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    return v.slice(1, -1);
  }
  return v;
}

function frontmatterDescription(yaml: string): string | undefined {
  const lines = yaml.split(/\r?\n/);
  const at = lines.findIndex((l) => /^description:/.test(l));
  if (at === -1) return undefined;
  const value = lines[at].replace(/^description:[ \t]*/, "");
  if (!BLOCK_SCALAR.test(value.trim())) return unquote(value) || undefined;
  // A block scalar's text is the indented lines below it. The card shows one line, so
  // folded (`>`) and literal (`|`) are both joined with spaces.
  const text: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && !/^[ \t]/.test(line)) break;
    text.push(line.trim());
  }
  return text.join(" ").replace(/\s+/g, " ").trim() || undefined;
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
  // The first H1 outside fenced code: a `# comment` in a leading shell block is not a title.
  let h1 = -1;
  let fence: ReturnType<typeof fenceOpener> = null;
  for (let i = 0; i < lines.length && h1 === -1; i++) {
    if (fence) {
      if (closesFence(lines[i], fence)) fence = null;
    } else {
      fence = fenceOpener(lines[i]);
      if (!fence && /^#\s+\S/.test(lines[i])) h1 = i;
    }
  }
  if (h1 !== -1) {
    const title = toPlainText(lines[h1].replace(/^#\s+/, "").replace(/\s+#+\s*$/, ""));
    if (title) content.title = title;
  }
  if (content.description) return content;

  // Paragraphs are runs of non-blank lines after the H1 (or from the top without one), cut
  // at every block start too: a heading or list right under a sentence is not part of it.
  // The H1 is outside any fence, so scanning restarts with none open.
  fence = null;
  let current: string[] = [];
  const paragraphs: string[] = [];
  const flush = () => {
    if (current.length) paragraphs.push(current.join("\n"));
    current = [];
  };
  for (const line of lines.slice(h1 + 1)) {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    fence = fenceOpener(line);
    if (fence) {
      flush();
    } else if (line.trim() === "") {
      flush();
    } else if (current.length && SETEXT_UNDERLINE.test(line)) {
      // The lines above are a setext heading, not prose.
      current = [];
    } else if (ATX_HEADING.test(line) || THEMATIC_BREAK.test(line)) {
      flush();
      paragraphs.push(line);
    } else if (BLOCK_START.test(line) && !(current.length && BLOCK_START.test(current[0]))) {
      // A new block, unless it continues one of its kind (the next item, quote or table row).
      flush();
      current.push(line);
    } else {
      current.push(line);
    }
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

/**
 * Largest page the card reads. The card needs only the head of a page, and the server reads
 * files synchronously: a bigger target is answered `tooLarge` and its card shows no content.
 */
export const WIKILINK_CARD_MAX_BYTES = 256 * 1024;

type CardState = { status: "idle" | "loading" | "ready" | "error"; content?: WikiLinkCardContent };

// Per-tab cache: a page's card is read once. A failed read is dropped so a later hover retries.
const cache = new Map<string, Promise<WikiLinkCardContent>>();
const resolved = new Map<string, WikiLinkCardContent>();

function loadCard(path: string): Promise<WikiLinkCardContent> {
  let pending = cache.get(path);
  if (!pending) {
    pending = fetch(`/api/files/read/${encodePathSegments(path)}?maxBytes=${WIKILINK_CARD_MAX_BYTES}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Not found (${res.status})`);
        const data = (await res.json()) as { content?: unknown; tooLarge?: unknown };
        if (typeof data?.content !== "string") throw new Error("No content");
        // Too large to read: the page exists, so the card shows the link label and path only.
        const content = data.tooLarge === true ? {} : parseCardContent(data.content);
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

/** Fetches `/api/files/read/<path>?maxBytes=…` once per path per tab (module-level cache); idle until `enabled`. */
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
