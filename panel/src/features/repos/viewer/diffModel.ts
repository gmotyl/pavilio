/**
 * Pure model behind the file viewer: unified diff → numbered rows, split pairs,
 * folds, word-level marks and Code-mode gutter marks. No React, no DOM.
 */

export type Row =
  | { kind: "ctx"; old: number; new: number; text: string }
  | { kind: "del"; old: number; text: string }
  | { kind: "add"; new: number; text: string }
  /** Lines between hunks the diff does not carry; `old`/`new` are the first hidden line on each side. */
  | { kind: "gap"; count: number; old: number; new: number };

export interface Fold {
  kind: "fold";
  id: number;
  rows: Row[];
}

export type Item = Row | Fold;

export type SplitRow =
  | { kind: "ctx"; left: Row; right: Row }
  | { kind: "change"; del: Row | undefined; add: Row | undefined }
  | Fold
  | Extract<Row, { kind: "gap" }>;

/** [start, end) UTF-16 offsets into a line. */
export type Range = [number, number];

export type GutterMark = "added" | "changed" | "removed";

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(diff: string): Row[] {
  const rows: Row[] = [];
  let old = 0;
  let nu = 0;
  let inHunk = false;
  let nextOld = 1;
  let nextNew = 1;
  for (const line of diff.split("\n")) {
    const h = HUNK_RE.exec(line);
    if (h) {
      old = Number(h[1]);
      nu = Number(h[3]);
      // `-0,0` / `+0,0` name an empty side; its first line is still 1.
      const startOld = Math.max(old, 1);
      const startNew = Math.max(nu, 1);
      if (Number(h[2] ?? 1) > 0 && startOld > nextOld) {
        rows.push({ kind: "gap", count: startOld - nextOld, old: nextOld, new: nextNew });
      }
      old = startOld;
      nu = startNew;
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    const sign = line[0];
    if (sign === " ") rows.push({ kind: "ctx", old: old++, new: nu++, text: line.slice(1) });
    else if (sign === "-") rows.push({ kind: "del", old: old++, text: line.slice(1) });
    else if (sign === "+") rows.push({ kind: "add", new: nu++, text: line.slice(1) });
    else if (sign === "\\") continue;
    else if (line.startsWith("diff ")) inHunk = false;
    else continue;
    nextOld = old;
    nextNew = nu;
  }
  return rows;
}

/** Replace gaps (and the unseen tail) with context lines read from the new side's `content`. */
export function fillGaps(rows: Row[], content: string): Row[] {
  const lines = splitLines(content);
  const out: Row[] = [];
  let lastOld = 0;
  let lastNew = 0;
  const push = (r: Row) => {
    out.push(r);
    if (r.kind !== "gap" && r.kind !== "add") lastOld = r.old;
    if (r.kind !== "gap" && r.kind !== "del") lastNew = r.new;
  };
  for (const r of rows) {
    if (r.kind !== "gap") {
      push(r);
      continue;
    }
    for (let k = 0; k < r.count; k++) {
      const text = lines[r.new - 1 + k];
      if (text === undefined) break;
      push({ kind: "ctx", old: r.old + k, new: r.new + k, text });
    }
  }
  for (let n = lastNew + 1, o = lastOld + 1; n <= lines.length; n++, o++) push({ kind: "ctx", old: o, new: n, text: lines[n - 1] });
  return out;
}

export function splitLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** The new side's lines, when the rows cover the whole file (no gaps); else null. */
export function newSide(rows: Row[]): string[] | null {
  if (rows.some((r) => r.kind === "gap")) return null;
  return rows.flatMap((r) => (r.kind === "ctx" || r.kind === "add" ? [r.text] : []));
}

export function countChanges(rows: Row[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const r of rows) {
    if (r.kind === "add") add++;
    else if (r.kind === "del") del++;
  }
  return { add, del };
}

export const isChanged = (rows: Row[]): boolean => rows.some((r) => r.kind === "add" || r.kind === "del");

/**
 * Context runs longer than `min` lines fold, keeping `context` lines next to each change visible.
 * Fold ids are stable for a given row list, so an expanded set survives re-renders.
 */
export function foldRows(rows: Row[], min = 6, context = 3): Item[] {
  const out: Item[] = [];
  let id = 0;
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== "ctx") {
      out.push(rows[i++]);
      continue;
    }
    const start = i;
    while (i < rows.length && rows[i].kind === "ctx") i++;
    const run = rows.slice(start, i);
    if (run.length <= min) {
      out.push(...run);
      continue;
    }
    const head = start > 0 && rows[start - 1].kind !== "gap" ? context : 0;
    const tail = i < rows.length && rows[i].kind !== "gap" ? context : 0;
    const hidden = run.slice(head, run.length - tail);
    out.push(...run.slice(0, head));
    if (hidden.length > 0) out.push({ kind: "fold", id: id++, rows: hidden });
    out.push(...run.slice(run.length - tail));
  }
  return out;
}

