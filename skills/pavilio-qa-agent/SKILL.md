---
name: pavilio-qa-agent
description: Generic acceptance-criteria-driven QA runner. Walks a user-supplied scenario in a browser, captures evidence before every check, and persists a self-contained run folder under `projects/<project>/qa/runs/`. Resolves project, env, ticket, account, and helpers from per-project QA config with sensible fallbacks. Use when the user invokes `/pavilio-qa-agent`, asks to run QA against a feature or ticket, wants to verify a numbered list of acceptance criteria with screenshots, or needs an evidence-backed manual QA pass before sign-off.
---

# Pavilio QA Agent

Generic acceptance-criteria-driven QA runner for any project. Uses browser automation to walk a scenario, capture evidence before each check, and persist a self-contained run folder under `projects/<project>/qa/runs/`.

## Required Skills

- `agent-browser` for browser automation

## Arguments

If `$ARGUMENTS` is present, extract any of the following:

- `--project=<name>` — project slug under `projects/` (e.g. `metro`, `ch`, `alokai`, `doterra`, `motyl`)
- `--env=<name>` — environment label (e.g. `local`, `pp`, `spartacus`, `develop`); project-specific values are resolved from the project's QA config
- `--ticket=<ID>` — Jira-like ticket (e.g. `ACCM-123`, `CO-5519`); ignore empty or boolean-like values
- `--silent` — opt out of verbose mode (off by default)
- A non-flag token → treated as run label slug (e.g. `cookie-banner-incognito`)

Any other free text in `$ARGUMENTS` is treated as operator context and used to fill inputs such as `startUrl`, `account`, `flow`, `market`, or acceptance criteria.

## Project Resolution

1. Use `--project` if provided.
2. Otherwise, infer from the working directory (`projects/<name>/...`).
3. Otherwise, ask the user which project to target — list the subfolders of `projects/`.

All run artifacts, AC files, and project-specific config must live under `projects/<project>/qa/`.

## Project QA Config (optional, per project)

If the project has any of these, read them before asking the user for missing inputs:

- `projects/<project>/qa/README.md` — workflow notes, flow docs, known quirks
- `projects/<project>/qa/accounts.yml` — account catalog grouped by env/market
- `projects/<project>/qa/flows/` — reusable flow definitions (e.g. `otp-checkout.md`)
- `projects/<project>/qa/ac/` — saved acceptance criteria, one file per ticket
- `projects/<project>/qa/lib/` — project-specific helpers that override the shared ones
- `projects/<project>/qa/*.sh` — project-specific scripts (e.g. `otp.sh`)

## Helper Resolution — shared by default, project-local overrides

For each helper (`run-orchestrator.js`, `report-path.js`, `url-resolver.js`, etc.), resolve the path with this precedence:

1. **Project-local:** `projects/<project>/qa/lib/<helper>.js` — use if present.
2. **Shared fallback:** `commands/qa/lib/<helper>.js` — use when the project has no override.

Most projects use the shared helpers. Create a project-local copy only when the generic version cannot express the project's flow (e.g. Metro's OTP checkpoint list lives at `projects/metro/qa/lib/run-orchestrator.js`).

The shared `commands/qa/lib/run-orchestrator.js`:
- requires `--project <slug>` and resolves runs under `projects/<project>/qa/runs/`
- accepts optional `--market`, `--env`, `--ticket`, `--report-label`, `--title`
- accepts `--checkpoints name1,name2,...` to preseed a fixed checkpoint list, or creates checkpoints on first `checkpoint` call when the list is empty
- supports `init`, `checkpoint`, `finalize` commands with the same flags as the Metro orchestrator

The shared `commands/qa/lib/report-path.js`:
- `run --project <slug> [--market ...] [--env ...] [--ticket ...] [--report-label ...] [--now ...]` → prints resolved `{ dir, baseName, markdownPath, jsonPath }`
- `screenshot --json-path <path> --checkpoint <name>` → prints the checkpoint screenshot path under `screenshots/`

## Run Folder Name

Derive the folder name as: `<timestamp>-<env>[-<ticket>][-<runLabel>]`

