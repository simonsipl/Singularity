# Singularity

AI-native backend framework. Humans write declarative contracts. The model
compiles them to procedural, TypedArray-backed execution units tuned for V8's
optimizing tier.

**The compiler ruleset lives in [.cursorrules](.cursorrules). Read it in full
before touching anything under `src/exec/` or `src/runtime/`.** It is normative.

## Two structures — read [docs/STRUCTURE.md](docs/STRUCTURE.md) first

Exec units are generated and never read by a human, so the human tree and the
machine tree are free to diverge and each is optimised for its own reader.

```
features/<feature>/<workflow>.intent.ts    <- humans navigate here
features/<feature>/<workflow>.assert.js
features/<feature>/decisions/*.md
features/<feature>/feature.md

src/exec/<workflow>.exec.js                <- machines run this, flat, generated
src/runtime/arena.js
```

`src/exec/` is flat on purpose. Directory layout has no effect on runtime
performance; what matters is arena sharing and process bundling, which are
manifest concerns rather than directory concerns.

## Commands

The CLI is the enforcement surface. Exit 0 means committable.

```bash
node bin/singularity.js check
```

```bash
node bin/singularity.js map
```

```bash
node bin/singularity.js layout visit-profiling
```

```bash
node --expose-gc --max-old-space-size=6144 tests/benchmark.js
```

```bash
npm run bench:matrix
```

`check` runs three gates: **drift** (does each exec's `intent-sha256` stamp match
its intent?), **verify** (every assert suite), **decisions** (does every rule have
recorded rationale?).

## Current workflows

| Feature | Workflow | Rules | Checks |
|---|---|---|---|
| payments | `bulk-settlement` | 26 | 33 |
| clients | `visit-profiling` | 43 | 47 |
| (framework) | `arena` runtime | — | 23 |

## Invariants

- Never add logic to an `*.intent.ts` file.
- Never modify an `*.exec.js` without re-running its assert suite.
- Exec units **declare** memory layout via `defineArena`; they never compute byte
  offsets or construct views by hand. Enforced by the assert suites.
- Money is integer minor units. Rates are basis points, truncating division.
- Never report a speedup without asserting output equivalence first.
- A new or changed rule needs a decision record or an explicit waiver.
- Recompiling an exec means re-stamping its `intent-sha256` header.

## Adding a feature

1. Create `features/<feature>/<workflow>.intent.ts`. 2. `singularity drift` fails
(no exec). 3. Compile the exec, stamp the intent hash. 4. Write the assert suite.
5. `singularity decisions` names rules missing rationale. 6. Write records or
waive explicitly. 7. `singularity check` green.

## Gotchas that have already bitten

- `new Function` in `src/runtime/arena.js` is deliberate and measured — a
  property-insertion loop deopts to dictionary mode at exactly 20 fields, and
  `visit-profiling` has 26 handle properties. Do not "simplify" it. See
  `decisions/0006`.
- Single-shot `heapUsed` deltas are not a valid allocation measurement. V8 keeps
  sweeping after `global.gc()` returns. Amortize and print a no-op control.
- Drift is a content hash, not mtime. mtime does not survive `git clone`.
- Fee stages are order-dependent and look independent (`0002`). So is the
  segmentation ladder (`0010`).
- `__proto__`, `constructor` and `Object.prototype` names are reserved in arena
  schemas — in an object literal they corrupt the handle rather than defining a
  field.
- A benchmark baseline must differ from the candidate in exactly one variable.
  The original 13x headline conflated memory layout with allocation style; the
  variable-isolated comparison is `tests/benchmark-matrix.js` (~1–1.5x vs
  disciplined plain JS on full scans, 5–12x under heap entropy). Give each
  variant its own kernel copy or inline caches cross-pollute the numbers.
- `resetLedger` is O(arena capacity), not O(batch). A 10k batch in a 1M-slot
  arena loses to a plain loop (0.67x). Right-size arenas to workloads.
