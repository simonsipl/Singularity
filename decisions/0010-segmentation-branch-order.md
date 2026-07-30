---
id: 0010
title: Lapsed outranks VIP in the segmentation ladder
status: accepted
date: 2026-07-30
module: client-profiler
rules:
  - segment.order
  - segment.1_never
  - segment.2_lapsed
  - segment.3_vip
  - segment.4_regular
  - segment.5_at_risk
  - segment.6_new
  - segment.recency_definition
  - segment.inactive_unsegmented
verified_by:
  - "segment.2_lapsed outranks VIP: heavy history but long gone"
  - "segment.2_lapsed: boundary at LAPSED_AFTER_DAYS"
  - "segment.3_vip: both boundaries"
  - "segment.4_regular: both boundaries"
  - "segment.inactive_unsegmented: rejected clients stay UNSEGMENTED"
---

## Context

Segments are defined by overlapping predicates. A client with 50 visits whose last
visit was 400 days ago satisfies "has a lot of visits" and "has not been seen in
over a year" simultaneously. Which label they get is a business decision that
determines what the marketing system does with them, and any ordering of the
branches produces a self-consistent-looking result.

## Decision

Branches are evaluated in a fixed ladder, first match wins:

1. `visitCount == 0` -> NEVER_VISITED
2. `recency > 365` -> LAPSED
3. `visits >= 12 && recency <= 60` -> VIP
4. `visits >= 4 && recency <= 120` -> REGULAR
5. `recency > 120` -> AT_RISK
6. otherwise -> NEW

**Recency dominates history.** A former VIP who has not appeared in over a year is
LAPSED, not VIP. The reasoning: the segment answers "what should we do about this
person now", and the answer for someone gone a year is a win-back campaign, not a
loyalty perk. Treating them as a VIP would also inflate the VIP count with people
who have effectively left, which is the exact number a salon owner would use to
judge the business.

`NEVER_VISITED` is checked first because recency is meaningless without a visit —
`lastVisitDay` is 0 for such a client, which would compute an enormous recency and
misclassify them as LAPSED.

Clients that are not ACTIVE stay UNSEGMENTED and are excluded from every segment
count, so the histogram sums to `activeClients` rather than to the input length.

## Consequences

- The VIP count is a count of *currently* engaged high-frequency clients. That is
  the useful definition, and it means the number can drop without anyone churning
  in the billing sense.
- A won-back client transitions LAPSED -> NEW on their next visit, not straight
  back to VIP, because branch 3 requires recency <= 60 and they now have one recent
  visit against a large history. They will climb back to VIP on the next visit,
  since `visitCount` is cumulative. This transient NEW is a little surprising and
  is called out here rather than discovered later.
- Reordering these branches is a business change, not a refactor. The ladder looks
  like an ordinary if/else chain and is not.
- Thresholds are compile-time constants. Making them per-tenant configurable is a
  real future requirement and would need bounds validation, which does not exist.

## Alternatives rejected

- **VIP outranks LAPSED** (history dominates recency). Keeps loyal customers
  labelled loyal forever, which makes the segment useless for deciding what to do
  next and quietly inflates VIP counts with departed clients.
- **A composite RFM score with thresholds.** More expressive and much harder to
  explain to the salon owner who has to act on it. Rejected on explainability, not
  on performance.
- **Separate orthogonal flags instead of one enum** (engaged / frequent / lapsed).
  Strictly more information, but every consumer then has to re-derive a single
  label, and they would each do it differently.

## Notes

Boundaries are inclusive-exclusive as written and all six are asserted on both
sides: exactly 365 days is *not* lapsed, exactly 366 is; exactly 12 visits at
exactly 60 days recency *is* VIP; one visit fewer or one day staler is REGULAR.
