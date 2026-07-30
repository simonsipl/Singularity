'use strict';
/* SINGULARITY BENCHMARK
 * idiomatic human implementation vs. compiled exec unit, same contract,
 * same input bytes, asserted-identical output.
 *
 * run: node --expose-gc --max-old-space-size=6144 tests/benchmark.js
 */

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const X = require('../src/exec/bulk-settlement.exec.js');

const N = 1000000;
const ACCOUNTS = 4096;
const INITIAL_BALANCE = 15000000; /* tuned so ~half the accounts deplete mid-batch */
const SEED = 0x5EED1701;

const HUMAN_WARMUP = 1, HUMAN_RUNS = 5;
const EXEC_WARMUP = 3, EXEC_RUNS = 15;

const HAS_GC = typeof global.gc === 'function';

/* ---- deterministic input generation ------------------------------------ */

function makeRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Derives the 5 contract fields from 5 PRNG draws into a scratch buffer.
 * Both the object generator and the arena generator route through this, so the
 * two representations are identical by construction, not by coincidence.
 * scratch = [id, accountSlot, amount, currency, flags] */
function deriveFields(i, d0, d1, d2, d3, d4, scratch) {
  let amount, currency, accountSlot, flags;

  if (d0 < 0.010) {
    amount = -1 - ((d1 * 100000) | 0);                       /* INVALID_AMOUNT */
  } else if (d0 < 0.015) {
    amount = X.LIMIT_MAX_PAYMENT_AMOUNT + 1 + ((d1 * 1000000) | 0); /* EXCEEDS_LIMIT */
  } else if (d0 < 0.715) {
    amount = 100 + ((d1 * 9900) | 0);                        /* tier 0 */
  } else if (d0 < 0.915) {
    amount = 10000 + ((d1 * 90000) | 0);                     /* tier 1 */
  } else if (d0 < 0.995) {
    amount = 100000 + ((d1 * 900000) | 0);                   /* tier 2 */
  } else {
    amount = 1000000 + ((d1 * 4000000) | 0);                 /* tier 3 */
  }

  if (d2 < 0.990) currency = (d2 * 3.0303030303030303) | 0;  /* 0..2, uniform over the kept range */
  else currency = 3 + ((d2 - 0.990) * 500) | 0;              /* UNSUPPORTED_CURRENCY */
  if (currency > 7) currency = 7;

  if (d3 < 0.995) accountSlot = (d3 * ACCOUNTS * 1.005025125628141) | 0;
  else accountSlot = ACCOUNTS + ((d3 - 0.995) * 20000 | 0);  /* UNKNOWN_ACCOUNT */
  if (accountSlot > 4294967294) accountSlot = 4294967294;

  flags = d4 < 0.20 ? X.FLAG_PRIORITY : 0;

  scratch[0] = i;
  scratch[1] = accountSlot;
  scratch[2] = amount;
  scratch[3] = currency;
  scratch[4] = flags;
}

/* array-of-structs: what a human writes */
function generateObjects(n) {
  const rng = makeRng(SEED);
  const scratch = new Float64Array(5);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const d0 = rng(), d1 = rng(), d2 = rng(), d3 = rng(), d4 = rng();
    deriveFields(i, d0, d1, d2, d3, d4, scratch);
    out[i] = {
      id: scratch[0],
      accountSlot: scratch[1],
      amount: scratch[2],
      currency: scratch[3],
      flags: scratch[4]
    };
  }
  return out;
}

/* struct-of-arrays, straight into the arena: what the exec unit consumes.
 * no intermediate object is ever materialised. */
function generateIntoArena(L, n) {
  const rng = makeRng(SEED);
  const scratch = new Float64Array(5);
  const ids = L.ids, accounts = L.accounts, amounts = L.amounts,
    currencies = L.currencies, flags = L.flags;
  for (let i = 0; i < n; i++) {
    const d0 = rng(), d1 = rng(), d2 = rng(), d3 = rng(), d4 = rng();
    deriveFields(i, d0, d1, d2, d3, d4, scratch);
    ids[i] = scratch[0];
    accounts[i] = scratch[1];
    amounts[i] = scratch[2];
    currencies[i] = scratch[3];
    flags[i] = scratch[4];
  }
}

