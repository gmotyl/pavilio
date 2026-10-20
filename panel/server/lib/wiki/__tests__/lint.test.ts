import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { join, dirname } from "path";

import { lintWiki } from "../lint";

let root = "";

function write(rel: string, text: string) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

const pageAt = (type: string | null, body: string, updated: string, extra = "") =>
  `---\n${type ? `type: ${type}\n` : ""}description: d\ncreated: 2026-10-01\nupdated: ${updated}\n${extra}---\n${body}`;
const page = (type: string | null, body: string, extra = "") => pageAt(type, body, "2026-10-10", extra);

/** Git isolated from the machine: no user config, no inherited repo env (hooks export GIT_DIR). */
function git(...args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: root,
    env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...gitDates },
    stdio: "pipe",
  });
}
let gitDates: Record<string, string> = {};
function commitAt(date: string, rel: string) {
  gitDates = { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  git("add", rel);
  git("commit", "-q", "-m", rel);
  gitDates = {};
}

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
        "sources:\n  - \"[[wiki/sources/absent]]\"\n  - sources/gone.md\n",
      ),
    );
    expect(lintWiki(root, "pavilio").broken).toEqual([
      { page: "wiki/concepts/linked.md", target: "metro:wiki/entities/gone" },
      { page: "wiki/concepts/linked.md", target: "sources/gone" },
      { page: "wiki/concepts/linked.md", target: "wiki/concepts/missing" },
      { page: "wiki/concepts/linked.md", target: "wiki/sources/absent" },
    ]);
  });

  it("reports orphans", () => {
    write(`${W}/sources/cited.md`, page("source", "A record.\n"));
    write(`${W}/sources/bare.md`, page("source", "Cited wiki-relative.\n"));
    write(`${W}/sources/uncited.md`, page("source", "Another record.\n"));
    write(
      `${W}/concepts/linked.md`,
      page("concept", "Prose.\n", "sources:\n  - wiki/sources/cited.md\n  - sources/bare.md\n"),
    );
    write(`${W}/notes/n.md`, page("note", "Free-form.\n"));
    write(`${W}/repos/r/ARCHITECTURE.md`, page("architecture", "Repo.\n"));
    write(`${W}/repos/r/index.md`, page("index", "- [[wiki/repos/r/ARCHITECTURE]]\n"));
    expect(lintWiki(root, "pavilio").orphans).toEqual(["wiki/concepts/lonely.md", "wiki/sources/uncited.md"]);
  });

  it("reports malformed frontmatter once, not as untyped", () => {
    write(`${W}/concepts/broken-yaml.md`, "---\ntype: concept\ndescription: foo: bar\n---\n[[wiki/concepts/linked]]\n");
    const report = lintWiki(root, "pavilio");
    expect(report.malformed).toEqual([{ page: "wiki/concepts/broken-yaml.md", error: expect.stringMatching(/\S/) }]);
    expect(report.untyped).not.toContain("wiki/concepts/broken-yaml.md");
  });

  it("reports untyped pages", () => {
    write(`${W}/concepts/untyped.md`, page(null, "No type. [[wiki/concepts/linked]]\n"));
    write(`${W}/entities/bare.md`, "Just text, no frontmatter.\n");
    expect(lintWiki(root, "pavilio").untyped).toEqual(["wiki/concepts/untyped.md", "wiki/entities/bare.md"]);
  });

  it("reports stale pages", () => {
    // Wiki-page sources are dated by their own frontmatter, never by checkout mtimes.
    write(`${W}/sources/meeting.md`, pageAt("source", "Meeting.\n", "2026-10-12"));
    write(`${W}/sources/old.md`, pageAt("source", "Old.\n", "2026-10-09"));
    write(`${W}/sources/created-only.md`, "---\ntype: source\ncreated: 2026-10-11\n---\nNew.\n");
    write(
      `${W}/concepts/linked.md`,
      page(
        "concept",
        "Prose.\n",
        "sources:\n  - wiki/sources/meeting.md\n  - sources/old\n  - [[wiki/sources/created-only]]\n",
      ),
    );
    setMtime(`${W}/sources/meeting.md`, "2026-10-01");
    setMtime(`${W}/sources/old.md`, "2026-10-20"); // touched by a checkout: still fresh
    // Untracked record and raw files fall back to their mtime.
    write("projects/pavilio/notes/2026-10-05-meeting.md", "# Meeting\n");
    write(`${W}/sources/untracked.md`, page("source", "U.\n", "record: notes/2026-10-05-meeting.md\n"));
    write(`${W}/raw/article.md`, "# Article\n");
    write(`${W}/sources/article.md`, page("source", "Article.\n", "raw: raw/article.md\n"));
    setMtime("projects/pavilio/notes/2026-10-05-meeting.md", "2026-10-15");
    setMtime(`${W}/raw/article.md`, "2026-10-10"); // same day: fresh
    expect(lintWiki(root, "pavilio").stale).toEqual([
      { page: "wiki/concepts/linked.md", source: "wiki/sources/created-only", updated: "2026-10-10", modified: "2026-10-11" },
      { page: "wiki/concepts/linked.md", source: "wiki/sources/meeting", updated: "2026-10-10", modified: "2026-10-12" },
      {
        page: "wiki/sources/untracked.md",
        source: "notes/2026-10-05-meeting.md",
        updated: "2026-10-10",
        modified: "2026-10-15",
      },
    ]);
  });

  it("dates committed records by their last commit", () => {
    write("projects/pavilio/notes/edited.md", "# Edited\n");
    write("projects/pavilio/notes/kept.md", "# Kept\n");
    write(`${W}/sources/edited.md`, page("source", "E.\n", "record: notes/edited.md\n"));
    write(`${W}/sources/kept.md`, page("source", "K.\n", "record: notes/kept.md\n"));
    git("init", "-q");
    commitAt("2026-10-05T12:00:00", "projects/pavilio/notes/kept.md");
    commitAt("2026-10-14T12:00:00", "projects/pavilio/notes/edited.md");
    setMtime("projects/pavilio/notes/edited.md", "2026-10-01"); // checkout mtimes say nothing
    setMtime("projects/pavilio/notes/kept.md", "2026-10-20");
    expect(lintWiki(root, "pavilio").stale).toEqual([
      { page: "wiki/sources/edited.md", source: "notes/edited.md", updated: "2026-10-10", modified: "2026-10-14" },
    ]);
  });

  it("warns on code identifiers in concept pages", () => {
    const body = [
      "The relay calls `startRelay()` once.", // line 7
      "It lives in panel/server/relay.ts and the UI in `src/AppShell.tsx`.", // line 8
      "Rendered by `MarkdownRenderer` and <SpeechPane open />.", // line 9
      "Plain prose: The Quick Brown fox, `TypeScript`, <GitHub> and `PostgreSQL`, <Project> placeholder.", // line 10
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
      { page: "wiki/concepts/linked.md", line: 8, rule: "path", match: "src/AppShell.tsx" },
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
