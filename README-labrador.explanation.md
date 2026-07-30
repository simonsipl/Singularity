# Singularity, explained to a labrador

Hello! This page explains what this project does **without using any computer words**.

If you have never written a line of code, you are exactly who this is for. There is a glossary of the grown-up words at the very bottom, in case you ever want to show off.

Our helper in this story is a labrador called **Biscuit**. Biscuit's job is to fetch things. She is very good at it, and she is the reason everything here works.

---

## 1. What is this thing?

Imagine a shop that has to check **a million payments** — a million times someone tries to buy something.

For every single payment, somebody has to check:

- Is this a sensible amount of money? (Not zero. Not a negative amount. Not a squillion pounds.)
- Is this a kind of money we accept?
- Is this a real customer?
- **What is our fee?** (The little bit the shop keeps.)
- Does the customer actually *have* enough money?

Then: take the money, or politely say no.

A million times. Every time. And it has to be **exactly right**, because it is money. Nobody thinks "close enough" is fine with money.

This project makes a computer do all million checks in **less time than it takes you to blink once.** A blink takes about a third of a second. This takes less than a fiftieth of a second — you'd have to blink about twenty times to keep up with it.

---

## 2. The big idea: a rule card and a robot

Normally, a person writes the instructions that tell the computer what to do. That is called *coding*.

Here we do it differently, in two pieces.

**Piece one: the rule card.** A human writes a card that says *what the rules are*. Just the rules, in plain sensible language. Like the rules on the lid of a board game box.

> A payment must be more than zero.
> A payment cannot be bigger than five hundred thousand pounds.
> The fee for a small payment is this much.
> If the customer has less money than the payment plus the fee, say no.

Anyone can read that card. It doesn't say **how** to do it. It only says what "correct" means.

**Piece two: the robot.** A robot reads the rule card and writes the actual instructions for the computer.

And here is the surprising part:

> **The robot's instructions are horrible to look at, and that is on purpose.**

They are cramped and scribbly and no human would ever want to read them. That's fine! We don't read them. We read the *rule card*.

Think of a jar of jam. The **label** on the front is for you: "Strawberry Jam." The **barcode** on the back is for the machine at the till. The barcode is ugly. You don't read barcodes. You'd never ask for it to be prettier, because it isn't for you.

The rule card is the label. The robot writes the barcode.

If the rules ever change, we don't *fix* the scribbles. We throw them away and let the robot write brand new ones. Scribbles are cheap. The rule card is the precious thing.

---

## 3. Trick one: Biscuit and the tennis balls

This is the most important trick, so here is where Biscuit comes in.

Inside a computer, information is kept somewhere far away from the bit that does the thinking. Something has to run and fetch it. That's Biscuit.

Biscuit has one lovely quality: **when she fetches, she brings back a whole mouthful, not one thing.** She can carry about sixteen tennis balls in one trip. She's a labrador. This is what she's for.

Now. Two ways to store our million payments.

### The normal way: a million lunchboxes

Give every payment its own little lunchbox. Inside each lunchbox: the amount, the customer's name, the kind of money.

```
[box 1: amount, name, money-kind]  [box 2: amount, name, money-kind]  [box 3: ...]
```

Now say we want to look at **all the amounts**.

Biscuit runs to lunchbox 1. She opens it. She takes the amount. She also has to carry back the name and the money-kind, because they were in the box and her mouth is full now. She comes back. We use the amount. We throw the other two bits away.

Then she does it again. And again.

**A million trips**, and on every single trip most of what she carried was stuff we didn't want.

### Our way: three big buckets

Don't use lunchboxes. Use three big buckets.

```
bucket of AMOUNTS:      [amount][amount][amount][amount][amount]...
bucket of NAMES:        [name][name][name][name][name]...
bucket of MONEY-KINDS:  [kind][kind][kind][kind][kind]...
```

Now we want all the amounts. Biscuit trots to the amounts bucket and takes a **big happy mouthful — sixteen amounts at once.** Every single one is something we wanted. Nothing wasted.

