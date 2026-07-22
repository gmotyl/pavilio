---
name: pavilio-memo-explain
description: Create a markdown memo with mermaid diagrams that explains a technical concept, flow, or design decision for a project. Use when the user invokes `/pavilio-memo-explain`, asks to "explain X graphically", "present this as a diagram", or wants a technical walkthrough captured as a memo. Writes to `projects/<project>/memo/YYYY-MM-DD_HHmm_slug.md` and embeds diagrams using standard mermaid conventions.
---

# Memo Explain

Create a markdown memo that explains a topic with embedded mermaid diagrams. Sibling of [[pavilio-memo]] — use this variant when the explanation benefits from a visual: a flowchart, sequence diagram, architecture sketch, or before/after comparison. Be extremely concise and sacrifise grammar fo the sake of concision.

## When to use

- User asks to explain how something works
- Documenting a code change or design decision
- Capturing a flow with multiple actors or branches
- Following up after a `/pavilio-session-start` brainstorm with a visual recap
- Any time text alone would leave the reader hunting for the structure

## When NOT to use

- Quick thought capture with no inherent structure → use [[pavilio-memo]]
- Project-wide architecture overview that should live forever → that's PROJECT.md or an ADR, not a dated memo

## Process

### 1. Identify the project

- Parse project name from the user message (e.g. "explain pavilio sidebar" → `pavilio`)
- If unclear, ask the user or fall back to the project from this session's `/resume-session`
- Read `projects/<project>/_index.json` and `PROJECT.md` for terminology and recent context

### 2. Analyse the topic

- Identify the actors, components, files, or steps involved
- Pick the diagram type:
  - `flowchart TD` — step-by-step processes, branching logic, layout overviews
  - `sequenceDiagram` — multi-actor / multi-service interactions
  - Both — when a flow has both a structural and a temporal dimension
- Use the conventions in [[mermaid-chart]] (subgraph colouring, solid/dashed arrows, rect blocks)

### 3. Extract supporting code (optional)

- If the memo refers to specific files, include short code snippets with file path + line range as the heading
- Keep snippets focused — the diagram is the centrepiece, not the wall of code

### 4. Write the memo

**Location:** `projects/<project>/memo/YYYY-MM-DD_HHmm_<slug>.md`

**Filename rules:**

- Format: `YYYY-MM-DD_HHmm_<slug>.md`
- Slug: max 4 words, snake_case, lowercase
- Example: `2026-05-15_2210_right_sidebar_design.md`

**Content template:**

````markdown
# <Title derived from the topic>

> Captured: YYYY-MM-DD HH:mm

<Paragraph or two framing the topic.>

## <Section per diagram or concept>

```mermaid
<diagram code>
```
````

<Optional commentary connecting the diagram back to the decisions or code.>

## Code references (optional)

**`<relative/path/to/file>:<lineRange>`** — <one-line description>

```ts
<code>
```

## Summary (optional)

<One short paragraph or bullet list of the takeaways.>
```

### 5. Apply diagram conventions

- See [[mermaid-chart]] for the panel-rendering rules (colours, arrow styles, subgraph nesting)
- Default colour rotation: first subgraph cyan, second red, third green
- Solid arrow `->>` for calls, dashed `-->>` for responses
- Use `rect` blocks in sequence diagrams to group related steps
- Keep diagrams under ~25 nodes; split into multiple diagrams rather than overcrowding one

## Notes

- Do NOT commit the file — just write it
- Do NOT touch `PROJECT.md`, `_index.json`, or other index files
- If a referenced project doesn't exist yet, ask before creating the folder
- Multiple diagrams in one memo are fine when each clarifies a different angle (e.g. one structural, one temporal)
