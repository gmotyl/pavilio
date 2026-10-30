# Review guide for Kilo

Pavilio is a single-user, local web panel (Vite + React + Express) plus workspace scripts and skills.
One maintainer, one machine, token-auth on loopback/LAN. Calibrate findings to that.

## Comment format

Every comment starts with a one-sentence **TL;DR** — explain the problem like to a 5-year-old, no
jargon, no identifiers. Then a blank line, then the technical write-up.

```
**TL;DR:** If you press Clear while a song is still being saved, the song comes back.

**WARNING:** <technical explanation, trigger sequence, suggested fix>
```

## Mistakes from past reviews — do not repeat

These made us decline findings on earlier PRs:

- **Invented repo rules.** You cited a "no-comments rule" in `panel/AGENTS.md` that does not exist.
  Cite a convention only if you can quote it verbatim with its file path. Explanatory "why" comments
  are the house style, not a violation.
- **Invented line numbers / unread code.** Citations pointed at the wrong line, and "missing" guards
  sat a few lines above the flagged code. Read the whole function and its callers before claiming
  something is unguarded.
- **Misquoted external specs.** Do not paraphrase a spec (e.g. Media Session rates) from memory —
  quote it or leave it out.
- **Inflated severity.** A CRITICAL for a state only a partial test mock can produce. Severity is
  about what real usage can reach.
- **Designed behaviour flagged as a defect.** Read the PR description and its design decisions
  first; if a decision is stated there, argue with the decision, don't report it as a bug.
- **Impossible races.** Single-threaded Node: adjacent synchronous statements cannot interleave
  (no TOCTOU between them). A race finding must give a concrete event order that one user can
  actually trigger.
- **Wrong cost models.** "N² fan-out" where every consumer already handled every event; O(n)
  complaints where n is 1–4. Show the real n.
- **Same race, one level deeper, every round.** For best-effort caches, a worst case of
  "re-synthesise" or "stale entry survives" is a SUGGESTION, not a WARNING — say so explicitly
  instead of escalating.

## What is worth your attention

These were real, verified findings — keep finding them:

- Stale async results overwriting newer state (refetch erasing a just-acked value, late responses
  after clear/stop). Missing generation/abort guards.
- Missing cleanup: timers, listeners, sockets, `AbortSignal` not passed through.
- React hook-order divergence from early returns; effects that skip a `notify`.
- Untrusted keys in plain objects (`__proto__`), symlinks followed on write.
- Secure-context-only APIs (`crypto.subtle`, `crypto.randomUUID`) used where the panel is served
  over plain http on LAN.
- Doc comments or README lines that claim more than the code does.
- Tests that mock away the very path the fix is about.

## Conventions

- Rules live in `AGENTS.md`, `panel/AGENTS.md` and `CONTEXT.md` (glossary — use its terms). Nothing
  else is a rule.
- Code, comments and commit messages are in English.
- Every bugfix ships with a regression test that fails without it.
- `pnpm lint` typechecks app and server; dead code is `knip`'s job, not a review finding.
- Keep it short: no praise, no restating the diff, no style nits a formatter would catch.
