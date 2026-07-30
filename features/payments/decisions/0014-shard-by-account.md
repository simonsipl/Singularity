---
id: 0014
title: Parallel execution shards by account, not by index range
status: accepted
date: 2026-07-30
feature: payments
workflow: bulk-settlement
rules:
  - shard.ownership
  - shard.order
  - shard.equivalence
  - shard.stats_isolation
verified_by:
  - "shard.equivalence: any shard count reproduces sequential byte-for-byte"
  - "shard.ownership: every record has exactly one owner, none left PENDING"
  - "shard.stats_isolation: shards never touch the shared stats block"
  - "shard.equivalence holds across real worker_threads (4 workers, 100000 records, zero-copy)"
---

## Context

Settlement mutates account balances in place, and record order matters: rule R1
says a payment sees every earlier payment's effect. That makes the obvious
parallelisation — split the batch into index ranges, one range per worker —
wrong. Two workers holding different ranges will both touch the same account,
racing on a `Float64Array` slot with no atomicity, and the result depends on
thread interleaving. It would *look* fine on small tests and corrupt money under
load.

## Decision

Shard by **account**, not by index range. Worker *k* processes record *i* iff
`accounts[i] % shardCount === k`.

Three properties fall out, and each is why this partitioning was chosen:

- **No shared mutable state.** An account belongs to exactly one shard, so no
  two workers ever write the same balance slot. No locks, no atomics, no
  `Atomics.compareExchange` on the hot path.
- **Order is preserved where it matters.** Each shard still walks indices in
  ascending order, so within any single account the mutation sequence is
  identical to sequential execution. Ordering *across* accounts was never
  observable, because accounts are independent.
- **Equivalence is total, not statistical.** The union of shard outputs is
  byte-identical to `processBatch` for any shard count. Asserted for 1, 2, 3, 4
  and 8 shards over statuses, fees, balances and folded counters — and again
  across real `worker_threads`.

Counters go to a **caller-provided slab**, never `L.stats`. Shards incrementing
a shared `Float64Array` would race; the main thread folds slabs after join. Each
slab is 16 f64 slots (128 B) so two shards never share a cache line.

The unknown-account check moves *after* the ownership test, because a record
whose account is out of range still has a deterministic owner
(`hugeAccount % shards`) and must be rejected exactly once, by that owner.

## Consequences

- **Every shard scans the whole batch** to find its records — `count` iterations
  each, of which roughly `count/shards` do work. Memory traffic therefore grows
  with worker count and scaling is sublinear by construction. Measured on 24
  logical cores: 1.04x at 2 workers, 1.50x at 4, **2.06x at 8**. That is the
  honest ceiling of this design, not a tuning failure.
- A pre-pass building per-shard index lists would avoid the redundant scan, but
  costs a full pass plus `shards` index arrays — and at these ratios it is not
  obviously a win. Not attempted; would need measuring before adoption.
- **Skew is a real risk.** Account-based sharding assumes accounts distribute
  roughly evenly across the modulus. A batch where 90% of records hit one
  account will serialise onto one worker and parallel will be *slower* than
  sequential. No detection or rebalancing exists.
- Worker spawn costs 24–37 ms, far more than a 15 ms batch. Parallel only makes
  sense for a long-lived pool, never per request. The benchmark reports spawn
  and steady-state separately for exactly this reason.
- The main thread must not touch the arena between dispatch and join. Nothing
  enforces this; it is a caller contract.

## Alternatives rejected

- **Index-range sharding.** The obvious approach and silently wrong: concurrent
  unsynchronised writes to the same balance slot.
- **Atomics on balances.** `Float64Array` has no atomic add, and the check-then-
  debit sequence is not atomic anyway — it would need a CAS loop per record,
  which costs more than the parallelism returns.
- **One arena per worker, merged after.** Removes sharing but needs a merge pass
  over balances and re-derives the ordering problem for accounts touched by
  more than one worker.

## Notes

The strongest argument against using this at all: at 8 workers we get 2.06x for
8x the CPU. For a batch that already takes 15 ms, spending 8 cores to save 7 ms
is usually a bad trade — the sequential path is fast enough, and the cores are
worth more elsewhere. This exists because the README claimed zero-copy worker
fan-out was possible; it is now implemented, measured, and its ceiling is
documented so nobody adopts it expecting linear scaling.
