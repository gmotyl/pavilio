---
name: pavilio-create-skill
description: Scaffold a new workspace skill that works as a slash command in both Claude Code and opencode — creates skills/<name>/SKILL.md plus command wrappers in .claude/commands/ and .opencode/commands/, syncs opencode, and commits. Use when the user invokes `/pavilio-create-skill <name>`, asks to "create a new skill", or wants a new slash command available in both agents.
---

# Pavilio Create Skill

Scaffold a new skill the standard workspace way. Skill creation only — this does not design the skill's behavior; if the behavior is non-trivial and undesigned, run brainstorming first.

## Usage

```
/pavilio-create-skill <skill-name> [short description of what it should do]
```

## Inputs to collect (ask only for what's missing)

1. **Name** — kebab-case (e.g. `pavilio-manager`). Prefix `pavilio-` for workspace/meta skills; plain names for domain skills.
2. **Purpose** — one or two sentences: what it does, when to invoke it.
3. **Behavior outline** — the steps/rules the skill should encode. If the user has no outline yet, draft one from the purpose and confirm before writing.

## Steps

1. **Check for collisions:** `ls skills/ .claude/commands/ .opencode/commands/` — if `<name>` exists, stop and ask (update vs rename).

2. **Write `skills/<name>/SKILL.md`** (native Write tool) with this shape:

```markdown
---
name: <name>
description: <what it does + explicit invocation triggers: "Use when the user invokes `/<name>`, asks to …">
---

# <Title>

<One-line role statement: what this skill is and is not.>

## Usage

​```
/<name> [args]
​```

## Behavior / Steps

<numbered steps or rules — concrete, imperative, token-frugal>

## Non-goals

<what the skill must NOT do — always include this section>
```

Conventions: description frontmatter must name the slash command and trigger phrases; keep the body terse and imperative; state fixed read budgets when the skill gathers data; always end with Non-goals.

3. **Generate the command wrappers** — do NOT hand-write them. The per-agent setup scripts derive one wrapper per `skills/*/SKILL.md` automatically:

- Claude Code: `bash scripts/setup:claude-code` → `.claude/commands/<name>.md`
- opencode: `bash scripts/setup:opencode` → `.opencode/commands/<name>.md` + registers it in `opencode.json`'s `command` block

4. **Commit:** `git add skills/<name>`, commit as `feat: <name> skill`. Only the SKILL.md is committed — `.claude/` and `.opencode/` (and `opencode.json`) are generated per-user and gitignored.

5. **Report:** file path + note that `/<name>` becomes available after running the setup script for each agent in use (or on the next `pnpm pull`, which re-runs them), and that upstreaming to gmotyl/pavilio via PR is optional.

## Non-goals

- Does not design complex skill behavior (use brainstorming/grill-with-docs first).
- Does not edit `AGENTS.md`, `commands/` (repo-level), or upstream pavilio repo.
- Does not overwrite an existing skill without explicit confirmation.
