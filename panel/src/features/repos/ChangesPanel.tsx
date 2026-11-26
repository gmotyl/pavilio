import type { useBranches } from "../git/useBranches";
import type { useGitChanges } from "../git/useGitChanges";
import { CodeBranchPicker } from "./CodeBranchPicker";

interface Props {
  /** The checkout's `useGitChanges`, lifted so the toolbar picker shares it. */
  changes: ReturnType<typeof useGitChanges>;
  branches: ReturnType<typeof useBranches>;
  /** HEAD's sha while detached. */
  head: string | null;
  /** A branch pick from the panel's label; the same checkout the toolbar picker runs. */
  onSwitch: (target: string, opts: { track: boolean }) => void;
  selected?: string | null;
  onOpen: (path: string) => void;
  /** After a stage or commit: the tree's badges are stale. */
  onChanged: () => void;
}

// Porcelain XY → one letter; untracked reads as U like the tree.
const letter = (s: string) => (s === "??" ? "U" : s.charAt(0));

/** Working-tree changes with stage, commit, push and branch checkout. */
export default function ChangesPanel({ changes: g, branches, head, onSwitch, selected, onOpen, onChanged }: Props) {
  const after = (p: Promise<unknown>) => p.then(onChanged);
  const busy = !!g.loading;

  return (
    <aside className="cv-rail cv-panel" aria-label="Changes" data-testid="code-changes-panel">
      <div className="cv-panel-head">
        <h4>Changes</h4>
        <CodeBranchPicker changes={g} branches={branches} head={head} onSwitch={onSwitch} variant="panel" testIdPrefix="changes-branch" />
      </div>
      {g.checkoutError && (
        <p className="cv-panel-err" role="alert">
          {g.checkoutError}{" "}
          <button type="button" data-testid="changes-checkout-error-dismiss" onClick={() => g.setCheckoutError("")}>
            dismiss
          </button>
        </p>
      )}
      {g.actionError && (
        <p className="cv-panel-err" role="alert">
          {g.actionError}{" "}
          <button type="button" data-testid="changes-action-error-dismiss" onClick={() => g.setActionError("")}>
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
