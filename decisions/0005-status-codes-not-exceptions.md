---
id: 0005
title: The hot procedure never throws; failures are status codes
status: accepted
date: 2026-07-30
module: payment-processor
rules:
  - exec.no_throw
  - aggregate.counters
  - traversal
verified_by:
  - "exec.no_throw: adversarial garbage produces status codes, never exceptions"
  - "aggregate.counters: settled + rejected === count, one counter per record"
---

## Context

One bad record in a batch of a million must not abort the batch. Exceptions are
also a performance problem here: a `try` block around a hot loop inhibits some V8
optimisations, and throwing allocates.

## Decision

`processBatch` never throws. Every failure writes a status code to the output array
and increments a counter. Exactly one counter is incremented per record, so
`settledCount + rejectedCount === count` is an invariant the suite checks.

Validation of *structure* — a malformed schema, a bad dim value — happens at
`defineArena` and `alloc` time and throws loudly there, at startup, where a crash
is the correct outcome. The split is deliberate: bad data is a status code, a bad
program is an exception.

## Consequences

- A caller must inspect statuses; there is no exception to catch. Ignoring the
  status array silently treats declined payments as settled.
- Garbage input produces a defined status rather than a crash, verified by feeding
  the batch Int32 extremes, 255 in every byte field, and a pre-corrupted negative
  balance.
- Errors are cheap, so a batch that is 100% invalid costs about the same as one
  that is 100% valid — there is no denial-of-service asymmetry between good and
  bad input.

## Alternatives rejected

- **Throw on the first bad record.** Loses the other 999,999 results and makes
  batch size a reliability risk.
- **Collect errors into an array.** Allocates per batch and grows unboundedly with
  hostile input.

## Notes

A negative pre-existing balance can never settle, because the check is
`balance < amount + fee` and amount plus fee is always positive. That falls out of
the arithmetic rather than being special-cased, and is asserted so that a future
change to the comparison cannot quietly permit it.
