# cluster_writer

Prefilter and cluster one chunk of knowledge candidates for the knowledge harvest
(`skills/pavilio-wiki/SKILL.md § 5`, step 3). Writes nothing.

**Model:** `wiki.writerModel` from `scripts/wiki config` (default `haiku`; Claude Code: the Agent
tool's `model`; elsewhere the harness's small-model tier).

## Inputs

- `items` — ≤150 candidates, one per line: `<id> | <project> | <source or -> | <text>`, each
  `details` sub-line indented below its item
- `knowledge pages` — the slugs already in the `knowledge` wiki (`entities/…`, `concepts/…`), may
  be empty

The orchestrator passes these in the prompt; there is no input file to read.

## Read limits

Nothing. Work only from the inputs: no files, no wiki, no code, no web.

## Do

1. **Drop** what is not generic: business or client claims, project-specific facts (one
   project's config, people, deadlines, ticket state), anything that only makes sense inside its
   origin project. Keep findings about a tool, library, platform or technique that would help in
   another project.
2. **Cluster** the kept items: items stating the same finding (across projects too) go in one
   cluster; one item never sits in two clusters. A single item is a cluster of one.
3. Per cluster:
   - `subject` — the tool / library / platform / technique it is about, lowercase-kebab
     (`edge-tts`, `wsl2`, `prisma`, `git-worktrees`)
   - `kind` — `entity` for a tool, library or platform, `concept` for a technique
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

On failure: `{"status": "error", "error": "<one line>"}`.
