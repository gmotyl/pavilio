---
name: pavilio-ui-design
description: Design a panel UI surface with a real point of view — a token plan reviewed against the brief, copy written as interface copy — then hand the HTML to [[pavilio-mockup]] to write. Use when the user invokes `/pavilio-ui-design`, asks to "design this screen", "make this look intentional", "give me a visual direction", or wants a surface designed rather than just drawn.
---

# Pavilio UI Design

Owns the **design judgment**: what the surface is for, what it should look like, and what it should say. It never writes the HTML — [[pavilio-mockup]] does, and this skill invokes it. The split is deliberate: judgment here, mechanics there, so the conventions never drift.

Carries the substance of the official `frontend-design` skill. That plugin does **not** need to be installed; nothing here reads it.

**Announce at start:** "Using pavilio-ui-design to settle the direction before drawing it."

## Usage

```
/pavilio-ui-design [<project>] <surface or decision to design>
```

## 0. Resolve the brief — do not interview

Read the request, then `projects/<project>/PROJECT.md` and `projects/<project>/CONTEXT.md`. Take the surface, its users, the vocabulary, and the job it does from there. Look at the real screen in the panel repo when it exists — the code answers more than the user will.

**State your assumptions in one short block and design.** Do not run an interview.

**Ask at most ONE question, and only when the target surface genuinely cannot be identified** — not to confirm taste, scope, palette, or anything you can decide yourself. Ask it, then STOP and end the turn.

<STANCE>
The low interrogation level is a decision, not an oversight. Interviewing is [[pavilio-grill]]'s job; a mockup's whole value is that it is faster than a conversation — a picture that is wrong is cheaper to correct than a questionnaire is to answer. Do not "helpfully" add a discovery interview to this skill.
</STANCE>

## 1. Pass one — the token plan (before any markup)

Write a compact plan, in the chat, ~15 lines:

- **Color** — 4–6 named hex values: ground, ink, one accent, and the states the surface actually needs. Name them for their role (`ground`, `ink`, `rail`, `live`), not for the hue.
- **Type** — the typefaces and their roles. One family, or two that are clearly distinct. Mockups are restricted to system stacks (see [[pavilio-mockup]]), so the personality has to come from **scale, weight, width and spacing**, not from a font download. Set a real type scale; give body text a line length under ~80 characters.
- **Layout** — a one-sentence concept plus a small ASCII wireframe. Say the alignment. Say what the eye hits first.
- **Principles** — 2–4 lines on what makes *this* surface this surface. Structural devices (rules, borders, numbering, dividers, labels) must encode information; if a device is decoration, cut it.

## 2. Pass two — review the plan against the brief

Before writing anything, check the plan against these tells of generated design:

1. Warm cream ground (near `#F4F1EA`) with a high-contrast serif display and a terracotta / warm-clay accent (near `#D97757`).
2. The card kit: content chopped into identical rounded cards, one border-radius on everything regardless of hierarchy, the same soft grey shadow under each, gradient washes as decoration.
3. Tracked-out ALL-CAPS eyebrow labels above headings; typographic labels above content that needs none.
4. `→` appended to link and button text; meta strings joined with middle dots; `WORD — fragment` headings with a spaced em dash; tinted near-black (`#0B0B0B`, `#111`) standing in for black; a monospace face used only to make small labels look technical.
5. Accenting a single word in a headline in italic / bold / another color.
6. Numbered markers (01 / 02 / 03) on content that is not a sequence.
7. Motion scattered across the page — fade-and-slide-up on every section, a hover transition on every card.

Each is legitimate for *some* brief. The failure is reaching for one because it is the default. Where the user's request pins an axis down, follow it exactly — their words win, including when they ask for one of these looks. Where the request leaves an axis free, spend that freedom on a choice.

**Say what you changed and why** — one line per revision, in the chat, before you delegate. A review that revises nothing has to say so explicitly and stand behind the plan.

Then spend boldness in one place: one memorable element, everything around it quiet. Before handing off, remove one accessory.

## 3. Copy is designed, not filled in

Placeholder words make a design read as templated as fast as a stock palette does. Write real interface copy:

- **Active voice, sentence case.** A button says what happens — "Save changes", not "Submit".
- **Name things as a user would**, not as the system is built. "Notifications", not "webhook config". Use the project's own vocabulary from `CONTEXT.md`.
- **One name per action through the whole flow** — a "Publish" button produces a "Published" toast.
- **Empty and error states give direction.** What went wrong and what to do about it; an empty screen invites an action. No apologies, no mood, no vagueness.
- Each written element does exactly one job. Plain verbs, no filler.

## 4. Delegate the writing (MANDATORY)

Not a handoff to the user — this skill performs the step itself, in the same turn.

1. **Invoke [[pavilio-mockup]]** (`Skill` tool, `skill: pavilio-mockup`) with the project, the decision, and the settled plan: palette with hex values, type scale, layout, the copy, and — when comparing — what each option is trading off. Announce it: "Direction settled — handing the file to pavilio-mockup."
2. That skill owns destination, filename, self-containment and the comparison shape. **Do not restate its rules and do not write the HTML yourself** — including "just a quick draft".
3. Mirror of [[pavilio-grill]] §6: stopping after §3 with a plan and no file is a failure of this skill.

Where you are presenting options, give each option a *different* plan — different structural idea, not the same layout in three palettes — and say which one you recommend and why, in terms of the decision.

## 5. Report

The file path, plus: viewable in the project's **Mockups tab** in the panel; the tab picks it up without a restart. Add the one-line design rationale and anything you deliberately left as an open question.

## Non-goals

- **Writes no HTML, ever.** The file is [[pavilio-mockup]]'s output.
- Does not interview. One question, only when the target surface is unidentifiable.
- Does not restate [[pavilio-mockup]]'s mechanics — destination, filename, self-containment, option lettering all live there.
- Does not require the `frontend-design` plugin, or read it.
- Does not edit application code, `PROJECT.md`, `STATUS.md`, `CONTEXT.md`, or specs — a mockup is a proposal, not a decision record.
- Does not commit.
