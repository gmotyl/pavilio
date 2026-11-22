import BranchPicker from "../git/BranchPicker";
import { useGitChanges } from "../git/useGitChanges";

interface Props {
  /** Repo or worktree directory. */
  root: string;
  selected?: string | null;
  onOpen: (path: string) => void;
  /** After a stage, commit or checkout: the tree's badges are stale. */
  onChanged: () => void;
}

// Porcelain XY → one letter; untracked reads as U like the tree.
const letter = (s: string) => (s === "??" ? "U" : s.charAt(0));

/** Working-tree changes with stage, commit, push and branch checkout. */
export default function ChangesPanel({ root, selected, onOpen, onChanged }: Props) {
  const g = useGitChanges(root);
  const after = (p: Promise<unknown>) => p.then(onChanged);
  const busy = !!g.loading;

  return (
    <aside className="cv-rail cv-panel" aria-label="Changes" data-testid="code-changes-panel">
      <div className="cv-panel-head">
        <h4>Changes</h4>
        {g.branch && (
          <BranchPicker
            branches={g.branches}
            value={g.branch}
            onChange={(b) => after(g.checkout(b))}
            align="right"
            testIdPrefix="changes-branch"
            trigger={<>{g.loading === "switching" ? "switching…" : g.branch} ▾</>}
            triggerClassName="cv-panel-branch"
            triggerStyle={{}}
          />
        )}
      </div>
      {g.checkoutError && (
        <p className="cv-panel-err" role="alert">
          {g.checkoutError}{" "}
          <button type="button" data-testid="changes-checkout-error-dismiss" onClick={() => g.setCheckoutError("")}>
            dismiss
          </button>
        </p>
      )}
      {g.files.length === 0 ? (
        <p className="cv-rail-empty">No changes.</p>
      ) : (
        <ul className="cv-panel-files">
          {g.files.map((f) => (
            <li key={f.path} aria-current={f.path === selected ? "true" : undefined}>
              <input type="checkbox" aria-label={`Select ${f.path}`} checked={g.selected.has(f.path)} onChange={() => g.toggleFile(f.path)} />
              <span className={`ft-st ft-st-${letter(f.status)}`}>{letter(f.status)}</span>
              <button type="button" data-testid={`changes-file-${f.path}`} title={f.path} onClick={() => onOpen(f.path)}>
                {f.path}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="cv-panel-actions">
        <button
          type="button"
          data-testid="changes-stage-selected"
          disabled={g.selected.size === 0 || busy}
          onClick={() => after(g.stageFiles([...g.selected]))}
        >
          Stage selected ({g.selected.size})
        </button>
        <button
          type="button"
          data-testid="changes-stage-all"
          disabled={g.files.length === 0 || busy}
          onClick={() => after(g.stageFiles(g.files.map((f) => f.path)))}
        >
          Stage all
        </button>
      </div>
      <textarea
        className="cv-panel-msg"
        aria-label="Commit message"
        placeholder="Commit message…"
        value={g.commitMsg}
        onChange={(e) => g.setCommitMsg(e.target.value)}
      />
      <div className="cv-panel-actions">
        <button type="button" data-testid="changes-commit" disabled={!g.commitMsg.trim() || busy} onClick={() => after(g.commit(false))}>
          Commit
        </button>
        <button type="button" data-testid="changes-commit-push" disabled={!g.commitMsg.trim() || busy} onClick={() => after(g.commit(true))}>
          Commit &amp; Push
        </button>
      </div>
      {g.loading && <p className="cv-rail-empty">{g.loading}…</p>}
    </aside>
  );
}
