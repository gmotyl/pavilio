import { useMemo } from "react";
import { parseDiff } from "./viewer/diffModel";
import "./Review.css";

export interface ChangeRun {
  /** New-side line to jump to: the first added line, or the line after a pure deletion. */
  line: number;
  add: number;
  del: number;
}

/** One entry per contiguous run of added/removed lines. */
export function changeRuns(diff: string): ChangeRun[] {
  const out: ChangeRun[] = [];
  let run: { add: number; del: number; first?: number } | null = null;
  let nextNew = 1;
  const close = (at: number) => {
    if (run) out.push({ line: run.first ?? at, add: run.add, del: run.del });
    run = null;
  };
  for (const r of parseDiff(diff)) {
    if (r.kind === "add") {
      run ??= { add: 0, del: 0 };
      run.add++;
      run.first ??= r.new;
      nextNew = r.new + 1;
    } else if (r.kind === "del") {
      run ??= { add: 0, del: 0 };
      run.del++;
    } else {
      close(r.new);
      nextNew = r.kind === "ctx" ? r.new + 1 : r.new;
    }
  }
  // A deletion at the end of the file has no following line; point at the last one.
  close(Math.max(nextNew - 1, 1));
  return out;
}

interface Props {
  diff?: string;
  /** The file is gone at head: no new-side line to jump to. Status, not diff shape, decides — an emptied file still has one. */
  deleted?: boolean;
  onJump: (line: number) => void;
}

export default function ChangeRail({ diff, deleted = false, onJump }: Props) {
  const runs = useMemo(() => (diff && !deleted ? changeRuns(diff) : []), [diff, deleted]);
  return (
    <aside className="rv-rail" aria-label="Changes in this file">
      <h4>Changes in this file</h4>
      {deleted ? (
        <p className="rv-rail-empty">File deleted.</p>
      ) : runs.length === 0 ? (
        <p className="rv-rail-empty">Nothing here.</p>
      ) : (
        runs.map((r, i) => (
          <button key={`${r.line}-${i}`} type="button" data-testid={`review-rail-${r.line}`} onClick={() => onJump(r.line)}>
            <i className={r.add === 0 ? "rv-k-del" : r.del === 0 ? "rv-k-add" : "rv-k-mod"} aria-hidden="true" />
            <span className="rv-ln">L{r.line}</span>
            <span className="rv-sum">
              {r.add > 0 && <span className="rv-add">+{r.add}</span>}
              {r.add > 0 && r.del > 0 && " "}
              {r.del > 0 && <span className="rv-del">−{r.del}</span>}
            </span>
          </button>
        ))
      )}
    </aside>
  );
}
