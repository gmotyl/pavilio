# overview_writer

Rewrite `wiki/overview.md`, the entry page of the wiki.

**Model:** `wiki.writerModel` from `scripts/wiki config` (default `haiku`; Claude Code: the Agent
tool's `model`; elsewhere the harness's small-model tier).

## Inputs

- `project`
- `changed` — project-root paths (`wiki/…` form, e.g. `wiki/concepts/speech-relay.md`) of the
  knowledge pages this run created or updated

The orchestrator passes these in the prompt; there is no input file to read. A long `changed`
list (a migration) is fine — choose the ≤5 pages to open from it, never open them all.

## Read limits

- `wiki/index.md` and the section indexes (`entities/`, `concepts/`, `repos/`) — the frontmatter
  view of every page: titles and descriptions.
- The existing `wiki/overview.md`, if any.
- ≤5 pages, preferring `changed` and the most-linked entities and concepts.

Nothing else: no source pages beyond those 5, no records, raw files, code or web.

## Write

One file, `wiki/overview.md`, shaped per `skills/pavilio-wiki/PAGES.md § Overview`: what the
project is, its main actors and concepts, where to start reading. ≤40 lines, D14 links only to
pages listed in the indexes, no code identifiers, keep `created`, bump `updated`. No
`overview.md` yet (a first ingest or a migration) → create it with `created` = `updated` = today.

- Frontmatter strings — `title`, `description`, `record`, `raw` and every list item — are
  double-quoted JSON strings: `description: "Tailscale HTTPS: needs MagicDNS"`. An unquoted `: `
  breaks the YAML (lint reports the page as `malformed`).

## Receipt

Reply with exactly one JSON object and nothing else:

```json
{ "status": "ok", "page": "wiki/overview.md", "read": ["wiki/concepts/speech-relay.md"] }
```

On failure: `{"status": "error", "page": "wiki/overview.md", "error": "<one line>"}`.
