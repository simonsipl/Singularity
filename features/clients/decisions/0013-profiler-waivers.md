---
id: 0013
title: Rules in visit-profiling that need no rationale
status: accepted
date: 2026-07-30
feature: clients
workflow: visit-profiling
waives:
  - pipeline.stages
  - pipeline.replayable
  - client.1_name_present
  - client.2_phone_plausible
  - client.3_not_future
  - client.accept
  - visit.1_client_known
  - visit.2_client_active
  - visit.3_not_future
  - visit.recency_window
  - aggregate.client_counts
  - aggregate.visit_counts
  - aggregate.spend
  - aggregate.segment_counts
  - exec.soa
  - exec.declared_layout
  - exec.no_throw
  - exec.zero_alloc
---

## Context

Not every rule earns a decision record. Padding the log with restatements of
self-evident rules makes the genuinely dangerous records
([[0008]], [[0009]], [[0010]]) harder to find, which defeats the purpose.

Waiving is a first-class outcome and is recorded explicitly so that "no rationale"
is a considered position rather than an oversight. Each rule below is waived for a
stated reason.

## Decision

The rules listed in `waives` need no separate rationale.

**Plain validation, no ambiguity.** `client.1_name_present`,
`client.2_phone_plausible`, `client.3_not_future`, `client.accept`,
`visit.1_client_known`, `visit.2_client_active`, `visit.3_not_future`. A competent
engineer reimplementing from the rule text would produce the same behaviour. The
*ordering* between them is not obvious and is covered by [[0012]]; the individual
checks are.

**Mechanical bookkeeping.** `aggregate.client_counts`, `aggregate.visit_counts`,
`aggregate.segment_counts`, `visit.recency_window`. These are partition and
min/max invariants with one sensible reading. They are heavily asserted because
they are easy to *break*, not because they are hard to *decide*.

**Framework-standard, decided elsewhere.** `pipeline.stages`,
`pipeline.replayable`, `exec.soa`, `exec.declared_layout`, `exec.zero_alloc` follow
from [[0006]]. `exec.no_throw` follows from [[0005]]. Restating them per module
would duplicate the rationale and let the copies drift.

**One borderline case, waived deliberately.** `aggregate.spend` requires a Float64
slot for totals past 2^31. That is a real constraint, but it is the same constraint
as [[0001]] and is documented there. Recorded here so the omission is visible.

## Consequences

- Coverage reaches 100% honestly. A reader can tell "considered and waived" from
  "nobody looked", which is the distinction a coverage number is worthless without.
- If any waived rule later becomes contentious — most likely `client.3_not_future`,
  once appointments can be booked in advance and back-dated by staff — the fix is
  to remove it from this list and write a real record. The CLI will then report it
  as undocumented until someone does.

## Notes

This record deliberately has no `rules:` key. It waives rather than explains, and
the CLI counts the two separately so a reader can see at a glance how much of the
contract is reasoned versus dismissed.
