# repo_writer

Write the code subtree of one repository from its clone: `ARCHITECTURE.md` (architecture mode) or
one code-level note (question mode).

**Model:** `wiki.writerModel` from `scripts/wiki config` (default `haiku`; Claude Code: the Agent
tool's `model`; elsewhere the harness's small-model tier).

## Inputs

- `project`
- `repo` — the repository entity's name; pages go in `wiki/repos/<repo>/`
- `clonePath`, `commitSha` — from the `scripts/wiki clone-repo` receipt
- `mode` — `architecture` or `question`
- `question` — question mode only
- `url` — the clone's origin, normalised to `https://github.com/<owner>/<repo>` (no `.git`)

The orchestrator passes these in the prompt; there is no input file to read.

## Read limits

- Architecture mode: inside `clonePath` only — README, manifests (`package.json`, `pyproject.toml`,
  `go.mod`, …), the directory tree to depth 3, entry points, and ≤20 further source files chosen
  from those. The existing `ARCHITECTURE.md` (for `created`).
- Question mode: `wiki/repos/<repo>/ARCHITECTURE.md`, then ≤15 files in `clonePath` it points to
  or a search of the clone finds.

Nothing outside `clonePath` and `wiki/repos/<repo>/`; no web, no other wiki pages.

## Write

Shaped per `skills/pavilio-wiki/PAGES.md § Repo pages`, with `commit: <commitSha>` and
`url: "<url>"` on every page (question mode without a `url` input: copy `ARCHITECTURE.md`'s; none
there either → omit it, never invent one).
- Architecture mode: an `Original: <url>` line directly under the `# <repo>` title.
- Frontmatter strings — `title`, `description`, `record`, `raw`, `url` and every list item — are
  double-quoted JSON strings: `description: "Tailscale HTTPS: needs MagicDNS"`. An unquoted `: `
  breaks the YAML (lint reports the page as `malformed`).
- Architecture mode: one file, `wiki/repos/<repo>/ARCHITECTURE.md` (rewrite; keep `created`).
- Question mode: one new file, `wiki/repos/<repo>/<topic-slug>.md`, answering the question with
  file paths and symbols. Never edit `ARCHITECTURE.md` in this mode.
- Architecture mode may carry one or two ```` ```mermaid ```` diagrams — module map, request flow
  (`skills/pavilio-wiki/CONVENTIONS.md § Diagrams`); only what the page states, labels quoted.
- Code identifiers belong here. List the entities and concepts the page explains in
  `entities:` / `concepts:` (bare names), always including `<repo>` in `entities`.

## Receipt

Reply with exactly one JSON object and nothing else:

```json
{
  "status": "ok",
  "page": "wiki/repos/pavilio/ARCHITECTURE.md",
  "repo": "pavilio",
  "mode": "architecture",
  "commitSha": "1a2b3c4",
  "slugs": ["entities/pavilio", "concepts/speech-relay"],
  "generic": []
}
```

`slugs` namespaced, matching the frontmatter. On failure:
`{"status": "error", "repo": "<repo>", "error": "<one line>"}`.
