# LinkedIn promotion guide

How to talk about this project publicly without torching your credibility.
Working notes for you, not for publication.

---

## 1. The positioning decision (read this first)

Your instinct might be to lead with **"I built an AI framework that's 13x
faster."** Don't. That post is written a hundred times a week, and yours has a
specific problem: **it isn't true, and your own repo proves it isn't.** The first
competent engineer who clones it will find `tests/benchmark-honest.js` and say so
in your comments.

Lead with the opposite:

> **"I let AI build a framework, then had it audit itself. It destroyed its own
> headline claim."**

Why this wins:

- **It is unfalsifiable in the bad-faith sense** — you already published the
  failure, so nobody can "expose" you.
- **It is rare.** Everyone posts wins. Almost nobody posts a measured
  self-correction with the git history to back it.
- **It filters your audience.** The people who engage are engineers who value
  rigour — the ones worth knowing.
- **It survives scrutiny**, which "13x" does not.

The credibility asymmetry is the whole play. You are not selling a framework. You
are demonstrating **how you think about evidence.** That is what gets you hired,
funded, or taken seriously.

---

## 2. Hard rules — do not break these

**Never claim:**

- ❌ "13x faster" without the qualifier. It's ~1x vs competent code.
- ❌ That the framework is production-ready. Two workloads, one machine, n=1.
- ❌ That a human independently audited it. The audit was AI-run, and started by
  an agent that hit a spend limit before finishing.
- ❌ That AI wrote it "with no human input." You steered constantly — that is
  literally one of your findings.
- ❌ Anything about AGI, sentience, or biological hybrids **in the same post as
  the technical work.** It vaporises your engineering credibility. That
  hypothesis is a separate paper for a reason.

**Always include:**

- ✅ That it was AI-generated on purpose, as an experiment
- ✅ One number that makes you look worse ("it loses on small batches")
- ✅ The repo link, so claims are checkable
- ✅ "One machine, one Node version" when quoting benchmarks

The unflattering number is not modesty — it is the strongest credibility signal
in the post. Readers assume everyone hides the bad numbers. Publishing one buys
trust for every other figure you cite.

---

## 3. Post drafts

### Draft A — The main post (recommended opener)

> **I vibe-coded a backend framework to see what would happen. Then I had an AI
> audit it for slop. It killed its own headline claim.**
>
> The experiment: let Claude build "Singularity" — humans write declarative
> contracts, the model compiles them into deliberately unreadable, V8-optimised
> execution code. I steered; I wrote almost none of the implementation.
>
> What came out looked great. Two working modules. 140 adversarial tests. A CLI
> that fails the build when generated code drifts from its contract. A decision
> log wired into CI. And a benchmark reporting **13x faster than idiomatic
> JavaScript.**
>
> Then I asked for a hostile review: "tell me if this is AI slop."
>
> It mutation-tested the suite — flipped boundaries, reordered fee maths,
> corrupted memory layout. Every observable break was caught. Then it asked the
> question the benchmark never had: *13x faster than what, exactly?*
>
> The baseline was idiomatic-but-wasteful code. Against **disciplined** plain
> JavaScript, the fancy version was roughly tied. Some runs slower.
>
> So the repo now ships the matrix instead of the headline:
> • vs allocation-heavy idiomatic code: **~9x**
> • vs disciplined plain JS: **~1–1.5x**
> • once objects are scattered like real long-lived heaps: **5–12x**
> • small batches in an oversized arena: **it loses**. That's in the README on
> purpose.
>
> The surprise: 8-way shape polymorphism — the thing every V8 guide warns about —
> cost nothing measurable. A scattered heap cost 5x. It's the pointer chase, not
> the shape check.
>
> **My actual takeaway:** vibe coding produced impressive claims *and* the
> machinery that disproved them. The generated code was never the value. The
> value was that verification was mandatory — so the marketing couldn't survive
> contact with its own test suite.
>
> 82% of what got written exists to constrain the 18% that actually runs. That
> ratio *is* the approach.
>
> Everything's public, including the correction commits:
> github.com/simonsipl/Singularity
>
> Try to break it. That's what it's for.

*~290 words. Tighten the bullet block if it runs long in preview.*

---

### Draft B — Short version (higher reach, less depth)

> I let AI build a backend framework, then asked another AI to tear it apart.
>
> It found the benchmark was rigged. Not maliciously — the "slow" baseline was
> just badly written code. Against *well-written* plain JavaScript, my 13x
> speedup was about 1x.
>
> I published the correction instead of the headline.
>
> What actually survived: 8x less memory, ~45,000x less garbage per batch, and a
> test suite that caught a `__proto__` bug that silently deleted a field.
>
> The lesson isn't "AI writes fast code." It's that when verification is
> mandatory, your marketing can't survive your own test suite. Mine didn't.
>
> github.com/simonsipl/Singularity

