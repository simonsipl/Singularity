# Singularity — bootstrap kit

This directory is the framework, extracted. Copy its contents into an empty
repository and you have a working Singularity project: the compiler ruleset, the
arena runtime with its test suite, the enforcement CLI, the decision-record
system, and a skeleton feature to start from. Zero npm dependencies; Node 18+.

The reference project this kit was extracted from (two shipped workflows,
benchmarks, and the audit trail that produced the ruleset's benchmark
discipline) lives one directory up: https://github.com/simonsipl/Singularity

## Bootstrap

Copy **including dotfiles** — `.cursorrules` is the compiler's brain and
missing it silently degrades every future generation.

```bash
cp -r framework/. /path/to/new-project/
```

PowerShell:

```bash
Copy-Item -Recurse -Force framework\* , framework\.cursorrules , framework\.gitignore , framework\.gitattributes C:\path\to\new-project\
```

Then, in the new project:

```bash
node bin/singularity.js check
```

Expected on a fresh copy: **clean**, with a warning that no workflows exist yet.
The arena runtime's 23-check suite runs and must pass; if it does not, your copy
is incomplete.

## What you copied

| Path | What it is |
|---|---|
| `.cursorrules` | The compiler ruleset. Normative. The AI reads this before generating any exec unit. |
| `bin/singularity.js` | CLI: `map` / `verify` / `drift` / `decisions` / `layout` / `check`. Exit 0 = committable. |
| `src/runtime/arena.js` | Schema-driven arena allocator. Owns all byte-offset math. Do not "simplify" its `new Function` — see `decisions/0006`. |
| `src/exec/` | Where generated execution units land. Flat, machine-only. |
| `features/` | Where humans work: one directory per feature, holding intents, assert suites, and decision records. |
| `features/_example/` | A skeleton feature. The `_` prefix hides it from the CLI; rename to activate. |
| `decisions/` | Framework-wide decision records. `0006` ships with the runtime it justifies. |
| `docs/STRUCTURE.md` | Why there are two trees (human vs machine) and what actually links them. |
| `docs/DECISIONS.md` | The decision-record format and the coverage enforcement workflow. |
| `tests/_source-lint.js` | Shared ruleset lint used by every assert suite. |
| `tests/arena.assert.js` | The runtime's own suite — 23 checks including adversarial codegen injection. |

## Your first feature

1. Copy `features/_example/` to `features/<feature>/` and rename the intent to
   `<workflow>.intent.ts` (action-first names: `bulk-settlement`, not
   `payment-processor`). Remove the `_` so the CLI sees it.
2. Fill in the contract: types, tunable constants, and `rules:` as
   `"key: prose"` strings. **No logic.** An intent with an `if` in it is a
   compiler error.
3. `node bin/singularity.js drift` — fails: no exec unit. Good.
4. Have the AI compile it: point it at `.cursorrules` and the intent. It emits
   `src/exec/<workflow>.exec.js` declaring its memory layout via `defineArena`,
   and stamps the header with `intent-sha256: <sha256 of the intent file,
   LF-normalised>`.
5. Write (or have the AI write, then review) `features/<feature>/<workflow>.assert.js`.
   The ruleset's §6 says what it must cover: both sides of every boundary, every
   error state in isolation, precedence between error states, replay
   determinism, and adversarial garbage.
6. `node bin/singularity.js decisions` — names every rule with no recorded
   rationale. Write records for the choices that were not forced; waive the
   rest explicitly (see `docs/DECISIONS.md`).
7. `node bin/singularity.js check` — green means committable.

## Benchmarking, when you get there

This kit ships no benchmark files — they are workload-specific — but the
ruleset's §7 is binding when you write one: assert output equivalence before
timing, isolate exactly one variable per comparison, give each measured variant
its own kernel copy, and report where your code *loses* with the same prominence
as where it wins. The reference project's `tests/benchmark-matrix.js` is the
worked example, and it exists because the project's original headline number did
not survive those rules.

## Invariants (short form — CLAUDE.md has the full list)

- Never add logic to an `*.intent.ts`.
- Never modify an `*.exec.js` without re-running its assert suite.
- Exec units declare memory layout via `defineArena`; they never compute byte
  offsets by hand.
- Money is integer minor units; rates are basis points, truncating division.
- A new or changed rule needs a decision record or an explicit waiver.
- Recompiling an exec means re-stamping its `intent-sha256` header.