She has just done sixteen payments' worth of fetching in one trip.

That is most of the magic. Same information, same million payments — just **sorted into buckets instead of boxes**, so Biscuit's mouth is always full of useful things.

She also learns the route. Once Biscuit realises we're just walking down the amounts bucket in order, she starts running ahead and fetching the next mouthful *before we ask for it*. Computers really do this. It's called "prefetching," and it only works if things are in a tidy line.

---

## 4. Trick two: don't make a mess

Here's the second trick, and it's about tidying up.

Every time a computer program makes a new thing, it leaves a bit of litter behind. Not on purpose — it's just how it works. And there is a **Tidy Robot** whose job is to sweep up the litter.

The Tidy Robot has one very annoying habit: **when it sweeps, everything else has to stop and wait.**

Now, the normal way of doing our million payments makes a *new little thing* for every payment. A million new things, each one leaving litter. Add it up and it's about **210 megabytes** of mess for one batch of payments.

You don't know what a megabyte is, and you don't need to. Here's the picture:

> **The normal way makes a pile of wrapping paper the size of a van.**
> **Our way makes a pile you could fit in a matchbox.**

That is a real measurement, not a joke. 210 megabytes versus 4.7 kilobytes. The van versus the matchbox.

How? **We use the same buckets over and over.** We don't get new buckets for each batch. We empty them out and use them again, like washing up a plate instead of throwing it away and buying a new plate every dinner.

And here's why it matters more than being fast:

Imagine you're playing a lovely game, and every four minutes someone stops the whole game to sweep the floor. Even if you're a brilliant player, the game feels **jerky and annoying.**

That's what the van-sized mess does to a computer. Most of the time it's fine, and then every so often — *stop, everybody wait, sweeping* — and somebody out there in the world sees a website that won't load for a moment.

With the matchbox, there's nothing to sweep. So nobody ever has to wait.

Grown-ups who run big websites care about this **more** than they care about raw speed, which surprises people.

---

## 5. Trick three: count in pennies, never in half-pennies

A small thing, but it's about money, so it matters.

Computers are a bit rubbish at halves and quarters. If you ask a computer for a third of something and then add it up three times, you sometimes get 0.9999999 instead of 1. Which is *nearly* right. Nearly right is fine for how tall a tree is.

Nearly right is **not fine for money.** Nearly-right money means pennies going missing, and pennies going missing means somebody is either being robbed or getting free money, and both of those are bad.

So we never, ever use halves. **We count everything in whole pennies.** Not "£3.50" — three hundred and fifty pennies. Whole numbers only. Nothing to round, nothing to go wrong, no pennies lost.

When we work out a fee we always chop downwards to a whole penny, and we wrote that rule on the rule card so there's no arguing about it later.

---

## 6. How do we know the robot didn't get it wrong?

Excellent question, and it's the right thing to be suspicious about. The robot's instructions are unreadable scribbles. So how can anyone trust them?

**The robot has to prove it. Every time.**

We ask it **32 tricky questions**, and it has to get all 32 right or we don't believe a word of it. And they are properly mean questions — the kind designed to catch someone who's only *pretending* to understand:

- What if the payment is exactly zero? What about minus five?
- What if it's *exactly* the biggest allowed amount? What about one penny more?
- What if the customer has *exactly* enough — to the penny? (That should work.) What about **one penny short**? (That should not.)
- What if a payment breaks **two** rules at once — which complaint do you make?
- What if the customer runs out of money halfway through the million?
- What if we hand you total nonsense — can you stay calm and not fall over?

That last kind matters. "What if I'm *exactly* on the line" is where mistakes hide. Not in the middle, where everything's obvious. Right on the edge.

### The fair race

Then we do something even better. We wrote the whole thing **twice**:

1. The normal, tidy, human way. Slow, but easy for a person to read and check.
2. The robot's scribbly bucket way. Very fast.

We run **both** on the same million payments. Then we check they agree on **every single answer** — all million results, all the fees, every customer's leftover money.