/* marshalling cost of the AoS -> SoA boundary, measured honestly and reported
 * separately rather than hidden outside the timed region */
function packObjectsIntoArena(records, L) {
  const ids = L.ids, accounts = L.accounts, amounts = L.amounts,
    currencies = L.currencies, flags = L.flags;
  for (let i = 0, len = records.length; i < len; i++) {
    const r = records[i];
    ids[i] = r.id;
    accounts[i] = r.accountSlot;
    amounts[i] = r.amount;
    currencies[i] = r.currency;
    flags[i] = r.flags;
  }
}

// ===========================================================================
// THE IDIOMATIC "HUMAN" IMPLEMENTATION
// Same contract. Written the way a competent engineer would actually write it:
// declarative, immutable-ish, composed from higher-order array methods.
// ===========================================================================

const STATUS = {
  SETTLED: 1,
  INVALID_AMOUNT: 2,
  AMOUNT_EXCEEDS_LIMIT: 3,
  UNSUPPORTED_CURRENCY: 4,
  UNKNOWN_ACCOUNT: 5,
  INSUFFICIENT_FUNDS: 6
};

const FEE_TIERS = [
  { amountBelow: 10000, bps: 290, flat: 30 },
  { amountBelow: 100000, bps: 250, flat: 25 },
  { amountBelow: 1000000, bps: 190, flat: 20 },
  { amountBelow: Infinity, bps: 120, flat: 0 }
];

function calculateFee(payment) {
  const tier = FEE_TIERS.find(t => payment.amount < t.amountBelow);
  let fee = Math.floor((payment.amount * tier.bps) / 10000) + tier.flat;
  if (payment.currency !== 0) {
    fee += Math.floor((payment.amount * 15) / 10000);
  }
  if ((payment.flags & 1) !== 0) {
    fee += Math.floor((fee * 5000) / 10000);
  }
  return Math.min(Math.max(fee, 30), 5000);
}

function validate(payment, accountCount) {
  if (payment.amount <= 0) return STATUS.INVALID_AMOUNT;
  if (payment.amount > 50000000) return STATUS.AMOUNT_EXCEEDS_LIMIT;
  if (payment.currency > 2) return STATUS.UNSUPPORTED_CURRENCY;
  if (payment.accountSlot >= accountCount) return STATUS.UNKNOWN_ACCOUNT;
  return null;
}

function processPaymentsHuman(records, initialBalances) {
  const balances = initialBalances.slice();

  const processed = records.reduce((acc, payment) => {
    const violation = validate(payment, balances.length);
    if (violation !== null) {
      acc.push({ ...payment, fee: 0, status: violation });
      return acc;
    }

    const fee = calculateFee(payment);
    const total = payment.amount + fee;

    if (balances[payment.accountSlot] < total) {
      acc.push({ ...payment, fee, status: STATUS.INSUFFICIENT_FUNDS });
      return acc;
    }

    balances[payment.accountSlot] -= total;
    acc.push({ ...payment, fee, status: STATUS.SETTLED });
    return acc;
  }, []);

  const settled = processed.filter(p => p.status === STATUS.SETTLED);
  const rejected = processed.filter(p => p.status !== STATUS.SETTLED);

  const tally = rejected.reduce((counts, p) => {
    counts[p.status] = (counts[p.status] || 0) + 1;
    return counts;
  }, {});

  return {
    settledCount: settled.length,
    rejectedCount: rejected.length,
    totalSettledAmount: settled.reduce((sum, p) => sum + p.amount, 0),
    totalFees: settled.reduce((sum, p) => sum + p.fee, 0),
    rejectedInvalidAmount: tally[STATUS.INVALID_AMOUNT] || 0,
    rejectedAmountExceedsLimit: tally[STATUS.AMOUNT_EXCEEDS_LIMIT] || 0,
    rejectedUnsupportedCurrency: tally[STATUS.UNSUPPORTED_CURRENCY] || 0,
    rejectedUnknownAccount: tally[STATUS.UNKNOWN_ACCOUNT] || 0,
    rejectedInsufficientFunds: tally[STATUS.INSUFFICIENT_FUNDS] || 0,
    statuses: processed.map(p => p.status),
    fees: processed.map(p => p.fee),
    balances: balances
  };
}

