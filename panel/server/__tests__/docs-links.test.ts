import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Contract for the shape of the user-facing docs: a short README that points
 * at one doc per topic, and no link in the docs set that leads nowhere.
 *
 * The link check is mechanical on purpose — a moved or deleted doc should fail
 * here, not on GitHub in front of a reader.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const README_PATH = join(REPO_ROOT, "README.md");

/** README, every top-level docs/*.md (docs/adr/ excluded) and the panel guide. */
function docsSet(): string[] {
  const docsDir = join(REPO_ROOT, "docs");
  const docs = existsSync(docsDir)
    ? readdirSync(docsDir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => join(docsDir, name))
        .filter((path) => statSync(path).isFile())
    : [];
  return [README_PATH, ...docs, join(REPO_ROOT, "panel/help/panel-guide.md")];
}

/** Markdown with fenced code blocks and inline code spans blanked out. */
function stripCode(markdown: string): string {
  return markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replace(/`[^`\n]*`/g, "");
}

/** Every inline markdown link / image target in a document, code excluded. */
function linkTargets(markdown: string): string[] {
  const targets: string[] = [];
  const re = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\s*\)/g;
  let m: RegExpExecArray | null;
  const body = stripCode(markdown);
  while ((m = re.exec(body)) !== null) {
    targets.push(m[1].replace(/^<|>$/g, ""));
  }
  return targets;
}

/** True for links this contract does not check: external, mail, pure anchors. */
function isExternalOrAnchor(target: string): boolean {
  return /^(https?:|mailto:)/i.test(target) || target.startsWith("#");
}

/** The README section headed exactly `## <title>`, up to the next h1/h2. */
function readmeSection(readme: string, title: string): string {
  const lines = readme.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  expect(start, `README has no "## ${title}" heading`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

describe("docs shape contract", () => {
  it("every relative link in README, docs and the panel guide resolves", () => {
    const broken: string[] = [];
    for (const file of docsSet()) {
      expect(existsSync(file), `${relative(REPO_ROOT, file)} is missing`).toBe(true);
      for (const target of linkTargets(readFileSync(file, "utf8"))) {
        if (isExternalOrAnchor(target)) continue;
        const pathPart = decodeURI(target.split("#")[0].split("?")[0]);
        if (!pathPart) continue;
        const absolute = pathPart.startsWith("/")
          ? join(REPO_ROOT, pathPart)
          : resolve(dirname(file), pathPart);
        if (!existsSync(absolute)) broken.push(`${relative(REPO_ROOT, file)} -> ${target}`);
      }
    }
    expect(broken, "broken relative links").toEqual([]);
  });

  it("README is at most 160 lines and has no stale site or rename lines", () => {
    const readme = readFileSync(README_PATH, "utf8");
    const lineCount = readme.replace(/\n$/, "").split("\n").length;
    expect(lineCount, "README line count").toBeLessThanOrEqual(160);
    for (const stale of ["pavilio.ai", "pavilio.motyl.dev", "motyl-ai-workflow"]) {
      expect(readme.includes(stale), `README still mentions ${stale}`).toBe(false);
    }
  });

  it("README Docs index links every doc", () => {
    const index = readmeSection(readFileSync(README_PATH, "utf8"), "Docs");
    const linked = new Set(linkTargets(index).map((target) => target.split("#")[0].replace(/^\.\//, "")));
    // Derived from the docs set, not a fixed list, so a new doc cannot be forgotten here.
    const expected = docsSet()
      .filter((path) => path !== README_PATH)
      .map((path) => relative(REPO_ROOT, path).split("\\").join("/"));
    expect(expected).toContain("docs/install.md");
    expect(expected).toContain("panel/help/panel-guide.md");
    const missing = expected.filter((doc) => !linked.has(doc));
    expect(missing, "docs not linked from the README Docs index").toEqual([]);
  });
});
