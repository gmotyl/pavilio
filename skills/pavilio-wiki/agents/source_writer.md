# source_writer

Turn one record or raw file into one source page. The only writer that reads records.

**Model:** `wiki.writerModel` from `scripts/wiki config` (default `haiku`; Claude Code: the Agent
tool's `model`; elsewhere the harness's small-model tier).

## Inputs

- `project` — e.g. `pavilio`; workspace paths below are under `projects/<project>/`
- `input` — project-relative path of the record or raw file
- `page` — target path `wiki/sources/<kind>-<stem>.md` (exists → rewrite it, keep `created`)

## Read limits

- `input`, whole.
- `wiki/sources/<kind>-<stem>.md` if it exists (only its `created`).
- `wiki/entities/index.md` and `wiki/concepts/index.md` if they exist — to reuse slugs.
- `CONTEXT.md` term lines — to reuse glossary names.

Nothing else: no other records, wiki pages, code or web.

## Write

One file, `page`, shaped per `skills/pavilio-wiki/PAGES.md § Source page`; links per
`skills/pavilio-wiki/CONVENTIONS.md § Links`.

- Keep mechanisms, decisions and their reasons, gotchas, what broke and why, people and their roles.
- Drop status lines: PR and issue numbers, test counts, branch and commit names, "pending
  restart", "done/in progress", checklists, timings of the session itself.
- List in `entities:` / `concepts:` (bare names) every entity or concept the page says something
  durable about, not every word that appears. Reuse existing slugs and glossary names.
- A finding that is true outside this project (a library's behaviour, a platform limit, a general
  technique) is still written on the page and also returned as a `generic` item.
- An input with no durable knowledge → still write a short page (`description` says so) with empty
  lists.

## Receipt

Reply with exactly one JSON object and nothing else:

```json
{
  "status": "ok",
  "page": "wiki/sources/progress-2026-10-19-tts-relay-node20.md",
  "input": "progress/2026-10-19-tts-relay-node20.md",
  "slugs": ["concepts/speech-relay", "entities/edge-tts"],
  "generic": ["Edge TTS handshake returns 403 unless the UA is Edge >= 137"]
}
```

`slugs` are namespaced (`entities/<name>`, `concepts/<name>`) and match the page's frontmatter.
On failure: `{"status": "error", "input": "<path>", "error": "<one line>"}`.