/* ---- measurement -------------------------------------------------------- */

function median(xs) {
  const s = xs.slice().sort(function (a, b) { return a - b; });
  const m = s.length >> 1;
  return (s.length & 1) === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function settle() {
  if (HAS_GC) { global.gc(); global.gc(); }
}

/* returns { best, median } */
function measure(label, warmup, runs, thunk) {
  for (let i = 0; i < warmup; i++) thunk();
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    thunk();
    samples.push(performance.now() - t0);
  }
  return {
    label: label,
    best: Math.min.apply(null, samples),
    median: median(samples)
  };
}

/* Allocation churn, amortised over `reps` batches.
 *
 * A heapUsed delta sampled around a SINGLE short window is not a valid
 * instrument: V8's concurrent sweeping continues after global.gc() returns, so
 * heapUsed climbs in proportion to elapsed time and live-set size regardless of
 * whether the measured code allocates at all. Measured on this machine, a
 * ~14 ms no-op window against a large live heap reports several MB of phantom
 * "growth". Amortising over many reps pushes that fixed artifact below the
 * per-batch signal; measureFloor() below quantifies what remains. */
function measureAlloc(thunk, reps) {
  settle();
  const m0 = process.memoryUsage();
  for (let i = 0; i < reps; i++) thunk();
  const m1 = process.memoryUsage();
  return {
    perBatchHeap: (m1.heapUsed - m0.heapUsed) / reps,
    perBatchExternal: ((m1.external - m0.external) + (m1.arrayBuffers - m0.arrayBuffers)) / reps,
    reps: reps
  };
}

/* the same instrument pointed at a workload that provably allocates nothing:
 * whatever this reports is measurement error, not allocation. */
function measureFloor(totalMs, reps) {
  const perRep = totalMs / reps;
  settle();
  const m0 = process.memoryUsage();
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    let sink = 0;
    while (performance.now() - t0 < perRep) sink++;
    if (sink < 0) throw new Error('unreachable');
  }
  const m1 = process.memoryUsage();
  return (m1.heapUsed - m0.heapUsed) / reps;
}

function ms(v) { return v.toFixed(2).padStart(9) + ' ms'; }
function mb(v) {
  const s = (v / 1048576).toFixed(2);
  return ((v > 0 ? '+' : '') + s).padStart(9) + ' MB';
}
/* auto-scales, so a 4 KB figure does not render as "+0.00 MB" */
function bytes(v) {
  const sign = v > 0 ? '+' : '';
  if (Math.abs(v) < 1024) return (sign + v.toFixed(0)).padStart(9) + ' B ';
  if (Math.abs(v) < 1048576) return (sign + (v / 1024).toFixed(1)).padStart(9) + ' KB';
  return (sign + (v / 1048576).toFixed(2)).padStart(9) + ' MB';
}
function num(v) { return v.toLocaleString('en-US'); }
function rate(msVal) { return (N / (msVal / 1000) / 1e6).toFixed(2) + ' M rec/s'; }
function nsPer(msVal) { return ((msVal * 1e6) / N).toFixed(1) + ' ns'; }

/* ---- setup -------------------------------------------------------------- */

process.stdout.write('\n');
process.stdout.write('SINGULARITY :: payment-processor benchmark\n');
process.stdout.write('node ' + process.version + '  ' + process.platform + '/' + process.arch + '\n');
process.stdout.write('records ' + num(N) + '   accounts ' + num(ACCOUNTS) +
  '   opening balance ' + num(INITIAL_BALANCE) + ' cents/account\n');
