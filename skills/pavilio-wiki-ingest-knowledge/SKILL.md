---
name: pavilio-wiki-ingest-knowledge
description: Shortcut for the knowledge harvest — moves generic findings from every project wiki's `## Knowledge candidates` into the shared `knowledge` wiki by running `/pavilio-wiki ingest knowledge [-yolo]`. Use only when the user invokes `/pavilio-wiki-ingest-knowledge` or asks to run the knowledge harvest.
---

# Pavilio Wiki — ingest knowledge

A shortcut, nothing more. Invoke [[pavilio-wiki]] with the knowledge harvest, passing `-yolo`
through when given:

```
/pavilio-wiki-ingest-knowledge          →  /pavilio-wiki ingest knowledge
/pavilio-wiki-ingest-knowledge -yolo    →  /pavilio-wiki ingest knowledge -yolo
```

Follow `skills/pavilio-wiki/SKILL.md § 5. Knowledge harvest` exactly. Every step, threshold,
write, commit and report lives there; this skill restates none of them.

One reminder, because the harvest runs many `scripts/wiki` commands: an exit 1 stops the run only
when stdout carries a JSON `error`. A failure with no JSON (e.g. the sandbox refusing tsx's IPC
pipe with `EPERM`) means the CLI never started and nothing changed — retry that command once
through another executor, per `skills/pavilio-wiki/SKILL.md § Reading a scripts/wiki failure`.
