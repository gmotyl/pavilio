# Filesystem mutations live in the notes world only

The panel can move and rename files under `projectsDir` ("notes world") freely, because nothing outside the panel tracks those paths. Inside a **linked repository** ("repo world") the panel does not mutate the filesystem — `fs.rename` would silently divorce a tracked file from its git history. Repo-world rename/move belongs to `git mv`, which has its own surface (tracked vs untracked, conflicts, submodules) we are not ready to take on. Drag-to-move, search-and-rename, and any future "fix the path for me" affordance therefore apply to notes world only until we explicitly opt in to git-aware semantics.

## Considered options

- **Both worlds, plain `fs.rename`** — fast to ship but quietly breaks git history; every file move becomes "delete + add" in git, losing blame and rename detection.
- **Both worlds, `git mv` inside linked repos** — correct, but adds tracked/untracked detection, dirty-tree handling, and submodule edge cases for each mutation. Too much surface for v1.
- **Notes world only** *(chosen)* — one root, one guard, no git semantics to negotiate. Repo-world drag can land as a v2 feature with explicit `git mv` once we commit to that scope.

## Consequences

- Drag sources can render anywhere — including grids that mix notes and repo files — but drop targets exist only on notes-world rows. The asymmetry must be visible to the user (e.g. repo folders never accept a drop).
- Future panel features that mutate files (rename-in-place, "move all matching") inherit the same rule. When that changes, this ADR gets superseded.
