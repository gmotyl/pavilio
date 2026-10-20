import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

import { lintWiki } from "../lint";

let root = "";

function write(rel: string, text: string) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

const page = (type: string | null, body: string, extra = "") =>
  `---\n${type ? `type: ${type}\n` : ""}description: d\ncreated: 2026-10-01\nupdated: 2026-10-10\n${extra}---\n${body}`;

/** Noon local time, so the local calendar date is unambiguous in every timezone. */
function setMtime(rel: string, date: string) {
  const t = new Date(`${date}T12:00:00`);
  utimesSync(join(root, rel), t, t);
}

const W = "projects/pavilio/wiki";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wiki-lint-"));
  write(`${W}/index.md`, page("index", "- [[wiki/concepts/index|Concepts]]\n"));
  write(`${W}/overview.md`, page("overview", "See [[wiki/concepts/linked]].\n"));
  write(`${W}/open-questions.md`, page("open-questions", "Nothing yet.\n"));
  write(
    `${W}/concepts/index.md`,
    page("index", "- [[wiki/concepts/linked]]\n- [[wiki/concepts/glossary-term]]\n- [[wiki/concepts/lonely]]\n"),
  );
  write(`${W}/concepts/linked.md`, page("concept", "Plain prose about relays.\n"));
  write(`${W}/concepts/glossary-term.md`, page("concept", "A glossary term.\n"));
  write(`${W}/concepts/lonely.md`, page("concept", "Nobody links here.\n"));
  write(`${W}/questions/q.md`, page("question", "Answered from [[wiki/concepts/linked]].\n"));
  write("projects/pavilio/CONTEXT.md", "- **Glossary term** — x. See [[wiki/concepts/glossary-term]]\n");
  write("projects/metro/wiki/entities/y.md", page("entity", "Y\n"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("lintWiki", () => {
  it("reports broken links", () => {
    write(
      `${W}/concepts/linked.md`,
      page(
        "concept",
        "See [[wiki/concepts/missing]], [[metro:wiki/entities/y]], [[metro:wiki/entities/gone|Gone]] and `[[wiki/in/code]]`.\n",
        "sources:\n  - \"[[wiki/sources/absent]]\"\n",
      ),
    );
    expect(lintWiki(root, "pavilio").broken).toEqual([
      { page: "wiki/concepts/linked.md", target: "metro:wiki/entities/gone" },
      { page: "wiki/concepts/linked.md", target: "wiki/concepts/missing" },
      { page: "wiki/concepts/linked.md", target: "wiki/sources/absent" },
    ]);
  });

  it("reports orphans", () => {
    write(`${W}/sources/cited.md`, page("source", "A record.\n"));
    write(`${W}/sources/uncited.md`, page("source", "Another record.\n"));
    write(`${W}/concepts/linked.md`, page("concept", "Prose.\n", "sources:\n  - wiki/sources/cited\n"));
    write(`${W}/notes/n.md`, page("note", "Free-form.\n"));
    write(`${W}/repos/r/ARCHITECTURE.md`, page("architecture", "Repo.\n"));
    write(`${W}/repos/r/index.md`, page("index", "- [[wiki/repos/r/ARCHITECTURE]]\n"));
    expect(lintWiki(root, "pavilio").orphans).toEqual(["wiki/concepts/lonely.md", "wiki/sources/uncited.md"]);
  });

  it("reports untyped pages", () => {
    write(`${W}/concepts/untyped.md`, page(null, "No type. [[wiki/concepts/linked]]\n"));
    write(`${W}/entities/bare.md`, "Just text, no frontmatter.\n");
    expect(lintWiki(root, "pavilio").untyped).toEqual(["wiki/concepts/untyped.md", "wiki/entities/bare.md"]);
  });

  it("reports stale pages", () => {
    write("projects/pavilio/notes/2026-10-05-meeting.md", "# Meeting\n");
    write(`${W}/sources/meeting.md`, page("source", "Meeting.\n", "record: projects/pavilio/notes/2026-10-05-meeting.md\n"));
    write("projects/pavilio/notes/2026-10-06-old.md", "# Old\n");
    write(`${W}/sources/old.md`, page("source", "Old.\n", "record: projects/pavilio/notes/2026-10-06-old.md\n"));
    write(`${W}/raw/article.md`, "# Article\n");
    write(`${W}/sources/article.md`, page("source", "Article.\n", "raw: raw/article.md\n"));
    write(
      `${W}/concepts/linked.md`,
      page("concept", "Prose.\n", "sources:\n  - \"[[wiki/sources/meeting]]\"\n  - wiki/sources/old\n"),
    );
    setMtime("projects/pavilio/notes/2026-10-05-meeting.md", "2026-10-15"); // edited after ingest
    setMtime("projects/pavilio/notes/2026-10-06-old.md", "2026-10-10"); // same day: fresh
    setMtime(`${W}/raw/article.md`, "2026-10-11");
    setMtime(`${W}/sources/meeting.md`, "2026-10-12");
    setMtime(`${W}/sources/old.md`, "2026-10-09");
    expect(lintWiki(root, "pavilio").stale).toEqual([
      { page: "wiki/concepts/linked.md", source: "wiki/sources/meeting", updated: "2026-10-10", modified: "2026-10-12" },
      { page: "wiki/sources/article.md", source: "raw/article.md", updated: "2026-10-10", modified: "2026-10-11" },
      {
        page: "wiki/sources/meeting.md",
        source: "projects/pavilio/notes/2026-10-05-meeting.md",
        updated: "2026-10-10",
        modified: "2026-10-15",
      },
    ]);
  });

  it("warns on code identifiers in concept pages", () => {
    const body = [
      "The relay calls `startRelay()` once.", // line 7
      "It lives in panel/server/relay.ts and the UI in `src/App.tsx`.", // line 8
      "Rendered by `MarkdownRenderer` and <SpeechPane open />.", // line 9
      "Plain prose: The Quick Brown fox, e.g. a JavaScript-free note, <Project> placeholder.", // line 10
      "```ts", // line 11
      "export function doThing() {}", // line 12
      "```", // line 13
    ].join("\n");
    write(`${W}/concepts/linked.md`, page("concept", `${body}\n`));
    write(`${W}/repos/r/notes.md`, page("note", "`startRelay()` in relay.ts is fine here.\n"));
    write(`${W}/entities/svc.md`, page("entity", "Deployed from `deploy.ts`.\n"));
    expect(lintWiki(root, "pavilio").codeIdentifiers).toEqual([
      { page: "wiki/concepts/linked.md", line: 7, rule: "call", match: "startRelay(" },
      { page: "wiki/concepts/linked.md", line: 8, rule: "path", match: "panel/server/relay.ts" },
      { page: "wiki/concepts/linked.md", line: 8, rule: "path", match: "src/App.tsx" },
      { page: "wiki/concepts/linked.md", line: 9, rule: "component", match: "MarkdownRenderer" },
      { page: "wiki/concepts/linked.md", line: 9, rule: "component", match: "SpeechPane" },
      { page: "wiki/concepts/linked.md", line: 11, rule: "fence", match: "```ts" },
      { page: "wiki/concepts/linked.md", line: 12, rule: "call", match: "doThing(" },
      { page: "wiki/entities/svc.md", line: 7, rule: "path", match: "deploy.ts" },
    ]);
  });

  it("does not write", () => {
    write(`${W}/concepts/untyped.md`, page(null, "[[wiki/concepts/missing]] `fooBar()`\n"));
    const snapshot = () => {
      const out: string[] = [];
      const visit = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const abs = join(dir, e.name);
          if (e.isDirectory()) visit(abs);
          else out.push(`${abs}|${statSync(abs).mtimeMs}|${readFileSync(abs, "utf8")}`);
        }
      };
      visit(root);
      return out.sort();
    };
    const before = snapshot();
    const report = lintWiki(root, "pavilio");
    expect(report.broken.length).toBeGreaterThan(0);
    expect(snapshot()).toEqual(before);
  });
});
