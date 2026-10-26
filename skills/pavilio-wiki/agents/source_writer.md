# source_writer

Turn one record or raw file into one source page. The only writer that reads records.

**Model:** `wiki.writerModel` from `scripts/wiki config` (default `haiku`; Claude Code: the Agent
tool's `model`; elsewhere the harness's small-model tier).

## Inputs

- `project` — e.g. `pavilio`; workspace paths below are under `projects/<project>/`
- `input` — project-relative path of the record or raw file
- `page` — target path `wiki/sources/<kind>-<stem>.md` (exists → rewrite it, keep `created`)
- `url` — external material only (an article, a YouTube transcript, a clone): the original's URL,
  as the orchestrator gives it, already normalised and with any userinfo (`user:token@`) stripped
  (a local-path or `file://` clone has none); never write credentials onto a page

The orchestrator passes these in the prompt; there is no input file to read.

## Read limits

- `input`, whole.
- `wiki/sources/<kind>-<stem>.md` if it exists (only its `created`).
- `wiki/entities/index.md` and `wiki/concepts/index.md` if they exist — to reuse slugs and to see
  which pages exist before linking.
- `CONTEXT.md` term lines — to reuse glossary names.

Nothing else: no other records, wiki pages, code or web.

## Write

One file, `page`, shaped per `skills/pavilio-wiki/PAGES.md § Source page`; links per
`skills/pavilio-wiki/CONVENTIONS.md § Links`.
- Given a `url`: write it as `url: "<url>"` and make the provenance line
  `From [[wiki/raw/…]] · Original: <url>`. No `url` given → no `url` field; never invent one.
- Frontmatter strings — `title`, `description`, `record`, `raw`, `url` and every list item — are
  double-quoted JSON strings: `description: "Tailscale HTTPS: needs MagicDNS"`. An unquoted `: `
  breaks the YAML (lint reports the page as `malformed`).
- Keep mechanisms, decisions and their reasons, gotchas, what broke and why, people and their roles.
- Drop status lines: PR and issue numbers, test counts, branch and commit names, "pending
  restart", "done/in progress", checklists, timings of the session itself.
- List in `entities:` / `concepts:` (bare names) every entity or concept the page says something
  durable about, not every word that appears. Reuse existing slugs and glossary names.
- An input with a `## Glossary` section (an archived change's `design.md`): every term it defines
  goes into `concepts:`, under the slug its `CONTEXT.md` line links (`See [[wiki/concepts/<slug>]]`),
  else the term in kebab-case. Archive-plan has already linked those slugs from `CONTEXT.md`; a
  term left untagged is a dead glossary link, because this page is what qualifies its concept page.
- Body wikilinks only to pages the indexes list (and to records); a name without a page stays plain
  text in the body — its frontmatter entry is what counts it toward a page.
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
