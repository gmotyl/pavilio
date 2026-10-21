# CONTEXT.md Format

Grill never writes `CONTEXT.md`. Terms resolved during a grill go to the change's
`design.md § Glossary` (the **glossary delta**) in the same format; [[pavilio-archive-plan]] folds
that delta into `CONTEXT.md` when the change ships, and `/pavilio-wiki-migrate <project>` rewrites a
legacy `CONTEXT.md` into this format once. Rationale, relationships, examples and history live in
the change's `design.md` and, after archive, in the project wiki — never in `CONTEXT.md`.

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

- **Order** — a customer's request for goods, from placement to fulfilment. _Avoid_: purchase, transaction. See [[wiki/concepts/order]]
- **Invoice** — a request for payment sent to a customer after delivery. _Avoid_: bill, payment request
- **Customer** — a person or organization that places orders. _Avoid_: client, buyer, account
```

The glossary delta in `design.md` is the same list under `## Glossary`. A term the change retires
is listed as `- **Term** — retired: <one-line reason>`; archive-plan removes it from `CONTEXT.md`.

## Rules

- **Strict one line per term.** `- **Term** — <one sentence>.`, then optional `_Avoid_: alias, alias.`, then at most one `See [[…]]` link (a wiki concept page or a spec path). No second sentence, no sub-bullets, no wrapped paragraphs.
- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Resolve conflicts in the definition.** An ambiguous word is settled by picking the canonical term and listing the loser under `_Avoid_`; the discussion stays in `design.md`.
- **Define what it IS, not what it does.**
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.

## Single vs multi-context repos

**Single context (most repos):** One `CONTEXT.md` at the repo root.

**Multiple contexts:** A `CONTEXT-MAP.md` at the repo root lists the contexts, where they live, and how they relate to each other:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) — receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md) — generates invoices and processes payments
- [Fulfillment](./src/fulfillment/CONTEXT.md) — manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

The skill infers which structure applies:

- If `CONTEXT-MAP.md` exists, read it to find contexts
- If only a root `CONTEXT.md` exists, single context
- If neither exists, archive-plan creates a root `CONTEXT.md` lazily when it folds the first glossary delta

When multiple contexts exist, infer which one the current topic relates to. If unclear, ask.
