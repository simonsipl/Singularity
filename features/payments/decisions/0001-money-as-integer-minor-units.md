---
id: 0001
title: Money is integer minor units, never a float
status: accepted
date: 2026-07-30
feature: payments
workflow: bulk-settlement
rules:
  - fee.rounding
  - balance.debit_total
  - aggregate.precision
verified_by:
  - "aggregate.precision: totals above 2^31 stay exact in the Float64 slots"
  - "fee.differential: inlined loop math === computeFee === spec re-derivation"
---

## Context

Fees are percentages of an amount. The obvious implementation multiplies by 0.029
and stores the result as a float. Binary floating point cannot represent 0.01
exactly, so repeated fractional arithmetic accumulates drift. Over a million
records that drift becomes real money that either appears or vanishes, and a
ledger that does not balance is worse than a slow one.

## Decision

All monetary values are integers counting the smallest currency unit (cents).
Rates are basis points. Every division truncates toward zero. No monetary value is
ever stored, transported, or computed as a fractional number.

Running totals are the one exception to "integer storage": they live in
`Float64Array` slots because a batch total exceeds 2^31. That is safe because a
`Float64` represents every integer exactly up to 2^53 — it is being used as a
53-bit integer, not as a fraction.

## Consequences

- Fee arithmetic is exactly reproducible across machines and across languages.
- `(x / 10000) | 0` is valid only for non-negative operands whose result fits in
  int32. Both hold here and are asserted, but this is a real trap for anyone
  extending the fee table with larger amounts or negative adjustments.
- Amounts are capped at 50,000,000 cents partly so intermediate products stay well
  inside the safe range.
- Anyone integrating over an API boundary must agree that the wire format is minor
  units. A JSON payload containing an amount of 3.50 is a bug, not an input.

## Alternatives rejected

- **Floats with rounding at the boundary.** Drift still accumulates inside the
  batch before any rounding happens, and the error depends on record order.
- **A decimal library.** Correct, and far slower — it reintroduces object
  allocation per operation, which is exactly what this framework exists to avoid.
- **BigInt.** Exact, but allocates and is substantially slower than small-integer
  arithmetic. Unnecessary when values fit comfortably in 32 bits.

## Notes

The tier table's flat components (30, 25, 20) are also cents. Changing the cap or
adding a tier above 1,000,000 requires rechecking that amount times bps stays
under 2^31 before the truncation.