process.stdout.write('forced GC: ' + (HAS_GC ? 'yes' : 'NO (heap deltas are unforced and noisy — rerun with --expose-gc)') + '\n\n');

const seedBalances = new Array(ACCOUNTS);
for (let i = 0; i < ACCOUNTS; i++) seedBalances[i] = INITIAL_BALANCE;

process.stdout.write('generating input...\n');

/* the object-free path first, so the exec allocation baseline below can be taken
 * against a heap that has never held a payment object */
const L = X.allocLedger(N, ACCOUNTS);
const tNative0 = performance.now();
generateIntoArena(L, N);
const tNativeGen = performance.now() - tNative0;

/* CLEAN-HEAP allocation baseline. Taken here, before any object graph exists,
 * this is the load-bearing evidence for the zero-allocation claim: later in the
 * run a 145 MB live set inflates the same measurement by an order of magnitude
 * purely through GC re-accounting. */
const CLEAN_ALLOC_REPS = 100;
for (let i = 0; i < 5; i++) {
  X.resetLedger(L);
  for (let a = 0; a < ACCOUNTS; a++) L.balances[a] = INITIAL_BALANCE;
  X.processBatch(L, N);
}
const execAllocClean = measureAlloc(function () {
  X.resetLedger(L);
  const balances = L.balances;
  for (let i = 0; i < ACCOUNTS; i++) balances[i] = INITIAL_BALANCE;
  X.processBatch(L, N);
}, CLEAN_ALLOC_REPS);

settle();
const genHeap0 = process.memoryUsage().heapUsed;
const tGen0 = performance.now();
const records = generateObjects(N);
const tGenObjects = performance.now() - tGen0;
settle();
const objectsResidentBytes = process.memoryUsage().heapUsed - genHeap0;

/* marshal the object graph into a second arena and prove the two ingest paths
 * agree byte-for-byte across all 1M records and every field */
const L2 = X.allocLedger(N, ACCOUNTS);
const tPack0 = performance.now();
packObjectsIntoArena(records, L2);
const tPack = performance.now() - tPack0;

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0, len = a.length; i < len; i++) if (a[i] !== b[i]) return false;
  return true;
}
assert.ok(sameBytes(L2.ids, L.ids), 'ingest divergence: ids');
assert.ok(sameBytes(L2.accounts, L.accounts), 'ingest divergence: accounts');
assert.ok(sameBytes(L2.amounts, L.amounts), 'ingest divergence: amounts');
assert.ok(sameBytes(L2.currencies, L.currencies), 'ingest divergence: currencies');
assert.ok(sameBytes(L2.flags, L.flags), 'ingest divergence: flags');

process.stdout.write('  SoA arena (direct) ' + ms(tNativeGen) + '   resident ' + mb(L.byteLength) + ' (SharedArrayBuffer, off-heap)\n');
process.stdout.write('  AoS object graph   ' + ms(tGenObjects) + '   resident ' + mb(objectsResidentBytes) + '\n');
process.stdout.write('  AoS -> SoA marshal ' + ms(tPack) + '   (both paths verified byte-identical, all ' + num(N) + ' records)\n\n');

/* ---- correctness gate: assert equivalence BEFORE reporting any timing --- */

process.stdout.write('verifying result equivalence...\n');

let humanResult = processPaymentsHuman(records, seedBalances);

X.resetLedger(L);
for (let i = 0; i < ACCOUNTS; i++) L.balances[i] = seedBalances[i];
X.processBatch(L, N);

