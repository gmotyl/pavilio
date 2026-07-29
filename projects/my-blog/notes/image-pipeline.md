# The photo pipeline

Every ID needs a photo — that is the one hard rule in [CONTEXT.md](../CONTEXT.md).
So the photos are not decoration, they are evidence, and the pipeline has to be
boring enough that it never blocks a post.

This note records the approach that superseded
[ADR 0002](../adr/0002-photos-in-the-repo.md), which committed full-size originals
into the repo and pushed it past 2 GB.

## The split

Two stores, different rules:

| Store | Contents | Tracked? |
|---|---|---|
| photo store (external drive + one backup) | every frame, untouched, by walk date | no |
| repo | web-size copies actually used in posts | yes |

Originals are never edited and never deleted. Web copies are disposable — they can
always be regenerated from an original, so nothing is lost by not versioning them.

## Getting from camera to post

1. **Dump by walk, not by post.** Card empties into `walks/YYYY-MM-DD/` in the photo
   store. A walk usually feeds zero or one posts, occasionally three.
2. **Cull the same evening.** If it waits a week, nothing gets culled — I lose the
   memory of which frame was the sharp one and keep all of them.
3. **Pick and name.** Chosen frames get copied into the post's folder in the repo,
   numbered in reading order: `01-`, `02-`. The number is the order they appear in
   the post, so reordering the post means renaming files. That is deliberate friction.
4. **Resize on the way in.** Long edge 1600 px. Nothing larger ever gets committed.
5. **Caption in the markdown, never in the filename.** Filenames are for ordering.

## Scale, and why it matters

A crack plant photographed close up could be 4 cm or 40. Every close-up needs either
a wide shot in the same set or something of known size in frame. The habit is a
folding rule laid flat beside the plant — ugly in the photo, but the alternative is a
post that cannot support its own measurements.

## What still goes wrong

- Culling gets skipped when a walk produces something exciting. The excitement makes
  me want to publish, not sort.
- The Kerb Walk survey shots are near-identical by design (same twelve points every
  month) and are impossible to tell apart out of context. They live under
  `surveys/` in the photo store, not with the walks.
- Regenerating a web copy needs the original, so the external drive is a real single
  point of failure between backups. Backup cadence is monthly, which is too slow, and
  is the next thing to fix.
