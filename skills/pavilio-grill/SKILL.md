---
name: pavilio-grill
description: Stress-test an idea or plan into a sharp, domain-aligned design. Auto-detects whether you have a raw idea (design it first) or an existing plan/draft (grill it), then interviews relentlessly one question at a time, challenges terminology against the project glossary, cross-references code, and captures the result as a spec doc plus inline CONTEXT.md / ADR updates. Use when the user invokes `/pavilio-grill` or wants to harden a plan before writing an implementation plan.
---

# pavilio-grill

Design-and-harden in one pass. Grill-forward: relentless one-at-a-time interview with a recommended answer per question, project-scoped domain docs, spec doc as the durable artifact.

**Announce at start:** "Using pavilio-grill to sharpen this into a design."

<HARD-GATE>
Do NOT write implementation code, scaffold, or invoke any implementation skill until a design is presented AND the user approves it. Grilling ends by handing off to `pavilio-writing-plans`, never by coding.
</HARD-GATE>

## 0. Resolve the project and OpenSpec backend

Determine `<project>` from the conversation / cwd / an un-archived change under a configured OpenSpec source. If ambiguous, ask which project — one question, then stop.

Then **resolve the OpenSpec backend for the target scope before writing anything** — follow [[pavilio-openspec-storage]] (ask-once/persist/reuse; project-wide changes use the project store with no question). All change artifacts land in the resolved backend's `openspec/` tree:

- Proposal: `openspec/changes/<change-id>/proposal.md`
- Technical design (**keeps mermaid diagrams**): `openspec/changes/<change-id>/design.md`
- Requirement deltas: `openspec/changes/<change-id>/specs/<capability>/spec.md`
- Living specs (current behavior per capability, the base grill writes deltas against): `openspec/specs/<capability>/spec.md` — maintained only by [[pavilio-archive-plan]], never written by grill

Other project-scoped docs live under the workspace repo root:

- Glossary: `projects/<project>/CONTEXT.md` (or `CONTEXT-MAP.md` if multi-context)
- ADRs: `projects/<project>/adr/NNNN-slug.md`

## 1. Auto-detect entry mode

Explore context first: read recent commits, the un-archived change dirs under the backend's `openspec/changes/`, any spec/draft the user points at, `CONTEXT.md`, the `adr/` listing (don't pre-read every ADR — open one only when the topic touches it), and the `openspec/specs/` listing — the capability filenames are the project's area index; open only the living spec(s) (`openspec/specs/<capability>/spec.md`) whose capability the topic touches, never all of them. If no capability maps to the topic, ask which one (one question) before reading any. Living specs describe shipped behavior and are the base the new design's deltas are written against.

- **Plan/spec/draft exists** → **grill mode**: stress-test what's there.
- **Only a raw idea** → **design mode**: build the design first, applying grill tactics throughout.

State which mode you're in, then proceed. The two modes share the same interview loop below; design mode adds the "propose 2-3 approaches" step at genuine forks.

## 2. The interview loop (grill-forward)

Interview relentlessly until you reach shared understanding. Walk each branch of the design tree, resolving dependencies one by one.

- **One question per message.** Ask, then STOP and wait for the answer. Never stack questions.
- **Always give your recommended answer** with brief reasoning.
- **If the codebase can answer it, go read the code** instead of asking.
- **Sharpen fuzzy language.** Vague/overloaded term → propose a precise canonical term. ("You said 'account' — Customer or User? Those differ.")
- **Challenge against the glossary.** A term that conflicts with `CONTEXT.md` → call it out immediately.
- **Probe with concrete scenarios.** Invent edge-case scenarios that force precise boundaries.
- **Cross-reference with code.** If a stated behavior contradicts the code, surface the contradiction.
- **Propose 2-3 approaches** (design mode, or grill mode when a real fork appears) with trade-offs; lead with your recommendation.

## 3. Update domain docs inline

Capture decisions as they crystallise — don't batch.

- **CONTEXT.md** — when a term is resolved, write it right there using the format in
  [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md). Create the file lazily on the first resolved term. Keep it domain-level; don't couple to implementation details. Multi-context repos use `CONTEXT-MAP.md`.
- **ADRs** — offer sparingly, only when ALL THREE hold: hard to reverse, surprising without context, result of a real trade-off. Format + guidance in [ADR-FORMAT.md](ADR-FORMAT.md). Location override: `projects/<project>/adr/` (NOT `docs/adr/`); scan it for the highest number and increment.

## 4. Present the design

Once you understand what's being built, present it in sections scaled to complexity (a few sentences if simple, up to ~300 words if nuanced). Cover architecture, components, data flow, error handling, testing. Ask after each section whether it looks right. Go back and clarify when something doesn't fit. YAGNI ruthlessly. Design docs **keep mermaid diagrams** where they aid understanding.

## 5. Write + review the change artifacts

Backend already resolved in §0 (per [[pavilio-openspec-storage]]). Write into the resolved `openspec/changes/<change-id>/` tree and commit:

- `proposal.md` — the why/what of the change.
- `design.md` — the technical design, **with mermaid diagrams** where they clarify architecture, data flow, or state.
- `specs/<capability>/spec.md` — the requirement **deltas** (below). One file per capability the change touches.

A coordinated multi-repository change reuses **one shared `<change-id>`** across each repository's independently-resolved backend (see [[pavilio-openspec-storage]]). The panel's Plans tab groups these change dirs.

- **Delta specs use delta format** (OpenSpec-style) — state what this change does to system behavior, each requirement with concrete WHEN/THEN scenarios:

  ````markdown
  ## ADDED Requirements
  ### Requirement: <name>
  <one-line statement>
  #### Scenario: <case>
  - **WHEN** <trigger/input>
  - **THEN** <observable result>

  ## MODIFIED Requirements
  ### Requirement: <existing behavior being changed>
  <was → is>
  #### Scenario: ...

  ## REMOVED Requirements
  ### Requirement: <behavior that stops existing> — <why>
  #### Scenario: <case>
  - **WHEN** <trigger>
  - **THEN** <behavior no longer occurs>
  ````

  Scenarios are the acceptance criteria [[pavilio-writing-plans]] will carry into `tasks.md` and the reviewer will verify diffs against. If the backend has living specs under `openspec/specs/<capability>/spec.md`, write deltas relative to them; [[pavilio-archive-plan]] folds them back in after the change ships.

  **Recognizing living specs:** the current-behavior files are `openspec/specs/<capability>/spec.md`, each containing `### Requirement:` sections. Delta specs (`changes/<id>/specs/<capability>/spec.md`) are the *change*, not living truth — never fold a delta into itself.
- **Self-review** with fresh eyes: placeholder scan (no TBD/TODO), internal consistency, scope (single change or needs decomposition?), ambiguity (pick one interpretation, make it explicit). Fix inline.
- **User review gate:** "Change artifacts written and committed to `openspec/changes/<change-id>/`. Review them and tell me if you want changes before we write the implementation contract." Wait. On changes, edit + re-review. Only proceed on approval.

## 6. Transition

The only next skill is **pavilio-writing-plans**. Invoke it to turn the approved design into the change's `tasks.md` implementation contract.

## Key principles

- One question at a time — with a recommended answer.
- Read code before asking what code can tell you.
- Multiple choice / 2-3 approaches at real forks; don't manufacture them.
- Domain docs are project-scoped and written inline, not at the end.
- YAGNI. Incremental validation. Terminal state = pavilio-writing-plans.
