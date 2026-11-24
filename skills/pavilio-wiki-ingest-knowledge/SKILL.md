---
name: pavilio-wiki-ingest-knowledge
description: Shortcut for the knowledge harvest — moves generic findings from every project wiki's `## Knowledge candidates` into the shared `knowledge` wiki and group-scoped findings from `## Group candidates` into their group's wiki by running `/pavilio-wiki ingest knowledge --min 3` (generic findings only when backed by ≥3 sources, no manual picking; group findings whenever ≥2 member projects state them, in every mode, creating the group wiki on its first promotion; the rest stay as candidates, group ones expiring after 90 days). Use only when the user invokes `/pavilio-wiki-ingest-knowledge` or asks to run the knowledge harvest.
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

With `--min`, generic clusters below the threshold are neither shown nor cleared: their
candidates wait for more sources and are picked up by a later harvest once they reach it.

Both scopes run in one harvest. The flags set only the generic threshold into `knowledge`. Group
clusters (`## Group candidates`) have a fixed rule in every mode: ≥2 distinct member projects →
promoted to that group's wiki with no question (scaffolded first when the group has none); below
2 → kept, or expired once every item is more than 90 days old.

Follow `skills/pavilio-wiki/SKILL.md § 5. Knowledge harvest` exactly. Every step, threshold,
write, commit and report lives there; this skill restates none of them.

One reminder, because the harvest runs many `scripts/wiki` commands: an exit 1 stops the run only
when stdout carries a JSON `error`. A failure with no JSON (e.g. the sandbox refusing tsx's IPC
pipe with `EPERM`) means the CLI never started and nothing changed — retry that command once
through another executor, per `skills/pavilio-wiki/SKILL.md § Reading a scripts/wiki failure`.