*~110 words. Best if you want reach over depth.*

---

### Draft C — The methodology angle (strongest for senior engineers)

> **A measurement told me my code allocated 18 MB. It allocated 4 KB. Here's how
> I caught it.**
>
> I was benchmarking a zero-allocation code path. The instrument said 18.91 MB of
> garbage per batch — which would have meant the entire design was pointless.
>
> Before believing it, I pointed the same instrument at **doing nothing at all**
> for the same duration.
>
> "Nothing" reported several MB too.
>
> The instrument was broken, not the code. V8 keeps sweeping after `global.gc()`
> returns, so a short measurement window against a large live heap reports
> phantom growth proportional to elapsed time. The real figure, measured properly
> across 100 batches on a clean heap, was 4.7 KB.
>
> The rule I'd write on the wall:
>
> **When a measurement surprises you, calibrate the ruler against an answer you
> already know.**
>
> Same project, same week, the same discipline killed my headline benchmark (13x
> → ~1x against competent code) and found a `__proto__` bug that silently deleted
> a struct field.
>
> None of these were found by reading code. All were found by controls.
>
> Full write-up + reproducible benchmarks: github.com/simonsipl/Singularity

*~180 words. This one performs best with staff+ engineers and gets the most
substantive comments.*

---

### Draft D — The uncomfortable-economics angle

> Everyone asks if AI makes developers faster. Wrong question.
>
> I built a framework where AI writes 100% of the production code. Here's the
> line count:
>
> • Code that actually runs: **1,159 lines**
> • Tests, contracts, and decision records constraining it: **5,165 lines**
>
> **82% of the work exists to make the 18% trustworthy.**
>
> AI didn't reduce the work. It *relocated* it — from writing implementation to
> specifying behaviour and proving conformance.
>
> That's a gain only if your bottleneck was ever typing implementation code. For
> most teams, it wasn't.
>
> github.com/simonsipl/Singularity

*~95 words. Most likely of the four to be shared by engineering leaders.*

---

## 4. Sequencing

Don't post everything at once. Suggested cadence:

| Week | Post | Goal |
|---|---|---|
| 1 | **Draft A** | Establish the story and the repo |
| 2 | **Draft C** | Demonstrate methodological depth to engineers |
| 3–4 | **Draft D** | Reach engineering leadership |
| Later | The H6 paper, standalone | Only after technical credibility is banked |

Never put the AGI/biological-hybrid hypothesis in the same post as the technical
work. If someone asks in comments, answer briefly and point to it as separate,
unevidenced speculation. Mixing them makes engineers discount your measurements.

---

## 5. Handling the comments you will actually get

**"This is just SoA / data-oriented design, game devs have done it for 30 years."**
> Correct, and worth saying so. The novelty isn't the layout — it's letting AI
> generate the unreadable version because verification is mechanical. Concede
> fast; you look better and it's true.

**"Your benchmark is flawed."**
> Ask which one — you ship four. Then: "The original was, badly. That's
> `benchmark-honest.js` and it's in the README." Nearly always ends the argument
> in your favour.

**"AI-generated code in production is irresponsible."**
> Agree with the premise, disagree with the conclusion: unreviewable code with no
> verification is irresponsible. That's why 84% of the repo is verification and
> why the CLI fails the build on drift. Then note you'd only use it for hot batch
> paths, not a whole backend — which is already in your README.

**"Did you actually write any of this?"**
> Yes: direction, skepticism, and every decision about what to measure. That
> division of labour is one of the documented findings, not a dodge.

**"What's the point if it's only 1x faster?"**
> The best question you'll get. Memory: 8x residency, ~45,000x less churn, flat
> p99, ~4x pod density. It's a memory play, not a speed play. Most infra bills
> are memory-bound.

---

## 6. Practical formatting

- **First two lines are everything** — LinkedIn truncates around ~200 characters.
  Get the hook and the reversal above the fold.
- **No link in the first comment trick.** It suppresses reach less than it used
  to, and it looks evasive. Put the repo link in the post body.
- **Short paragraphs, one idea each.** Mobile readers.
- **Numbers as bullets**, prose as sentences. Don't mix.
- **Zero hashtag spam.** Three max: `#SoftwareEngineering #AI #Performance`.
- **Post Tue–Thu, 8–10am** in your target audience's timezone.
- **Reply to every substantive comment within the first 2 hours.** Early
  engagement drives distribution more than post content does.

---

## 7. The one-sentence version

If you only get a single line in a bio, a talk intro, or a DM:

> *"I let AI build a backend framework, then made it prove its own performance
> claim was wrong — and published the correction."*

That sentence does more for you than any benchmark in the repo.