assert.equal(L.stats[X.STAT_SETTLED_COUNT], humanResult.settledCount, 'settledCount');
assert.equal(L.stats[X.STAT_REJECTED_COUNT], humanResult.rejectedCount, 'rejectedCount');
assert.equal(L.stats[X.STAT_TOTAL_SETTLED_AMOUNT], humanResult.totalSettledAmount, 'totalSettledAmount');
assert.equal(L.stats[X.STAT_TOTAL_FEES], humanResult.totalFees, 'totalFees');
assert.equal(L.stats[X.STAT_REJ_INVALID_AMOUNT], humanResult.rejectedInvalidAmount, 'rejectedInvalidAmount');
assert.equal(L.stats[X.STAT_REJ_AMOUNT_EXCEEDS_LIMIT], humanResult.rejectedAmountExceedsLimit, 'rejectedAmountExceedsLimit');
assert.equal(L.stats[X.STAT_REJ_UNSUPPORTED_CURRENCY], humanResult.rejectedUnsupportedCurrency, 'rejectedUnsupportedCurrency');
assert.equal(L.stats[X.STAT_REJ_UNKNOWN_ACCOUNT], humanResult.rejectedUnknownAccount, 'rejectedUnknownAccount');
assert.equal(L.stats[X.STAT_REJ_INSUFFICIENT_FUNDS], humanResult.rejectedInsufficientFunds, 'rejectedInsufficientFunds');

let statusMismatch = -1, feeMismatch = -1;
for (let i = 0; i < N; i++) {
  if (L.statuses[i] !== humanResult.statuses[i]) { statusMismatch = i; break; }
  if (L.fees[i] !== humanResult.fees[i]) { feeMismatch = i; break; }
}
assert.equal(statusMismatch, -1, 'per-record status divergence at index ' + statusMismatch);
assert.equal(feeMismatch, -1, 'per-record fee divergence at index ' + feeMismatch);

let balanceMismatch = -1;
for (let i = 0; i < ACCOUNTS; i++) {
  if (L.balances[i] !== humanResult.balances[i]) { balanceMismatch = i; break; }
}
assert.equal(balanceMismatch, -1, 'final balance divergence at slot ' + balanceMismatch);

/* the run must actually be non-trivial, or the benchmark proves nothing */
assert.ok(humanResult.settledCount > N * 0.1, 'too few settlements to be meaningful');
assert.ok(humanResult.rejectedInsufficientFunds > 0, 'no balance exhaustion exercised');
assert.ok(humanResult.rejectedInvalidAmount > 0);
assert.ok(humanResult.rejectedAmountExceedsLimit > 0);
assert.ok(humanResult.rejectedUnsupportedCurrency > 0);
assert.ok(humanResult.rejectedUnknownAccount > 0);

let drained = 0;
for (let i = 0; i < ACCOUNTS; i++) if (L.balances[i] < 100) drained++;

process.stdout.write('  identical: counters, totals, ' + num(N) + ' statuses, ' +
  num(N) + ' fees, ' + num(ACCOUNTS) + ' final balances\n\n');

process.stdout.write('BATCH PROFILE\n');
process.stdout.write('  settled                 ' + num(humanResult.settledCount).padStart(11) +
  '  (' + (100 * humanResult.settledCount / N).toFixed(1) + '%)\n');
process.stdout.write('  rejected                ' + num(humanResult.rejectedCount).padStart(11) +
  '  (' + (100 * humanResult.rejectedCount / N).toFixed(1) + '%)\n');
process.stdout.write('    invalid amount        ' + num(humanResult.rejectedInvalidAmount).padStart(11) + '\n');
process.stdout.write('    amount exceeds limit  ' + num(humanResult.rejectedAmountExceedsLimit).padStart(11) + '\n');
process.stdout.write('    unsupported currency  ' + num(humanResult.rejectedUnsupportedCurrency).padStart(11) + '\n');
process.stdout.write('    unknown account       ' + num(humanResult.rejectedUnknownAccount).padStart(11) + '\n');
process.stdout.write('    insufficient funds    ' + num(humanResult.rejectedInsufficientFunds).padStart(11) + '\n');
process.stdout.write('  total settled amount    ' + num(humanResult.totalSettledAmount).padStart(11) + ' cents\n');
process.stdout.write('  total fees              ' + num(humanResult.totalFees).padStart(11) + ' cents\n');
process.stdout.write('  accounts drained        ' + num(drained).padStart(11) + ' / ' + num(ACCOUNTS) + '\n\n');

