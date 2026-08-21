---
name: pavilio-archive-plan
description: Archive a shipped change OpenSpec-style — fold its delta specs into the living specs under openspec/specs/, move the change dir into the archived-changes tree, and distill durable knowledge into CONTEXT.md/ADRs. Skill-owned (git-mv + markdown fold), no CLI. Use when the user invokes `/pavilio-archive-plan`, a change's PR has merged, or [[pavilio-manager]] flags a merged-but-unarchived change.
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

   **All-or-nothing.** A fold or validation failure leaves the active change dir **and** the living specs unchanged (see [[pavilio-openspec-storage]]) — report the error and stop; do not move the change dir.

3. **Distill durable knowledge.** Terms that crystallised → `CONTEXT.md`. A decision meeting the ADR bar (hard to reverse + surprising + real trade-off) that has no ADR yet → offer one. Don't force either.

4. **Move the change dir under `openspec/changes/archive/`.** `mkdir -p` the backend's `openspec/changes/archive/`, then `git mv openspec/changes/<change-id> openspec/changes/archive/YYYY-MM-DD-<change-id>` (merge date as the prefix). This move is what closes the loop and removes the change from the active set — there is no pointer file to update. Use `git mv` so history follows (plain `mv` only if untracked). A coordinated multi-repository change is archived per repository, each in its own resolved backend.

5. **Commit** the living-specs changes, `CONTEXT.md`, **and the moved change dir** in the workspace repo: `chore(<project>): archive <change-id>`.

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
