# The research, explained to a labrador

The other explainer ([README-labrador](README-labrador.explanation.md)) tells you
**what this project built**. This one tells you **what we were trying to find
out**, and what actually happened — including the bits where we turned out to be
wrong.

Biscuit the labrador is still here. She still fetches things. She is still the
reason any of it works.

---

## The five things we wanted to find out

Before building anything, someone had five ideas. Not facts — **guesses**. Good
guesses, worth checking.

The whole point of building the thing was to find out which guesses were right.

Here they are in plain words:

1. **"People could write rules in a language that's easy to read but still tidy
   enough for a machine."**
2. **"The messy computer code underneath doesn't need to be readable — it's like
   a rough draft nobody keeps."**
3. **"This whole approach might use less of the computer, so we get more out of
   the computers we already own."**
4. **"One day, robots will do the translating job that special translator
   programs do today."**
5. **"Eventually, apps will rebuild themselves based on what people do, and web
   browsers will have to change to keep up."**

Let's go through what we found. Spoiler: **two were right, two needed fixing, and
one turned out to be asking the wrong question entirely.**

---

## Guess 1: "People can write rules that are easy to read"

### Mostly right! With one hole in it.

We wrote rules like this:

> *"If the money isn't dollars, add a small extra fee."*

Anyone can read that. You just did. That bit worked.

**But here's the hole.** Every rule has two parts:

- A **name tag** — like `fee.2_fx`
- A **sentence** — the bit that actually says what to do

The computer checks the **name tags** very carefully. If you rename one and
forget to update something, it shouts at you immediately.

The computer does **not** check the **sentences at all.**

So if the sentence says *"always round DOWN"* and the robot's scribbles actually
round **up**... nothing shouts. Nothing notices. The only reason we caught things
like that is that somebody wrote a test on purpose.

It's like having a recipe where the ingredients list is double-checked by a
machine, but the actual cooking instructions are just... trusted.

**How to fix it:** make the maths bits of the sentences into something the
computer can actually *do*, so it can check the robot's work by doing the sum
itself and comparing. That's the single most useful thing anyone could build
next.

---

## Guess 2: "The messy code doesn't need to be readable"

### Right idea. But we were leaning on it too hard.

There's a thing programmers already use called TypeScript. You write the tidy
version, a translator turns it into the messy version, and nobody reads the messy
version. Our guess was: *"this is the same thing, but with a robot doing the
translating."*

**It's not quite the same, and the difference matters.**

Imagine two ways of getting a sandwich:

**A vending machine.** Press button 4, get cheese and pickle. Press button 4
tomorrow, get *exactly the same sandwich*. Press it a hundred times, a hundred
identical sandwiches. It cannot misunderstand you, because it isn't listening —
it's just a machine doing a machine thing.

**A very helpful friend.** Ask for "something nice with cheese," and you get
something nice with cheese. Ask again tomorrow — also lovely, also cheese,
slightly different sandwich. They're *good*. But they're **interpreting** you.

The TypeScript translator is the vending machine. Our AI is the helpful friend.

Both feed you! But only with the vending machine can you check the result by
pressing the button again. With the friend, you have to actually **taste the
sandwich** — every single time.

That's why this project needed three extra safety nets that the vending machine
never needs:

1. **We had to keep the robot's scribbles**, because asking again costs money and
   gives slightly different scribbles.
2. **We had to fingerprint the rule card**, so we can tell if the rules changed
   after the scribbles were written.
3. **We had to write down *why* choices were made**, because you can't read the
   scribbles to find out.

None of that means the guess was bad. It means: **make the friend behave more
like a vending machine — same answer every time — and the guess becomes exactly
right.**

---

## Guess 3: "It will use less of the computer"

### Half right. And the right half is the good half.

This is the guess we had the most numbers for. It splits neatly in two.

### Speed: not really

We thought our clever version would be much faster. Against **sloppy** code, it
was. Against **tidy** code, it was about the same — and in one case a bit slower.

(The other explainer tells this story properly: we raced someone carrying a
wheelbarrow of litter, won easily, and got very pleased with ourselves.)

### Space: **yes, massively**

Here's where Biscuit earns her dinner.

| | Old way | Our way |
|---|---|---|
| Room the payments take up | a big suitcase | a school backpack |
| Mess made each time | a van of wrapping paper | a matchbox |

**That second row is the huge one.** Not a bit less mess. About **forty-five
thousand times** less mess.

And here's why that's worth actual money: companies rent computers a bit like
renting fridges. If every lunch needs a suitcase you fit six in the fridge. If
every lunch is a backpack you fit twenty-four. **Same fridge, four times the
lunches.**

