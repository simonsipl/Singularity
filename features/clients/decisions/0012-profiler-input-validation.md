---
id: 0012
title: Spend has an upper bound, and validation order is declared
status: accepted
date: 2026-07-30
feature: clients
workflow: visit-profiling
rules:
  - client.validate_order
  - visit.validate_order
  - visit.4_spend_sane
  - visit.order_independent
  - cadence.definition
  - cadence.same_day
verified_by:
  - "client.validate_order: name > phone > future > duplicate"
  - "visit.4_spend_sane: zero legal, negative and over-cap rejected"
  - "visit.order_independent: shuffling a batch yields identical aggregates"
  - "cadence.definition: truncating mean gap"
  - "cadence.same_day: repeated same-day visits give 0"
---

## Context

Three small choices that each look arbitrary and each have a reason.

**Why cap spend at all.** Rejecting negative spend is obvious. An *upper* bound is
not, and it costs a comparison per visit. But `totalSpend` is a running sum, and
without a per-visit ceiling a single corrupt record — an amount in the wrong units,
a fixture with `Number.MAX_SAFE_INTEGER` — silently poisons the aggregate for the
whole client. A bound turns that into one rejected record with a status code.

**Why declare validation order.** Same reasoning as [[0004]]: a record can violate
several rules at once, and without a declared order the reported error is an
accident of statement order that changes under refactor.

**Why cadence truncates and same-day is legal.** Cadence is a mean gap in whole
days. Several visits on one day give a span of 0 and therefore a cadence of 0. That
is a real answer, not an error — a client who came twice this morning genuinely has
a zero-day gap — but it looks like a missing value, so it is stated.

## Decision

Visit spend must satisfy `0 <= spend <= MAX_VISIT_SPEND` (1,000,000 cents).
Zero is legal: a consultation with no charge is a real attended visit.

Validation runs in a declared order, first failure wins, for both cards
(name, phone, future-dating, uniqueness) and visits (known client, active client,
future-dating, spend, no-show).

`cadenceDays = trunc((lastVisitDay - firstVisitDay) / (visitCount - 1))` for two or
more visits, and 0 otherwise. Integer division, truncating, per [[0001]].

Visit aggregation is commutative — min, max, sum, count — so visits may arrive in
any order within a batch. This is asserted by shuffling a batch and comparing every
derived field, which also guards against someone later introducing an
order-dependent aggregate without noticing.

## Consequences

- The spend cap is a contract, not a guardrail: a genuine 15,000-unit transaction
  is rejected as invalid. If real prices approach the cap, this must be raised
  deliberately, and the running-total precision argument in [[0001]] rechecked.
- The upper bound and the "negative" bound share one status code
  (`NEGATIVE_SPEND`), which is a naming inaccuracy in the enum. Callers cannot
  distinguish "below zero" from "above cap" without inspecting the value. Left as
  is because splitting it is a contract change; noted because the name misleads.
- Order independence for visits contrasts with de-duplication, which is
  deliberately order-*dependent* ([[0009]]). Two adjacent passes with opposite
  properties is a real trap for a reader skimming the code.

## Alternatives rejected

- **No spend ceiling.** One bad record corrupts a client's whole history with no
  signal that anything happened.
- **Clamp out-of-range spend instead of rejecting.** Silently invents revenue.
  Rejecting produces a counted, visible failure.
- **Rounding cadence to nearest rather than truncating.** Marginally more accurate
  and inconsistent with every other division in the framework.
