import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The README is the install instructions. A wrong command in it is worse than a
 * missing one — the reader has no way to tell it apart from a right one — so the
 * few claims that a fresh user acts on before anything else works are pinned
 * here, against the scripts that actually implement them.
 *
 * These assertions are deliberately about *substance*, not wording: which
 * commands the Quick Start block runs, that the platform notes name the things
 * a first run trips over, and that nothing is documented which the repo no
 * longer ships. Rewriting the prose around them is free; changing what the
 * reader is told to type is not.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const README_PATH = join(REPO_ROOT, "README.md");
const README = readFileSync(README_PATH, "utf8");

/** Every heading in the document, in order, with its level and offset. */
function headings() {
  const found: Array<{ level: number; text: string; start: number; end: number }> = [];
  const re = /^(#{2,6})[ \t]+(.+?)[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(README)) !== null) {
    found.push({ level: m[1].length, text: m[2], start: m.index, end: re.lastIndex });
  }
  return found;
}

/**
 * The body of one section: everything after its heading, up to the next heading
 * at the same level or higher. Matched on a normalised prefix so the test does
 * not break on an added em dash or a reworded tail.
 */
function section(headingPrefix: string): string {
  const all = headings();
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const i = all.findIndex((h) => norm(h.text).startsWith(norm(headingPrefix)));
  expect(i, `README has no heading starting with "${headingPrefix}"`).toBeGreaterThanOrEqual(0);
  const here = all[i];
  const next = all.slice(i + 1).find((h) => h.level <= here.level);
  return README.slice(here.end, next ? next.start : README.length);
}

/** Position of the first heading whose text starts with the given prefix. */
function headingIndex(headingPrefix: string): number {
  const all = headings();
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const found = all.find((h) => norm(h.text).startsWith(norm(headingPrefix)));
  expect(found, `README has no heading starting with "${headingPrefix}"`).toBeTruthy();
  return found!.start;
}

