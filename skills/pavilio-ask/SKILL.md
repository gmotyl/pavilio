---
name: pavilio-ask
description: Shared reference for how every Pavilio skill asks the user a question — one question per turn, then stop; discrete choices as a lettered markdown list (A–C, recommended first, D) Other last); pick-several lists as one markdown item per row; and a self-contained final message, so the panel's answer pane renders the question instead of gluing the options into one paragraph. Referenced by [[pavilio-grill]], [[pavilio-note]], [[pavilio-note-batch]], [[pavilio-memo-grill]], [[pavilio-wiki-research]], [[pavilio-new-project]] and [[pavilio-session-start]].
---

# pavilio-ask

The single source of truth for **how** a Pavilio skill puts a question to the user. Skills say *what* to ask and *when*; this file says how the question is written.

This skill is a reference — it is not invoked on its own. A skill that asks the user anything links here and follows the rules below.

## Why

The panel's answer pane renders the turn's **last message** as markdown, and markdown joins consecutive bare lines into one paragraph. Options written as `a. …` / `1. …` lines without a blank line before them, or as plain lines with no list marker, arrive as one run-on sentence. A list item per option, after a blank line, is the only shape that survives.

## Rules

1. **One question per turn.** Ask it, then STOP and end the turn. Never stack a second question, never answer it yourself, never continue other work underneath it.
2. **Free-text questions** (a name, a path, a description) carry no options and no letters — just the question.
3. **Choose-one questions are lettered, uppercase.** A blank line after the question, then one markdown list item per option:

   ```markdown
   Which project should this change land in?

   - **A)** my-app — the meeting is about its checkout rewrite *(recommended)*
   - **B)** my-site — the blog migration thread
   - **D)** Other, tell me how
   ```

   - Your recommendation is **A)** and carries *(recommended)*. Up to three real options (A–C); with two, drop C and keep the letters `A)`, `B)`, `D)`.
   - **D) Other, tell me how** is always last.
   - A skill may fix the option order when later text refers to the letters — then mark whichever option you recommend with *(recommended)* instead of moving it to A.
   - A bare letter reply ("B", "b") *is* that option — act on it, do not ask for confirmation.
4. **Pick-several questions** (meetings to process, tasks to add to Todoist) are a list of candidates, not lettered choices. Use the same shape: a blank line, then one markdown list item per candidate, numbered as list items so the user can reply with several (`1, 3`):

   ```markdown
   Which tasks should go to Todoist for today?

   1. **[my-app] Request staging access** — for both developers, plus meeting invites
   2. **[my-app] Review open support tickets** — this week
   3. **[my-app] Check the hours budget** — before the migration starts
   ```

   Put the reply grammar on its own line after the list when it is more than "numbers" (e.g. `N:project` overrides).
5. **Language follows the user.** When the user writes Polish, ask in Polish; artifacts, code and commit messages stay English.
6. **The final message is self-contained.** Only the turn's last message reaches the answer pane. Restate the whole question — context line, every option, your recommendation — in that message; never close on a bare "waiting for your answer" line or a question asked earlier in the turn.

## Non-goals

- Does not decide *whether* a skill should ask — that stays with the calling skill.
- Does not cover the `AskUserQuestion` tool; when a harness offers it, its own UI renders the options.
