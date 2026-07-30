# _example (skeleton)

This directory is hidden from the CLI by its `_` prefix. To activate it:

1. Copy it to `features/<your-feature>/` (no underscore).
2. Rename `example-workflow.intent.ts` to `<your-workflow>.intent.ts` — name the
   *action*, not the noun: `bulk-settlement`, not `payment-processor`.
3. Rewrite this file for your feature. A good `feature.md` answers, in order:
   what the feature is in one sentence, which workflows it has and what each
   does, which decisions are easy to break by accident, and what the known gaps
   are — including the unflattering ones. See the reference project's
   `features/payments/feature.md` for the shape.

## Workflows

| Workflow | What it does | Status |
|---|---|---|
| `example-workflow` | Skeleton: validate a batch, accept or reject, aggregate | skeleton |

## Read before changing anything here

List the decisions whose implementation looks like ordinary independent code but
is not — orderings that change results, boundaries with exact semantics,
representation choices. This section is the difference between a feature a new
engineer can safely touch and one they quietly break.

## Known gaps

An honest list. A feature page that only lists what works is marketing.
