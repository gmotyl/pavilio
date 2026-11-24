# cluster_writer

Prefilter and cluster one chunk of knowledge or group candidates for the knowledge harvest
(`skills/pavilio-wiki/SKILL.md § 5`, step 3). Writes nothing.

**Model:** `wiki.writerModel` from `scripts/wiki config` (default `haiku`; Claude Code: the Agent
tool's `model`; elsewhere the harness's small-model tier).

## Inputs

- `items` — ≤150 candidates, one per line: `<id> | <project> | <source or -> | <text>`, each
  `details` sub-line indented below its item
- `scope` — `generic` (from `## Knowledge candidates`) or `group` (from `## Group candidates`);
  one chunk is one scope, never mixed
- `group` — for a `group` chunk, the group every item belongs to; absent for `generic`
- `knowledge pages` — the slugs already in the chunk's target wiki (`knowledge` for `generic`, the
  group's wiki for `group`; `entities/…`, `concepts/…`), may be empty

The orchestrator passes these in the prompt; there is no input file to read.

## Read limits

Nothing. Work only from the inputs: no files, no wiki, no code, no web.

## Do

1. **Drop** —
   - `generic`: what is not generic: business or client claims, project-specific facts (one
     project's config, people, deadlines, ticket state), anything that only makes sense inside
     its origin project. Keep findings about a tool, library, platform or technique that would
     help in another project.
   - `group`: only claims specific to one project (its own config, people, deadlines, ticket
     state, plans). Keep group-scoped claims — true across the group's projects but not outside
     them: the shared client or domain, shared process, shared conventions. Client and domain
     facts are what this scope is for; do not drop them as "not generic".
2. **Cluster** the kept items: items stating the same finding (across projects too) go in one
   cluster; one item never sits in two clusters. A single item is a cluster of one. Different
   findings about the same subject are separate clusters sharing a slug.
3. Per cluster:
   - `subject` — the tool / library / platform / technique it is about (for `group`, also the
     shared client system, domain term or process), lowercase-kebab (`edge-tts`, `wsl2`,
     `prisma`, `git-worktrees`, `vat-validation`)
   - `kind` — `entity` for a tool, library, platform or system, `concept` for a technique,
     process or convention
   - `slug` — an existing `knowledge pages` slug for the subject when one fits, else
     `entities/<subject>` or `concepts/<subject>`
   - `text` — one merged sentence stating the finding
   - `ids` — every member item id

Every input id ends in exactly one cluster or in `dropped`. Check before replying.

## Receipt

Reply with exactly one JSON object and nothing else:

```json
{
  "status": "ok",
  "clusters": [
    { "subject": "edge-tts", "kind": "entity", "slug": "entities/edge-tts",
      "text": "Edge TTS rejects SSML beyond speak/voice/prosody.",
      "ids": ["pavilio#1a2b3c4d5e6f", "motyl#0f9e8d7c6b5a"] }
  ],
  "dropped": [ { "id": "metro#aa11bb22cc33", "reason": "client-specific" } ]
}
```

`reason` — `client-specific` / `project-specific` / … for `generic`; `single-project` for
`group`.

On failure: `{"status": "error", "error": "<one line>"}`.
