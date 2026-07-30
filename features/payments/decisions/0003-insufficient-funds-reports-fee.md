---
id: 0003
title: A rejected-for-funds payment reports its fee but is not charged
status: accepted
date: 2026-07-30
feature: payments
workflow: bulk-settlement
rules:
  - balance.reject_records_fee
  - balance.check
  - balance.check_boundary
  - balance.no_overdraft
  - balance.settle
  - aggregate.totals_settled_only
verified_by:
  - "balance.reject_records_fee: INSUFFICIENT_FUNDS reports the fee it would have charged"
  - "balance.check_boundary: balance == amount+fee settles to exactly zero"
---

## Context

When a payment fails the balance check, the fee has already been computed. Two
questions have no obvious answer: does the output report that fee, and is the
account debited anything at all?

This was an underspecified point in the original request, answered by the compiler
rather than stated by a human. It is recorded here precisely *because* it was an
invented answer, and an integrator could reasonably have assumed the opposite.

## Decision

The computed fee is reported in the output fees array, and **nothing is debited**.
The balance is left byte-identical.

Fees are reported for every record that reaches the fee stage, so a caller can
show the customer what the transaction *would* have cost, and reconciliation can
distinguish "we declined a 4,000-cent payment plus a 95-cent fee" from "we
declined something, amount unknown".

Records rejected *before* the fee stage report exactly 0, so a zero fee
unambiguously means "never priced".

## Consequences

- The fees array is not a record of money moved. Summing it overstates revenue.
  `totalFees` in the stats block is the money-moved figure and covers settled
  records only. This asymmetry is a genuine footgun for anyone reading the fees
  array directly, and it is why the field is documented in the intent.
- The debit is all-or-nothing: amount plus fee, or zero. There is no partial
  settlement, so a balance can never go negative.
- Exactly-sufficient funds settle and leave a zero balance. The comparison is
  strictly less-than, not less-than-or-equal.

## Alternatives rejected

- **Report 0 for insufficient-funds records.** Simpler to aggregate, but throws
  away information the caller needs to explain the decline.
- **Charge the fee anyway.** Some processors do this for failed transactions. It
  requires a business decision this framework should not make silently, and it
  would let a balance be debited on a rejected payment.

## Notes

Flagged to the user at delivery as an invented semantic rather than a specified
one. If the real product wants declined-payment fees, this is the record to
supersede — and doing so changes [[0004]] nothing but changes the meaning of the
fees array for every consumer.
