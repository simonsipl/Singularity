# Singularity

AI-native backend framework. Humans write `src/intents/*.intent.ts` (declarative
contracts, zero logic). The model compiles them to `src/exec/*.exec.js`
(procedural, TypedArray-backed, optimized for V8's TurboFan tier).

**The compiler ruleset lives in [.cursorrules](.cursorrules). Read it in full
before touching anything under `src/exec/`.** It is normative, not advisory.

## Commands

```bash
node tests/payment-processor.assert.js
```

```bash
node --expose-gc --max-old-space-size=6144 tests/benchmark.js
```

## Invariants

- Never add logic to an `*.intent.ts` file.
- Never modify an `*.exec.js` without re-running its `tests/*.assert.js` suite.
- Money is integer minor units. Rates are basis points with truncating division.