- `timestamp` — ISO 8601 with `:` and `.` replaced by `-` (e.g. `2026-04-21T14-30-00-000Z`)
- `env` — resolved environment label
- `ticket` — included when a Jira-like ticket was supplied
- `runLabel` — sanitized (replace non-alphanumeric with `-`, strip leading/trailing `-`); omit if not provided

Examples:
- `2026-04-21T14-30-00-000Z-local-CO-5519-vat-save`
- `2026-04-21T14-30-00-000Z-pp-cart-screenshot`
- `2026-04-21T14-30-00-000Z-local`

## Inputs — ask for missing values in a single message

Required:
1. **startUrl** — full URL or path relative to the env base
2. **acceptanceCriteria** — numbered list of things to verify, OR a reference to a saved AC file, OR a narrow one-off check

Optional (resolved from flags, project config, or auto-generated):
- **env** — if the project defines multiple envs and none was given, ask explicitly. Do not default silently when the choice is load-bearing (e.g. `local` vs `pp`/`prod`).
- **account** — if the flow needs login, pick from `accounts.yml` and prefer accounts that are not flagged `blocked`, `obsolete`, `employee`, `broken`, `sensitive`, `shared_qa`, `do_not_alter`, or `prod`. When the user supplies a new account, propose a normalized YAML entry and append it after confirmation.
- **ticket** — if present, look for an existing file in `projects/<project>/qa/ac/` matching `^<TICKET>-`. Reuse it as the canonical AC file even if the slug differs. If no file exists and the user pastes new criteria, save them to `projects/<project>/qa/ac/<TICKET>-<slug>.md`.
- **runLabel** — short slug appended to the folder name; auto-omitted if not provided

For one-off checks with no ticket, do not create an AC file unless asked.

## URL Normalization

The `startUrl` may come from any environment. Strip the known origin and reattach the target env's base URL, preserving the full path and query string.

1. If `startUrl` matches a known origin for this project → strip origin, keep path + query.
2. If `startUrl` is already a bare path (starts with `/`) → use as-is.
3. If the target env's base URL is unknown → ask the user for it once and remember for this run.
4. Append the stripped path to the target env's base URL.

Use `projects/<project>/qa/lib/url-resolver.js` when present. Do not invent hosts.

