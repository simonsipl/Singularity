# Singularity

AI-native backend framework. Humans write `src/intents/*.intent.ts` (declarative
contracts, zero logic). The model compiles them to `src/exec/*.exec.js`
(procedural, TypedArray-backed, optimized for V8's TurboFan tier).

**The compiler ruleset lives in [.cursorrules](.cursorrules). Read it in full
before touching anything under `src/exec/` or `src/runtime/`.** It is normative,
not advisory.

## Commands

The CLI is the enforcement surface. Exit 0 means the repo is committable.

```bash
node bin/singularity.js check
```

```bash
node bin/singularity.js layout payment-processor
```

```bash
node --expose-gc --max-old-space-size=6144 tests/benchmark.js
```

`check` runs three gates: **drift** (is any exec older than its intent?),
**verify** (every `tests/*.assert.js`), **decisions** (does every intent rule
have recorded rationale?).

## Layout

| Path | Role |
|---|---|
| `src/intents/*.intent.ts` | Declarative contracts. The only files a human edits. |
| `src/exec/*.exec.js` | Generated. Never hand-edit; regenerate from the intent. |
| `src/runtime/arena.js` | Schema-driven arena allocator. Owns all offset math. |
| `tests/*.assert.js` | Loopback suites. Adversarial by requirement. |
| `tests/_source-lint.js` | Shared ruleset lint used by the suites. |
| `decisions/*.md` | Why non-obvious choices were made. See `docs/DECISIONS.md`. |
| `bin/singularity.js` | CLI. |

## Invariants

- Never add logic to an `*.intent.ts` file.
- Never modify an `*.exec.js` without re-running its `tests/*.assert.js` suite.
- Exec units **declare** memory layout via `defineArena`; they never compute byte
  offsets or construct views by hand. Both are enforced by the assert suite.
- Money is integer minor units. Rates are basis points with truncating division.
- Never report a speedup without asserting output equivalence first.
- A new or changed intent rule needs a decision record or an explicit waiver.
  `singularity decisions` will tell you which.

## Adding a feature

1. Edit the intent. 2. `singularity drift` fails. 3. Recompile the exec.
4. Extend the assert suite. 5. `singularity decisions` names any rule missing
rationale. 6. Write the record or waive it. 7. `singularity check` green.

## Gotchas that have already bitten

- `new Function` in `src/runtime/arena.js` is deliberate and measured — a
  property-insertion loop deopts to dictionary mode at exactly 20 fields. Do not
  "simplify" it. See `decisions/0006`.
- Single-shot `heapUsed` deltas are not a valid allocation measurement. V8 keeps
  sweeping after `global.gc()` returns. Amortize over many batches and print a
  no-op control.
- The fee stages are order-dependent and look independent. See `decisions/0002`.
