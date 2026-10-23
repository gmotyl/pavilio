import { join } from "path";

import { bodyFirstLine, isMermaidInfo } from "./lint";
import { walkWikiPages } from "./pages";

/**
 * Parse check of every ```mermaid block in one project's wiki (`scripts/wiki lint <p>` merges it
 * in as `diagrams`). Read-only. A block that mermaid cannot parse renders as an error box in the
 * panel, so it is reported with the page, the file line of its opening fence and mermaid's message.
 *
 * mermaid needs a DOM even to parse, so jsdom globals are installed on first use. Both are loaded
 * lazily: no other CLI command pays for them. When either cannot be loaded the check is skipped and
 * the reason is reported as `diagramCheck: "unavailable: …"` instead of failing the whole lint.
 */

export type BadDiagram = { page: string; line: number; error: string };
export type DiagramReport = { diagrams: BadDiagram[]; diagramCheck?: string };

type Mermaid = { parse(code: string): Promise<unknown> };
type JsdomModule = { JSDOM: new (html: string) => { window: Window & typeof globalThis } };

/** jsdom ships no types and the panel has no `@types/jsdom`; a non-literal specifier keeps tsc out. */
const JSDOM_MODULE: string = "jsdom";

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

let loading: Promise<Mermaid> | null = null;

/** jsdom globals, then mermaid, once per process. A failed load is retried on the next call. */
function loadMermaid(): Promise<Mermaid> {
  loading ??= (async () => {
    if (typeof globalThis.document === "undefined") {
      const { JSDOM } = (await import(JSDOM_MODULE)) as JsdomModule;
      const { window } = new JSDOM("<!doctype html><body></body>");
      Object.assign(globalThis, {
        window,
        document: window.document,
        DOMParser: window.DOMParser,
        Element: window.Element,
      });
    }
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false });
    return mermaid;
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/** Each ```mermaid block of a body: its source and the body-relative index of its opening line. */
export function extractMermaidBlocks(body: string): { code: string; line: number }[] {
  const blocks: { code: string; line: number }[] = [];
  let fence: { char: string; len: number; start: number; lines: string[] | null } | null = null;
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const content = lines[i];
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(content);
    if (fence) {
      const close = open && open[1][0] === fence.char && open[1].length >= fence.len
        && content.slice(open[0].length).trim() === "";
      if (!close) fence.lines?.push(content);
      else {
        if (fence.lines) blocks.push({ code: fence.lines.join("\n"), line: fence.start });
        fence = null;
      }
      continue;
    }
    if (open) {
      const mermaid = isMermaidInfo(content.slice(open[0].length));
      fence = { char: open[1][0], len: open[1].length, start: i, lines: mermaid ? [] : null };
    }
  }
  // An unclosed fence runs to the end of the page, as in CommonMark.
  if (fence?.lines) blocks.push({ code: fence.lines.join("\n"), line: fence.start });
  return blocks;
}

/** mermaid's message, up to its first three non-blank lines (message, source excerpt, caret). */
function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .slice(0, 3)
    .join(" | ")
    .trim();
}

/** Parse-check the mermaid blocks of `projects/<project>/wiki` under `workspaceRoot`. */
export async function lintDiagrams(workspaceRoot: string, project: string): Promise<DiagramReport> {
  const wikiDir = join(workspaceRoot, "projects", project, "wiki");
  const found = walkWikiPages(wikiDir).flatMap((page) =>
    extractMermaidBlocks(page.body).map((block) => ({ page, block })),
  );
  if (found.length === 0) return { diagrams: [] };

  let mermaid: Mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (err) {
    return { diagrams: [], diagramCheck: `unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }

  const diagrams: BadDiagram[] = [];
  const firstLines = new Map<string, number>();
  for (const { page, block } of found) {
    try {
      await mermaid.parse(block.code);
    } catch (err) {
      let first = firstLines.get(page.path);
      if (first === undefined) {
        first = bodyFirstLine(join(wikiDir, ...page.path.split("/")), page.body);
        firstLines.set(page.path, first);
      }
      diagrams.push({ page: `wiki/${page.path}`, line: first + block.line, error: errorText(err) });
    }
  }
  return { diagrams: diagrams.sort((a, b) => byString(a.page, b.page) || a.line - b.line) };
}
