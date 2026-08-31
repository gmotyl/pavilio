---
name: pavilio-openspec-storage
description: Shared reference for how Pavilio stores OpenSpec artifacts — the native change/spec tree layout, per-scope backend resolution (ask-once, persist, reuse; project-wide changes use the project store), and the skill-owned (no-CLI) fold + archive procedure. Referenced by [[pavilio-grill]], [[pavilio-writing-plans]], [[pavilio-execute-plan]], [[pavilio-archive-plan]], [[pavilio-session-start]], and [[pavilio-manager]].
---

# pavilio-openspec-storage

The single source of truth for **where** Pavilio's OpenSpec artifacts live and **how** a workflow resolves that location. The lifecycle skills (grill → writing-plans → execute → archive) all defer here for storage and never re-decide it themselves.

This skill is a reference — it is not invoked on its own. The workflow skills link to it and follow the rules below **before** writing any artifact.

## Native tree layout

Pavilio follows OpenSpec's native layout in every backend. There is no second Pavilio-specific format.

```
openspec/
  changes/
    <change-id>/                 — one active (un-archived) change
      proposal.md                — the why/what (from pavilio-grill)
      design.md                  — technical design; KEEPS mermaid diagrams (from pavilio-grill)
      tasks.md                   — test-first implementation contract (from pavilio-writing-plans)
      specs/
        <capability>/spec.md     — requirement deltas (ADDED/MODIFIED/REMOVED)
    archive/
      YYYY-MM-DD-<change-id>/     — a shipped change, moved here on archive
  specs/
    <capability>/spec.md         — living specs: current behavior, one file per capability
```

**Active vs archived is directory location, not a pointer file.** A change directory under `openspec/changes/` that is **not** under `changes/archive/` is the active/current change. There is **no `CURRENT.md`** and no star pin — active work is *derived* from un-archived change dirs.

## Backends

Each artifact scope selects one of two backends independently; both use the identical tree above and differ only in the storage root:

- **native** — the tree lives inside the repository's own `<repo>/openspec/`. Used only when that repository has adopted OpenSpec.
- **store** — an identically shaped tree under the project workspace: `projects/<project>/plans/<repo>/openspec/` for an unadopted linked repository, or `projects/<project>/plans/openspec/` for a project-wide change not tied to a single repository.

A store is just a directory tree — there is **no registered store id** and **no CLI**. Pavilio never initializes OpenSpec in, or writes planning files into, an unadopted repository.

## Backend resolution (ask once, persist, reuse)

Persisted per linked repository in `repos.json` as an `openspec` object: `{ "mode": "native" | "store", "root"?: string }`. `root` defaults to the repository root for native mode and `projects/<project>/plans/<repo>/` for a store.

Resolve **before** writing any artifact:

1. **Determine the target scope** — which repository the change touches, or "project-wide" when it is not tied to one linked repository. Ambiguous → ask for one scope and stop.
2. **Project-wide change** → use the project store `projects/<project>/plans/openspec/` with **no adoption question**.
3. **Repo scope with a valid saved `openspec` config** → reuse it without asking.
4. **Repo scope, unconfigured** → ask **one question**: "Has `<repo>` adopted OpenSpec (native `<repo>/openspec/`), or should Pavilio keep its artifacts in a project-local store?" Then stop and wait.
   - Answer *native* → validate the repository's `openspec/` root exists/is reachable, then save `{ mode: "native", root }`.
   - Answer *store* → save `{ mode: "store" }` (default store root under `plans/<repo>/`).
5. **Persist first, then write.** Save the validated mode/root to `repos.json` before the first artifact write. Later grill / writing-plans / execute / archive on that scope reuse it silently.

**Validation gates:**
- User selects native but the expected root/tree cannot be validated → **stop before writing** and report the mismatch.
- Saved config conflicts with filesystem evidence → stop and ask whether to update it.
- Duplicate change identifier in one scope → reuse only after explicit confirmation; never overwrite an unrelated change.

### Switching a backend never migrates history

Switching a repository from store to native (or vice-versa) validates and saves the new mode/root only. It **never** automatically migrates existing artifacts — relocating history is a separate, explicit migration operation ([[pavilio-openspec-migrate]]), not a side effect of a config change.

## Multi-repository changes

One logical change coordinating several repositories uses **one shared change identifier** in every repository, but each repository **owns its own artifacts** and its backend is resolved **independently** (§ Backend resolution runs per repository). The same identifier across repositories is coordination metadata only — it is never permission to write outside each individually resolved root. Pavilio groups matching identifiers as one coordinated change in the panel without copying files.

## Skill-owned fold + archive (no CLI)

Archival is implemented in skill logic — **git-mv + markdown fold, exactly as today** — never by shelling out to an OpenSpec binary. See [[pavilio-archive-plan]] for the step list. In summary:

1. Fold the change's delta specs (`changes/<id>/specs/<capability>/spec.md`) into the living specs (`openspec/specs/<capability>/spec.md`): `ADDED` appends, `MODIFIED` rewrites in place, `REMOVED` deletes.
2. `git mv` the change directory to `openspec/changes/archive/YYYY-MM-DD-<change-id>/`.

Validation is skill-level (structure + delta-shape checks), not an external binary. **A fold or validation failure leaves the active change directory and the living specs unchanged** and reports the error — archival is all-or-nothing.

## Rules

- Resolve and persist the backend **before** any artifact write; project-wide changes skip the question.
- Never invoke an `openspec` binary or a child process for a CLI — archive/validation stay skill-owned.
- Never write into an unadopted repository; use its store instead.
- Active = un-archived change directory. No `CURRENT.md`, no star.
- Same change id across repos = coordination only, resolved independently per repo.
