---
id: 0007
title: The fee ceiling is applied before the floor
status: accepted
date: 2026-07-30
feature: payments
workflow: bulk-settlement
rules:
  - fee.4_ceiling
  - fee.5_floor
  - fee.bounds_sane
verified_by:
  - "fee.4_ceiling / fee.5_floor clamp on both sides"
  - "fee.bounds_sane: load-time guard exists in the exec source"
  - "fee never leaves the declared [MIN_FEE, MAX_FEE] envelope across a wide sweep"
---

## Context

The fee is clamped to a maximum of 5,000 cents and a minimum of 30. Applying two
clamps requires an order, and the two orders differ if the bounds ever cross.

## Decision

Ceiling first, then floor, as a single if/else-if chain. The `else` matters: it
makes the two clamps mutually exclusive, so the result is always inside the
envelope for any `MIN <= MAX`.

## Consequences

- The fee is provably within [30, 5000] for every input, asserted by sweeping the
  full amount range against every currency and flag combination.
- If someone later configures `MIN > MAX`, the ceiling would win — an arbitrary
  outcome. That gap is now closed: the module **refuses to load** if
  `MIN_FEE > MAX_FEE`, throwing at require time rather than silently clamping
  wrong. An incoherent fee table is a bad program, not bad data, so it is an
  exception and not a status code — the same split [[0005]] draws. When fee
  tables become per-tenant configuration rather than compile-time literals, this
  guard must move to wherever the table is loaded.

## Alternatives rejected

- **Nested `Math.min`/`Math.max`.** Equivalent for sane bounds and arguably
  clearer. The branch form is what the exec unit uses and what the intent
  documents. Usefully, the idiomatic benchmark implementation deliberately uses the
  `Math.min`/`Math.max` form and is asserted to agree on all 1,000,000 records,
  which makes this a genuine cross-check rather than a restatement.

## Notes

At the top tier a 1,000,000-cent payment produces a raw fee of 12,000 before
clamping, so the ceiling is not an edge case — it is the common path for large
payments. The boundary is exact: 262,105 cents yields 4,999 and 262,106 yields
5,000. Both are asserted, along with 262,158, which produces 5,001 raw and must
clamp down.
