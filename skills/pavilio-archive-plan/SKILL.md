---
name: pavilio-archive-plan
description: Archive a shipped plan OpenSpec-style — fold its spec's requirement deltas into the project's living specs under projects/<project>/specs/, distill durable knowledge into CONTEXT.md/ADRs, mark the plan Done in CURRENT.md, and `git mv` the plan's files into projects/<project>/plans/archived/. Use when the user invokes `/pavilio-archive-plan`, a plan's PR has merged, or [[pavilio-manager]] flags a merged-but-unarchived plan.
---

# pavilio-archive-plan

Close the loop after a change ships: what the plan *changed* becomes part of what the project *is*. Analog of OpenSpec's archive step — deltas merge into living truth; the plan's own files move to `plans/archived/` and stay there as history (step 5).

**Announce at start:** "Using pavilio-archive-plan to archive <plan>."

## Usage

```
/pavilio-archive-plan [project] [plan-file]
```

No args → resolve project from the session, then read `projects/<project>/plans/CURRENT.md`: the active plan whose PR is merged is the candidate. Multiple candidates → list them, ask which. None → say so and stop.

## Steps

1. **Verify shipped.** Confirm the plan's change actually landed: PR merged / squash commit on the target repo's main. Not merged → stop ("archive is for shipped plans — PR #N is still open").

2. **Fold spec deltas into living specs.** Read the plan's `-design.md`. For each requirement in its delta sections:
   - `ADDED` → append the requirement + scenarios to `projects/<project>/specs/<area>.md` (create the file lazily; pick `<area>` by feature domain, follow existing **living** spec filenames first).
   - `MODIFIED` → find the requirement in `specs/` and rewrite it to the new behavior. Search before declaring it missing: exact requirement name across all **living** spec files (undated `specs/<area>.md` — see Living specs layout below; never search or rewrite dated `*-design.md` legacy files), then keywords from the requirement statement and its scenarios (behavior may be documented under a different name or area). Only after that search comes up empty → add it with a `<!-- folded from MODIFIED delta <plan>; prior behavior was undocumented -->` marker, state in the report what was searched (names + keywords), and flag it in the commit message so the was→is trail isn't silently lost.
   - `REMOVED` → delete the requirement from `specs/`.
   - Spec files are behavior-level: requirement statements + WHEN/THEN scenarios, no implementation detail.
   - Design doc has no delta sections (older spec) → distill its behavior into requirement + scenarios form first, then fold. Say you did this.
   - **Spec-worthy vs. CONTEXT-worthy.** Before distilling, decide where the plan's content belongs — a domain with no `specs/<area>.md` yet is **not** a reason to skip: create it lazily, same as the ADDED case above. Apply this test: *if this shipped differently next month, would there be a right/wrong behavior to check it against?* Yes → distill into a requirement + scenarios in `specs/<area>.md` (new file if needed). No — a one-off action or decision with no forward-looking contract (a completed rename, a copy tweak, a test-coverage push, a migration) → `CONTEXT.md` gotcha instead, per step 3. Defaulting everything to CONTEXT.md because "this domain never had a spec before" is the failure mode this test exists to prevent.

3. **Distill durable knowledge.** Terms that crystallised → `CONTEXT.md`. A decision meeting the ADR bar (hard to reverse + surprising + real trade-off) that has no ADR yet → offer one. Don't force either.

4. **Mark Done in CURRENT.md.** Move the plan out of the active section to a `Done:` line with PR number + merge date (existing convention). Promote a follow-on candidate to active only if the user confirms.

5. **Move the plan files to `plans/archived/`.** `mkdir -p projects/<project>/plans/archived/`, then `git mv` **every file of the plan's `<date>-<slug>` stem** — `-design.md`, `-implementation.md`, `-plan.md`, or the bare `<stem>.md` — into it. A plan with no file (ad-hoc bugfix session) has nothing to move; say so. CURRENT.md stays the state authority; the subfolder is where the panel's plans tab groups archived plans (default-collapsed "Archived" group). Use `git mv` so history follows (plain `mv` only if the file is untracked).

6. **Commit** the specs/CONTEXT/CURRENT.md changes **and the moved plan files** in the workspace repo: `chore(<project>): archive <plan-name>`.

## Living specs layout

```
projects/<project>/specs/
  <area>.md        — current behavior of one feature area:
                     ### Requirement: ... / #### Scenario: WHEN/THEN
```

Area files are **undated kebab-case names** (`checkout-tax.md`, `realtime-refresh.md`) — never `YYYY-MM-DD-*` and never `-design`. Dated `*-design.md` files encountered in `specs/` are legacy change specs misfiled there (they belong in `plans/`): leave them alone, don't fold into them, and mention them in the report as move candidates.

`specs/` is the base future [[pavilio-grill]] designs write their deltas against, and what a staleness check can compare a parked spec to.

## Non-goals

- Does not archive unshipped plans — merge first.
- Moves the plan's files into `plans/archived/` (step 5) but never **deletes** them; `plans/` (incl. `archived/`) is the history, CURRENT.md is the state.
- Does not write or modify code.
- Does not replace [[pavilio-session-end]] — archive is per-plan, session-end is per-session.
