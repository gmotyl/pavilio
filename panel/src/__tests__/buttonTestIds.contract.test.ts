import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Static contract: every <button> opening tag rendered by the panel must have
 * a data-testid. Plus, literal (non-template) testids must be globally unique.
 *
 * This walks the source tree at test time, so adding a new button without a
 * testid fails the suite — which the husky pre-push hook rejects before the
 * push lands. Dynamic testids (template strings with ${...}) are accepted as
 * long as they include `data-testid=`; their runtime uniqueness is the
 * caller's responsibility (we use stable ids like sessionId/projectName).
 */

const FEATURES_ROOT = join(__dirname, "..", "features");
const ROUTED_PAGES = ["TerminalsPage.tsx", "ArchivePage.tsx"].map((f) =>
  join(__dirname, "..", "pages", f),
);

interface ButtonHit {
  file: string;
  line: number;
  raw: string;
  testid?: string; // when literal
  dynamic: boolean; // template-string testid
}

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    // The contract covers production buttons "rendered by the panel" only.
    // Skip test trees, whose fixtures legitimately reuse literal testids
    // (e.g. the same section-files-<file> row rendered by several cases).
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walkTsx(full));
    else if (entry.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(entry))
      out.push(full);
  }
  return out;
}

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content[i] === "\n") line++;
  return line;
}

// Capture the opening <button ... > tag (multi-line allowed). Stop at the
// first `>` that is not inside a {} expression. Regex is intentionally simple
// — this is a smoke check, not a full JSX parser. Buttons that defeat this
// check (e.g. JSX expression with a literal `>` inside attribute braces)
// are vanishingly rare in this codebase.
const BUTTON_OPEN_RE = /<button\b([\s\S]*?)>/g;

function findButtons(file: string): ButtonHit[] {
  const content = readFileSync(file, "utf8");
  const hits: ButtonHit[] = [];
  for (const m of content.matchAll(BUTTON_OPEN_RE)) {
    const attrs = m[1];
    const offset = m.index ?? 0;
    const literal = attrs.match(/data-testid\s*=\s*"([^"]+)"/);
    const dynamic =
      /data-testid\s*=\s*\{[\s\S]*?\}/.test(attrs) && !literal;
    hits.push({
      file,
      line: lineOf(content, offset),
      raw: m[0],
      testid: literal?.[1],
      dynamic,
    });
  }
  return hits;
}

describe("button data-testid contract", () => {
  const files = [...walkTsx(FEATURES_ROOT), ...ROUTED_PAGES];
  const allHits = files.flatMap(findButtons);

  it("every <button> has data-testid", () => {
    const offenders = allHits
      .filter((h) => !h.testid && !h.dynamic)
      .map(
        (h) =>
          `${relative(process.cwd(), h.file)}:${h.line} ${h.raw.slice(0, 80).replace(/\s+/g, " ")}`,
      );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("literal testids are unique across the panel", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const h of allHits) {
      if (!h.testid) continue;
      const where = `${relative(process.cwd(), h.file)}:${h.line}`;
      const prior = seen.get(h.testid);
      if (prior) dupes.push(`"${h.testid}" at ${prior} and ${where}`);
      else seen.set(h.testid, where);
    }
    expect(dupes, dupes.join("\n")).toEqual([]);
  });
});
