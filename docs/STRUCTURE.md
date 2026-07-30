# Two structures, one system

Most frameworks make you pick one layout and live with the compromise. MVC groups
by technical role and scatters a feature across four directories. Package-by-
feature groups by domain and fights the framework's conventions. Either way, one
audience loses, because the same files have to serve both the human reading them
and the machine running them.

Singularity does not have that constraint, for one specific reason:

> **Exec units are generated and never read by a human.**

That single fact decouples the two layouts. The human tree can be organised
purely for navigation. The machine tree can be organised purely for execution.
Neither has to compromise, because no file is serving both audiences at once.

## The human tree

Organised by **feature**, then **workflow**. A workflow is an action the business
performs — settle a batch, profile a client's visits — not a technical noun.

```
features/
  payments/
    feature.md                      what this feature is, gotchas, gaps
    bulk-settlement.intent.ts       the contract: 26 declarative rules
    bulk-settlement.assert.js       the verification: 33 adversarial checks
    decisions/
      0001-money-as-integer-minor-units.md
      0002-fee-stage-ordering.md
      ...
  clients/
    feature.md
    visit-profiling.intent.ts
    visit-profiling.assert.js
    decisions/
      0008-no-show-semantics.md
      ...
```

Everything a human needs to understand or change one workflow is in one
directory: what it must do, proof it does it, and why it was built that way.
Nothing is one level up, in a sibling tree, or in a wiki.

Naming is action-first. `bulk-settlement`, not `payment-processor`. Someone
looking for "where do we settle payments" searches for the verb they think in,
not the noun an engineer happened to pick.

## The machine tree

```
src/
  exec/
    bulk-settlement.exec.js         generated, flat
    visit-profiling.exec.js
  runtime/
    arena.js                        shared: schema-driven arena allocator
```

Flat, and deliberately so.

**Directory layout has no effect on runtime performance.** Files do not make V8
faster. There is no cache locality, no branch prediction, no inlining benefit
that depends on which folder a module sits in. Any structure claiming otherwise
is cargo cult.

What *does* vary on the machine side is real, and none of it is a directory:

| Concern | What actually controls it |
|---|---|
| Memory locality | Which fields share an arena, and their declared order |
| Zero-copy sharing | Which workers `attach` to the same `SharedArrayBuffer` |
| Deployment size | Which exec units get bundled into one process |
| Load cost | The `require` graph |

Those are **manifest concerns**, not filesystem concerns. When this repo has more
than one deployment unit, the right answer is a manifest declaring which workflows
share a process and which share an arena — not a directory tree pretending folders
are performance-relevant. That manifest does not exist yet, because there is only
one deployment shape today and inventing unused scaffolding would be worse than
leaving it out.

## What connects them

The two trees are joined by three mechanical links, all checked by the CLI:

**Name.** `features/<f>/<workflow>.intent.ts` compiles to
`src/exec/<workflow>.exec.js`. The CLI resolves the pair by name and fails if
either side is missing.

**Content stamp.** Each exec header carries the SHA-256 of the intent it was
compiled from:

```js
/* SINGULARITY EXEC UNIT — compiled from features/payments/bulk-settlement.intent.ts
 * Verified by features/payments/bulk-settlement.assert.js
 * intent-sha256: e7949f18fcec38d97ddb8c4091643ad0b6b68992bf33fcacebca59269d63f0b7 */
```

`singularity drift` recomputes it and fails on mismatch. This replaced an earlier
mtime comparison, which had a fatal flaw: **mtime does not survive `git clone`**.
Every file gets checkout time, so an mtime check silently passes on a fresh CI
checkout no matter how stale the exec is. A content stamp is correct everywhere
and detects only real changes, not reformatting or a touched file.

**Rule keys.** Decision records point at intent rule keys. `singularity decisions`
cross-references them, reports undocumented rules, and fails on records pointing
at keys that no longer exist.

## Navigating

```bash
node bin/singularity.js map
```

Prints the human view — features, workflows, rule counts, and which decisions
cover them — and finishes by naming the machine view, so nobody has to guess how
the trees relate.

```bash
node bin/singularity.js layout visit-profiling
```

Prints the machine view for one workflow: every field's byte offset, length and
size inside the arena. This exists because layout order is *derived* (widest
element first, for alignment) and no longer matches declaration order — so the
arena cannot be understood by reading the source top to bottom.

## Where framework-wide decisions live

A decision that is not about any single feature lives in the top-level
`decisions/` folder with `scope: framework` instead of `workflow:`. Decision ids
are globally unique across both locations, so `[[0006]]` resolves from anywhere
and the CLI can detect collisions.

## Adding a feature

```
features/<new-feature>/
  feature.md
  <workflow>.intent.ts        <- write this
  <workflow>.assert.js        <- generated, then reviewed
  decisions/                  <- one record per non-obvious choice
```

The CLI discovers it automatically. No registry to update, no index to
regenerate, nothing to remember. `singularity check` will immediately tell you
what is missing: no exec unit, no assert suite, or rules with no recorded
rationale.
