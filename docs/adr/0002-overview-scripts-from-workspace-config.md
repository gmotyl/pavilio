# Overview scripts driven by workspace JSON config

The panel surfaces project-scoped shell scripts as buttons on each project's Overview tab. The set of buttons is defined in a workspace-level JSON file (`scripts/scripts.json`) rather than hardcoded in panel code. Buttons share one backend route pair (`GET /api/scripts`, `POST /api/projects/:name/scripts/:id/run`) and one frontend component (`ScriptButton`). Adding a new button means adding a `scripts/*.sh` file plus an entry in `scripts.json` — no panel changes required.

## Considered options

- **Hardcoded per-button route + UI** — simplest for one button (Export to NotebookLM), but every future button (export-codebase, export-git-insights, …) adds a new route, a new React file, and a new test file. Three buttons in, the wiring is duplicated.
- **Per-project `<project>/scripts.json`** — each project owns its button set. More expressive but no project actually needs different buttons in v1, and the discovery cost (every project must opt in) is high. Quietly violates "common case first".
- **Workspace `scripts/scripts.json` driving a generic run endpoint** *(chosen)* — one config, one route, one component. Every project gets the same buttons. New script = new shell file + one JSON entry.

## Consequences

- `scripts.json` is config-as-code: changes ship in pavilio upstream and propagate via `scripts/update.sh`. Users don't hand-edit it (yet); a future `scripts.local.json` overlay would be the escape hatch.
- The exec route trusts the config: any `scripts/*.sh` path can be listed. Path-traversal guards live in the route, not in the JSON. Reviewing a `scripts.json` change is reviewing executable surface area.
- Per-project filtering, ordering, hiding, and `scripts.local.json` are deliberately out of v1 scope. Adding them later does not require changing the route shape — only adding new optional config fields.
