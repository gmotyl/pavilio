import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, Printer, X } from "lucide-react";
import type { BufferSnapshot, ColoredRun } from "./TerminalView";

interface Props {
  sessionName: string | null;
  snapshot: BufferSnapshot | null;
  onClose: () => void;
}

function runStyle(run: ColoredRun): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (run.fg) s.color = run.fg;
  if (run.bg) s.background = run.bg;
  if (run.bold) s.fontWeight = 600;
  if (run.italic) s.fontStyle = "italic";
  if (run.underline) {
    s.textDecorationLine = (s.textDecorationLine
      ? `${s.textDecorationLine} underline`
      : "underline") as React.CSSProperties["textDecorationLine"];
  }
  if (run.strike) {
    s.textDecorationLine = (s.textDecorationLine
      ? `${s.textDecorationLine} line-through`
      : "line-through") as React.CSSProperties["textDecorationLine"];
  }
  if (run.dim) s.opacity = 0.6;
  return s;
}

function snapshotToPlainText(
  snapshot: BufferSnapshot,
  topIndex: number,
  bottomIndex: number,
): string {
  const out: string[] = [];
  for (let i = topIndex; i <= bottomIndex; i++) {
    const line = snapshot.lines[i];
    if (!line || line.length === 0) {
      out.push("");
      continue;
    }
    out.push(line.map((r) => r.text).join(""));
  }
  return out.join("\n").replace(/\n+$/, "");
}

function printSnapshot(text: string, title: string): void {
  const w = window.open("", "_blank");
  if (!w) return;
  const doc = w.document;
  doc.title = title;
  const style = doc.createElement("style");
  style.textContent = `
    body {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 12px;
      line-height: 1.4;
      padding: 24px;
      white-space: pre-wrap;
      margin: 0;
    }
    h1 {
      font-family: system-ui, sans-serif;
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    pre { margin: 0; }
  `;
  doc.head.appendChild(style);
  const h1 = doc.createElement("h1");
  h1.textContent = title;
  doc.body.appendChild(h1);
  const pre = doc.createElement("pre");
  pre.textContent = text;
  doc.body.appendChild(pre);
  w.focus();
  setTimeout(() => w.print(), 100);
}

export function TerminalViewportModal({
  sessionName,
  snapshot,
  onClose,
}: Props) {
  const [topIndex, setTopIndex] = useState<number>(0);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!snapshot) return;
    setTopIndex(snapshot.viewportTopIndex);
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    // Capture phase so we beat xterm's own keydown handler — otherwise
    // xterm sees Escape first and forwards it to the PTY (or swallows it),
    // leaving the modal open. stopPropagation keeps xterm from ever
    // seeing the event.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [snapshot]);

  const visibleSlice = useMemo(() => {
    if (!snapshot) return [] as { idx: number; runs: ColoredRun[] }[];
    const out: { idx: number; runs: ColoredRun[] }[] = [];
    for (let i = topIndex; i <= snapshot.viewportBottomIndex; i++) {
      out.push({ idx: i, runs: snapshot.lines[i] ?? [] });
    }
    return out;
  }, [snapshot, topIndex]);

  if (!snapshot) return null;

  const title = `Terminal viewport — ${sessionName ?? "(unnamed)"}`;
  const canLoadMore = topIndex > 0;
  const linesShown = snapshot.viewportBottomIndex - topIndex + 1;
  const totalLines = snapshot.lines.length;
  // Modal width matches the terminal width plus the body's horizontal
  // padding (px-4 = 32) + outer border (2). Without this, the inner text
  // area is ~34px narrower than the terminal, which clips the last ~4
  // chars of each row to the next line.
  const TEXT_AREA_CHROME_PX = 40;
  const contentWidthPx = Math.min(
    Math.max(snapshot.pixelWidth + TEXT_AREA_CHROME_PX, 320),
    Math.round(window.innerWidth * 0.95),
  );

  const loadPrevious = () => {
    setTopIndex((cur) => Math.max(0, cur - snapshot.pageSize));
  };

  const handlePrint = () => {
    const text = snapshotToPlainText(
      snapshot,
      topIndex,
      snapshot.viewportBottomIndex,
    );
    printSnapshot(text, title);
  };

  return (
    <div
      data-testid="viewport-modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <div
        role="dialog"
        aria-labelledby="viewport-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] flex flex-col rounded-lg"
        style={{
          width: `${contentWidthPx}px`,
          background: snapshot.defaultBg,
          border: "1px solid var(--border-subtle)",
          color: snapshot.defaultFg,
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-2.5 shrink-0"
          style={{
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--bg-elevated)",
          }}
        >
          <h2
            id="viewport-modal-title"
            className="text-[13px] font-semibold truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </h2>
          <div
            className="flex items-center gap-1"
            style={{ color: "var(--text-secondary)" }}
          >
            <span
              className="text-[11px] mr-2 tabular-nums"
              style={{ color: "var(--text-tertiary)" }}
            >
              {linesShown} / {totalLines} lines
            </span>
            <button
              type="button"
              data-testid="viewport-modal-print"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] transition-colors"
              style={{
                background: "var(--bg-base)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-subtle)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--bg-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "var(--bg-base)")
              }
              title="Print"
            >
              <Printer size={12} />
              Print
            </button>
            <button
              type="button"
              data-testid="viewport-modal-close"
              onClick={onClose}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.background = "transparent";
              }}
              title="Close (Esc)"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div
          className="flex-1 min-h-0 overflow-auto"
          style={{ background: snapshot.defaultBg }}
        >
          {canLoadMore && (
            <button
              type="button"
              data-testid="viewport-modal-load-previous"
              onClick={loadPrevious}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] tracking-widest uppercase transition-colors sticky top-0 z-10"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
                borderBottom: "1px solid var(--border-subtle)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--bg-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "var(--bg-elevated)")
              }
              title={`Load previous ${snapshot.pageSize} lines`}
            >
              <ChevronUp size={12} />
              Load previous page
            </button>
          )}
          <div
            className="px-4 py-3"
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: `${snapshot.fontSize}px`,
              lineHeight: 1.35,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: snapshot.defaultFg,
            }}
            tabIndex={0}
            aria-label="Terminal viewport text"
          >
            {visibleSlice.length === 0 ? (
              <span style={{ color: "var(--text-muted)" }}>
                (viewport is empty)
              </span>
            ) : (
              visibleSlice.map(({ idx, runs }) => (
                <div key={idx}>
                  {runs.length === 0 ? (
                    <>{" "}</>
                  ) : (
                    runs.map((run, j) => (
                      <span key={j} style={runStyle(run)}>
                        {run.text}
                      </span>
                    ))
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div
          className="flex items-center justify-between px-4 py-2 text-[11px] shrink-0"
          style={{
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--bg-elevated)",
            color: "var(--text-tertiary)",
          }}
        >
          <span>
            Right-click the text and choose <em>Read aloud</em> (Edge) or use
            your screen reader.
          </span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}

export default TerminalViewportModal;