Only if they match **perfectly** do we even look at which one was faster.

> **A wrong answer that arrives quickly is still a wrong answer.**

That's the whole rule. Speed doesn't count for anything until we're certain it's right.

---

## 7. The mistake I made (this is the best bit)

I want to tell you about a mistake, because it's more interesting than the stuff that worked.

I wanted to prove our way makes almost no mess — the matchbox, remember. So I measured it. And the answer came back: **our way made a mess about the size of a small car.**

That was wrong. But I didn't know it was wrong yet. I could easily have written it down and moved on.

Here's what had actually happened. I measured the mess **while the Tidy Robot was still finishing sweeping up the old mess from before.** So I was counting somebody else's litter and blaming it on us.

How did I catch it? I did the fairest test I could think of:

> **I measured how much mess is made by doing absolutely nothing at all.**

Just sitting there. Not one single payment. And "doing nothing" appeared to make **a whole wheelbarrow of mess.**

Well — that settles it. *Nothing cannot make a mess.* So the measuring tape was broken, not the thing I was measuring.

So I fixed how I measured: waited until the floor was properly clean first, and counted across a hundred batches instead of one, so any leftover wobble got squashed down small enough to ignore.

Then the real answer came out: **the matchbox.**

If you only remember one thing from this whole page, please make it this one:

> **When a measurement tells you something surprising, check the ruler before you believe the answer.**
>
> And the way you check the ruler is to measure something where you *already know* what the answer must be — like "nothing."

Grown-up scientists call that a *control*. It's how you catch yourself being wrong. It is genuinely the most useful idea in this entire project, and it has nothing to do with computers.

---

## 8. So how much faster is it, really? (the part where we got caught)

All of these are real measurements from a real computer, doing a real million payments. And this section has a confession in it.