Project-specific base-path rules (e.g. Metro's `de` → `/marktplatz/`, others → `/marketplace/`) live in the project's QA README or resolver. Honor them.

## Run Artifacts

Create the run folder at:

```
projects/<project>/qa/runs/<folderName>/
```

Inside it:
- `run.md` — live markdown report, written incrementally after each criterion
- `run.json` — machine-readable state
- `screenshots/` — all screenshots; paths in markdown are relative to `run.md`

Use the `run-orchestrator.js` resolved via **Helper Resolution** (project-local override or shared fallback). Call `init` before browser work, `checkpoint` per persisted step, and `finalize` when done. Direct file writes are only appropriate if neither helper is available — which should not happen now that the shared fallback exists.

## Verbose Mode

Verbose is **on by default**. Disable only when `--silent` is present.

Verbose means:
- Capture one screenshot before every click, form submit, or page-transition action.
- Capture one screenshot before every criterion is marked `passed` or `failed`.
- **Do NOT mark a criterion until a screenshot has been taken and saved.**
- Every persisted step must render the actual image inline in `run.md`, not just the filename.
- Each checkpoint records: current page/screen, screenshot path, what is visible and relevant, and what will be clicked or submitted next.

## Workflow

1. Parse `$ARGUMENTS` for `--project`, `--env`, `--ticket`, `--silent`, and optional run label.
2. Resolve project (see **Project Resolution**). Read the project's QA config files.
3. If `env` is missing and the project defines multiple, ask explicitly.
4. If the flow needs login, resolve the account from `accounts.yml` or ask.
5. Ask (in a single message) for any remaining inputs: `startUrl`, `acceptanceCriteria`, and the ticket if relevant.
6. **Wait for the user's reply before continuing.**
7. Normalize `startUrl` per **URL Normalization** → `resolvedStartUrl`.
8. Resolve helpers per **Helper Resolution** (project-local → shared fallback).
9. Initialize the run by calling the resolved `run-orchestrator.js init --project <project> [--market ...] [--env ...] [--ticket ...] [--report-label ...] [--checkpoints ...]`. It creates the run folder and writes initial `run.json` + `run.md`.
10. Open the browser with `agent-browser open <resolvedStartUrl>`.
11. Wait for load: `agent-browser wait --load networkidle`.
12. Take initial screenshot: `agent-browser screenshot --path screenshots/initial.png`.
13. For each acceptance criterion (in order):
    a. Navigate or interact with `agent-browser` as needed to reach the relevant UI state.
    b. In verbose mode, save a screenshot before each interaction and persist a checkpoint.
    c. Read DOM: `agent-browser snapshot -i`.
    d. Take the evidence screenshot: `agent-browser screenshot --path screenshots/ac-<index>.png`.
    e. Evaluate the visible UI → `passed` or `failed`.
    f. Update `run.json` criterion: `status`, `screenshotPath`, `note`.
    g. Append checkpoint section to `run.md` (status, note, inline screenshot).
14. For targeted checks, stop as soon as the requested evidence is collected. Do not force a full flow.
15. Determine final outcome: `pass` if all criteria passed, `fail` otherwise.
16. Finalize by calling the resolved `run-orchestrator.js finalize --json-path <...> --outcome <pass|fail|blocked> [--blocker ...]`.
17. Report the run folder path and final outcome.

## Login / Credentials

- If the site requires login and the project has no helper (e.g. `otp.sh`), ask the user for credentials before proceeding.
- If an OTP/login helper exists, run it. Only ask the user for manual retrieval if the helper fails or returns unusable output.
- Confirm login succeeded by verifying signed-in UI state (account button, visible identity text) before continuing to AC steps.

## run.json Schema

```json
{
  "project": "ch",
  "runName": "cookie-banner-incognito",
  "env": "local",
  "ticket": null,
  "startUrl": "http://local.example.com:3000/es/es/adding-products?products=...",
  "startedAt": "2026-04-21T10:00:00.000Z",
  "finishedAt": "2026-04-21T10:15:00.000Z",
  "outcome": "pass",
  "acceptanceCriteria": [
    {
      "index": 1,
      "text": "Cookie banner appears on first visit in incognito",
      "status": "passed",
      "screenshotPath": "screenshots/ac-1.png",
      "note": "Banner visible with Accept All / Cookie Settings buttons"
    }
  ]
}
```

## run.md Format

```markdown
# QA Run: <runName>

**Project:** <project>
**Env:** <env>
**Ticket:** <ticket or —>
**Started:** <timestamp>
**URL:** <startUrl>

## Acceptance Criteria

1. <criterion 1>
2. <criterion 2>

## Results

### AC 1 — <criterion 1>

**Status:** PASSED / FAILED
**Note:** <observation about what was seen>

![screenshot](screenshots/ac-1.png)

---

### AC 2 — <criterion 2>

...

## Summary

**Outcome:** PASS / FAIL
**Passed:** X / N
**Finished:** <timestamp>
```

## Failure Reporting

When a criterion fails, include in `run.md`:
- Last visible browser URL
- Visible error text, missing UI elements, or unexpected state
- Screenshot path

## Browser Guidance

- `agent-browser open <url>` — navigate to URL
- `agent-browser wait --load networkidle` — wait after navigation
- `agent-browser snapshot -i` — read current DOM state
- `agent-browser screenshot --path <path>` — capture screenshot
- `agent-browser click <label>` — click (prefer visible text / semantic labels over CSS selectors)
- `agent-browser type <selector> <text>` — fill inputs

## Safety

- Never place orders or submit payment information.
- Always write run artifacts before exiting, even on failure or block.
- Always finalize the run, including failures and blockers.
- If the browser session cannot start, report clearly which env URL was unreachable.

## Response Guidance

When responding:
- Lead as if the user asked to execute QA.
- Mention the selected project, env, account (if any), and flow.
- Mention whether criteria came from a saved AC file or new pasted input.
- Mention the run artifact path under `projects/<project>/qa/runs/`.
- In verbose mode, mention that `run.md` is a page-by-page journey with screenshots before each action.
- If blocked, explain exactly which input is missing and what evidence was collected so far.