/** The command lines of the first fenced code block in a chunk of markdown. */
function firstCodeBlock(body: string): string[] {
  const m = body.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  expect(m, "expected a fenced code block here").toBeTruthy();
  return m![1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** Case-insensitive "the section talks about this", for prose we may reword. */
function mentions(body: string, needle: string | RegExp): boolean {
  if (needle instanceof RegExp) return needle.test(body);
  return body.toLowerCase().includes(needle.toLowerCase());
}

describe("README Quick Start", () => {
  it("Quick Start opens with exactly clone, pnpm bootstrap, pnpm start", () => {
    // Before the optional-extras pitch, not after it: the first thing a reader
    // needs is the thing that makes the panel exist.
    expect(headingIndex("Quick Start")).toBeLessThan(headingIndex("Recommended Skills"));

    const lines = firstCodeBlock(section("Quick Start"));
    expect(lines).toHaveLength(3);

    // 1. the clone. Any host spelling (ssh or https), any target directory.
    expect(lines[0]).toMatch(/^git clone\b.*\bpavilio\.git\b/);

    // 2. the one setup command — `pnpm bootstrap`, no `run` needed.
    //    The script is deliberately NOT called `setup`: `pnpm setup` is one of
    //    pnpm's OWN subcommands (it installs pnpm into the user's shell rc and
    //    never looks at package.json), so a bare `pnpm setup` would not run our
    //    script at all — it would edit the reader's ~/.zshrc and report success.
    //    Verified against pnpm 10. `bootstrap` is not a pnpm command, so the
    //    bare spelling is the correct one.
    expect(lines[1]).toBe("pnpm bootstrap");

    // 3. the panel. `start` is not a pnpm subcommand, so this one is literal.
    expect(lines[2]).toBe("pnpm start");

    // And nowhere in the block is a name pnpm claims for itself.
    for (const line of lines) {
      expect(line).not.toMatch(/^pnpm\s+(run\s+)?setup\b/);
      expect(line).not.toMatch(/^pnpm\s+(run\s+)?update\b/);
      expect(line).not.toMatch(/^pnpm\s+(run\s+)?restart\b/);
    }
  });

  it("platform notes cover the WSL shortcut, UAC, and the notes-safety rebase", () => {
    const quickStart = section("Quick Start");

    // Both platforms get a note of their own under Quick Start.
    expect(quickStart).toMatch(/^###\s+macOS/m);
    expect(quickStart).toMatch(/^###\s+WSL2/m);

    const wsl = section("WSL2");
    // The shortcut setup writes, by name.
    expect(mentions(wsl, "shortcut"), "WSL2 note must mention the desktop shortcut").toBe(true);
    // The one-time elevation prompt the launcher's portproxy step raises.
    expect(mentions(wsl, "UAC"), "WSL2 note must mention the UAC prompt").toBe(true);
    expect(mentions(wsl, /\bonce\b|\bone-time\b|\bfirst\b/i)).toBe(true);
    // The recovery for the classic failure: a shortcut whose bash read no
    // dotfiles, so scripts/pm found no node and said to re-run setup.
    expect(
      mentions(wsl, /node.{0,20}not found|not find node|could not find/i),
      "WSL2 note must name the node-not-found case",
    ).toBe(true);
    expect(mentions(wsl, "pnpm bootstrap"), "WSL2 note must say to re-run setup").toBe(true);

    const notes = section("Keep your notes safe");
    // What the notes actually are: commits, on main, in this workspace.
    expect(mentions(notes, /commits?\b/i)).toBe(true);
    expect(mentions(notes, /`?main`?\b/)).toBe(true);
    // The prompt setup asks, and the remote it wires up.
    expect(mentions(notes, "origin"), "must name the private origin remote").toBe(true);
    expect(
      mentions(notes, /private repo/i),
      "must quote setup's own private-repo prompt",
    ).toBe(true);
    // And how an update keeps them: replayed on top of upstream, not merged.
    expect(mentions(notes, /rebase/i), "must say the update rebases").toBe(true);
    expect(mentions(notes, "upstream")).toBe(true);
    // Spelled the way that actually reaches scripts/update.sh: `pnpm pull`.
    // `pnpm update` is pnpm's own dependency updater and would never run it —
    // and neither would `pnpm upgrade` or `pnpm up`, which pnpm 10 documents as
    // aliases of exactly that command.
    expect(notes).toMatch(/`pnpm pull`/);
    expect(notes).not.toMatch(/`pnpm (run )?(update|upgrade|up)`(?!\s*(is|runs|would|and))/);
  });

  it("no package script is named after a command pnpm resolves itself", () => {
    // pnpm matches its OWN subcommands before it ever looks at package.json, so
    // a script named after one is unreachable by the bare `pnpm <name>` spelling
    // this README teaches — pnpm runs its own thing and reports success.
    //
    // `update` has two documented aliases, `up` and `upgrade`, and all three run
    // pnpm's dependency updater. That is why the workspace's update command is
    // `pnpm pull` (and its second spelling `pnpm sync`) and never `pnpm upgrade`.
    // Verified against pnpm 10.18.1.
    //
    // `start` and `test` are absent from this list on purpose: pnpm claims those
    // names too, but only to run the package script of the same name.
    const CLAIMED_BY_PNPM = ["setup", "install", "update", "up", "upgrade", "restart"];

    for (const manifest of [join(REPO_ROOT, "package.json"), join(REPO_ROOT, "panel/package.json")]) {
      const scripts = (
        JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> }
      ).scripts ?? {};
      for (const claimed of CLAIMED_BY_PNPM) {
        expect(Object.keys(scripts), `${manifest} defines an unreachable script "${claimed}"`)
          .not.toContain(claimed);
      }
    }

    // …and the update command is still there under a name that does reach it.
    const rootScripts = (
      JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(rootScripts.sync, "scripts.sync must run scripts/update.sh").toContain(
      "scripts/update.sh",
    );
    // `pull` predates `sync` and people's fingers know it — both names point at
    // the one script, deliberately.
    expect(rootScripts.pull, "scripts.pull must run scripts/update.sh").toContain(
      "scripts/update.sh",
    );
  });

  it("no hand-written shortcut snippet or reference .lnk remains", () => {
    // scripts/setup:shortcut writes the shortcut through powershell.exe. The
    // hand-typed PowerShell recipe it replaced told the reader to build a
    // shortcut around `bash -lc "npm start"` — the exact failure mode the
    // launcher now exists to prevent.
    expect(README).not.toContain("CreateShortcut");
    expect(README).not.toContain("WScript.Shell");
    expect(README).not.toMatch(/\$s(hortcut)?\.Arguments\s*=/);
    expect(README).not.toMatch(/bash -lc ["']npm start/);

    // scripts/Pavilio Panel.lnk was deleted from the repo; the README linked to
    // it until now, which is a 404 on GitHub.
    expect(README).not.toMatch(/Pavilio(%20| )Panel\.lnk/);

    // Generalised: every relative link in the document must resolve on disk.
    // A documented path that does not exist is the same defect in another spot.
    const broken: string[] = [];
    for (const m of README.matchAll(/\]\((\.[^)\s]+)\)/g)) {
      const target = decodeURIComponent(m[1].split("#")[0]);
      if (!existsSync(join(REPO_ROOT, target))) broken.push(m[1]);
    }
    expect(broken, "README links a path that is not in the repo").toEqual([]);

    // The two fork/upstream sections are one section now, and it still carries
    // what made Option B worth reading: the side-by-side clone, and what
    // scripts/update.sh does with them.
    const teams = section("Teams");
    expect(teams).toMatch(/git clone\b[\s\S]*pavilio\.git/);
    expect((teams.match(/git clone\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(mentions(teams, /same parent|side by side|side-by-side/i)).toBe(true);
    expect(mentions(teams, /rsync/i), "must explain update.sh's sync mode").toBe(true);
    expect(mentions(teams, "pnpm pull")).toBe(true);

    // The old headings are gone, not duplicated alongside the new one.
    expect(README).not.toMatch(/^##\s+Using as Your Upstream/m);
    expect(README).not.toMatch(/^###\s+Option [AB]\b/m);
  });
});
