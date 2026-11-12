# QA Agent — Carolina Herrera

Use this skill to run acceptance-criteria-driven QA testing against the Carolina Herrera Alokai storefront using browser automation.

## Required Skills

- `agent-browser` for browser automation

## Arguments

If `$ARGUMENTS` contains any of the following, extract them:

- `--env=local` (default) | `--env=spartacus` | `--env=develop`
- A short run name slug (any non-flag token), e.g. `cookie-banner-incognito`

## Run Folder Name

Derive the folder name as: `<timestamp>-<env>[-<runLabel>]`

- `timestamp` — ISO 8601 with `:` and `.` replaced by `-` (e.g. `2026-03-24T14-30-00-000Z`)
- `env` — the resolved environment name (`local`, `spartacus`, `develop`)
- `runLabel` — sanitized run name from args (replace non-alphanumeric with `-`, strip leading/trailing `-`); omit if not provided

Examples:
- with label: `2026-03-24T14-30-00-000Z-local-cookie-banner-incognito`
- without label: `2026-03-24T14-30-00-000Z-local`

## Inputs — ask for missing values in a single message

Required:
1. **startUrl** — where to begin (full URL or path relative to env base, e.g. `/es/es/adding-products?products=...`)
2. **acceptanceCriteria** — numbered list of things to verify; ask user to provide before continuing

Optional (resolved from flags or auto-generated):
- **runLabel** — short slug appended to the folder name; auto-omitted if not provided
- **env** — default `local`

## Environment Base URLs

| env        | base URL                                         |
|------------|--------------------------------------------------|
| `local`    | `http://local.carolinaherrera.com:3000`          |
| `spartacus`| `https://spartacus-dev.carolinaherrera.com`      |
| `develop`  | ask user for URL if not already known            |

Default locale prefix: `/es/es`

## URL Normalization

The `startUrl` may come from any environment. Always strip the known origin and reattach the target env's base URL, preserving the full path and query string.

Known origins to strip:

| Origin | Pattern |
|--------|---------|
| local | `http://local.carolinaherrera.com:3000` |
| spartacus-dev | `https://spartacus-dev.carolinaherrera.com` |
| spartacus-prep | `https://spartacus-prep.carolinaherrera.com` |

Normalization steps:
1. If `startUrl` matches a known origin → strip the origin, keep path + query string
2. If `startUrl` is already a bare path (starts with `/`) → use as-is
3. If env is `develop` and base URL is unknown → apply the same stripping then prepend the develop URL once known
4. Append stripped path to the target env base URL

Example: user provides `https://spartacus-dev.carolinaherrera.com/es/es/adding-products?products=123:1` with `--env=local`
→ stripped path: `/es/es/adding-products?products=123:1`
→ resolved: `http://local.carolinaherrera.com:3000/es/es/adding-products?products=123:1`

## Run Artifacts

Create the run folder at:
```
/Users/gmotyl/git/prv/projects/projects/ch/qa/<folderName>/
```
where `<folderName>` is derived per the **Run Folder Name** rules above.

Create inside it:
- `run.md` — live markdown report (write incrementally after each criterion)
- `run.json` — machine-readable state
- `screenshots/` — all screenshots go here; paths in markdown are relative to `run.md`

## Verbose Mode

`verbose=true` by default. This means:
- Capture one screenshot before every criterion is marked `passed` or `failed`
- **Do NOT mark a criterion until a screenshot has been taken and saved**
- Include a screenshot reference in `run.md` for every criterion result

## Workflow

1. Parse `$ARGUMENTS` for `--env` flag and optional run label slug (any non-flag token)
2. Default `env` to `local` if not provided
3. Derive the folder name using the **Run Folder Name** rules (timestamp + env + optional label)
4. Ask the user (in a single message) for any missing inputs: `startUrl`, `acceptanceCriteria`
5. **Wait for the user's reply before continuing**
6. Normalize `startUrl` per the **URL Normalization** rules → get `resolvedStartUrl`
7. Create the run folder and write initial `run.json`:
   ```json
   {
     "runName": "...",
     "env": "local|spartacus|develop",
     "startUrl": "...",
     "startedAt": "ISO timestamp",
     "finishedAt": null,
     "outcome": "incomplete",
     "acceptanceCriteria": [
       { "index": 1, "text": "...", "status": "pending", "screenshotPath": null, "note": "" }
     ]
   }
   ```
8. Write initial `run.md` header with env, folderName, startUrl, and full acceptance criteria list
9. Open browser: `agent-browser open <resolvedStartUrl>`
10. Wait for load: `agent-browser wait --load networkidle`
11. Take initial screenshot: `agent-browser screenshot --path screenshots/initial.png`
12. For each acceptance criterion (in order):
    a. Navigate or interact with `agent-browser` as needed to reach the relevant UI state
    b. Read DOM: `agent-browser snapshot -i`
    c. Take screenshot: `agent-browser screenshot --path screenshots/ac-<index>.png`
    d. Evaluate: does the visible UI satisfy the criterion? → `passed` or `failed`
    e. Update `run.json` criterion: set `status`, `screenshotPath`, `note`
    f. Append checkpoint section to `run.md` (status, note, screenshot)
13. Determine final outcome: `pass` if all criteria passed, `fail` otherwise
14. Update `run.json`: set `finishedAt` and `outcome`
15. Append summary section to `run.md`
16. Report the run folder path and final outcome to the user

## run.json Schema

```json
{
  "runName": "cookie-banner-incognito",
  "env": "local",
  "startUrl": "http://local.carolinaherrera.com:3000/es/es/adding-products?products=...",
  "startedAt": "2026-03-24T10:00:00.000Z",
  "finishedAt": "2026-03-24T10:15:00.000Z",
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

**Env:** <env>
**Started:** <timestamp>
**URL:** <startUrl>

## Acceptance Criteria

1. <criterion 1>
2. <criterion 2>

## Results

### AC 1 — <criterion 1>

**Status:** ✅ PASSED / ❌ FAILED
**Note:** <observation about what was seen>

![screenshot](screenshots/ac-1.png)

---

### AC 2 — <criterion 2>

...

## Summary

**Outcome:** ✅ PASS / ❌ FAIL
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
- If the site requires login, ask the user for credentials before proceeding

## Safety

- Never place orders or submit payment information
- Always write run artifacts before exiting, even on failure
- If the browser session cannot start, report clearly which env URL was unreachable

---

Operator context:

`$ARGUMENTS`
