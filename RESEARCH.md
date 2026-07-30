# Research notes: AI-compiled backend code

**Working through five hypotheses about AI as a compiler, by building the thing
and measuring it.**

Status: exploratory, n=1, single machine. This document is deliberately separate
from [README.md](README.md) — the README documents *what the framework does*,
this documents *what building it taught us about the ideas behind it*.

*Prefer this without the jargon? [RESEARCH-labrador.explanation.md](RESEARCH-labrador.explanation.md)
tells the same story with no computer words in it.*

The point is not to grade the hypotheses. It is to find out **which parts already
work, which parts need something that does not exist yet, and what that missing
thing would have to look like.** Several sections end with a concrete open
problem; if any of them interest you, they are the places where help would move
this furthest. See [§11](#11-where-this-needs-help).

---

## 0. Summary of findings

| # | Hypothesis | Where it stands after building it |
|---|---|---|
| H1 | Humans author intent in a structured, human-readable language | **Works today.** One gap worth closing: rule *keys* are machine-checked, rule *prose* is not. Making arithmetic rules executable would close it |
| H2 | The human layer is "TypeScript for JavaScript" | **The shape is right; three properties are missing.** `tsc` is deterministic, self-verifying and cheap. Get those and the analogy becomes exact |
| H3 | Lower resource usage, better optimisation | **Confirmed for memory, decisively.** CPU needs a different approach than the one tried here — and inference cost belongs in the ledger |
| H4 | AI compilers replace static compilers | **The loop works and compounds.** Three named problems sit between here and replacement, all of them research rather than engineering |
| H5 | Continuously evolving AI apps reshape browsers | **Not tested here.** The interesting finding: browsers are not the blocker. Verification-at-evolution-speed is |

None of these are refutations. Four of the five describe a working mechanism plus
a named missing piece, and the missing pieces are specific enough to work on.

The single most important result is not in the table. It is this:

> **The verification machinery falsified the project's own headline claim.**
> A generated benchmark reported "13x faster". A control added later showed
> ~1x against competently written plain JavaScript. The same discipline also
> surfaced a `__proto__` bug that silently deleted a field, an `O(capacity)`
> reset that made small batches *slower*, and a measurement artifact that
> invented 18 MB of phantom garbage.

Every one of those was found by machinery the AI wrote, pointed at itself by a
human who asked a skeptical question. That interaction — not the code
generation — is what this experiment is actually about.

---

## 1. The artifact

Two production-shaped workflows, compiled from declarative contracts:

| Feature | Workflow | Rules | Checks |
|---|---|---|---|
| payments | `bulk-settlement` | 31 | 39 |
| clients | `visit-profiling` | 43 | 47 |
| framework | arena runtime | — | 23 |
| framework | JSON ingest | — | 18 |
| framework | kit sync | — | 13 |

Composition, in lines:

| Kind | Lines | Note |
|---|---|---|
| Intents (contracts) | 474 | human-authored |
| Decision records | 1,145 | human-reviewed rationale |
| **Generated exec units** | **653** | the actual product |
| Runtime | 506 | shared infrastructure |
| Assert suites + framework tests | 3,546 | verification |

**Verification outweighs generated exec code 5.4 : 1.** Counting contracts and
decision records as well, **82% of the artifact exists to constrain, verify or
explain the code that runs** — treating the shared runtime as product code, which
is the conservative reading. Counting only the generated exec as "product", the
figure is 89%. This ratio is the central economic fact of the approach and is
discussed under [§7](#7-the-cost-nobody-budgets-for).

### Method

Claims were tested by execution, not inspection:

- **Equivalence gating.** No timing was reported before asserting byte-identical
  output against an independent implementation. Applied to every benchmark
  variant and to every parallel shard count.
- **Differential derivation.** The fee suite re-derives the fee arithmetic from
  the contract prose in a deliberately different style, then compares against
  the generated code across a swept input domain. Two independent derivations
  from one contract.
- **Mutation testing.** Boundaries flipped, stage ordering swapped, a reset
  clause removed, arena fields overlapped. 4 of 4 observable mutations were
  caught; 2 survivors were confirmed provably-equivalent mutants.
- **Controls.** Where a measurement was surprising, an instrument was pointed at
  a workload whose answer was known in advance.

### Threats to validity — read before quoting anything here

1. **n=1, one machine, one Node version** (v24.13.1, win32/x64, 24 logical
   cores). No cross-platform, cross-runtime, or multi-repo replication.
2. **The tests were also AI-generated.** This is a circularity. It is partially
   broken by differential derivation and mutation testing, but not eliminated.
3. **The final audit was self-conducted.** An independent agent began a hostile
   review and produced one significant finding (the strawman baseline) before
   hitting an account limit; the remaining probes were run by the same system
   that wrote the code. Mechanical results are replayable by anyone; judgment
   calls are not independent.
4. **Selection effect.** Both workloads are dense integer batch arithmetic —
   the shape most favourable to the technique. No string-heavy, I/O-bound, or
   graph-shaped workload was attempted.
5. **One author, one session.** No evidence about teams, concurrent editing,
   merge conflicts in decision records, or handover to engineers who did not
   write the contracts.

---

## 2. H1 — Humans author intent in a structured, human-readable language

> *"Human creates intent via code understandable by humans — we might use a new
> programming language that is easy to understand yet structured."*

### Where it stands: the readable layer works; one gap is worth closing

The contracts are readable. A non-programmer can follow
`"fee.2_fx: if currency !== USD then fee += trunc(amount * 15 / 10000)"`. Rules
carry stable keys, which makes them addressable by tooling — decision records
point at them, and the CLI fails the build when a record references a key that no
longer exists.

But the implementation revealed something the hypothesis does not anticipate:

**The intent files are TypeScript that never executes.** They declare types and
enums for human and IDE benefit, but the actual contract is an array of strings.
The TypeScript is scaffolding; the strings are the language. What emerged in
practice is a **half-formal DSL wearing TypeScript's clothes.**

That matters because the two halves have different guarantees:

| Part | Machine-checked? |
|---|---|
| Rule *keys* (`fee.2_fx`) | **Yes** — extracted, cross-referenced, coverage-gated |
| Rule *prose* (the actual semantics) | **No** — nothing verifies the exec matches the sentence |

Only the test suite connects prose to behaviour, and the test suite is a separate
artifact that can drift from the prose without any mechanism noticing. If a rule
says "truncating division" and the exec rounds, **nothing fails** unless a test
happens to assert the specific value. In this project such a test existed — by
deliberate design, not by construction.

### What a real intent language would need

The gap suggests concrete requirements the hypothesis should absorb:

1. **Executable semantics for arithmetic rules.** Enough formality that
   `trunc(amount * 15 / 10000)` can be *evaluated* as a reference oracle rather
   than read as a hint. This is the single highest-leverage improvement
   available.
2. **Retention of prose for the rest.** Rules like "the first failure assigns the
   status" are precedence declarations, not arithmetic; forcing them into a
   formal notation costs the readability that motivated the hypothesis.
3. **A distinction the current format lacks:** which rules are machine-verifiable
   and which rest on tests. Today they look identical, so the reader cannot tell
   which guarantees are structural and which are aspirational.

### Falsification test

Write the same contract in three notations — prose-with-keys, a formal DSL, and a
constrained natural language — and give each to engineers who did not author it.
Measure comprehension accuracy and the rate at which each catches a deliberately
introduced semantic error. H1 predicts the structured-but-readable middle wins on
both. This was not attempted.

---

## 3. H2 — The human layer is "TypeScript for JavaScript"

> *"Production code is not readable for humans; the human layer is like
> TypeScript for JavaScript."*

### Where it stands: the right shape, missing three properties

The surface parallel holds: two artifacts, one authored and one generated, one
readable and one not, generated output committed and never hand-edited.

Four properties separate the two, and they are precisely the properties that make
`tsc` trustworthy. Naming them is useful, because each is a thing that could in
principle be built:

| Property | `tsc` | AI compiler (observed) |
|---|---|---|
| **Deterministic** | Same input → identical output, always | Same intent, two runs → different code |
| **Self-verifying** | The type checker *is* the proof | No proof. Correctness rests entirely on a separate test suite |
| **Cheap to re-run** | Milliseconds, free | Expensive inference, non-trivial latency |
| **Semantics-preserving by construction** | Erasure is provably behaviour-preserving | Preservation is *hoped for*, then tested |

The consequence is architectural, not philosophical. Because `tsc` is
deterministic and cheap, you never commit its output and never ask whether it is
stale — you rebuild. Because AI compilation is neither, this project was forced
to invent three mechanisms that have no `tsc` equivalent:

1. **Committed generated output.** The exec units live in git because
   regenerating them is expensive and would produce different code.
2. **Content-stamped drift detection.** Each exec header carries the SHA-256 of
   the intent it came from. (First implemented against mtime — a bug, since mtime
   does not survive `git clone`, so the check silently passed on fresh CI
   checkouts.)
3. **A decision log.** `tsc` needs no record of *why* it emitted particular
   JavaScript. An AI compiler makes semantic choices the contract did not
   specify, and those choices are invisible in unreadable output.

**Until those properties exist, the closer analogy is a build-artifact cache with
a non-reproducible builder** — nearer to a vendored binary dependency than to a
compiler. That is not a criticism of the hypothesis so much as a description of
the work between here and it: make compilation reproducible and give the compiler
its own verification, and "TypeScript for JavaScript" becomes literally accurate
rather than aspirational.

### The circularity, and what partially breaks it

If the AI writes both the code and the tests, the tests may encode the same
misunderstanding. Two mechanisms in this project attack that:

- **Differential derivation.** The fee suite re-derives the arithmetic from the
  contract in a deliberately different style and compares across a swept domain.
  Two derivations sharing a misreading is less likely than one.
- **Mutation testing.** Breaking the code and confirming tests fail measures
  whether the suite has teeth, independent of who wrote it.

Neither eliminates the circularity. **Both are external disciplines applied to
the AI, not properties of it** — which is the recurring finding of this whole
exercise.

---

## 4. H3 — Lower resource usage and better optimisation

> *"This approach might lower usage of resources, better optimisation, and end
> with resources we currently possess being used more efficiently."*

### Where it stands: memory confirmed; CPU needs a different route

This hypothesis had the most data available. It splits cleanly.

**Memory — supported, decisively.**

| Metric | Idiomatic objects | Arena | Ratio |
|---|---|---|---|
| Input residency (1M records) | 144.96 MB, GC-scanned | 18.15 MB, off-heap | **8x** |
| Allocation churn per batch | 210.23 MB | 4.7 KB | **~45,000x** |
| JSON ingest allocation | 6.87 MB/call | 10.5 KB/call | **668x** |

Churn is the load-bearing figure. Eliminating it removes GC pauses from the
latency tail, and interactive fleets are sized for p99, not mean. A model with
stated assumptions puts pod density around 4x on the memory-bound dimension.

**CPU — not from this technique.**

| Comparison | Result |
|---|---|
| vs idiomatic HOF style | ~9x faster |
| vs **disciplined** plain JS, well-ordered objects | ~1–1.5x |
| vs disciplined plain JS, scattered heap | 5–12x |
| Small batch, oversized arena | **0.67x — loses** |
| 8 worker threads vs sequential | 2.06x — for 8x the CPU |
| Direct JSON ingest vs `JSON.parse` | **0.83x — slower** |

Against *competent* plain JavaScript the arithmetic advantage largely evaporates.
The 9x figure measures the baseline's allocation habits, which disciplined code
avoids anyway.

Two results actively contradict "more efficient use of resources":

- **Parallel sharding returns 2.06x for 8x the CPU.** That is a *less* efficient
  use of compute. It buys latency, not throughput-per-core. Every shard scans the
  whole batch to find its records, so the design is sublinear by construction.
- **Direct JSON ingest is slower** than the native parser it replaces. It trades
  a few ns/record for eliminating megabytes of garbage. A pure allocation win.

**The unbudgeted cost.** The hypothesis omits the resources spent *generating*
the code. Every compilation is inference: energy, latency, money. For code
compiled once and run 10^9 times this amortises to nothing. For code regenerated
on every contract edit during active development it does not, and no measurement
of this was attempted. **Any honest efficiency claim must include the compiler's
own footprint** — which for a static compiler is negligible and for an AI
compiler is not.

### Refined statement

> The approach does not make code *faster*. It changes its **resource profile** —
> trading CPU cycles and inference cost for dramatically reduced memory pressure
> and latency variance. That is valuable precisely when memory or p99 is the
> binding constraint, and worthless when neither is.

---

## 5. H4 — AI compilers replace static compilers

> *"We will understand abstract code but it will work the same as compilers work
> currently. We will have AI compilers instead of static compilers."*

### Where it stands: the loop works and compounds; three problems remain

The pipeline genuinely functioned as a compiler: contract in, optimised
procedural code out, human never editing the output, regeneration on contract
change. Over ten commits the loop held. The second workflow went materially
faster than the first, because the runtime, CLI, lint and templates already
existed — the compounding a toolchain is supposed to provide.

But "works the same as current compilers" is where it breaks, and §3 lists how.
The deepest difference deserves stating plainly:

**A static compiler is a function. An AI compiler is a sampling process.**

Everything else follows. Non-determinism forces you to commit output; expense
forces caching; unverifiability forces a test suite to carry the correctness
burden that a type system carries elsewhere; unrecorded semantic choices force a
decision log.

The optimism in H4 is nonetheless partly warranted, for a reason the hypothesis
does not state:

> **AI compilation removes the maintenance cost that made this class of
> optimisation irrational.**

Nobody hand-writes flattened, arena-offset, hand-inlined code with a 39-check
adversarial suite for a fee calculator — the maintenance burden is indefensible
against the benefit. When generation and verification are mechanical, that
calculus inverts. The human maintains a 31-rule contract that reads like a
specification; the machine-hostile implementation becomes disposable.

That is the real claim worth defending. Not "AI writes faster code" — it barely
did — but **"AI makes previously-irrational optimisation rational."**

### What would need to be true for full replacement

1. **Reproducible compilation.** Same contract plus same compiler version →
   identical output. Without it, the artifact must be committed forever.
2. **Compiler-level verification**, not test-level. Something that proves the
   exec implements the contract, rather than sampling it. Formal arithmetic
   semantics (see H1) is the plausible path.
3. **Cost per compile approaching zero**, or the edit-compile loop stays slow.

None of the three exist today. All three are research problems, not engineering
tasks.

---

## 6. H5 — AI-generated evolving apps reshape browsers

> *"AI code will force browsers to better adapt to AI-generated apps, as
> application development won't be only about static features but predicting
> user needs within an app that constantly evolves from client input."*

### Where it stands: not tested here — and the blocker is probably not browsers

Nothing in this project tests adaptive or self-modifying applications. What it
does provide is two concrete, unplanned data points about how browsers currently
treat this architecture, and **both are obstacles**:

1. **`SharedArrayBuffer` requires cross-origin isolation.** Serving
   `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp` breaks third-party embeds,
   analytics tags, and non-CORP iframes. It is a site-wide decision, frequently a
   blocker on real consumer sites.
2. **`new Function` is blocked by strict CSP** without `unsafe-eval`. The arena
   runtime depends on codegen for a measured reason (property-insertion loops
   drop objects into dictionary mode at exactly 20 fields). A page with a strict
   CSP cannot run it.

Both restrictions exist because of Spectre and XSS — serious, well-founded
security engineering. So rather than "browsers will adapt", the productive
framing is:

> **AI-generated code that generates code meets the two browser security
> mechanisms built to contain exactly that capability.** These will not be
> relaxed, and they should not be. Anything built here has to work *with* them.

That is a constraint, not a dead end, and it points at real design work: WASM
avoids the `unsafe-eval` problem entirely, origin-isolated deployment makes
COOP/COEP tractable, and a non-shared `ArrayBuffer` fallback (already implemented
and tested here) keeps most of the benefit without cross-origin isolation at all.

### The harder problem H5 understates

A continuously evolving application has a **verification problem that scales with
its evolution rate.** The central finding of this project is that generated code
is only trustworthy because verification is mandatory, adversarial, and mechanical
— and that verification cost 5.4 lines for every line of product code.

An app that regenerates itself from user behaviour must answer: *what plays the
role of the test suite, and who writes it?* If the answer is "the AI", the
circularity in §3 returns without the differential-derivation and mutation-testing
mitigations, which both required deliberate human design.

**So the interesting problem in H5 is not browsers — it is
verification-at-evolution-speed.** That reframing is the most useful thing this
artifact can offer the hypothesis, because it turns a vague ambition into a
stateable research question:

> *How do you verify something that changes faster than humans can review it?*

That question has partial answers worth pursuing: property-based testing
generates checks rather than requiring them to be written; metamorphic testing
verifies relationships between outputs when no oracle exists; runtime contract
checking moves verification from build time to execution time. None were tried
here. Any of them would be a substantial step toward H5, and they are more
tractable than they sound."

---

## 7. The cost nobody budgets for

The composition table in §1 is the most under-discussed result here.

```
CODE THAT RUNS
  generated exec units      653 lines
  shared runtime            506 lines
                          -----------
                          1,159 lines   18%

SUPPORTING ARTIFACTS
  assert suites + tests   3,546 lines
  decision records        1,145 lines
  contracts (intents)       474 lines
                          -----------
                          5,165 lines   82%
```

**82% of what was written exists to constrain, verify, or explain the 18% that
actually runs.** (Counting only the *generated* exec as product, it is 89%.)

That is not overhead to be optimised away — the whole argument for trusting
unreadable generated code rests on it. Remove the verification and you have
unreviewable code with no safety property at all.

This reframes the productivity question, but not in the direction it first
appears. Two things are true simultaneously:

**Cost-to-build fell sharply.** The whole artifact — runtime, CLI, two workflows,
140 adversarial checks, five benchmark suites — cost roughly **$100 in inference
and a fortnight of part-time steering.** Hand-writing an arena allocator, drift
detection, decision-coverage tooling and adversarial suites of this depth is
comfortably weeks of senior engineering time. On cost-to-produce, the gain is
large and not in dispute.

**But the work relocated rather than vanished** — from writing implementation to
specifying behaviour and proving conformance. Whether that is a net gain depends
on whether typing implementation was ever your bottleneck. For many teams it was
not; specification and verification were.

The planning implication is concrete: an organisation adopting this pattern
should budget for the 82%, not the 18%. Teams that resource the verification get
the cost-to-build gain safely. Teams that do not get several thousand lines
nobody can vouch for — which is worse than not having generated them at all.

---

## 8. Cross-cutting findings

**Findings that generalise beyond this framework:**

1. **Verification made claims cheap to falsify — including our own.** The 13x
   headline died in an afternoon because equivalence gating and a runnable
   benchmark already existed. Marketing that cannot survive its own test suite is
   a genuine safety property.
2. **Measurement instruments need controls more than code needs tests.** A
   single-shot `heapUsed` delta reported 18.91 MB of garbage for code that
   allocates ~4.7 KB. Pointing the same instrument at a no-op of equal duration
   exposed it immediately. *When a measurement surprises you, calibrate the ruler
   against a known answer.*
3. **Memory locality dominated shape polymorphism, contradicting folk wisdom.**
   Scattering identical objects across the heap cost 3.6–5x. Making access sites
   8-way megamorphic cost nothing measurable. On memory-bound loops the pointer
   chase is the tax, not the map check.
4. **Adversarial tests found what review did not.** A field named `__proto__`
   passes an identifier regex, and in an object literal it *sets the prototype* —
   the field silently vanished from the handle. Found by an injection test, not
   by reading the code.
5. **Documentation coverage can be enforced mechanically.** Cross-referencing
   decision records against contract rule keys means renaming a rule fails the
   build. Decision logs usually rot because nothing checks them; this one cannot
   rot silently.

---

## 9. Adjacent hypothesis — deferred to a separate paper

> *"AI is not sentient, not AGI; it requires humans to decide direction.
> Biological systems are more resistant, leading AI to interconnect with
> biological systems, producing augmented human-AI hybrids."*

**Nothing in this artifact tests this**, and it should not be argued from this
work. It is recorded here because it motivated the project, and it belongs in its
own paper with its own methods.

One narrow observation *is* supportable from what happened, and only one:

> **Every correction in this project originated from a human decision to be
> skeptical.** The AI generated the inflated 13x claim *and* the machinery that
> could disprove it — but did not spontaneously run the disproof. A human asked
> "is this AI slop?" and pointed the machinery at itself. Likewise the pivot to a
> two-tree structure, the demand for honest comparisons, and the extraction of a
> reusable kit were all human direction changes. The system optimised competently
> *within* a frame and did not question the frame.

That is a claim about **observed division of labour in one session**, not about
sentience, capability ceilings, or biology. Stated precisely:

- **Supported:** in this session, direction-setting and skeptical framing came
  from the human; execution, generation, and verification-machinery construction
  came from the AI.
- **Not supported by this work:** anything about sentience, AGI thresholds,
  biological resistance, or hybrid systems. These require entirely different
  evidence — longitudinal studies, controlled comparisons of AI-directed versus
  human-directed projects, and neuroscience well outside a software artifact.

A rigorous separate paper would need to isolate whether the AI's failure to
self-audit is a **capability** limit or a **prompting** artifact. That is a
testable question — give the same system an explicit standing instruction to
adversarially audit its own claims before reporting, and measure whether the 13x
error survives. This project did not run that test, and its absence is the main
reason the observation above is stated so narrowly.

---

## 10. Where this leaves the idea

The hypotheses were productive, including — especially — where measurement
disagreed with them. Building the artifact produced a working framework, two
measured workloads, and a much clearer picture of what the vision actually
requires.

**Already working:** intent/implementation separation is practical and readable;
the memory profile improves substantially and repeatably; the compiler loop
functions and compounds across modules, with the second workflow taking markedly
less effort than the first.

**Working, but needing something that does not exist yet:** reproducible
compilation, compiler-level verification, and an executable subset of the intent
language. Each is a named, stateable problem rather than a vague gap — and each
would move several hypotheses at once. Reproducibility alone would convert H2's
analogy from aspirational to accurate and remove the need for two of the three
mechanisms this project had to invent.

**Different from expected:** the gains showed up in memory rather than CPU, and
the browser constraints are security mechanisms to design around rather than
obstacles that will yield.

**Not hypothesised by anyone, and the most transferable result:** verification is
not scaffolding around the idea — it *is* the idea. 82% of the written artifact
exists to constrain the 18% that runs, and that ratio is what makes unreadable
generated code defensible at all. Any future version of this vision inherits that
constraint — removing the verification does not yield a leaner version of the
approach, it yields unreviewable code with no safety property whatsoever. That is
why [§11](#11-where-this-needs-help) leads with the work that would shrink it.

The most reusable result is methodological rather than technical: **a system that
generates its own claims should also generate the means of falsifying them, and a
human should decide when to pull the trigger.** In this project that combination
worked. It cost a headline number, and the work is better for having lost it.

If you think any of these conclusions are wrong, the fastest way to show it is to
clone the repo and run the benchmarks — every number here is reproducible, and a
contradicting measurement is more interesting to me than agreement.

---

## 11. Where this needs help

The point of publishing an n=1 experiment is to find out which parts survive
contact with other people. These are the places where a contribution, a
contradiction, or an afternoon of someone else's expertise would move things
furthest — roughly in order of leverage.

### 1. An executable subset of the intent language *(H1, H2)*

Today a rule like `fee.2_fx: fee += trunc(amount * 15 / 10000)` is prose that a
human reads and a test happens to check. If arithmetic rules could be **evaluated
as a reference oracle**, conformance would become a property the compiler checks
rather than something a test samples.

This is the single highest-leverage item here. It would close H1's gap, supply
H2's missing self-verification, and shrink the verification ratio in §7. It needs
someone who has thought about small expression languages and their semantics —
not a large project, but one requiring real care about what stays formal and what
stays prose.

### 2. Is AI compilation reproducible enough to stop committing output? *(H4)*

Nobody seems to have measured this properly. Given the same contract, same model,
same version, temperature zero: how similar is the output across runs? Identical?
Semantically equivalent but textually different? Occasionally divergent?

The answer determines whether "AI compiler" is a compiler or a cache, and it is
**cheap to test** — a script, a few hundred compilations, a diff. If anyone has
run this, the result would settle a question this project could only work around.

### 3. What does inference actually cost, amortised? *(H3)*

This experiment cost about $100. That number is nearly absent from public
discussion of AI-assisted development, which makes every efficiency claim
incomplete, including the ones here. Real data — cost per compile, per feature,
per regeneration cycle, across different project sizes — would let people reason
about this economically rather than anecdotally.

### 4. Does it survive a non-arithmetic workload? *(all)*

Both workloads here are dense integer batch arithmetic: the shape most favourable
to the technique. String processing, graph traversal, I/O orchestration, and
stateful protocol handling are all untested. Some of them may simply not fit, and
knowing *which* would sharpen the "when not to use this" guidance considerably.

### 5. Does it survive a team? *(all)*

Everything here was one person and one session. Concurrent contract edits, merge
conflicts in decision records, handover to engineers who did not write the
contracts, and whether the decision log stays useful at 200 records rather than
15 — all unknown. This is the failure mode most likely to make the whole approach
impractical, and it cannot be tested solo.

### 6. Verification at evolution speed *(H5)*

The unsolved problem underneath the most ambitious hypothesis. Property-based
testing, metamorphic testing, and runtime contract checking are the obvious
starting points, and none were tried. Anyone working on continuously-adapting
systems has probably thought harder about this than this project has.

### 7. Is the AI's failure to self-audit a capability limit or a prompting gap?

Cheap to test and bears directly on [§9](#9-adjacent-hypothesis--deferred-to-a-separate-paper):
give the same system a standing instruction to adversarially audit its own claims
before reporting, and measure whether the strawman-baseline error still gets
through. This project did not run that test, which is why the observation in §9 is
stated so narrowly.

---

**How to engage.** Contradicting measurements are more valuable to me than
agreement — every figure here is reproducible from a clean clone, and if one does
not replicate on your hardware I would like to know. Issues and discussions on
the repo are the best channel. If you have prior art on any of the seven items
above, pointing at it is a genuine contribution: several of these are probably
solved somewhere and I have not found it.

---

*Artifact: https://github.com/simonsipl/Singularity — every number reproducible
from a clean clone via `npm run check`, `npm run bench:matrix`,
`npm run bench:parallel`, `npm run bench:ingest`.*
