/*
 * Ported from fetch_article.py in decodingai-magazine/llm-wiki-workshop
 * (https://github.com/decodingai-magazine/llm-wiki-workshop).
 *
 * MIT License
 *
 * Copyright (c) 2026 Decoding AI Magazine
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

/**
 * Fetch a web article into `<projectDir>/wiki/raw/article-<slug>.md` as markdown.
 *
 * Three jobs, in order: get the HTML (with a browser user agent, because most
 * publishers block default client UAs), find the part of the page that is the
 * article (Readability), and convert only that fragment to markdown (Turndown).
 */

/** Publishers block default fetch/curl user agents; pose as a desktop browser. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export const FETCH_TIMEOUT_MS = 60_000;
/** A body shorter than this is most likely a paywall, bot wall or teaser. */
export const MIN_ARTICLE_WORDS = 300;
/** Paywall markers only count on bodies shorter than this; long articles often carry subscribe CTAs. */
export const PAYWALL_MARKER_MAX_WORDS = 600;

const PAYWALL_MARKERS = [
  /for paid subscribers/i,
  /subscribe to (continue|keep) reading/i,
  /this (post|article|story) is for (paid )?(subscribers|members)/i,
  /members[- ]only/i,
  /already a (subscriber|member)\?/i,
  /sign in to (continue|read)/i,
  /you('ve| have) reached your (free )?article limit/i,
];

const STRIP_TAGS = ["script", "style", "noscript", "nav", "footer", "form", "button", "svg", "iframe"];

export type ArticleReceipt = {
  /** Raw file path relative to the wiki dir, e.g. `raw/article-<slug>.md`. */
  raw: string;
  title: string;
  warning?: string;
};

export type FetchArticleOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: Date;
};

/** Filesystem-safe, deterministic slug: ASCII, lowercase, dash-separated, ≤ 60 chars. */
export function slugify(text: string, limit = 60): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (slug.length <= limit) return slug;
  const cut = slug.slice(0, limit);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 0 ? cut.slice(0, lastDash) : cut;
}

/** Slug from the last URL path segment, falling back to the title. */
export function articleSlug(url: string, title: string): string {
  let segment = "";
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    segment = parts.length ? decodeURIComponent(parts[parts.length - 1]).replace(/\.html?$/i, "") : "";
  } catch {
    // not a URL — use the title
  }
  return slugify(segment) || slugify(title) || "untitled";
}

function metaContent(document: Document, selector: string): string | null {
  const value = document.querySelector(selector)?.getAttribute("content")?.trim();
  return value ? value : null;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

async function fetchHtml(url: string, options: FetchArticleOptions): Promise<string> {
  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`fetch failed for ${url}: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
    throw new Error(`not an HTML page: ${url} (${type})`);
  }
  const html = await res.text();
  if (!html.trim()) throw new Error(`fetch failed for ${url}: empty response`);
  return html;
}

function toMarkdown(html: string): string {
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  turndown.remove(STRIP_TAGS as (keyof HTMLElementTagNameMap)[]);
  return turndown.turndown(html).trim();
}

/** Fetch `url`, extract the main content and write the raw snapshot. */
export async function fetchArticle(
  projectDir: string,
  url: string,
  options: FetchArticleOptions = {},
): Promise<ArticleReceipt> {
  const html = await fetchHtml(url, options);
  const { document } = parseHTML(html);

  const ogTitle = metaContent(document, 'meta[property="og:title"]');
  const docTitle = document.querySelector("title")?.textContent?.trim() || null;

  // Readability mutates the document, so read metadata first and parse a copy.
  const parsed = new Readability(parseHTML(html).document as unknown as Document, { charThreshold: 0 }).parse();
  const title = ogTitle || parsed?.title?.trim() || docTitle || url;

  let bodyHtml = parsed?.content ?? "";
  if (!bodyHtml.trim()) {
    for (const tag of document.querySelectorAll(STRIP_TAGS.join(","))) tag.remove();
    bodyHtml = (document.querySelector("article") ?? document.querySelector("main") ?? document.body)?.innerHTML ?? "";
  }
  let body = toMarkdown(bodyHtml);
  // The title is written as the H1 below; drop a duplicate leading H1.
  body = body.replace(/^#\s+(.+)\n+/, (line, heading: string) => (heading.trim() === title ? "" : line));

  const slug = articleSlug(url, title);
  const raw = `raw/article-${slug}.md`;
  const fetched = (options.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const header = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `source_url: ${JSON.stringify(url)}`,
    "origin: article",
    `fetched: ${fetched}`,
    "---",
    "",
    `# ${title}`,
    "",
    "",
  ].join("\n");
  const file = join(projectDir, "wiki", raw);
  mkdirSync(join(projectDir, "wiki", "raw"), { recursive: true });
  writeFileSync(file, `${header}${body}\n`);

  const receipt: ArticleReceipt = { raw, title };
  const words = countWords(parsed?.textContent ?? body);
  const marker = words < PAYWALL_MARKER_MAX_WORDS && PAYWALL_MARKERS.some((re) => re.test(body));
  if (marker) {
    receipt.warning = "body matches a paywall marker — likely a subscriber-only stub";
  } else if (words < MIN_ARTICLE_WORDS) {
    receipt.warning = `body is only ${words} words — paywall, bot wall, or missed main content`;
  }
  return receipt;
}
