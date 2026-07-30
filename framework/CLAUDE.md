# <project name>

Built on Singularity: an AI-native backend approach. Humans write declarative
contracts. The model compiles them to procedural, TypedArray-backed execution
units tuned for V8's optimizing tier.

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
node bin/singularity.js layout <workflow>
```

`check` runs three gates: **drift** (does each exec's `intent-sha256` stamp match
its intent?), **verify** (every assert suite), **decisions** (does every rule have
recorded rationale?).

## Current workflows

| Feature | Workflow | Rules | Checks |
|---|---|---|---|
| (framework) | `arena` runtime | — | 23 |
| (framework) | `ingest` runtime | — | 20 |

*(none yet — see [framework README](README.md) for the first-feature walkthrough)*

## Invariants

- Never add logic to an `*.intent.ts` file.
- Never modify an `*.exec.js` without re-running its assert suite.
- Exec units **declare** memory layout via `defineArena`; they never compute byte
  offsets or construct views by hand. Enforce this in every assert suite.
- Money is integer minor units. Rates are basis points, truncating division.
- Never report a speedup without asserting output equivalence first.
- A new or changed rule needs a decision record or an explicit waiver.
- Recompiling an exec means re-stamping its `intent-sha256` header.

## Adding a feature

1. Create `features/<feature>/<workflow>.intent.ts`. 2. `singularity drift` fails
(no exec). 3. Compile the exec, stamp the intent hash. 4. Write the assert suite.
5. `singularity decisions` names rules missing rationale. 6. Write records or
waive explicitly. 7. `singularity check` green.

## Gotchas inherited from the reference project (all bit someone already)

- `new Function` in `src/runtime/arena.js` is deliberate and measured — a
  property-insertion loop deopts to dictionary mode at exactly 20 fields. Do not
  "simplify" it. See `decisions/0006`.
- Single-shot `heapUsed` deltas are not a valid allocation measurement. V8 keeps
  sweeping after `global.gc()` returns. Amortize and print a no-op control.
- Drift is a content hash, not mtime. mtime does not survive `git clone`.
- Order-dependent stages love to look independent. If ordering changes results,
  write the decision record before someone "tidies" it.
- `__proto__`, `constructor` and `Object.prototype` names are reserved in arena
  schemas — in an object literal they corrupt the handle rather than defining a
  field.
- A benchmark baseline must differ from the candidate in exactly one variable,
  each variant needs its own kernel copy, and losses get reported alongside
  wins. The reference project's 13x headline fell to ~1x when a control
  separated layout from allocation style.
- An arena `reset` is O(capacity), not O(batch). Right-size arenas to workloads
  or small batches will lose to a plain loop.
