---
name: pavilio-archive-plan
description: Archive a shipped change OpenSpec-style — fold its delta specs into the living specs under openspec/specs/, move the change dir into the archived-changes tree, distill durable knowledge into CONTEXT.md/ADRs, and retire the shipped branch, its remote and its worktree. Skill-owned (git-mv + markdown fold), no CLI. Use when the user invokes `/pavilio-archive-plan`, a change's PR has merged, or [[pavilio-manager]] flags a merged-but-unarchived change.
---

# pavilio-archive-plan

Close the loop after a change ships: what the change *changed* becomes part of what the project *is*. **Skill-owned: git-mv + markdown fold, no CLI** (see [[pavilio-openspec-storage]]). OpenSpec's archive step — deltas merge into living truth; the change dir moves under the backend's archive as history.

**Announce at start:** "Using pavilio-archive-plan to archive <change-id>."

## Usage

```
/pavilio-archive-plan [project] [change-id]
```

No args → resolve project + backend from the session (see [[pavilio-openspec-storage]]), then scan the un-archived dirs under `openspec/changes/`: the change whose PR is merged is the candidate. Multiple candidates → list them, ask which. None → say so and stop.

## Steps

1. **Verify shipped.** Confirm the change actually landed: PR merged / squash commit on the target repo's main. Not merged → stop ("archive is for shipped changes — PR #N is still open").

2. **Fold delta specs into living specs.** Read the change's delta specs `openspec/changes/<change-id>/specs/<capability>/spec.md`. For each requirement in the delta sections:
   - `ADDED` → append the requirement + scenarios to `openspec/specs/<capability>/spec.md` (create the file lazily; pick `<capability>` by feature domain, follow existing living-spec capability names first).
   - `MODIFIED` → find the requirement in `openspec/specs/` and rewrite it to the new behavior. Search before declaring it missing: exact requirement name across all living capability specs, then keywords from the requirement statement and its scenarios (behavior may be documented under a different name or capability). Only after that search comes up empty → add it with a `<!-- folded from MODIFIED delta <change-id>; prior behavior was undocumented -->` marker, state in the report what was searched (names + keywords), and flag it in the commit message so the was→is trail isn't silently lost.
   - `REMOVED` → delete the requirement from `openspec/specs/`.
   - Living specs are behavior-level: requirement statements + WHEN/THEN scenarios, no implementation detail.
   - Change has no delta sections (older change) → distill its behavior into requirement + scenarios form first, then fold. Say you did this.
   - **Spec-worthy vs. CONTEXT-worthy.** Before distilling, decide where the change's content belongs — a capability with no `openspec/specs/<capability>/spec.md` yet is **not** a reason to skip: create it lazily, same as the ADDED case above. Apply this test: *if this shipped differently next month, would there be a right/wrong behavior to check it against?* Yes → distill into a requirement + scenarios in `openspec/specs/<capability>/spec.md` (new file if needed). No — a one-off action or decision with no forward-looking contract (a completed rename, a copy tweak, a test-coverage push, a migration) → `CONTEXT.md` gotcha instead, per step 3. Defaulting everything to CONTEXT.md because "this capability never had a spec before" is the failure mode this test exists to prevent.

   **All-or-nothing.** A fold or validation failure leaves the active change dir **and** the living specs unchanged (see [[pavilio-openspec-storage]]) — report the error and stop; do not move the change dir.

3. **Distill durable knowledge.** Terms that crystallised → `CONTEXT.md`. A decision meeting the ADR bar (hard to reverse + surprising + real trade-off) that has no ADR yet → offer one. Don't force either.

4. **Move the change dir under `openspec/changes/archive/`.** `mkdir -p` the backend's `openspec/changes/archive/`, then `git mv openspec/changes/<change-id> openspec/changes/archive/YYYY-MM-DD-<change-id>` (merge date as the prefix). This move is what closes the loop and removes the change from the active set — there is no pointer file to update. Use `git mv` so history follows (plain `mv` only if untracked). A coordinated multi-repository change is archived per repository, each in its own resolved backend.

