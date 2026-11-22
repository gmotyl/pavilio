import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import hljs from "highlight.js";
import { preferences } from "../../../preferences/declarations";
import { usePreference } from "../../../preferences/usePreference";
import {
  countChanges,
  expandFolds,
  fillGaps,
  foldRows,
  gutterMarks,
  isChanged,
  newSide,
  pairRows,
  parseDiff,
  rowWordMarks,
  splitLines,
  type GutterMark,
  type Item,
  type Range,
  type Row,
} from "./diffModel";
import { detectLang, escapeHtml } from "./highlight";
import "./FileViewer.css";

export interface FileViewerProps {
  path: string;
  diff?: string;
  content?: string;
  status?: "M" | "A" | "D" | null;
  counts?: { add: number; del: number };
  defaultMode: "diff" | "code";
  uncommitted?: boolean;
  highlight?: string;
  onIdentifierClick?: (pos: { line: number; col: number }, name: string) => void;
  scrollToLine?: number;
  /** Changes on every request so asking for the same line again re-scrolls and re-flashes. */
  scrollKey?: number | string;
}

const SPLIT_MIN_WIDTH = 720;
const FLASH_MS = 1300;
// highlight.js on a huge file stalls the tab; past this it renders plain.
const MAX_HIGHLIGHT_CHARS = 500_000;
// ts-nav only resolves these; elsewhere identifier links would lead nowhere.
const NAVIGABLE = /\.(?:tsx?|jsx?|mts|cts)$/i;

/** Highlight `lines` as one text so multi-line tokens (comments, template strings) stay right, then split back per line. */
function highlightLines(lines: string[], lang: string | undefined): string[] {
  const text = lines.join("\n");
  if (!lang || text.length > MAX_HIGHLIGHT_CHARS) return lines.map(escapeHtml);
  let html: string;
  try {
    html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return lines.map(escapeHtml);
  }
  const out: string[] = [];
  const open: string[] = [];
  let cur = "";
  let last = 0;
  // Spans crossing a newline are closed at the line end and reopened on the next line.
  for (const m of html.matchAll(/<span[^>]*>|<\/span>|\n/g)) {
    cur += html.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0] === "\n") {
      out.push(cur + "</span>".repeat(open.length));
      cur = open.join("");
    } else {
      if (m[0] === "</span>") open.pop();
      else open.push(m[0]);
      cur += m[0];
    }
  }
  out.push(cur + html.slice(last) + "</span>".repeat(open.length));
  return out;
}

const ENTITY_RE = /^&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i;

/**
 * Wrap the text at `ranges` (offsets into the line's plain text) in `open(i)`…`close`,
 * splitting around tags so the result stays well nested. `skip` vetoes a range by the classes it sits in.
 */
function decorate(
  html: string,
  ranges: Range[],
  open: (i: number) => string,
  close: string,
  skip?: (classes: string[]) => boolean,
): string {
  if (ranges.length === 0) return html;
  let out = "";
  let pos = 0;
  let r = 0;
  let inside = -1;
  const stack: string[] = [];
  const shut = () => {
    if (inside >= 0) out += close;
    inside = -1;
  };
  for (let i = 0; i < html.length; ) {
    if (html[i] === "<") {
      const end = html.indexOf(">", i) + 1;
      const tag = html.slice(i, end);
      shut();
      if (tag[1] === "/") stack.pop();
      else stack.push(/class="([^"]*)"/.exec(tag)?.[1] ?? "");
      out += tag;
      i = end;
      continue;
    }
    const unit = html[i] === "&" ? (ENTITY_RE.exec(html.slice(i, i + 12))?.[0] ?? "&") : html[i];
    while (r < ranges.length && ranges[r][1] <= pos) r++;
    const hit = r < ranges.length && ranges[r][0] <= pos && !skip?.(stack);
    if (!hit) shut();
    else if (inside !== r) {
      shut();
      out += open(r);
      inside = r;
    }
    out += unit;
    i += unit.length;
    pos++;
  }
  shut();
  return out;
}

function matchRanges(text: string, term: string): Range[] {
  if (!term) return [];
  const hay = text.toLowerCase();
  const needle = term.toLowerCase();
  const out: Range[] = [];
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) out.push([at, at + needle.length]);
  return out;
}

