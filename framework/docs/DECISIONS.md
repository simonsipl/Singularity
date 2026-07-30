# Decision records

## The gap this fills

A Singularity project has three artifacts and, without this system, only two
kinds of knowledge:

| Artifact | Answers |
|---|---|
| `*.intent.ts` | **what** the rules are |
| `*.exec.js` | **how** they are executed |
| `*.assert.js` | **that** the rules hold |

Nothing answers **why**. That gap is worse in an AI-compiled codebase than in a
hand-written one, because the model makes dozens of micro-decisions per module
that no human ever consciously made — and the generated code, being deliberately
unreadable, cannot be read for intent.

A concrete example from the reference project: its fee pipeline applies an FX
surcharge *before* a priority surcharge. That ordering was worth 38 cents on a
50,000-cent payment. Both orderings look correct in the source; the conditionals
look independent and are not. Without a record, the first engineer to "tidy up"
four independent-looking `if` statements silently changes what customers are
billed.

## Format

One file per decision. Records live with the feature they belong to:

```
features/<feature>/decisions/NNNN-kebab-title.md   <- feature-scoped
decisions/NNNN-kebab-title.md                     <- framework-wide
```

Ids are globally unique across both, so `[[NNNN]]` resolves from anywhere and the
CLI detects collisions. Copy [`_template.md`](../decisions/_template.md).

```yaml
---
id: 0002                      # unique, zero-padded, never reused
title: Short imperative statement
status: accepted              # proposed | accepted | superseded
date: YYYY-MM-DD
feature: <feature>            # human-navigable grouping
workflow: <workflow>          # which intent this belongs to
#  for a framework-wide record use `scope: framework` instead
rules:                        # intent rule keys this decision explains
  - fee.order
waives:                       # rule keys that need no rationale, reason in prose
verified_by:                  # assert-suite check names that lock it in
  - "exact check name from the suite"
supersedes:                   # id of the record this replaces
---
```

Body sections: **Context**, **Decision**, **Consequences**, **Alternatives
rejected**, **Notes**. Cross-reference other records with `[[NNNN]]`.

Two rules about content:

- **Consequences must include the unpleasant ones.** A record listing only
  upsides is marketing, not a decision log.
- **"We didn't consider alternatives" is a valid entry.** It is more honest than
  inventing three rejected options after the fact.

## The mechanical part

`rules:` is not decoration. The CLI cross-references it against the rule keys
actually present in each intent:

```bash
node bin/singularity.js decisions
```

This gives three enforcement properties that a `docs/` folder does not:

1. **Undocumented rules are surfaced, not forgotten.** Add a rule to an intent
   and it appears as a warning until someone records why it exists.
2. **Stale decisions fail loudly.** Rename a rule key and every record still
   pointing at the old name is reported as referencing an unknown rule. Without
   this, decision logs rot silently, which is why most of them are worthless
   within a year.
3. **Coverage is a number.** It can gate a build — and `check` runs it on the
   same footing as the test suites.

## When a decision is required

Write one when the answer was **not forced**. Ask: *if a competent engineer
reimplemented this from the intent alone, could they reasonably produce something
different and still satisfy every rule?* If yes, the choice needs a record.

Required:

- Ordering that changes results (stage sequences, validation precedence, clamp
  order)
- Semantics the intent did not specify, that the compiler invented
- Representation choices with correctness implications (integer cents over
  floats)
- Performance choices that constrain future work (codegen over property loops)
- Anything where the obvious implementation is wrong for a non-obvious reason

Not required — waive these:

- Restatements of a business rule already spelled out in the intent
- Language mechanics with one sensible spelling
- Anything a reader would find self-evident from the rule text

Waiving is a first-class outcome: a record with `waives:` entries and a one-line
reason per group in the prose. It is better than a padded record nobody reads,
and it makes "considered and dismissed" distinguishable from "nobody looked".

## Workflow when adding a feature

```
1. Edit the intent          add or change rules
2. singularity drift        fails: intent hash no longer matches the exec stamp
3. Recompile the exec       AI regenerates from the changed intent, re-stamps
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

Run `node bin/singularity.js map` for the live index. A fresh project starts
with one framework-scoped record: [0006](../decisions/0006-schema-driven-arena-runtime.md),
which ships with the arena runtime it justifies.
