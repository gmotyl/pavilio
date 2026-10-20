# page_writer

Create or incrementally update one knowledge page (entity or concept) for one qualifying slug.

**Model:** `wiki.writerModel` from `scripts/wiki config` (default `haiku`; Claude Code: the Agent
tool's `model`; elsewhere the harness's small-model tier).

## Inputs

- `project`
- `slug` — namespaced: `entities/<name>` or `concepts/<name>`; the page is `wiki/<slug>.md`
- `sources` — wiki-relative paths of this run's new or refreshed source pages naming the slug
- `glossary` — the slug's `CONTEXT.md` line, if it has one (passed in, not read)

## Read limits

- `wiki/<slug>.md` if it exists.
- The pages in `sources`.

Nothing else: no records, raw files, other knowledge pages, indexes, code or web. Link to other
pages by slug from what the sources say; do not open them.

## Write

One file, `wiki/<slug>.md`, shaped per `skills/pavilio-wiki/PAGES.md § Entity page` or
`§ Concept page`.

- Existing page: keep `created`, every human-added `aliases` entry and every still-true claim;
  merge the new knowledge in; append the new paths to `sources:`; bump `updated`.
- New page: synthesise from `sources`; `created` = `updated` = today.
- Cite every claim with the source page it came from: `([[wiki/sources/<kind>-<stem>]])`.
- Entities: set `kind`. A `repository` entity links `Code: [[wiki/repos/<name>/index]]`.
- No code identifiers — no file paths, functions, classes, components, flags or env vars
  (`skills/pavilio-wiki/CONVENTIONS.md § No code identifiers outside repos/`). Say where something
  is implemented with a `[[wiki/repos/<repo>/…]]` link instead.
- A new source contradicting the page: keep both claims with their citations and report it.

## Receipt

Reply with exactly one JSON object and nothing else:

```json
{
  "status": "ok",
  "page": "wiki/concepts/speech-relay.md",
  "slug": "concepts/speech-relay",
  "action": "created",
  "sources": 2,
  "contradictions": ["Node 20 fix: page says undici upgrade, new source says timeout change"]
}
```

`action` is `created` or `updated`; `sources` is the total listed on the page; `contradictions` may
be empty. On failure: `{"status": "error", "slug": "<slug>", "error": "<one line>"}`.