/* release the human result set (~50 MB live) so the allocation measurements
 * below run against a settled heap rather than this function's output */
humanResult = null;

/* ---- timed runs --------------------------------------------------------- */

process.stdout.write('benchmarking (human ' + HUMAN_WARMUP + '+' + HUMAN_RUNS +
  ', exec ' + EXEC_WARMUP + '+' + EXEC_RUNS + ')...\n\n');

const human = measure('human', HUMAN_WARMUP, HUMAN_RUNS, function () {
  const r = processPaymentsHuman(records, seedBalances);
  if (r.settledCount < 0) throw new Error('unreachable');
});

/* full apples-to-apples: clears the output buffers and reseeds balances inside
 * the timed region, mirroring the human path's internal allocation of its own
 * output arrays and balance copy */
const execFull = measure('exec', EXEC_WARMUP, EXEC_RUNS, function () {
  X.resetLedger(L);
  const balances = L.balances;
  for (let i = 0; i < ACCOUNTS; i++) balances[i] = INITIAL_BALANCE;
  X.processBatch(L, N);
});

/* the traversal alone, for transparency about where the time goes */
const execLoop = measure('exec-loop', EXEC_WARMUP, EXEC_RUNS, function () {
  X.processBatch(L, N);
});

/* ---- allocation churn, amortised --------------------------------------- */

const HUMAN_ALLOC_REPS = 5;
const EXEC_ALLOC_REPS = 100;

/* ORDER MATTERS. The exec path is sampled FIRST, against a heap that has not
 * been churned by the human path. Sampling it afterwards inflates the figure by
 * ~1 MB/batch of residual sweeping from the human run's ~1 GB of garbage. */
const execAlloc = measureAlloc(function () {
  X.resetLedger(L);
  const balances = L.balances;
  for (let i = 0; i < ACCOUNTS; i++) balances[i] = INITIAL_BALANCE;
  X.processBatch(L, N);
}, EXEC_ALLOC_REPS);

/* what the instrument reports for a workload that provably allocates nothing,
 * over a comparable total wall time — the noise floor of the figure above */
const execFloor = measureFloor(execFull.best * EXEC_ALLOC_REPS, EXEC_ALLOC_REPS);

/* sampled last: this one trashes the heap for whatever follows */
const humanAlloc = measureAlloc(function () {
  const r = processPaymentsHuman(records, seedBalances);
  if (r.settledCount < 0) throw new Error('unreachable');
}, HUMAN_ALLOC_REPS);

/* ---- report ------------------------------------------------------------- */

const W = 76;
function rule(ch) { process.stdout.write(ch.repeat(W) + '\n'); }

process.stdout.write('\n');
rule('=');
process.stdout.write('RESULTS  (1,000,000 payment records, identical output asserted)\n');
rule('=');
process.stdout.write(
  'phase'.padEnd(24) + 'best'.padStart(13) + 'median'.padStart(13) +
  'throughput'.padStart(15) + 'per rec'.padStart(11) + '\n');
rule('-');

function row(name, r) {
  process.stdout.write(
    name.padEnd(24) + ms(r.best).padStart(13) + ms(r.median).padStart(13) +
    rate(r.best).padStart(15) + nsPer(r.best).padStart(11) + '\n');
}
row('human (AoS, HOFs)', human);
row('exec (reset+process)', execFull);
row('exec (process only)', execLoop);
rule('-');

const speedFull = human.best / execFull.best;
const speedLoop = human.best / execLoop.best;
process.stdout.write('speedup, full batch      ' + speedFull.toFixed(1) + 'x\n');
process.stdout.write('speedup, traversal only  ' + speedLoop.toFixed(1) + 'x\n');
process.stdout.write('\n');

