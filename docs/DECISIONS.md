# Decision records

## The gap this fills

The framework has three artifacts and, until now, only two kinds of knowledge:

| Artifact | Answers |
|---|---|
| `*.intent.ts` | **what** the rules are |
| `*.exec.js` | **how** they are executed |
| `*.assert.js` | **that** the rules hold |

Nothing answered **why**. That gap is worse in an AI-compiled codebase than in a
hand-written one, because the model makes dozens of micro-decisions per module
that no human ever consciously made — and the generated code, being deliberately
unreadable, cannot be read for intent.

A concrete example from the reference module. The fee pipeline applies the FX
surcharge *before* the priority surcharge. That ordering is worth 38 cents on a
50,000-cent EUR priority payment. Both orderings look correct in the source. The
only reason it is discoverable is a test that happened to assert the number, and
the only reason it is *justified* is [0002](../decisions/0002-fee-stage-ordering.md).

Without that record, the first engineer to "tidy up" four independent-looking
conditionals silently changes what customers are billed.

## Format

One file per decision, `decisions/NNNN-kebab-title.md`, frontmatter plus prose.
Copy [`_template.md`](../decisions/_template.md).

```yaml
---
id: 0002                      # unique, zero-padded, never reused
title: Short imperative statement
status: accepted              # proposed | accepted | superseded
date: 2026-07-30
module: payment-processor     # which intent this belongs to
rules:                        # intent rule keys this decision explains
  - fee.order
  - fee.2_fx
waives:                       # rule keys that need no rationale, with reason in prose
verified_by:                  # assert-suite check names that lock it in
  - "fee.3_priority: +50% truncating, applied after FX"
supersedes:                   # id of the record this replaces
---
```

Body sections: **Context**, **Decision**, **Consequences**, **Alternatives
rejected**, **Notes**. Cross-reference other records with `[[0002]]`.

Two rules about content:

- **Consequences must include the unpleasant ones.** A record listing only
  upsides is marketing. [0003](../decisions/0003-insufficient-funds-reports-fee.md)
  names its own footgun: the fees array is not a record of money moved, and
  summing it overstates revenue.
- **"We didn't consider alternatives" is a valid entry.** It is more honest than
  inventing three rejected options after the fact.

## The mechanical part

`rules:` is not decoration. The CLI cross-references it against the rule keys
actually present in each intent:

```bash
node bin/singularity.js decisions
```

```
decisions  (does every intent rule have recorded rationale?)
  payment-processor  26 rules: 26 documented, 0 waived, 0 undocumented
```

This gives three enforcement properties that a `docs/` folder does not:

1. **Undocumented rules are surfaced, not forgotten.** Add a rule to an intent
   and it appears as a warning until someone records why it exists. This is the
   "AI informs you" mechanism — it is a check, not a convention.
2. **Stale decisions fail loudly.** Rename a rule key and every record still
   pointing at the old name is reported as referencing an unknown rule. Without
   this, decision logs rot silently, which is why most of them are worthless
   within a year.
3. **Coverage is a number.** It can gate a build.

## When a decision is required

Write one when the answer was **not forced**. Ask: *if a competent engineer
reimplemented this from the intent alone, could they reasonably produce something
different and still satisfy every rule?* If yes, the choice needs a record.

Required:

- Ordering that changes results (fee stages, validation precedence, clamp order)
- Semantics the intent did not specify, that the compiler invented
- Representation choices with correctness implications (integer cents over floats)
- Performance choices that constrain future work (codegen over property loops)
- Anything where the obvious implementation is wrong for a non-obvious reason

Not required — waive these:

- Restatements of a business rule already spelled out in the intent
- Language mechanics with one sensible spelling
- Anything a reader would find self-evident from the rule text

Waiving is a first-class outcome. `waives:` with a one-line reason in the prose
is a legitimate answer, and better than a padded record nobody reads.

## Workflow when adding a feature

```
1. Edit the intent          add or change rules
2. singularity drift        fails: intent is newer than exec
3. Recompile the exec       AI regenerates from the changed intent
4. Extend the assert suite  new rules need new adversarial checks
5. singularity decisions    warns about any new rule with no rationale
6. Write the record         or waive it, explicitly
7. singularity check        drift + verify + decisions, all green
```

Step 5 is the one that keeps the log alive. It runs on every `check`, so
documentation debt shows up on the same footing as a failing test rather than
accumulating invisibly.

## Superseding

Never edit an accepted decision to say something different — the record of what
was previously believed is the point. Instead:

1. Set the old record's `status: superseded`.
2. Write a new record with `supersedes: <old id>`.
3. Move the `rules:` entries to the new record.

Superseded records are skipped for coverage, so the new record must claim the
rules or they revert to undocumented — which is the correct outcome, because a
rule whose rationale was just withdrawn genuinely needs a new one.

## Current records

| id | title | status |
|---|---|---|
| [0001](../decisions/0001-money-as-integer-minor-units.md) | Money is integer minor units, never a float | accepted |
| [0002](../decisions/0002-fee-stage-ordering.md) | FX surcharge applies before the priority surcharge | accepted |
| [0003](../decisions/0003-insufficient-funds-reports-fee.md) | A rejected-for-funds payment reports its fee but is not charged | accepted |
| [0004](../decisions/0004-validation-precedence.md) | Validation short-circuits in a fixed declared order | accepted |
| [0005](../decisions/0005-status-codes-not-exceptions.md) | The hot procedure never throws; failures are status codes | accepted |
| [0006](../decisions/0006-schema-driven-arena-runtime.md) | Arena layout is declared and generated, not hand-written | accepted |
| [0007](../decisions/0007-fee-clamp-order.md) | The fee ceiling is applied before the floor | accepted |
