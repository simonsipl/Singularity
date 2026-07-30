---
id: 0015
title: JSON is scanned straight into the arena, and the count is the commit point
status: accepted
date: 2026-07-30
scope: framework
verified_by:
  - "equivalence: matches JSON.parse + manual pack over a large batch"
  - "ingest allocates ~nothing per record (amortised, vs JSON.parse)"
  - "fractional values are REJECTED, never rounded (decision 0001)"
  - "unknown keys are REJECTED as contract drift, not ignored"
  - "ingest is NOT atomic: a throw may leave partial rows, so read nothing"
---

## Context

README §3.3 names the boundary where an adoption most often loses its win: a
service that runs `JSON.parse` and then packs the resulting objects into the
arena has allocated a million objects to save arithmetic it was not spending.
The arena's memory advantage is destroyed before the exec unit runs.

Closing that gap needs a scanner that reads the payload straight into typed
arrays without materialising a record object.

## Decision

`src/runtime/ingest.js` scans a flat JSON record array directly into parallel
typed arrays. `makeIngester(fieldNames)` precomputes per-field character codes
once; `ingest(str, views, capacity)` then walks the string by char code and
writes each value into its view. No record object, no per-record string, no
per-record allocation — the only scratch is one `Float64Array` sized to the
field count, allocated when the ingester is built.

Three deliberate refusals, because a boundary is the right place to enforce a
contract:

- **Fractional values throw.** Money is integer minor units ([[0001]]). A
  payload containing `3.50` is a bug in the producer; rounding it here would
  silently invent or destroy money.
- **Unknown keys throw.** An unrecognised field is a typo or contract drift, not
  data to ignore. Ignoring it is how a renamed field silently becomes zero.
- **Strings, nulls, booleans and nesting throw.** The supported grammar is
  deliberately narrow.

**The returned count is the commit point.** The scan is single-pass, so records
before a fault are already written when the throw happens. On success exactly
`[0, count)` is meaningful and anything beyond is stale — the same rule an
under-filled arena already follows. On throw there is no count, so the caller
must treat the whole payload as rejected and read nothing.

## Consequences

- **It is slower than `JSON.parse`, not faster.** Measured on 200,000 records
  (13.4 MB): 199 ns/record versus 166 ns for parse-then-pack — **0.83x**. V8's
  parser is native C++ and hand-written JavaScript does not beat it on raw
  throughput. This is not a speed optimisation and must never be sold as one.
- **It allocates 668x less**: 10.5 KB per call versus 6.87 MB. That is the
  entire point. Megabytes of per-batch garbage is what drives GC pauses and tail
  latency, which is the cost this framework actually reduces.
- Non-atomicity is a real footgun. A caller that catches the throw and then
  reads the views will see partial data. The contract is stated in the module
  header and pinned by a test so nobody "fixes" it into a silent partial-accept.
- The narrow grammar means real-world payloads often need a normalising proxy
  upstream. This is not a general JSON parser and should never grow into one —
  the moment it needs strings and nesting, `JSON.parse` is the better tool.
- Field names are matched by scanning the field list per key. With five fields
  that is trivial; with fifty it would want a perfect-hash or trie. Not built.

## Alternatives rejected

- **`JSON.parse` then pack.** The status quo. Faster to write, correct, and
  allocates 6.87 MB per batch — the exact cost the arena exists to avoid.
- **A streaming parser over a `Buffer` / byte stream.** Would avoid holding the
  whole payload as a string and is the right answer for genuinely large inputs,
  but it is a much bigger piece of machinery. String-based was chosen as the
  smallest thing that closes the documented gap.
- **Generating a bespoke parser per schema via codegen** (as the arena runtime
  does for handles). Plausible and probably faster, but it adds a second codegen
  surface to harden. Not justified until the per-key scan is shown to matter.

## Notes

The honest summary is the same shape as this project's headline finding: the
gain is allocation, not speed. It is listed here rather than in the README's
performance tables because a reader skimming for speedups would otherwise
mis-read a 0.83x as a regression to fix, when it is the intended trade.
