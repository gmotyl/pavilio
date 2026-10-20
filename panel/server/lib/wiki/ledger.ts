import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { createHash } from "crypto";
import { isAbsolute, join, relative, resolve, sep } from "path";

/**
 * The ledger: `- ingested: <path> #<hash>` lines in `wiki/log.md` that say which records
 * have been ingested. Paths are relative to the project dir, always "/"-separated; the
 * hash is the first 12 hex of the record's sha256.
 *
 * Records (closed workspace files the wiki learns from):
 * - `notes/**` and `memo/**` (or `memos/**`) — every `.md`, recursively, except `notes/log/**`
 *   (verbatim transcripts that duplicate the processed note)
 * - `progress/**` — `YYYY-MM-DD-*.md` or `YYYY-MM-DD_*.md` dated before today (local date);
 *   today's file is still open
 * - `adr/**` — every `.md`
 * - `{plans/openspec,openspec}/changes/archive/<id>/proposal.md|design.md` — never `tasks.md`
 *   or the delta specs under `specs/`, and never an active (un-archived) change
 */

export type PendingStatus = "new" | "changed";
export type PendingRecord = { path: string; hash: string; status: PendingStatus };

export type PendingOptions = {
  /**
   * Restrict to this one path (project-relative or absolute). It is considered whenever it
   * exists inside the project, even outside the record kinds — callers like the note skill
   * pass the file they just wrote. A missing file yields nothing.
   */
  only?: string;
  /** Local date `YYYY-MM-DD`, or a Date read in local time; defaults to now. */
  today?: string | Date;
};

const LEDGER_FILE = join("wiki", "log.md");
const LEDGER_LINE = /^- ingested: (.+?) #([0-9a-f]{12})\s*$/;
const PROGRESS_FILE = /^(\d{4}-\d{2}-\d{2})[-_].*\.md$/;
/** Verbatim transcripts; the processed note next to them is the record. */
const EXCLUDED_PREFIXES = ["notes/log/"];
const RECURSIVE_DIRS = ["notes", "memo", "memos", "adr"];
const OPENSPEC_ROOTS = ["plans/openspec", "openspec"];
const CHANGE_RECORDS = ["proposal.md", "design.md"];

/** First 12 hex of the sha256 of a record's content. */
export function hashRecord(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

/** Local calendar date as `YYYY-MM-DD` (not UTC: a late-evening file belongs to today). */
export function localDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Latest ledgered hash per record path; a later line for the same path wins. */
export function readLedger(projectDir: string): Map<string, string> {
  const ledger = new Map<string, string>();
  const file = join(projectDir, LEDGER_FILE);
  if (!existsSync(file)) return ledger;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = LEDGER_LINE.exec(line);
    if (match) ledger.set(match[1], match[2]);
  }
  return ledger;
}

/** Every record path in the project, sorted, project-relative and "/"-separated. */
export function listRecords(projectDir: string, today: string | Date = new Date()): string[] {
  const day = typeof today === "string" ? today : localDate(today);
  const out: string[] = [];
  for (const dir of RECURSIVE_DIRS) {
    for (const path of walkMarkdown(projectDir, dir)) {
      if (!EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) out.push(path);
    }
  }
  for (const path of walkMarkdown(projectDir, "progress")) {
    const match = PROGRESS_FILE.exec(path.slice(path.lastIndexOf("/") + 1));
    // String compare works for zero-padded ISO dates; future-dated files are not closed either.
    if (match && match[1] < day) out.push(path);
  }
  for (const root of OPENSPEC_ROOTS) {
    const archive = `${root}/changes/archive`;
    for (const id of listDirs(join(projectDir, archive))) {
      for (const name of CHANGE_RECORDS) {
        const path = `${archive}/${id}/${name}`;
        if (isFile(join(projectDir, path))) out.push(path);
      }
    }
  }
  return [...new Set(out)].sort();
}

/** Records that are not in the ledger (`new`) or whose latest ledgered hash differs (`changed`). */
export function pendingRecords(projectDir: string, opts: PendingOptions = {}): PendingRecord[] {
  let candidates: string[];
  if (opts.only !== undefined) {
    const only = toProjectPath(projectDir, opts.only);
    candidates = only && isFile(join(projectDir, only)) ? [only] : [];
  } else {
    candidates = listRecords(projectDir, opts.today);
  }
  const ledger = readLedger(projectDir);
  const pending: PendingRecord[] = [];
  for (const path of candidates) {
    const hash = hashRecord(readFileSync(join(projectDir, path)));
    const seen = ledger.get(path);
    if (seen === hash) continue;
    pending.push({ path, hash, status: seen === undefined ? "new" : "changed" });
  }
  return pending;
}

/** Append one ledger line, creating `wiki/log.md` if missing and never gluing onto a last line. */
export function recordIngested(projectDir: string, path: string, hash: string): void {
  const rel = toProjectPath(projectDir, path);
  if (!rel) throw new Error(`record path is outside the project: ${path}`);
  if (!/^[0-9a-f]{12}$/.test(hash)) throw new Error(`hash must be 12 lowercase hex chars: ${hash}`);
  const file = join(projectDir, LEDGER_FILE);
  mkdirSync(join(projectDir, "wiki"), { recursive: true });
  let prefix = "";
  if (existsSync(file)) {
    const existing = readFileSync(file, "utf8");
    if (existing.length > 0 && !existing.endsWith("\n")) prefix = "\n";
  }
  appendFileSync(file, `${prefix}- ingested: ${rel} #${hash}\n`);
}

/** Project-relative "/"-separated form of a path, or null when it escapes the project. */
function toProjectPath(projectDir: string, path: string): string | null {
  const abs = isAbsolute(path) ? path : resolve(projectDir, path);
  const rel = relative(resolve(projectDir), abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

function walkMarkdown(projectDir: string, dir: string): string[] {
  const out: string[] = [];
  const visit = (rel: string) => {
    let entries;
    try {
      entries = readdirSync(join(projectDir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(child);
    }
  };
  visit(dir);
  return out;
}

function listDirs(abs: string): string[] {
  try {
    return readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function isFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}
