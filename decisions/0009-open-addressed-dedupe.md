---
id: 0009
title: Phone de-duplication uses an open-addressed table inside the arena
status: accepted
date: 2026-07-30
module: client-profiler
rules:
  - client.4_phone_unique
  - client.dedupe_first_wins
  - exec.dedupe_open_addressing
verified_by:
  - "client.4_phone_unique: duplicate phone rejected, lowest slot wins"
  - "client.4_phone_unique: a rejected card does not claim its phone"
  - "dedupe survives hash collisions (probing, not just masking)"
  - "dedupe detects duplicates that collide with a third hash"
  - "phoneHash 0 is a usable value, not confused with an empty bucket"
  - "a full hash table cannot spin: probe is bounded"
---

## Context

Client cards must be de-duplicated by phone number. The obvious implementation is
`new Map()` or a plain object keyed by the hash. Both allocate per entry and put
the index on the GC heap, which defeats the point of the arena: the whole batch is
supposed to live in one buffer that the collector never scans.

## Decision

De-duplication uses an **open-addressed table with linear probing**, stored as a
`hashSlots` field inside the same arena. Capacity is the next power of two at or
above twice the client capacity, so the table is never more than half full and
probe runs stay short. Bucket selection is `(h ^ (h >>> 16)) & (capacity - 1)` —
a mask, not a modulo.

Three details that are not obvious and each have a test:

- **Slots are stored biased by one.** A bucket holds `clientSlot + 1`, so `0`
  means empty. A freshly allocated arena is zero-filled, so this removes the need
  for a `fill(-1)` pass on every reset — and it makes hash `0` for client slot `0`
  representable, which a naive `0 = empty` scheme silently breaks.
- **The probe is bounded by capacity.** The load factor guarantees a free bucket
  exists, so the bound is unreachable in normal operation; it exists so a
  corrupted arena produces a wrong answer rather than an infinite loop.
- **A rejected card does not claim its phone.** The uniqueness check runs *after*
  the other validations, so an invalid card never reserves a number that a later
  valid card should get.

De-duplication is therefore order-dependent: the lowest slot index with a given
hash wins. That is stated in the contract rather than left as an accident.

## Consequences

- The index costs `hashCapacity * 4` bytes inside the arena and zero heap
  allocations. For 100,000 clients that is 1 MB of the arena, off-heap.
- `reset` must clear `hashSlots`, and it is listed in `clearOnReset`. Forgetting
  it would carry de-duplication state across batches — the exact class of bug the
  replay test exists to catch.
- Collisions are handled by probing, so correctness does not depend on hash
  quality; only performance does. A degenerate hash degrades to a linear scan,
  which the bounded probe makes safe but slow.
- The caller supplies `phoneHash`. The framework never sees the phone number, per
  [[0011]], which means the framework also cannot detect a *bad* hash function.
  Hash quality is the caller's responsibility.

## Alternatives rejected

- **`Map` or plain object.** Allocates per entry, lands on the GC heap, and cannot
  be shared with a worker through the arena.
- **Sort-then-scan for duplicates.** No index memory, but it either mutates input
  order or needs a permutation array, and it makes "lowest slot wins" awkward.
- **Chaining instead of probing.** Needs per-bucket lists, which means allocation.

## Notes

`(h ^ (h >>> 16))` mixes the high bits down before masking. Without it, a hash
function whose low bits are poorly distributed — for example one derived from
sequential ids — would pile every entry into a handful of buckets. The collision
tests deliberately construct hashes that all mask to one bucket to prove probing
works rather than relying on the mixer to hide the problem.
