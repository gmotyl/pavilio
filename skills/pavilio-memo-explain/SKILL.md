---
name: pavilio-memo-explain
description: Create a project memo with Mermaid diagrams explaining a technical concept, flow, or design decision. Use for `/pavilio-memo-explain`, graphical explanations, or technical walkthroughs. Builds on pavilio-memo for storage and panel links.
---

# Memo Explain

Create a markdown memo that explains a topic with embedded mermaid diagrams. **First read and apply the Shared memo contract in [pavilio-memo](../pavilio-memo/SKILL.md)** for project resolution, storage, filename/header, edits, and the returned panel link. This skill adds the explanatory body and diagrams. Pick whichever mermaid type best fits the concept or question: flowchart, sequence, state machine, ERD, class, C4 architecture, git graph, gantt, or pie — not just a flowchart by default. Be extremely concise.

## When to use

- User asks to explain how something works
- Documenting a code change or design decision
- Capturing a flow with multiple actors or branches
- Following up after a `/pavilio-session-start` brainstorm with a visual recap
- Any time text alone would leave the reader hunting for the structure

## When NOT to use

- Quick thought capture with no inherent structure → use [[pavilio-memo]]
- Explaining a specific PR / branch / commit-range (built from a diff) → use [[pavilio-pr-explain]]
- Project-wide architecture overview that should live forever → that's PROJECT.md or an ADR, not a dated memo

## Process

### 1. Identify the project

- Resolve the project and memo through the base contract.
- Read the resolved project's `PROJECT.md` and relevant context for the explanation.

### 2. Analyse the topic → pick diagrams by angle

Don't default to a flowchart. Enumerate the *dimensions* the topic actually has, then map each to the diagram type that expresses it best. A good explanatory memo usually needs 2–4 complementary charts — each a different lens — not one chart repeated.

Walk this checklist and include a diagram for every angle the topic genuinely has (skip the ones it doesn't):

| Angle the topic has | Diagram | 
|---------------------|---------|
| Step-by-step process, branching logic, layout overview | `flowchart TD` |
| Actors/services interacting, request/response ordering over time | `sequenceDiagram` |
| An object/request/feature that moves through states | `stateDiagram-v2` |
| Data model — entities, fields, relationships | `erDiagram` |
| Types/classes/modules and their associations | `classDiagram` |
| Where pieces sit in the system, who talks to what | `C4Context` / `C4Container` |
| Branching / release / merge history | `gitGraph` |
| Timeline or phased rollout | `gantt` |
| Proportional breakdown of a whole | `pie` |

- Choose the **smallest set that covers the distinct angles** — e.g. an ERD for the schema + a sequence for the request flow + a state diagram for the lifecycle beats three flowcharts.
- Only skip a type because the topic lacks that dimension, never because it's unfamiliar.
- See the full "When to use which diagram" table + per-type syntax examples in [[pavilio-mermaid-chart]], and follow its colour/arrow/grouping conventions.

### 3. Extract supporting code (optional)

- If the memo refers to specific files, include short code snippets with file path + line range as the heading
- Keep snippets focused — the diagram is the centrepiece, not the wall of code

### 4. Write the memo

Use the base contract's destination and header. Append this explanatory body:

````markdown
<Paragraph or two framing the topic.>

## <Section per diagram or concept>

```mermaid
<diagram code>
```
<Optional commentary connecting the diagram back to the decisions or code.>

## Code references (optional)

**`<relative/path/to/file>:<lineRange>`** — <one-line description>

```ts
<code>
```

## Summary (optional)

<One short paragraph or bullet list of the takeaways.>
````

### 5. Apply diagram conventions

- See [[pavilio-mermaid-chart]] for the panel-rendering rules (colours, arrow styles, subgraph nesting) and per-type syntax examples
- Colour rotation applies **only** to flowcharts (subgraph clusters: 1st cyan, 2nd red, 3rd green) and sequence diagrams (sections + per-actor arrows). All other types render single-palette dark — if the point needs colored grouping, use a flowchart
- In sequences, solid `->>` = call, dashed `-->>` = response; arrow colour follows the sending actor automatically
- Use `rect` blocks in sequence diagrams to group related steps
- Keep diagrams under ~25 nodes; split into multiple diagrams rather than overcrowding one

## Notes

- Return the saved memo's panel link using the base contract, with a one-line description of the explanation.
- Multiple diagrams in one memo are fine when each clarifies a different angle (e.g. one structural, one temporal)
