# 0002 — Photos committed alongside the posts

## Status

**Superseded** — decided 14 August 2025, superseded 23 November 2025 by the
approach in [notes/image-pipeline.md](../notes/image-pipeline.md).

## Context

[ADR 0001](0001-drafts-live-in-the-repo.md) put the words in the repo and said
nothing about the photos. Since every ID needs a photo (house style, see
[CONTEXT.md](../CONTEXT.md)), a post is not portable without its images.

At the time the archive was about 400 photos.

## Decision

Commit the photos next to the markdown that uses them:

```
posts/2025-08-02-buddleia-on-the-footbridge.md
posts/2025-08-02-buddleia-on-the-footbridge/
    01-footbridge-north.jpg
    02-crack-detail.jpg
```

One folder per post, numbered filenames, originals only — no resizing.

## Consequences

- A post is one self-contained unit. Genuinely nice while it lasted.
- The repo passed 2 GB by the end of the summer season. A fresh clone took long
  enough that I stopped doing it on the laptop.
- Every rejected frame that got committed once stayed in history forever. Twenty
  near-identical shots of the same *Buddleja davidii* seedling are permanent.
- No resizing meant the site served 6 MB images on a phone. This was the actual
  reason the decision was revisited.
- Superseded: originals moved out to a separate photo store, only derived web-size
  copies stay tracked. The per-post folder layout survived; the "originals only"
  rule did not.
