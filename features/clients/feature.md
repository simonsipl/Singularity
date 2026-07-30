# Clients

Client cards and what their appointment history says about them. Who is a
regular, who is drifting, who books and does not turn up.

## Workflows

| Workflow | What it does | Status |
|---|---|---|
| [`visit-profiling`](visit-profiling.intent.ts) | Register cards, fold visit history, segment by frequency and recency | shipped |

## visit-profiling

The nightly pass. Three stages over one arena:

1. **Register cards** — validate name, phone shape and creation date, then
   de-duplicate by phone through an open-addressed table inside the arena.
2. **Fold visits** — accumulate attended visits, spend, no-shows and the
   first/last visit window per client.
3. **Segment** — derive cadence, assign a segment, flag unreliable clients.

- Contract: [`visit-profiling.intent.ts`](visit-profiling.intent.ts) — 44 rules
- Verification: [`visit-profiling.assert.js`](visit-profiling.assert.js) — 49 checks
- Compiled to: `src/exec/visit-profiling.exec.js` *(generated — do not read or edit)*
- Try it: `node examples/salon-profiler.demo.js` — 650,000 records in ~16 ms

## Read before changing anything here

- **[0008](decisions/0008-no-show-semantics.md) — a no-show is not a visit.** It
  does not move the recency window. Get this wrong and a client who booked six
  times and attended none looks freshly engaged.
- **[0010](decisions/0010-segmentation-branch-order.md) — lapsed outranks VIP.**
  Recency dominates history, so a former VIP gone a year is LAPSED. The ladder is
  an ordinary-looking if/else chain and reordering it is a business change.
- **[0011](decisions/0011-no-pii-in-the-arena.md) — no personal data in the
  arena.** Only a name length, a digit count and an opaque hash. Adding a name
  field is a one-line schema change that the suite is built to catch.

## All decisions

| id | title |
|---|---|
| [0008](decisions/0008-no-show-semantics.md) | A no-show is not a visit, and the rate is measured over bookings |
| [0009](decisions/0009-open-addressed-dedupe.md) | Phone de-duplication uses an open-addressed table inside the arena |
| [0010](decisions/0010-segmentation-branch-order.md) | Lapsed outranks VIP in the segmentation ladder |
| [0011](decisions/0011-no-pii-in-the-arena.md) | The arena holds no personal data, only shapes and opaque hashes |
| [0012](decisions/0012-profiler-input-validation.md) | Spend has an upper bound, and validation order is declared |
| [0013](decisions/0013-profiler-waivers.md) | Rules that need no rationale (waivers) |

## Known gaps

- The caller supplies `phoneHash`. If it hashes unnormalised input,
  `+44 7700 900123` and `07700900123` are different clients and de-duplication
  silently fails. The framework cannot detect this
  ([0011](decisions/0011-no-pii-in-the-arena.md)).
- **A 32-bit phone hash is too narrow above ~10,000 clients.** Two distinct
  numbers sharing a hash means a real client is wrongly rejected as a duplicate;
  the birthday-problem risk is ~1.2% at 10k clients and **~69% at 100k**. Call
  `collisionRiskFor(n)` to size it. Widening to 64 bits is the fix and is not yet
  implemented ([0009](decisions/0009-open-addressed-dedupe.md)).
- Segment thresholds are compile-time constants. Per-tenant tuning would need
  bounds validation that does not exist.
- ~~`NEGATIVE_SPEND` is also returned for spend above the cap.~~ **Fixed** after an
  external review: over-cap now returns `SPEND_EXCEEDS_MAX` with its own counter
  ([0012](decisions/0012-profiler-input-validation.md)).