5. **Commit** the living-specs changes, `CONTEXT.md`, **and the moved change dir** in the workspace repo: `chore(<project>): archive <change-id>`.

6. **Retire the shipped branch and its worktree.** A merged change leaves a branch, a remote branch and usually a worktree behind. Archiving the change without them means the repo accumulates one dead branch per shipped change — they pile up silently, because nothing else ever revisits them. Only act on a branch you have *proved* shipped.

   1. **Find the candidate.** The change dir records no branch, so derive it and confirm: the head branch of the merged PR from step 1 (`gh pr view <n> --json headRefName`), or a worktree whose path matches `<repo>-<slug>` / a branch whose name carries the change slug. No candidate → say so and stop. Nothing is wrong with a change that shipped straight from `main`.
   2. **Prove it merged by PR state, never by ancestry.** `gh pr list --head <branch> --state merged --json number`, and the result must contain **the PR from step 1** — not just any merged PR. Branch names get reused, so a name-matched candidate can otherwise be cleared by an earlier, unrelated change's PR, or by a branch that was merged and then recreated for new work. Where the repo squash-merges, a shipped branch is **not** an ancestor of `main`, so `git merge-base --is-ancestor` calls a merged branch unmerged — judging by ancestry keeps everything and the step does nothing. Step 1's PR not among the branch's merged PRs → **keep it** and report it. Unshipped work is the one thing this step must never eat.
   3. **Check the worktree is safe to remove:** `git -C <worktree> status --porcelain` empty, and `git -C <worktree> log --oneline origin/<branch>..HEAD` empty. Run `git fetch --prune origin` first so the ref is current. If `origin/<branch>` does not exist (never pushed, or already pruned), the check cannot pass — treat it as unpushed work. Dirty or unpushed → leave it, say why, and carry on with the rest.
   4. **Remove**, in this order: `git worktree remove <path>` → `git branch -D <branch>` → `git push --no-verify origin --delete <branch>`. Force `-D`, not `-d`: `-d` runs the same ancestry test step 2 rejects and refuses a squash-merged branch that has no upstream, leaving a half-retired branch behind. The gate is the PR-state proof in step 2, not git's ancestry heuristic.
   5. Report what was retired and what was kept, with the reason for each keep.

   **`--no-verify` on the delete, and batch the refspecs.** A `pre-push` hook that runs the test suite fires on deletions too, where there is no diff to test — one delete per push then costs a whole suite run each, which looks like a network hang rather than a hook. Deleting several at once: one push, all refspecs (`git push --no-verify origin :refs/heads/a :refs/heads/b …`).

   **Never** delete a branch checked out in another worktree (git refuses — leave it and say so), a worktree this session did not create (another session's, e.g. under `/tmp`), or anything under `.claude/worktrees/`.

## Living specs layout

```
openspec/specs/
  <capability>/spec.md   — current behavior of one capability:
                           ### Requirement: ... / #### Scenario: WHEN/THEN
```

Capability files are **undated kebab-case names** (`checkout-tax`, `realtime-refresh`) — never `YYYY-MM-DD-*` and never `-design`. `openspec/specs/` is the base future [[pavilio-grill]] designs write their deltas against, and what a staleness check can compare a parked design to.

## Non-goals

- Does not archive unshipped changes — merge first.
- Moves the change dir under `openspec/changes/archive/` (step 4) but never **deletes** it; the archive is the history.
- Does not write or modify code.
- Does not shell out to an OpenSpec binary — fold + move are skill logic (see [[pavilio-openspec-storage]]).
- Does not replace [[pavilio-session-end]] — archive is per-change, session-end is per-session.
- Does not delete unshipped branches, branches with no merged PR, or worktrees it did not create — step 6 retires only what a merged PR proves has shipped.