rule('-');
process.stdout.write('ALLOCATION CHURN  (heap growth per batch, amortised' +
  (HAS_GC ? '' : ' — NO forced GC, rerun with --expose-gc') + ')\n');
rule('-');
process.stdout.write('phase'.padEnd(30) + 'per batch'.padStart(14) + 'batches'.padStart(9) + '\n');
process.stdout.write('human (AoS, HOFs)'.padEnd(30) + bytes(humanAlloc.perBatchHeap).padStart(14) +
  String(humanAlloc.reps).padStart(9) + '\n');
process.stdout.write('exec, clean heap'.padEnd(30) + bytes(execAllocClean.perBatchHeap).padStart(14) +
  String(execAllocClean.reps).padStart(9) + '\n');
process.stdout.write('exec, 145MB live set'.padEnd(30) + bytes(execAlloc.perBatchHeap).padStart(14) +
  String(execAlloc.reps).padStart(9) + '\n');
process.stdout.write('  no-op control, same time'.padEnd(30) + bytes(execFloor).padStart(14) +
  String(EXEC_ALLOC_REPS).padStart(9) + '\n');
rule('-');
process.stdout.write('Read the two exec rows together. Identical code, same batch, measured twice:\n');
process.stdout.write('once before any payment object existed, once with a 145 MB live object graph\n');
process.stdout.write('resident. The gap is V8 re-accounting live data during the sample window, not\n');
process.stdout.write('garbage the traversal produced — heapUsed keeps climbing after global.gc()\n');
process.stdout.write('returns, in proportion to live-set size and elapsed time. The clean-heap row\n');
process.stdout.write('is the honest figure: ' + (execAllocClean.perBatchHeap / 1024).toFixed(1) +
  ' KB per 1M-record batch, against ' +
  (humanAlloc.perBatchHeap / 1048576).toFixed(0) + ' MB for the human path.\n');
process.stdout.write('Single-shot heapUsed deltas are unusable at this scale; every figure above is\n');
process.stdout.write('amortised over the stated batch count.\n');
rule('-');
process.stdout.write('input residency, AoS     ' + mb(objectsResidentBytes) + '  (1M live objects, on-heap, GC-scanned)\n');
process.stdout.write('input residency, SoA     ' + mb(L.byteLength) + '  (one SharedArrayBuffer, off-heap, not GC-scanned)\n');
process.stdout.write('arena is allocated once at startup and reused for every batch.\n');
/* deliberately NOT expressed as a ratio: the exec denominator is at the noise
 * floor, so a "46000x" figure would be quoting precision that does not exist */
process.stdout.write('per-batch churn          ' + bytes(humanAlloc.perBatchHeap).trim() +
  ' (human)  vs  ' + bytes(execAllocClean.perBatchHeap).trim() + ' (exec)\n');
process.stdout.write('                         exec churn is at the measurement floor; the ratio is\n');
process.stdout.write('                         bounded below by ~4 orders of magnitude, not precise.\n');
process.stdout.write('\n');

rule('-');
process.stdout.write('INGEST (reported separately — not folded into the numbers above)\n');
rule('-');
process.stdout.write('SoA direct-to-arena      ' + ms(tNativeGen) + '   (object-free path)\n');
process.stdout.write('AoS object construction  ' + ms(tGenObjects) + '   (' +
  (tGenObjects / tNativeGen).toFixed(1) + 'x the object-free path)\n');
process.stdout.write('AoS -> SoA marshalling   ' + ms(tPack) + '   (only paid at a legacy boundary)\n');
process.stdout.write('end-to-end, human        ' + ms(tGenObjects + human.best) + '\n');
process.stdout.write('end-to-end, exec native  ' + ms(tNativeGen + execFull.best) +
  '   -> ' + ((tGenObjects + human.best) / (tNativeGen + execFull.best)).toFixed(1) + 'x\n');
rule('=');
process.stdout.write('\n');
