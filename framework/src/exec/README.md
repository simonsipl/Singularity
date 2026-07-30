# src/exec — machine tree

Generated execution units land here, **flat**. One `<workflow>.exec.js` per
intent, compiled by the AI against [.cursorrules](../../.cursorrules), stamped
with the `intent-sha256` of the contract it was compiled from.

Nothing in this directory is written or read by a human. Do not organise it, do
not reformat it, do not review it line-by-line — review the intent, the assert
suite, and the decision records instead. `singularity drift` fails the build if
anything here is stale, and each workflow's assert suite fails it if anything
here is wrong.

Directory layout has no effect on runtime performance. What actually matters —
which fields share an arena, which workers attach to the same buffer, which
units bundle into one process — are manifest concerns, not folder concerns.
See [docs/STRUCTURE.md](../../docs/STRUCTURE.md).
