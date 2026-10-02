---
name: pavilio-pr-explain
description: Explain a PR / branch / commit-range as a diagram-rich memo built mechanically from the diff. Use for `/pavilio-pr-explain` or graphical walkthroughs of code changes. Builds on pavilio-memo for storage and panel links, and pavilio-mermaid-chart for diagrams.
---

# PR Explain

Explain a code change with a memo full of mermaid diagrams, built **from** the diff.
Sibling of [[pavilio-memo-explain]] — that one explains a concept; this one explains a
specific PR / branch / commit range. Same output shape (a dated memo), same panel
rendering rules ([[pavilio-mermaid-chart]]). Be extremely concise and sacrifise grammar
fo the sake of concision.

**First read and apply the Shared memo contract in [pavilio-memo](../pavilio-memo/SKILL.md)** for project resolution, destination, filename/header, edits, and panel links. This skill supplies the diff-based body, without repeating the base skill's quick-capture cleanup.

## When to use

- User invokes `/pavilio-pr-explain`, or says "explain this PR / branch / these changes"
- After a review or a merge, to capture what a change did for the team
- Onboarding someone to an unfamiliar change

## When NOT to use

- Explaining a concept/flow that isn't a specific diff → [[pavilio-memo-explain]]
- Quick unstructured thought → [[pavilio-memo]]
- Permanent architecture that should live forever → PROJECT.md or an ADR

## Process

### 1. Resolve project + the change

- `/pavilio-pr-explain [project] [ref]`. `ref` = branch, PR url/number, commit range
  (`main...feat/x`), or omitted (working tree / last commit).
- Resolve the notes project through the base memo contract; the code repository below is a separate input.
- Find the repo: `projects/<project>/repos.json` / `PROJECT.md`, or the cwd repo.

### 2. Gather the diff mechanically (context-mode for big output)

Run through `ctx_batch_execute` / `ctx_execute` (keep raw output out of context):

- `git log --oneline <base>..<ref>` — the commits
- `git diff --stat <base>...<ref>` — footprint (files + line counts) → feeds the **pie**
- `git diff <base>...<ref> -- <key files>` — read the load-bearing hunks
- `git show <ref>:<path>` for whole new files

Base = merge-base with the default branch unless the user says otherwise.

### 3. Build the diagrams — grounded, then inferred

**Grounding rule (critical):** structural diagrams (class, ERD-of-what-changed,
git-graph, pie, file-level flow) MUST be derived from the real diff — real paths,
symbols, commits, line counts. Never invent. Any diagram that shows *intended/future*
design (a proposed ERD, a roadmap gantt, an architecture the PR only partially builds)
MUST be labelled **proposed / illustrative** in prose so it isn't mistaken for shipped
fact. When the diff doesn't contain a fact, leave it out.

Pick the diagrams that each add a *distinct* angle. **Always include flowchart +
sequence** (the process view and the temporal/interaction view — they carry the most
explanatory weight). Add the others where the change actually has that dimension:

| Angle | Diagram | Grounded in |
|-------|---------|-------------|
| What happens step-by-step / branching logic | **flowchart** (required) | control flow in the diff |
| Who calls whom, in what order, over time | **sequence** (required) | the runtime interaction the change adds/alters |
| New/changed modules, types, their relations | class | changed files' exports/signatures |
| Data model / schema touched | ERD | migrations, entities, columns |
| Where the change sits in the system | C4 (`C4Context`/`C4Container`) | components + externals |
| Lifecycle / status / response-code machine | state | branches that map to states |
| Branch + commit history | git-graph | `git log` |
| Delivery/rollout timeline (mark illustrative) | gantt | tickets/roadmap |
| Proportional breakdown (e.g. lines by file) | pie | `git diff --stat` |

Omit a type when the change has no such dimension — better 5 sharp diagrams than 9
padded ones. Note in prose which are grounded vs proposed.

### 4. Apply panel rendering conventions

Follow [[pavilio-mermaid-chart]]:
- Flowchart: subgraphs for current-vs-new (1st cyan, 2nd red, 3rd green); entry/exit
  nodes outside subgraphs; `\n` for line breaks; don't start labels with `/`.
- Sequence: `rect` blocks for sections; `->>` calls / `-->>` responses (color follows
  the sending actor); `Note over A,Z` for section headers; `alt`/`opt`/`loop` for branches.
- Other types (class/ERD/C4/state/git-graph/gantt/pie) are single-palette — don't rely on
  color to group; if a concept needs colored grouping, model it as a flowchart instead.
- Keep C4 to `C4Context`/`C4Container`, small. gitGraph commit `id:` and branch names:
  avoid `/` — use `feat-x` not `feat/x`.

### 5. Write the memo — do NOT commit

Use the base contract's destination and header, with `<Change> — explained` as the title. Append this body:

````markdown
<1-2 lines: what the PR/branch is, its ref, and what it does. Flag which diagrams are
grounded vs proposed/illustrative.>

## <N. Angle title>

```mermaid
<diagram>
```

<One line tying the diagram back to the diff.>

## Summary

- <takeaways: what shipped, what's deferred, any open blocker>
````

### 6. Report

Return the saved memo's panel link through the base contract, plus a one-line index of the diagrams.

## Notes

- Multiple diagrams are the point — but each must clarify a *different* angle.
- This skill lives in the pavilio skill set; changes to it PR upstream to `gmotyl/pavilio`,
  not the consumer repo (see the project's PR-target rule).
