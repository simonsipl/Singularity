---
id: 0002
title: FX surcharge applies before the priority surcharge
status: accepted
date: 2026-07-30
feature: payments
workflow: bulk-settlement
rules:
  - fee.order
  - fee.1_tier
  - fee.2_fx
  - fee.3_priority
verified_by:
  - "fee.3_priority: +50% truncating, applied after FX"
  - "fee.2_fx: FX surcharge applies to EUR/GBP only, never to USD"
---

## Context

Three things adjust a fee: the tier rate, a cross-currency surcharge, and a
priority surcharge. The priority surcharge is a *percentage of the fee*, so the
order in which the stages apply changes the result. Nothing about the domain makes
one order obviously correct, and the difference is invisible unless you go looking
for it.

Concretely, for a 50,000-cent EUR priority payment:

| order | result |
|---|---|
| tier -> FX -> priority (chosen) | 2025 |
| tier -> priority -> FX | 1987 |

38 cents per payment. At a million payments a day that is a material number, and
neither value looks wrong on inspection.

## Decision

Stages apply in a fixed declared sequence: tier, then FX, then priority, then the
ceiling clamp, then the floor clamp. Each stage consumes the truncated integer
output of the previous one. The priority surcharge therefore compounds on top of
the FX surcharge.

The reasoning: priority is a service level applied to *the whole fee being
charged*, and the FX surcharge is part of that fee. Compounding priority over FX
follows from treating priority as the outermost adjustment.

## Consequences

- The stage sequence is now load-bearing. Reordering the conditionals in the exec
  unit changes billing and will not fail to compile.
- The ordering is asserted directly rather than implied: the test asserts 2025 and
  records that priority-before-FX would give 1987, so the wrong order fails loudly
  with a recognisable number.
- Truncation at each stage means the stages are not associative. Merging them into
  a single multiply would produce different results.

## Alternatives rejected

- **Apply both surcharges to the tier fee independently, then sum.** Avoids
  compounding, but makes "priority costs 50% more" false whenever FX applies.
- **Compute in one expression to avoid intermediate truncation.** Fewer rounding
  steps, but the result then depends on float behaviour, violating [[0001]].

## Notes

This is the decision most likely to be silently broken by a well-meaning refactor,
because the exec unit's four conditionals look independent and are not. That is
the entire reason this record exists.
