---
id: 0008
title: A no-show is not a visit, and the no-show rate is measured over bookings
status: accepted
date: 2026-07-30
feature: clients
workflow: visit-profiling
rules:
  - visit.5_no_show
  - visit.count
  - visit.recency_window
  - risk.no_show_rate
  - risk.min_sample
  - risk.unreliable
  - risk.orthogonal
verified_by:
  - "visit.5_no_show: counted separately, no spend, not an attended visit"
  - "risk.no_show_rate: rate is over BOOKED appointments"
  - "risk.min_sample: a tiny sample is never flagged"
  - "risk.orthogonal: a VIP can be flagged UNRELIABLE"
---

## Context

A booked appointment the client did not attend is a real event with real cost to
the salon, but it is not evidence of loyalty. Four questions follow, and none has
a forced answer:

1. Does a no-show count toward `visitCount`?
2. Does it move `lastVisitDay`, and therefore recency and segment?
3. Is the no-show *rate* measured over attended visits or over bookings?
4. Can a client be both a VIP and unreliable?

Get (2) wrong and a client who books six times and attends none looks freshly
engaged. Get (3) wrong and the rate can exceed 100%.

## Decision

A no-show increments `noShowCount` and nothing else. It does not count as a visit,
adds no spend, and **does not move the recency window**. A client with only
no-shows is `NEVER_VISITED`.

The no-show rate is measured over **booked** appointments —
`noShowCount / (visitCount + noShowCount)` — in truncated basis points. That
denominator is the number of times the client took a slot, which is the quantity
the salon actually cares about, and it bounds the rate at 10000 bps by
construction.

The rate is only evaluated once there are at least `MIN_BOOKINGS_FOR_RATE` (4)
bookings. Below that it is not evidence, it is noise: one no-show out of one
booking is 100% and means nothing.

`riskFlags` is **orthogonal to segment**. A client can be a VIP and unreliable at
the same time, because "books often and spends" and "sometimes fails to show" are
independent facts about them.

## Consequences

- A no-show can never make a lapsed client look active. This is the property most
  worth protecting; it is asserted directly.
- Because the recency window ignores no-shows, `lastVisitDay` is genuinely "last
  attended", and any UI must not label it "last appointment".
- The minimum sample means a brand-new client who no-shows once is not flagged.
  That is deliberate, and it does mean a first-time no-show is invisible until
  they have booked four times.
- Segment and risk must be presented as two separate facts. Collapsing them into
  one "customer quality" score would lose exactly the distinction this decision
  exists to preserve.

## Alternatives rejected

- **Count no-shows as visits with zero spend.** Simplest to implement and badly
  wrong: it makes non-attendance look like engagement.
- **Rate over attended visits.** Unbounded — five no-shows and one attendance
  gives 500%.
- **Fold unreliability into the segment enum** (an `UNRELIABLE` segment). Forces a
  false choice between "this person is a regular" and "this person no-shows", when
  both are true and both are actionable.

## Notes

`visitCount` and `noShowCount` are stored separately rather than deriving one from
a total, so the two facts remain independently auditable. The cost is 4 bytes per
client.
