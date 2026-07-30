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
Neither has to compromise, because no file serves both audiences at once.

## The human tree

Organised by **feature**, then **workflow**. A workflow is an action the business
performs — settle a batch, profile a client's visits — not a technical noun.

```
features/
  <feature>/
    feature.md                      what this feature is, gotchas, known gaps
    <workflow>.intent.ts            the contract: declarative rules, zero logic
    <workflow>.assert.js            the verification: adversarial checks
    decisions/
      NNNN-<kebab-title>.md         why the non-obvious choices were made
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
    <workflow>.exec.js              generated, flat
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

Those are **manifest concerns**, not filesystem concerns. When a project grows
more than one deployment unit, the right answer is a manifest declaring which
workflows share a process and which share an arena — not a directory tree
pretending folders are performance-relevant.

## What connects them

The two trees are joined by three mechanical links, all checked by the CLI:

**Name.** `features/<f>/<workflow>.intent.ts` compiles to
`src/exec/<workflow>.exec.js`. The CLI resolves the pair by name and fails if
either side is missing.

**Content stamp.** Each exec header carries the SHA-256 of the intent it was
compiled from (LF-normalised):

```js
/* SINGULARITY EXEC UNIT — compiled from features/<f>/<workflow>.intent.ts
 * Verified by features/<f>/<workflow>.assert.js
 * intent-sha256: <64 hex chars> */
```

`singularity drift` recomputes it and fails on mismatch. This is a content
stamp, **not mtime**, for a reason learned the hard way: mtime does not survive
`git clone` — every file gets checkout time — so an mtime comparison silently
passes on a fresh CI checkout no matter how stale the exec is.

**Rule keys.** Decision records point at intent rule keys. `singularity
decisions` cross-references them, reports undocumented rules, and fails on
records pointing at keys that no longer exist.

## Navigating

```bash
node bin/singularity.js map
```

Prints the human view — features, workflows, rule counts, and which decisions
cover them — and finishes by naming the machine view.

```bash
node bin/singularity.js layout <workflow>
```

Prints the machine view for one workflow: every field's byte offset, length and
size inside the arena. This exists because layout order is *derived* (widest
element first, for alignment) and does not match declaration order — the arena
cannot be understood by reading the source top to bottom.

## Where framework-wide decisions live

A decision that is not about any single feature lives in the top-level
`decisions/` folder with `scope: framework` instead of `workflow:`. Decision ids
are globally unique across both locations, so `[[NNNN]]` resolves from anywhere
and the CLI detects collisions.

## Adding a feature

```
features/<new-feature>/
  feature.md
  <workflow>.intent.ts        <- write this
  <workflow>.assert.js        <- generated, then reviewed
  decisions/                  <- one record per non-obvious choice
```

The CLI discovers it automatically. No registry to update, no index to
regenerate. `singularity check` immediately reports what is missing: no exec
unit, no assert suite, or rules with no recorded rationale. Directories whose
names start with `_` or `.` are skipped — which is why the bundled
`features/_example/` skeleton is invisible until you rename it.
