---
name: pavilio-archive-plan
description: Archive a shipped plan OpenSpec-style — fold its spec's requirement deltas into the project's living specs under projects/<project>/specs/, distill durable knowledge into CONTEXT.md/ADRs, and mark the plan Done in CURRENT.md. Use when the user invokes `/pavilio-archive-plan`, a plan's PR has merged, or [[pavilio-manager]] flags a merged-but-unarchived plan.
---

# pavilio-archive-plan

Close the loop after a change ships: what the plan *changed* becomes part of what the project *is*. Analog of OpenSpec's archive step — deltas merge into living truth; the plan itself stays in `plans/` as history.

**Announce at start:** "Using pavilio-archive-plan to archive <plan>."

## Usage

```
/pavilio-archive-plan [project] [plan-file]
```

No args → resolve project from the session, then read `projects/<project>/plans/CURRENT.md`: the active plan whose PR is merged is the candidate. Multiple candidates → list them, ask which. None → say so and stop.

## Steps

1. **Verify shipped.** Confirm the plan's change actually landed: PR merged / squash commit on the target repo's main. Not merged → stop ("archive is for shipped plans — PR #N is still open").

2. **Fold spec deltas into living specs.** Read the plan's `-design.md`. For each requirement in its delta sections:
   - `ADDED` → append the requirement + scenarios to `projects/<project>/specs/<area>.md` (create the file lazily; pick `<area>` by feature domain, follow existing spec filenames first).
   - `MODIFIED` → find the requirement in `specs/` and rewrite it to the new behavior. Target missing from specs → do NOT silently reclassify: add it with a `<!-- folded from MODIFIED delta <plan>; prior behavior was undocumented -->` marker and flag it in the report + commit message so the was→is trail isn't lost.
   - `REMOVED` → delete the requirement from `specs/`.
   - Spec files are behavior-level: requirement statements + WHEN/THEN scenarios, no implementation detail.
   - Design doc has no delta sections (older spec) → distill its behavior into requirement + scenarios form first, then fold. Say you did this.

3. **Distill durable knowledge.** Terms that crystallised → `CONTEXT.md`. A decision meeting the ADR bar (hard to reverse + surprising + real trade-off) that has no ADR yet → offer one. Don't force either.

4. **Mark Done in CURRENT.md.** Move the plan out of the active section to a `Done:` line with PR number + merge date (existing convention). Promote a follow-on candidate to active only if the user confirms.

5. **Commit** the specs/CONTEXT/CURRENT.md changes in the workspace repo: `chore(<project>): archive <plan-name>`.

## Living specs layout

```
projects/<project>/specs/
  <area>.md        — current behavior of one feature area:
                     ### Requirement: ... / #### Scenario: WHEN/THEN
```

`specs/` is the base future [[pavilio-grill]] designs write their deltas against, and what a staleness check can compare a parked spec to.

## Non-goals

- Does not archive unshipped plans — merge first.
- Does not move or delete plan/design files; `plans/` is the history, CURRENT.md is the state.
- Does not write or modify code.
- Does not replace [[pavilio-session-end]] — archive is per-plan, session-end is per-session.
