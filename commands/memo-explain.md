---
name: memo-explain
description: Create markdown memo files with diagrams. Use when user asks to explain something, document a flow, or capture technical understanding. Follows the memo command pattern from commands/memo.md with enhanced diagram support using mermaid.
---

# memo-explain

Create markdown memo files in `projects/<project>/memo/` with embedded diagrams. Use when explaining technical concepts, flows, or code changes.

## When to Use

- User asks to explain how something works
- Documenting a code change or diff
- Capturing a technical flow with diagrams
- Creating memos that need visual diagrams (flowcharts, sequence diagrams)
- Following up after a session resume with detailed technical explanation

## Prerequisites

### Install mermaid-diagrams skill (if not available)

If the user references mermaid diagrams or you need to create diagrams, check if the skill is available:

```bash
ls .agents/skills/mermaid-diagrams/
```

If not found, prompt user to install:

> The mermaid-diagrams skill is needed for creating diagrams. Would you like me to install it?
> 
> ```bash
> # Clone or create the skill in .agents/skills/mermaid-diagrams/
> ```

## Process

### 1. Identify Project

- Parse project name from user input (e.g., "explain metro custom flyout" → project = "metro")
- If no project specified, check recent session context or ask user
- Read `projects/<project>/_index.json` for context

### 2. Analyze Topic

- Understand what needs to be explained
- Identify key components, files, and their relationships
- Determine appropriate diagram types:
  - **Flowchart** (`flowchart TD`): Step-by-step processes, branching logic
  - **Sequence diagram** (`sequenceDiagram`): Multi-service interactions
  - **Both**: Complex flows with steps and interactions

### 3. Extract Code Snippets

- Find relevant source files
- Extract key code sections (function definitions, conditional logic, API calls)
- Note the filename and line numbers
- Use code blocks with language tags

### 4. Create Memo File

**Location**: `projects/<project>/memo/YYYY-MM-DD_HHmm_slug.md`

**Filename rules**:
- Format: `YYYY-MM-DD_HHmm_<4-word-snake-case-slug>.md`
- Slug: max 4 words, snake_case, lowercase
- Example: `2026-05-13_1143_custom_flyout_flow.md`

**Content template**:

```markdown
# [Title derived from content]

> Captured: YYYY-MM-DD HH:mm

[Main explanation content here - paragraphs, code snippets, diagrams]

## Diagrams

### [Diagram Title]

```mermaid
[Diagram code - flowchart or sequenceDiagram]
```

### Code Snippets

**1. <FileName>** — <What the code does>
```tsx
// Lines X-Y
<code here>
```

## Summary
[Optional brief summary]
```

### 5. Apply mermaid-diagrams conventions

- Use subgraphs for before/after or current/fixed patterns
- Use `rect` blocks in sequence diagrams for sections
- Color conventions: 1st subgraph = cyan, 2nd = red, 3rd = green
- Solid arrows (`->>`) for calls, dotted (`-->>`) for responses

## Example

### Input
"explain metro useCustomFlyout.tsx change and how assisted sales login works"

### Output Flow

1. **Project**: metro (from "metro" in input)
2. **Topic**: useCustomFlyout.tsx conditional fetch + assisted sales login flow
3. **Files to examine**:
   - `modules/account/components/custom-login-box-and-flyout/services/useCustomFlyout.tsx`
   - `core/components/Layout/Header/EmployeeBox/index.tsx`
   - Various custom-flyout components

4. **Memo created**:
   - Filename: `projects/metro/memo/2026-05-13_1143_custom_flyout_assisted_sales.md`
   - Contains: explanation + flowchart + sequence diagram + 8 code snippets

## Common Slug Patterns

| Topic | Slug |
|-------|------|
| Code change explanation | `code_change_explanation` |
| Login flow | `login_flow_diagram` |
| API explanation | `api_explanation` |
| Bug analysis | `bug_analysis` |
| Architecture overview | `architecture_overview` |

## Notes

- Do NOT commit - just write the file
- Do NOT create PROJECT.md, _index.json, or other files
- If unsure about project, ask user before proceeding
- Use existing project context from `_index.json` when available