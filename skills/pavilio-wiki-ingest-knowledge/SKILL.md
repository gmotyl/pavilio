---
name: pavilio-wiki-ingest-knowledge
description: Shortcut for the knowledge harvest — moves generic findings from every project wiki's `## Knowledge candidates` into the shared `knowledge` wiki by running `/pavilio-wiki ingest knowledge --min 3` (only findings backed by ≥3 sources, no manual picking; the rest stay as candidates). Use only when the user invokes `/pavilio-wiki-ingest-knowledge` or asks to run the knowledge harvest.
---

# Pavilio Wiki — ingest knowledge

A shortcut, nothing more. Invoke [[pavilio-wiki]] with the knowledge harvest. The default is an
automatic threshold of 3, because sorting every cluster by hand is too much to do in one sitting:

```
/pavilio-wiki-ingest-knowledge            →  /pavilio-wiki ingest knowledge --min 3
/pavilio-wiki-ingest-knowledge --min <n>  →  /pavilio-wiki ingest knowledge --min <n>
/pavilio-wiki-ingest-knowledge -yolo      →  /pavilio-wiki ingest knowledge -yolo
/pavilio-wiki-ingest-knowledge --manual   →  /pavilio-wiki ingest knowledge
```

With `--min`, clusters below the threshold are neither shown nor cleared: their candidates wait
for more sources and are picked up by a later harvest once they reach it.

Follow `skills/pavilio-wiki/SKILL.md § 5. Knowledge harvest` exactly. Every step, threshold,
write, commit and report lives there; this skill restates none of them.

One reminder, because the harvest runs many `scripts/wiki` commands: an exit 1 stops the run only
when stdout carries a JSON `error`. A failure with no JSON (e.g. the sandbox refusing tsx's IPC
pipe with `EPERM`) means the CLI never started and nothing changed — retry that command once
through another executor, per `skills/pavilio-wiki/SKILL.md § Reading a scripts/wiki failure`.