**The first race.** The messy old way took about **13 minutes** and our bucket way took about **1 minute** (in pretend-minutes — really it's fractions of a blink). We were very pleased with ourselves. Thirteen times faster!

**The rematch.** Then somebody sensible asked an awkward question: *"Was the old way slow because of the lunchboxes... or just because it was messy?"* So we raced again — against a **tidy** lunchbox way. Same lunchboxes, but no litter, no faffing about.

And the tidy lunchbox way **almost tied with us.** Some days it was even a whisker faster.

Ouch. Our "thirteen times faster" was mostly just "thirteen times less messy." Beating someone who is carrying a wheelbarrow of litter doesn't make you fast.

**So when do the buckets actually win?** We kept racing, fairly this time, and found out:

- **When the lunchboxes are scattered all over the house** — which is what happens to lunchboxes in real life, once they've been around a while — Biscuit has to run to a different room for every single box. Buckets win by **5 times**.
- **When you only want ONE thing from each box** — say, just the amounts — with lunchboxes, Biscuit opens every box and carries everything anyway. With buckets, she goes straight to the amounts bucket. Buckets win by **12 times**. This is her favourite race.
- **And sometimes we LOSE.** If there are only a few payments but our bucket is enormous, we waste time washing out the whole giant bucket for three biscuits' worth of work. The tidy lunchbox way beats us there. We wrote that on the tin too, because hiding it would be fibbing.

**Mess.** A van of wrapping paper, versus a matchbox. (This one survived the rematch completely — the tidy way still can't share its lunchboxes between helpers, and the messy way is still a van.)

**Space.** The normal way needs a great big suitcase to hold the million payments. Ours needs a **school backpack** — about eight times smaller.

That last one is quietly the most valuable, and here's why. Imagine a fridge. If every lunch needs a huge suitcase, you fit six lunches in the fridge. If every lunch fits in a backpack, you fit **twenty-four**. Same fridge.

Companies rent those fridges, and they are expensive. Fitting four times as much in each one saves real money — often **more money than being fast does.**

---

## 9. The honest part: when this does NOT help

Every page like this should have this section, and most of them don't. So here's ours.

**Sometimes making the fast bit faster changes almost nothing.**

Imagine your morning. You brush your teeth (2 minutes), get dressed (3 minutes), then **wait for the school bus (20 minutes)**.

Now imagine you get amazingly, unbelievably good at brushing your teeth. Thirteen times faster! Nine seconds!

How much earlier do you get to school?

**Not at all.** You still wait for the bus. The bus was always the slow bit.

Most computer programs are exactly like this. They spend a tiny bit of time thinking, and then **ages** waiting for something else — usually waiting for a big filing cabinet somewhere else to look something up. That's the bus.

So all our lovely bucket tricks only really help when the *thinking* is the slow bit. Sometimes it is! Adding up a million payments at the end of the day — that's real thinking, and we make it properly faster.

But if the program is mostly standing at a bus stop, we've made the teeth-brushing amazing and saved nobody any time. And it would be a bit dishonest to say otherwise, even though it makes our project sound less impressive.

**The other honest bit:** all our speed comes from things being sorted into buckets. If somebody hands us a million *lunchboxes* and we have to unpack them into buckets first, the unpacking can cost more than we saved. The buckets only pay off if things go **straight into buckets and stay there.**

---

## 10. Why do it this weird way at all?

Here's the real reason, and it isn't "computers go brrr."

Writing those scribbly instructions by hand would be **miserable**. It would take a person ages, they'd make mistakes, and every time the rules changed they'd have to do it all again. No sensible person would sign up for that just to make a shop's fee calculator faster. It simply wouldn't be worth the bother.

So people don't do it. They write the normal, tidy, slower version, and that's a perfectly reasonable choice.

But if a **robot** writes the scribbles, and the robot has to pass 32 mean questions before anyone believes it, then suddenly the bother is gone.

> The human keeps the nice readable rule card.
> The robot does the horrible fiddly part.
> The 32 questions make sure the robot was telling the truth.

That's the actual clever idea here. Not "the computer is fast." It's that **the boring, awful, fiddly work stopped being a reason not to bother.**

---

## Grown-up words, if you want to show off

You now understand all of these. Here's what they're called.

| What we called it | What grown-ups call it |
|---|---|
| The rule card | A *declarative contract* (or an "intent") |
| The robot's scribbles | *Generated code* |
| Lunchboxes | *Array of structs* |
| Big buckets | *Struct of arrays* |
| Biscuit's big mouthful | A *cache line* |
| Biscuit running ahead | *Prefetching* |
| Litter | *Garbage* |
| The Tidy Robot | The *garbage collector* |
| Everyone stopping to wait | A *GC pause* |
| Washing the plate instead of a new one | *Zero-allocation*, or *reusing a buffer* |
| Counting in whole pennies | *Integer arithmetic* (avoiding *floating point*) |
| The 32 mean questions | A *test suite* |
| Both ways must agree | *Differential testing* |
| Measuring "nothing" to check the ruler | A *control* |
| Racing someone slow on purpose | A *strawman baseline* |
| The fair rematch | *Isolating variables* |
| The school bus problem | *Amdahl's law* |
| Fitting more backpacks in the fridge | *Pod density* |

---

## The five things worth remembering

1. **Sort things into buckets, not boxes**, so the dog's mouth is always full of useful stuff.
2. **Don't make a mess**, so nobody ever has to stop the game to sweep.
3. **Check it's right before you check it's fast.** Fast and wrong is just wrong.
4. **When a measurement surprises you, test your ruler on something you already know the answer to.**
5. **Check who you were racing.** Beating someone carrying a wheelbarrow doesn't make you fast. Race someone quick before you brag — and write down the races you lose.

Numbers four and five are the ones you'll use for the rest of your life, whatever you end up doing.

---

## Want the other half of the story?

This page explained **what we built**. There's a companion page —
[RESEARCH-labrador](RESEARCH-labrador.explanation.md) — explaining **what we were
trying to find out**, and which of our five guesses turned out to be wrong.

(Two were right. Two needed fixing. One was asking the wrong question entirely.)

Good girl, Biscuit. 🦮
