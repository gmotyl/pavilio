---
name: pavilio-memo
description: Create or edit a project memo and return its Pavilio panel link. Use for `/pavilio-memo`, quick thought capture, or as the shared storage and linking base for specialized memo skills.
---

# Quick Memo

Capture a thought or note with light adjustments to make it clear and understandable.

## Shared memo contract

This skill owns project resolution, memo storage, naming, edit preservation, and panel links. Read and apply this section when using `pavilio-memo-*` or [[pavilio-pr-explain]]. Those skills supply their own content workflow; do not run the quick-capture cleanup again or flatten diagrams, research, or interview results into a short note. Keep these shared rules here rather than copying them into each derivative.

### Resolve the destination

- Resolve the **notes workspace root**, not the linked code repository being discussed. Use the known workspace from the session; `git rev-parse --show-toplevel` is appropriate only when running inside that workspace.
- Project: explicit argument or supplied memo path first, then the remembered memo/session project, then an unambiguous project folder containing the cwd. Consult `.projects.local.md` when present; its Notes Path is authoritative. Otherwise verify the existing `<workspace>/projects/<project>/` directory. Ask one question and wait only when the project cannot be resolved or its folder is missing.
- New memos go in the resolved project's `memo/` directory; create that directory if needed. Keep both `projects` levels when the workspace itself is named `projects`.
- Name new files `YYYY-MM-DD_HHmm_<slug>.md`, using the session's local date/time and at most four lowercase snake_case words. Do not overwrite an existing file on a name collision; choose a distinct descriptive slug.
- Use the common header below, followed by the calling skill's content. Read the project's `_index.json` if present for relevant terminology; do not create or update it as a side effect of writing a memo.

```markdown
# <Title>

> Captured: YYYY-MM-DD HH:mm

<Content supplied by this skill or its derivative>
```

- Edits use the supplied existing memo, or the most recently created memo in the session. Preserve its path, original capture timestamp, and unrelated content. Do not rename legacy filenames to the new-memo convention.
- Remember the resolved project and memo file for follow-up edits. Memo creation itself does not commit files or update project/index documents; separate user instructions or session bookkeeping still apply.

### Link to the memo in Pavilio

After writing or editing, return a Markdown link to the saved memo in the panel, plus a short description. Build it from the **actual saved path**:

1. Make the memo path relative to `<workspace>/projects/`, using `/` separators. A normal memo yields `<project>/memo/<filename>.md` — no leading slash, no filesystem prefix, and no `projects/` prefix.
2. Encode that entire relative path once as a query value (`encodeURIComponent` semantics); encode the project identifier separately as a route segment.
3. Use the origin-relative URL `/project/<encoded-project>/memo?file=<encoded-relative-path>`. Starting with `/` keeps it independent of the current panel tab. Do not hardcode a host or port.

Example for `projects/my-app/memo/2026-01-09_1423_release_notes.md`:

```markdown
[Release notes](/project/my-app/memo?file=my-app%2Fmemo%2F2026-01-09_1423_release_notes.md) (Pavilio panel) — saved memo.
```

Check that the decoded `file` value points to the memo just saved, including any nested directories. Use an absolute URL only when needed outside the panel, with an origin supplied by the user or verified from configuration; do not assume `localhost:3010`. A filesystem path may be supplementary, but is not the panel link. Relative Markdown references inside a memo may remain relative to that memo; this rule governs the link used to open the memo in Pavilio.

## Input Modes

### New Memo
`memo [--yolo] <project> <text>` - Create memo for specified project

### Continue with Same Project
`memo [--yolo] <text>` - If no project specified, use the same project as the previous memo in this session

### Edit Previous Memo
`edit memo [--yolo] <instructions>` - Update the most recently created memo according to the instructions

### Parameters
- `--yolo` - Auto-accept all prompts and confirmations (skip user confirmations)

## Process

### For New/Continue Memo:

1. **Check for `--yolo` flag** in input - if present, enable auto-accept mode (skip confirmations)
2. Resolve the project and destination using **Shared memo contract** above
3. **Read project context** from `projects/projectname/_index.json` if it exists
   - Use this to understand terminology, people, technologies mentioned
   - Add relevant context references (e.g., link to related decisions or people)
4. **Enhance the text** with light adjustments:
   - Fix typos and grammar
   - Add proper punctuation and formatting
   - Make it more understandable by adding context from `_index.json`
   - If something is unclear and context is not in `_index.json`, ask a brief follow-up question (unless `--yolo` mode: then make reasonable assumptions)
   - Do NOT invent context - only use what's in `_index.json` or confirmed by user
5. Save the content with the naming and header from **Shared memo contract**
6. Return the panel link, including in `--yolo` mode (it skips questions, not the result)

### For Edit Memo:

1. Resolve and read the existing memo using **Shared memo contract**
2. Apply the user's edit instructions to the content
3. Preserve the original timestamp in the `> Captured:` line
4. Save the updated content to the same file
5. Return the same memo's panel link and briefly state the edit

## Rules

- Read `_index.json` if present for context
- Ask follow-up questions ONLY if something is genuinely unclear and not in `_index.json`
- Do NOT invent context or details
- Do NOT add unnecessary structure or sections
- Do NOT create PROJECT.md, _index.json, or other files
- Do NOT commit - just write the file
- Create the `memo/` folder if it doesn't exist
- **Remember the last project and last memo file** for subsequent commands in the session

## Examples

**Input:** `my-work quick thought about using redis for session caching instead of postgres`

*Agent reads projects/my-work/_index.json, sees Redis was discussed in context of performance issues*

**Output file:** `projects/my-work/memo/2026-01-09_1423_redis_session_caching.md`

```markdown
# Redis for Session Caching

> Captured: 2026-01-09 14:23

Consider using Redis for session caching instead of Postgres. This relates to the ongoing performance optimization efforts.
```

---

**Input:** `my-blog need to check if the footer layout breaks on Safari 17`

*Agent reads projects/my-blog/_index.json, finds the footer component was recently touched*

**Output file:** `projects/my-blog/memo/2026-01-09_0930_safari_17_footer.md`

```markdown
# Safari 17 footer layout

> Captured: 2026-01-09 09:30

Need to verify the footer layout doesn't break on Safari 17 — the recent flex changes may have regressed narrower viewports.
```

---

**Input:** `my-work talked to X about the thing`

*Agent reads projects/my-work/_index.json, cannot identify "X" or "the thing"*

**Agent asks:** "Who is X and what thing are you referring to?"

---

### Continue with Same Project

**Previous memo:** Created `projects/my-work/memo/2026-01-09_1423_redis_session_caching.md`

**Input:** `memo also consider memcached as alternative`

*Agent reuses project "my-work" from previous memo*

**Output file:** `projects/my-work/memo/2026-01-09_1425_memcached_alternative.md`

---

### Edit Previous Memo

**Previous memo:** `projects/my-work/memo/2026-01-09_1423_redis_session_caching.md`

**Input:** `edit memo add that we should benchmark both options first`

*Agent reads the previous memo, adds the benchmark note, saves to same file*

**Confirmation:** [Updated memo](/project/my-work/memo?file=my-work%2Fmemo%2F2026-01-09_1423_redis_session_caching.md) (Pavilio panel) — added benchmark note.
