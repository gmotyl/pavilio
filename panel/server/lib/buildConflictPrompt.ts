export interface ConflictPromptInput {
  /** Absolute path to the repo that conflicted. */
  repoRoot: string;
  /** Branch the conflict happened on. */
  branch: string;
  /** Unmerged paths, captured before the rebase was aborted. */
  conflictFiles: string[];
  /** Paths auto-sync commits (project data). */
  dataPaths: string[];
  /** Paths rsynced in by update.sh (generated code). */
  generatedPaths: string[];
}

/** A trailing slash means "this directory and everything under it"; anything else is an exact path. */
function matches(file: string, patterns: string[]): boolean {
  return patterns.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p));
}

function section(title: string, files: string[], guidance: string): string {
  if (files.length === 0) return "";
  return `${title} — ${files.length}:\n${files.map((f) => `  ${f}`).join("\n")}\n${guidance}\n\n`;
}

/**
 * Turns an aborted-rebase conflict into instructions an agent can act on.
 * Returns "" when there is nothing to resolve, so callers can store it unconditionally.
 */
export function buildConflictPrompt(input: ConflictPromptInput): string {
  const { repoRoot, branch, conflictFiles, dataPaths, generatedPaths } = input;
  if (conflictFiles.length === 0) return "";

  const generated = conflictFiles.filter((f) => matches(f, generatedPaths));
  const data = conflictFiles.filter((f) => !matches(f, generatedPaths) && matches(f, dataPaths));
  const other = conflictFiles.filter((f) => !matches(f, generatedPaths) && !matches(f, dataPaths));

  const header =
    `Auto-sync hit a rebase conflict in ${repoRoot} (branch ${branch}). The rebase was ` +
    `already aborted, so the repo is clean at HEAD — nothing is half-applied. Resolve the ` +
    `divergence and get it synced again.\n\n`;

  const generatedGuidance =
    `Resolve these WHOLESALE from one host's tree, never per-hunk. A per-hunk merge takes the\n` +
    `conflicting files from one upstream version and the cleanly-merged neighbours from the\n` +
    `other, producing a tree that matches no upstream commit. Prefer the host that runs\n` +
    `scripts/update.sh (only one host does). After starting the merge:\n` +
    `  git -C ${repoRoot} restore --source=HEAD --staged --worktree -- ${generated.join(" ")}\n` +
    `First check that HEAD actually holds a full tree for each path:\n` +
    `  git -C ${repoRoot} ls-tree -r --name-only HEAD <path>\n` +
    `If HEAD tracks almost nothing there, restoring wholesale DELETES files instead of\n` +
    `reverting them.`;

  const dataGuidance =
    `Keep BOTH sides — these are append-mostly notes and plans, and dropping a side drops\n` +
    `written work. Merge the content rather than choosing a winner.`;

  const otherGuidance =
    `Read these and decide. Their presence means the dataPaths / generatedPaths lists in\n` +
    `panel.config.ts are incomplete — say so in your summary.`;

  const steps =
    `Steps:\n` +
    `1. git -C ${repoRoot} tag -f presync-backup HEAD && git -C ${repoRoot} fetch\n` +
    `2. git -C ${repoRoot} merge --no-commit --no-ff @{u}\n` +
    `3. Apply the per-class guidance above.\n` +
    `4. Verify before committing: cd ${repoRoot}/panel && pnpm build && pnpm test (both must exit 0)\n` +
    `5. Commit the merge and push.\n` +
    `6. Confirm it is green: POST http://localhost:3010/api/auto-sync/now and expect state "synced".\n`;

  return (
    header +
    section("Generated files (rsynced by scripts/update.sh)", generated, generatedGuidance) +
    section("Data files (project notes, plans, memos)", data, dataGuidance) +
    section("Unclassified", other, otherGuidance) +
    steps
  );
}
