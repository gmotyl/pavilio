import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, readFileSync, existsSync, symlinkSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import { join } from "path";

import { fetchArticle } from "../fetch-article";

const PARAGRAPH =
  "Retrieval pipelines decay quietly when nobody owns the source of truth, and the wiki keeps that ownership explicit. " +
  "Every ingest writes a raw snapshot first, then the writer distills durable facts into typed pages with backlinks. ";

const ARTICLE_HTML = `<!doctype html>
<html><head><title>Ignored tab title</title>
<meta property="og:title" content="How Wikis Beat Context Windows">
</head><body>
<nav><a href="/">Home</a> <a href="/about">About</a> Subscribe now</nav>
<article>
  <h1>How Wikis Beat Context Windows</h1>
  <p>${PARAGRAPH.repeat(4)}</p>
  <h2>Why raw snapshots</h2>
  <p>${PARAGRAPH.repeat(4)}</p>
  <ul><li>First <strong>point</strong></li><li>Second point</li></ul>
  <p>${PARAGRAPH.repeat(4)}</p>
</article>
<footer>Cookie banner text</footer>
</body></html>`;

const PAYWALL_HTML = `<!doctype html>
<html><head><title>Members Only Deep Dive</title></head><body>
<article>
  <h1>Members Only Deep Dive</h1>
  <p>The first paragraph teases the argument about wikis and context windows in a sentence or two.</p>
  <p>This post is for paid subscribers. Subscribe to continue reading.</p>
</article>
</body></html>`;

// A full-length article whose footer CTA mentions subscribers must not be flagged.
const LONG_WITH_CTA_HTML = ARTICLE_HTML.replace(
  "</article>",
  `<p>${PARAGRAPH.repeat(20)}</p><p>Already a subscriber? This post is for paid subscribers too.</p></article>`,
);

let server: Server;
let baseUrl = "";
let projectDir = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const body =
      req.url === "/p/paywalled" ? PAYWALL_HTML : req.url === "/p/long-with-cta" ? LONG_WITH_CTA_HTML : ARTICLE_HTML;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wiki-fetch-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("fetchArticle", () => {
  it("refuses to write through a symlinked snapshot file", async () => {
    const outside = mkdtempSync(join(tmpdir(), "wiki-fetch-outside-"));
    try {
      writeFileSync(join(outside, "target.md"), "keep\n");
      mkdirSync(join(projectDir, "wiki", "raw"), { recursive: true });
      symlinkSync(join(outside, "target.md"), join(projectDir, "wiki", "raw", "article-story.md"));

      await expect(fetchArticle(projectDir, `${baseUrl}/a/story`)).rejects.toThrow(/symlink/i);
      expect(readFileSync(join(outside, "target.md"), "utf8")).toBe("keep\n");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refreshes the same URL in place and suffixes a colliding slug from another URL", async () => {
    const first = await fetchArticle(projectDir, `${baseUrl}/a/story`);
    expect(first.raw).toBe("raw/article-story.md");
    expect((await fetchArticle(projectDir, `${baseUrl}/a/story`)).raw).toBe("raw/article-story.md");

    const other = await fetchArticle(projectDir, `${baseUrl}/b/story`);
    expect(other.raw).toMatch(/^raw\/article-story-[0-9a-f]{6}\.md$/);
    expect(readFileSync(join(projectDir, "wiki", first.raw), "utf8")).toContain(`${baseUrl}/a/story`);
    expect(readFileSync(join(projectDir, "wiki", other.raw), "utf8")).toContain(`${baseUrl}/b/story`);
    // Deterministic: the other URL lands on its suffixed file again.
    expect((await fetchArticle(projectDir, `${baseUrl}/b/story`)).raw).toBe(other.raw);
  });

  it("refuses a symlinked wiki/raw without writing through it", async () => {
    const outside = mkdtempSync(join(tmpdir(), "wiki-fetch-outside-"));
    try {
      mkdirSync(join(projectDir, "wiki"));
      symlinkSync(outside, join(projectDir, "wiki", "raw"));

      await expect(fetchArticle(projectDir, `${baseUrl}/p/x`)).rejects.toThrow(/symlink/i);
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("converts an article to markdown", async () => {
    const url = `${baseUrl}/p/how-wikis-beat-context-windows`;
    const receipt = await fetchArticle(projectDir, url, { now: new Date("2026-10-20T12:00:00Z") });

    expect(receipt.title).toBe("How Wikis Beat Context Windows");
    expect(receipt.raw).toBe("raw/article-how-wikis-beat-context-windows.md");
    expect(receipt.warning).toBeUndefined();

    const file = join(projectDir, "wiki", receipt.raw);
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text).toContain(`source_url: ${JSON.stringify(url)}`);
    expect(text).toContain("fetched: 2026-10-20T12:00:00Z");
    expect(text).toContain("# How Wikis Beat Context Windows");
    expect(text).toContain("## Why raw snapshots");
    expect(text).toContain("**point**");
    expect(text).toContain("Retrieval pipelines decay quietly");
    // Chrome outside the main content is dropped.
    expect(text).not.toContain("Cookie banner text");
    expect(text).not.toContain("Subscribe now");
  });

  it("warns on a paywall stub", async () => {
    const receipt = await fetchArticle(projectDir, `${baseUrl}/p/paywalled`);

    expect(receipt.title).toBe("Members Only Deep Dive");
    expect(receipt.raw).toBe("raw/article-paywalled.md");
    expect(receipt.warning).toMatch(/paywall|words/i);
    expect(existsSync(join(projectDir, "wiki", receipt.raw))).toBe(true);
  });

  it("does not flag a long article that mentions subscribers", async () => {
    const receipt = await fetchArticle(projectDir, `${baseUrl}/p/long-with-cta`);

    expect(receipt.warning).toBeUndefined();
  });
});
