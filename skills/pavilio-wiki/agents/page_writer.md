# page_writer

Create or incrementally update one knowledge page (entity or concept) for one qualifying slug.

**Model:** `wiki.writerModel` from `scripts/wiki config` (default `haiku`; Claude Code: the Agent
tool's `model`; elsewhere the harness's small-model tier).

## Inputs

- `project`
- `slug` — namespaced: `entities/<name>` or `concepts/<name>`; the page is `wiki/<slug>.md`
- `sources` — project-root paths (`wiki/sources/<kind>-<stem>.md`) of the source pages naming the
  slug that the page does not cite yet (`scripts/wiki backlog`), at most 12
- `glossary` — the slug's `CONTEXT.md` line, if it has one (passed in by the orchestrator, not read)

The orchestrator passes these in the prompt; there is no input file to read.

## Read limits

- `wiki/<slug>.md` if it exists.
- The pages in `sources`.
- `wiki/entities/index.md` and `wiki/concepts/index.md` — only to check which pages exist before
  linking.

Nothing else: no records, raw files, other knowledge pages, code or web. Link to other pages by
slug from what the sources say; do not open them.

## Write

One file, `wiki/<slug>.md`, shaped per `skills/pavilio-wiki/PAGES.md § Entity page` or
`§ Concept page`.
- Frontmatter strings — `title`, `description`, `record`, `raw` and every list item — are
  double-quoted JSON strings: `description: "Tailscale HTTPS: needs MagicDNS"`. An unquoted `: `
  breaks the YAML (lint reports the page as `malformed`).
- Existing page: keep `created`, every human-added `aliases` entry and every still-true claim;
  merge the new knowledge in; append the new paths to `sources:` in project-root form
  (`wiki/sources/<kind>-<stem>.md`); bump `updated`.
- New page: synthesise from `sources`; `created` = `updated` = today.
- Cite every claim with the source page it came from: `([[wiki/sources/<kind>-<stem>]])`.
- Link another entity or concept only when the indexes list its page; a name without a page stays
  plain text (`skills/pavilio-wiki/CONVENTIONS.md § Links`).
- Entities: set `kind`. A `repository` entity links `Code: [[wiki/repos/<name>/index]]`.
- No code identifiers — no file paths, functions, classes, components, flags or env vars
  (`skills/pavilio-wiki/CONVENTIONS.md § No code identifiers outside repos/`). Say where something
  is implemented with a `[[wiki/repos/<repo>/…]]` link instead.
- A newer source that replaces an older decision (a later design, a reverted plan, a shipped
  change) is not a contradiction: state what holds now with its citation, and keep the earlier
  version as dated history ("until 2026-10-15, …") with its own. Report nothing.
- Two sources that disagree with no later word settling it: keep both claims with their citations
  and report it under `contradictions`.
- The slug's name used by a source for something else (one word, two meanings): keep the page on
  its own meaning, say the other use in one sentence under a `Terminology` note, and report it
  under `collisions` — never merge the other meaning's claims into the page.

## Knowledge-wiki mode

When `project` is `knowledge` the knowledge harvest runs you, and these rules replace the
matching ones above:

- Inputs: `slug`, and `claims` — the picked findings, each with its origin as
  `<project>:wiki/sources/<kind>-<stem>.md` (no `sources` from a backlog, no `glossary`).
- Read limits: `wiki/<slug>.md` in `knowledge` if it exists, the origin source pages the claims
  name (only to get a claim right), and `knowledge`'s `wiki/entities/index.md` and
  `wiki/concepts/index.md`.
- Cite every claim with its origin: `([[<project>:wiki/sources/<kind>-<stem>]])`; append each
  origin to `sources:` as `"<project>:wiki/sources/<kind>-<stem>.md"`.
- No ≥2-source rule: one picked claim is enough for a page. The user's pick is the promotion.
- Write only what holds outside any one project — the tool, library, platform or technique, never
  a client, a deal or a project's own plans. Name the project only in the citation.

## Receipt

Reply with exactly one JSON object and nothing else:

```json
{
  "status": "ok",
  "page": "wiki/concepts/speech-relay.md",
  "slug": "concepts/speech-relay",
  "action": "created",
  "sources": 2,
  "contradictions": ["Node 20 fix: page says undici upgrade, new source says timeout change"],
  "collisions": []
}
```

`action` is `created` or `updated`; `sources` is the total listed on the page; `contradictions` and
`collisions` may be empty. On failure: `{"status": "error", "slug": "<slug>", "error": "<one line>"}`.