export function expandFolds(items: Item[], expanded: ReadonlySet<number>): Item[] {
  return items.flatMap((it) => (it.kind === "fold" && expanded.has(it.id) ? it.rows : [it]));
}

/** Change blocks (dels then adds) as index pairs: del k pairs with add k. */
function blocks<T extends Item>(items: T[], visit: (dels: T[], adds: T[], next: T | undefined, prev: T | undefined) => void): void {
  let i = 0;
  while (i < items.length) {
    if (items[i].kind !== "del" && items[i].kind !== "add") {
      i++;
      continue;
    }
    const prev = items[i - 1];
    const dels: T[] = [];
    const adds: T[] = [];
    while (i < items.length && items[i].kind === "del") dels.push(items[i++]);
    while (i < items.length && items[i].kind === "add") adds.push(items[i++]);
    visit(dels, adds, items[i], prev);
  }
}

export function pairRows(items: Item[]): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.kind === "ctx") {
      out.push({ kind: "ctx", left: it, right: it });
      i++;
    } else if (it.kind === "fold" || it.kind === "gap") {
      out.push(it);
      i++;
    } else {
      const dels: Row[] = [];
      const adds: Row[] = [];
      while (i < items.length && items[i].kind === "del") dels.push(items[i++] as Row);
      while (i < items.length && items[i].kind === "add") adds.push(items[i++] as Row);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ kind: "change", del: dels[k], add: adds[k] });
    }
  }
  return out;
}

/** Word marks for every paired del/add row in `rows`, keyed by row. */
export function rowWordMarks(rows: Row[]): Map<Row, Range[]> {
  const marks = new Map<Row, Range[]>();
  blocks(rows, (dels, adds) => {
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const d = dels[k] as Extract<Row, { kind: "del" }>;
      const a = adds[k] as Extract<Row, { kind: "add" }>;
      const m = wordMarks(d.text, a.text);
      if (m.del.length) marks.set(d, m.del);
      if (m.add.length) marks.set(a, m.add);
    }
  });
  return marks;
}

const TOKEN_RE = /[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g;
// Token LCS is quadratic; past this the line just stays a whole-line change.
const MAX_CELLS = 40_000;

/** Ranges of the tokens that differ between a deleted line `a` and its added pair `b`. */
export function wordMarks(a: string, b: string): { del: Range[]; add: Range[] } {
  const none = { del: [], add: [] };
  const ta = [...a.matchAll(TOKEN_RE)].map((m) => ({ s: m.index, t: m[0] }));
  const tb = [...b.matchAll(TOKEN_RE)].map((m) => ({ s: m.index, t: m[0] }));
  const n = ta.length;
  const m = tb.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return none;
  // lcs[i][j] = LCS length of ta[i..] and tb[j..]
  const w = m + 1;
  const lcs = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * w + j] = ta[i].t === tb[j].t ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  let common = false;
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (ta[i].t === tb[j].t) {
      keepA[i] = keepB[j] = true;
      if (ta[i].t.trim()) common = true;
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) i++;
    else j++;
  }
  if (!common) return none;
  return { del: ranges(ta, keepA), add: ranges(tb, keepB) };
}

function ranges(tokens: { s: number; t: string }[], keep: boolean[]): Range[] {
  const out: Range[] = [];
  tokens.forEach((tok, i) => {
    if (keep[i]) return;
    const end = tok.s + tok.t.length;
    const last = out.at(-1);
    if (last && last[1] === tok.s) last[1] = end;
    else out.push([tok.s, end]);
  });
  return out;
}

/**
 * Code-mode gutter marks by new line: adds paired with a deletion are "changed",
 * the rest "added"; a pure deletion marks the line after it "removed" (the line before at end of file).
 */
export function gutterMarks(rows: Row[]): Map<number, GutterMark> {
  const marks = new Map<number, GutterMark>();
  blocks(rows, (dels, adds, next, prev) => {
    adds.forEach((a, k) => {
      if (a.kind === "add") marks.set(a.new, k < dels.length ? "changed" : "added");
    });
    if (adds.length === 0) {
      const at = next && (next.kind === "ctx" || next.kind === "add") ? next.new : prev && prev.kind === "ctx" ? prev.new : undefined;
      if (at !== undefined && !marks.has(at)) marks.set(at, "removed");
    }
  });
  return marks;
}