const KEYWORDS = new Set(
  ("abstract as async await break case catch class const continue debugger declare default delete do else enum export " +
    "extends false finally for from function get if implements import in instanceof interface is keyof let new null " +
    "of package private protected public readonly return satisfies set static super switch this throw true try type " +
    "typeof undefined var void while with yield").split(" "),
);
const NOT_CODE = /\bhljs-(string|comment|keyword|number|literal|regexp|meta|doc)\b/;

function identifierRanges(text: string): { ranges: Range[]; names: string[] } {
  const ranges: Range[] = [];
  const names: string[] = [];
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (KEYWORDS.has(m[0])) continue;
    ranges.push([m.index, m.index + m[0].length]);
    names.push(m[0]);
  }
  return { ranges, names };
}

const attr = (s: string): string => escapeHtml(s).replace(/"/g, "&quot;");

/** One line's final HTML: syntax colours, then word marks, search matches and clickable identifiers. */
function lineHtml(base: string, text: string, opts: { words?: Range[]; term: string; symbols: boolean }): string {
  let html = base;
  if (opts.words?.length) html = decorate(html, opts.words, () => '<mark class="fv-word">', "</mark>");
  html = decorate(html, matchRanges(text, opts.term), () => '<mark class="fv-hl">', "</mark>");
  if (opts.symbols) {
    const { ranges, names } = identifierRanges(text);
    html = decorate(
      html,
      ranges,
      (i) => `<span class="fv-sym" data-sym="${attr(names[i])}" data-col="${ranges[i][0] + 1}" title="Go to definition">`,
      "</span>",
      (classes) => classes.some((c) => NOT_CODE.test(c)),
    );
  }
  return html;
}

/** Per-side syntax HTML for diff rows, keyed by line number on that side. */
function sideHtml(rows: Row[], side: "old" | "new", lang: string | undefined): Map<number, string> {
  const picked = rows.filter((r): r is Extract<Row, { kind: "ctx" | "del" | "add" }> =>
    side === "old" ? r.kind === "ctx" || r.kind === "del" : r.kind === "ctx" || r.kind === "add",
  );
  const html = highlightLines(picked.map((r) => r.text), lang);
  const out = new Map<number, string>();
  picked.forEach((r, i) => out.set(side === "old" ? (r as { old: number }).old : (r as { new: number }).new, html[i]));
  return out;
}

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const MARK_TITLE: Record<GutterMark, string> = { added: "Added", changed: "Changed", removed: "Lines removed above" };
const STATUS_TEXT = { M: "modified", A: "new file", D: "deleted" } as const;

export default function FileViewer({
  path,
  diff,
  content,
  status,
  counts,
  defaultMode,
  uncommitted,
  highlight,
  onIdentifierClick,
  scrollToLine,
  scrollKey,
}: FileViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState(defaultMode);
  const [layout, setLayout] = usePreference(preferences.fileViewerDiffLayout);
  const [width, setWidth] = useState<number | null>(null);
  // `seq` alternates the animation name so a repeat flash on the same row restarts it.
  const [flash, setFlash] = useState<{ line: number; seq: number } | null>(null);
  const [pending, setPending] = useState<number | undefined>(undefined);

  const parsed = useMemo(() => (diff ? parseDiff(diff) : []), [diff]);
  const changed = isChanged(parsed);
  const rows = useMemo(() => (content != null && changed ? fillGaps(parsed, content) : parsed), [parsed, content, changed]);
  const codeLines = useMemo(
    () => (content != null ? splitLines(content) : changed && status !== "D" ? newSide(parsed) : null),
    [content, changed, parsed, status],
  );
  const items = useMemo(() => foldRows(rows), [rows]);
  // Expanded folds belong to one row list; a new diff starts folded again.
  const [expansion, setExpansion] = useState<{ rows: Row[]; ids: Set<number> }>({ rows, ids: new Set() });
  const expanded = useMemo(() => (expansion.rows === rows ? expansion.ids : new Set<number>()), [expansion, rows]);
  const expand = useCallback((id: number) => setExpansion({ rows, ids: new Set([...expanded, id]) }), [rows, expanded]);

  const narrow = width !== null && width < SPLIT_MIN_WIDTH;
  const shownMode = changed ? mode : "code";
  const shownLayout = narrow ? "unified" : layout;
  const total = counts ?? countChanges(parsed);
  const lang = detectLang(path);
  const term = highlight ?? "";
  const symbols = !!onIdentifierClick && NAVIGABLE.test(path);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (el.clientWidth > 0) setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries.at(-1)?.contentRect.width;
      if (w !== undefined) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const diffHtml = useMemo(() => {
    if (shownMode !== "diff") return null;
    const words = rowWordMarks(rows);
    const oldSide = sideHtml(rows, "old", lang);
    const newSideHtml = sideHtml(rows, "new", lang);
    const out = new Map<Row, string>();
    for (const r of rows) {
      if (r.kind === "gap") continue;
      const base = r.kind === "del" ? oldSide.get(r.old) : newSideHtml.get(r.new);
      out.set(r, lineHtml(base ?? escapeHtml(r.text), r.text, { words: words.get(r), term, symbols: false }));
    }
    return out;
  }, [shownMode, rows, lang, term]);

  const codeHtml = useMemo(() => {
    if (shownMode !== "code" || !codeLines) return null;
    return highlightLines(codeLines, lang).map((h, i) => lineHtml(h, codeLines[i], { term, symbols }));
  }, [shownMode, codeLines, lang, term, symbols]);

  const marks = useMemo(() => (changed ? gutterMarks(rows) : new Map<number, GutterMark>()), [changed, rows]);

  useEffect(() => {
    if (scrollToLine != null) setPending(scrollToLine);
  }, [scrollToLine, scrollKey]);

  useLayoutEffect(() => {
    if (pending == null) return;
    const el = bodyRef.current?.querySelector(`tr[data-line="${pending}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      setFlash((f) => ({ line: pending, seq: (f?.seq ?? 0) + 1 }));
      setPending(undefined);
      return;
    }
    if (shownMode === "diff") {
      const fold = items.find((it) => it.kind === "fold" && it.rows.some((r) => (r.kind === "ctx" || r.kind === "add") && r.new === pending));
      if (fold && fold.kind === "fold" && !expanded.has(fold.id)) return expand(fold.id);
      if (codeLines) return setMode("code");
    }
    setPending(undefined);
  }, [pending, shownMode, items, codeLines, expanded, expand]);

  useEffect(() => {
    if (flash == null) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  const onBodyClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onIdentifierClick || shownMode !== "code") return;
    const sym = (e.target as HTMLElement).closest<HTMLElement>("[data-sym]");
    const line = Number(sym?.closest("tr")?.dataset.line);
    if (!sym || !line) return;
    onIdentifierClick({ line, col: Number(sym.dataset.col) }, sym.dataset.sym ?? "");
  };

  const slash = path.lastIndexOf("/");
  const flashCls = (n: number | undefined) =>
    n !== undefined && n === flash?.line ? ` fv-flash${flash.seq % 2 ? "" : " fv-flash-alt"}` : "";

  const foldRow = (it: Extract<Item, { kind: "fold" }>) => (
    <tr key={`f${it.id}`} className="fv-fold-row">
      <td colSpan={4}>
        <button type="button" className="fv-fold" onClick={() => expand(it.id)}>
          ⋯ Expand {it.rows.length} unchanged lines
        </button>
      </td>
    </tr>
  );
  const gapRow = (r: Extract<Row, { kind: "gap" }>, key: string) => (
    <tr key={key} className="fv-gap-row">
      <td colSpan={4}>⋯ {r.count} unchanged lines</td>
    </tr>
  );
  const cell = (r: Row | undefined, side: "del" | "add") =>
    r && r.kind !== "gap" ? <td className={`fv-cd fv-s-${side}`} dangerouslySetInnerHTML={{ __html: diffHtml?.get(r) ?? "" }} /> : <td className="fv-cd fv-s-empty" />;

  let body: ReactNode;
  if (shownMode === "code") {
    body = codeHtml ? (
      <table className="fv-table fv-code">
        <colgroup>
          <col style={{ width: 6 }} />
          <col style={{ width: 46 }} />
          <col />
        </colgroup>
        <tbody>
          {codeHtml.map((html, i) => {
            const n = i + 1;
            const m = marks.get(n);
            return (
              <tr key={n} data-line={n} data-mark={m} className={`${m ? `fv-m-${m}` : ""}${flashCls(n)}`}>
                <td className="fv-gm" title={m ? MARK_TITLE[m] : undefined} />
                <td className="fv-no">{n}</td>
                <td className="fv-cd" dangerouslySetInnerHTML={{ __html: html }} />
              </tr>
            );
          })}
        </tbody>
      </table>
    ) : (
      <p className="fv-empty">{status === "D" ? "This file was deleted." : "File content is not loaded."}</p>
    );
  } else {
    const visible = expandFolds(items, expanded);
    if (shownLayout === "unified") {
      body = (
        <table className="fv-table fv-unified">
          <colgroup>
            <col style={{ width: 46 }} />
            <col style={{ width: 46 }} />
            <col style={{ width: 18 }} />
            <col />
          </colgroup>
          <tbody>
            {visible.map((it, i) => {
              if (it.kind === "fold") return foldRow(it);
              if (it.kind === "gap") return gapRow(it, `g${i}`);
              const n = it.kind === "del" ? undefined : it.new;
              return (
                <tr key={i} data-line={n} className={`fv-r-${it.kind}${flashCls(n)}`}>
                  <td className="fv-no">{it.kind === "add" ? "" : it.old}</td>
                  <td className="fv-no">{n ?? ""}</td>
                  <td className="fv-sg">{it.kind === "del" ? "−" : it.kind === "add" ? "+" : ""}</td>
                  <td className="fv-cd" dangerouslySetInnerHTML={{ __html: diffHtml?.get(it) ?? "" }} />
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    } else {
      body = (
        <table className="fv-table fv-split">
          <colgroup>
            <col style={{ width: 42 }} />
            <col />
            <col style={{ width: 42 }} />
            <col />
          </colgroup>
          <tbody>
            {pairRows(visible).map((p, i) => {
              if (p.kind === "fold") return foldRow(p);
              if (p.kind === "gap") return gapRow(p, `g${i}`);
              if (p.kind === "ctx") {
                const r = p.right as Extract<Row, { kind: "ctx" }>;
                return (
                  <tr key={i} data-line={r.new} className={`fv-r-ctx${flashCls(r.new)}`}>
                    <td className="fv-no">{r.old}</td>
                    <td className="fv-cd" dangerouslySetInnerHTML={{ __html: diffHtml?.get(r) ?? "" }} />
                    <td className="fv-no">{r.new}</td>
                    <td className="fv-cd" dangerouslySetInnerHTML={{ __html: diffHtml?.get(r) ?? "" }} />
                  </tr>
                );
              }
              const d = p.del?.kind === "del" ? p.del : undefined;
              const a = p.add?.kind === "add" ? p.add : undefined;
              return (
                <tr key={i} data-line={a?.new} className={`fv-r-change${flashCls(a?.new)}`}>
                  <td className={`fv-no ${d ? "fv-s-del" : "fv-s-empty"}`}>{d?.old ?? ""}</td>
                  {cell(d, "del")}
                  <td className={`fv-no ${a ? "fv-s-add" : "fv-s-empty"}`}>{a?.new ?? ""}</td>
                  {cell(a, "add")}
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }
  }

  return (
    <div ref={rootRef} className="fv" data-testid="file-viewer">
      <div className="fv-header" data-testid="file-viewer-header">
        <span className="fv-path">
          {path.slice(0, slash + 1)}
          <b>{path.slice(slash + 1)}</b>
        </span>
        {changed && (
          <span className="fv-stat">
            <span className="fv-pa">+{total.add}</span> <span className="fv-pd">−{total.del}</span>
            {uncommitted && <span className="fv-muted"> · {STATUS_TEXT[status ?? "M"]}, uncommitted</span>}
          </span>
        )}
        <span className="fv-spacer" />
        {changed && (
          <div className="fv-seg" role="group" aria-label="Show as">
            <button type="button" aria-pressed={shownMode === "diff"} onClick={() => setMode("diff")}>
              Diff
            </button>
            <button type="button" aria-pressed={shownMode === "code"} onClick={() => setMode("code")}>
              Code
            </button>
          </div>
        )}
        {shownMode === "diff" ? (
          <div className="fv-seg" role="group" aria-label="Diff layout">
            <button
              type="button"
              aria-pressed={shownLayout === "split"}
              disabled={narrow}
              title={narrow ? "Needs a wider pane" : undefined}
              onClick={() => setLayout("split")}
            >
              Split
            </button>
            <button type="button" aria-pressed={shownLayout === "unified"} onClick={() => setLayout("unified")}>
              Unified
            </button>
          </div>
        ) : (
          changed && (
            <span className="fv-legend" data-testid="file-viewer-legend">
              <span>
                <i className="fv-legend-added" />
                added
              </span>
              <span>
                <i className="fv-legend-changed" />
                changed
              </span>
              <span>
                <i className="fv-legend-removed" />
                removed
              </span>
            </span>
          )
        )}
      </div>
      <div ref={bodyRef} className="fv-body" data-testid="file-viewer-body" onClick={onBodyClick}>
        {body}
      </div>
    </div>
  );
}