For a company renting thousands of fridges, that's a very large bill getting
smaller.

### The bit we forgot to count

Here's the embarrassing part: we forgot the robot itself costs something.

Asking the robot to write code uses electricity and costs money. **This whole
project cost about $100** in robot time.

Almost nobody mentions this when they talk about robots making work cheaper —
which means most of those claims have a hole in them. Ours had the same hole
until we noticed.

---

## Guess 4: "Robots will replace translator programs"

### Heading the right way. Not there yet.

The good news: **it genuinely worked.** Rules in, working code out, over and over,
ten times in a row. And the *second* project was much quicker than the first,
because all the tools already existed. That's exactly what's supposed to happen.

The catch is the sandwich thing again: **a translator program is a machine, and
our robot is a helper who interprets.**

But there's something genuinely brilliant hiding here that the guess didn't
mention:

> **Nobody would ever hand-write code this fiddly for a job this small.**

Writing all those cramped scribbles and thirty-nine tricky questions, by hand, for
a fee calculator? Any sensible person would say "that's not worth my week" — and
they'd be right.

But if a **robot** does the fiddly part, and the tricky questions check its
homework, then suddenly it *is* worth it.

**That's the real discovery.** Not "robots write faster code." It's **"robots make
worth-doing a job that was never worth doing before."**

---

## Guess 5: "Web browsers will change to keep up"

### We couldn't test this. But we bumped into something interesting.

We never built a self-rebuilding app, so we can't say whether browsers will
adapt.

What we *did* find is that browsers currently make this **harder**, not easier —
and for a genuinely good reason.

Web browsers have safety locks, a bit like a playground with gates on it. The
gates are there because bad people once did nasty things through those exact
gaps. Two of our best tricks bump straight into two of those gates.

So "browsers should just unlock the gates" isn't a great answer. **The gates are
protecting people.** The better answer is finding routes that don't need them —
and there are some.

### The bigger problem the guess skipped past

Here's the thing that worries me most about guess 5.

Our single biggest finding, across the whole project, was: **the checking is the
important part.** Not the clever code — the tricky questions that catch it being
wrong.

Now imagine an app that **rebuilds itself constantly**, all day, based on what
people click.

*Who writes the tricky questions?*

If the app changes faster than anyone can check it, then nothing is checking it.
And unchecked scribbles are just... scribbles.

So guess 5's real problem isn't browsers at all. It's:

> **How do you check something that changes faster than you can look at it?**

Nobody has solved that. It's a proper, genuine, interesting unsolved problem —
and honestly a better question than the one we started with.

---

## The thing nobody guessed

We counted up everything written for this project:

```
Code that actually does the work:     1,159 lines
Stuff that checks and explains it:    5,165 lines
```

**Eight out of every ten lines exist to make the other two trustworthy.**

Nobody predicted that. And it's not waste you could trim away — it's the *entire
reason* you're allowed to trust code that nobody reads. Delete the checking and
you don't get a leaner version of this idea. You get a pile of scribbles nobody
can vouch for, which is worse than not writing them at all.

So: did the robot save work?

**It made building it much cheaper** — $100 and a fortnight, versus weeks of a
person's time. That's real, and it's a big deal.

**But the work moved rather than vanished.** Less time typing code, much more time
writing down exactly what "correct" means and proving it. If typing was your slow
bit, that's a huge win. If deciding what to build was your slow bit — and it
usually is — it helps less.

---

## What we'd love help with

Being wrong in public is the point of writing this down. A few things we genuinely
don't know:

1. **Can we make the rule-sentences checkable by machine?** The most useful thing
   on the list.
2. **Does the robot give the same answer twice?** Nobody seems to have properly
   measured this. It's a cheap experiment and it would settle a lot.
3. **What does it cost at bigger sizes?** We know one number ($100, one project).
   One number isn't a pattern.
4. **Does it work for jobs that aren't sums?** Everything here was arithmetic —
   the friendliest possible case.
5. **Does it survive a whole team?** One person, one fortnight. Teams are
   different and usually harder.

---

## The five things worth remembering

1. **Two guesses were right, two needed fixing, one was asking the wrong
   question.** That's a *good* result. Guesses that are all correct usually mean
   you weren't guessing about anything interesting.
2. **The big win was space, not speed** — and space is where the money is.
3. **The checking is the actual invention.** Eight lines out of ten.
4. **Count what the robot costs too.** Almost nobody does.
5. **The best question we found, we found by accident:** *how do you check
   something that changes faster than you can look at it?*

Number five is the one someone should go and solve.

Good girl, Biscuit. 🦮
