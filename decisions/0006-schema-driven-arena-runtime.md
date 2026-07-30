---
id: 0006
title: Arena layout is declared and generated, not hand-written
status: accepted
date: 2026-07-30
module: payment-processor
rules:
  - exec.soa
  - exec.zero_alloc
  - exec.reentrant
verified_by:
  - "handles from one schema share a V8 hidden class (%HaveSameMap)"
  - "handles keep fast properties past the 20-field dictionary threshold"
  - "SECURITY: injection through every interpolated path is rejected"
  - "exec delegates memory layout to the runtime rather than hand-rolling it"
---

## Context

The first version of the payment exec unit computed nine byte offsets by hand.
That is where the dangerous bugs live: a wrong offset silently overlaps two
fields, a misaligned offset throws only for certain dim values, and a forgotten
zero-fill in reset produces results that are correct on the first batch and wrong
on the second. Every new module would have duplicated it.

## Decision

Exec units declare their memory layout as a schema. `src/runtime/arena.js` derives
offsets, orders fields widest-element-first for alignment, and generates the handle
factory, the reset function, and `attach`.

**Handles are built by `new Function`.** This is the load-bearing part of the
decision, and the part most likely to be "cleaned up" by someone who does not know
why it is there.

Measured on Node v24.13.1 with `--allow-natives-syntax`: building a handle by
inserting properties in a loop produces the same hidden class per schema — but V8
moves the object into **dictionary mode at exactly 20 properties**. Dictionary mode
makes every property access a hash lookup and is the permanent deopt this framework
exists to avoid. A generated single object literal keeps fast properties at 64+
fields. The 13-field payment ledger is fine either way; a domain arena with 30
parallel field arrays is not.

## Consequences

- New modules declare fields and get alignment, offsets, reset, and zero-copy
  `attach` for free. `attach` is what makes worker fan-out possible at all.
- Codegen is a code-injection surface, so it is hardened in four layers: strict
  identifier validation on every interpolated token, a closed type table,
  tokenising the generated source against an allowlist before evaluating it, and
  adversarial tests that attempt injection through every interpolated path.
- `new Function` is unavailable under a strict CSP without `unsafe-eval`. This does
  not affect Node, but it constrains a future browser build and interacts with the
  cross-origin isolation constraint already documented in the README.
- Layout order no longer matches declaration order. Reading raw bytes requires
  `singularity layout <module>` rather than reading the source top to bottom.

## Alternatives rejected

- **Property-insertion loop.** No codegen and no injection surface, but silently
  deopts at 20 fields. Rejected on the measurement, not on principle — and if a
  future V8 removes that cliff, this decision should be revisited.
- **Hand-written offsets per module.** What we had. Correct once, then duplicated
  and wrong.
- **A fixed maximum field count with a hand-written literal.** Caps the domain
  model to fit an implementation detail.

## Notes

`__proto__` was initially accepted as a field name because it satisfies the
identifier regex. In an object literal, `__proto__` *sets the prototype* instead of
defining a property, so the field silently vanished from the handle (absent from
`Object.keys`) and the handle's prototype became a TypedArray. Found by the
adversarial test, not by review. `__proto__`, `constructor`, `prototype`, and the
`Object.prototype` methods are now reserved everywhere in a spec.
