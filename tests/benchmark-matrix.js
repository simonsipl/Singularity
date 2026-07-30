'use strict';
/* SINGULARITY BENCHMARK MATRIX
 *
 * The full comparison the single-baseline benchmarks cannot give: four
 * implementation strategies crossed with the workload dimensions that actually
 * move the numbers. Every variant is equivalence-gated against the exec unit
 * before anything is timed.
 *
 * STRATEGIES
 *   hof         idiomatic HOF style: .reduce, spread per record (allocates)
 *   aos-seq     plain loop over AoS objects, one hidden class, objects
 *               allocated in traversal order (best case for AoS)
 *   aos-scat    same objects and shape, but allocated in SHUFFLED order so heap
 *               position is uncorrelated with traversal order — models a
 *               long-lived object cache after GC and time have scattered it
 *   aos-poly    allocation-ordered, but 8 rotating key orders -> 8 hidden
 *               classes -> megamorphic access sites — models objects assembled
 *               by different code paths / JSON of varying field order
 *   soa-exec    the compiled arena unit
 *
 * WORKLOADS
 *   full-pipeline   validate + fee + balance, reads EVERY field (the shape the
 *                   original benchmark measured)
 *   partial-scan    sum valid amounts: reads 1 of 5 fields — the analytics
 *                   shape where layout should matter most
 *   size sweep      hot-subset traversal at 10k / 100k / 1M records
 *
 * METHODOLOGY NOTES
 *   - Each AoS variant gets its OWN COPY of the kernel function. A shared
 *     kernel would let the polymorphic variant poison the inline caches of the
 *     monomorphic ones and corrupt every number measured after it.
 *   - aos-scat holds the SAME logical array order (results are byte-identical);
 *     only the correlation between array index and heap address changes.
 *   - Deterministic PRNG, same seed and distribution as tests/benchmark.js.
 *   - best-of-N after warmup; HOF gets fewer reps because it is slow.
 *
 * run: node --expose-gc --max-old-space-size=6144 tests/benchmark-matrix.js
 */

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const X = require(path.join(__dirname, '..', 'src', 'exec', 'bulk-settlement.exec.js'));

const N = 1000000, ACCOUNTS = 4096, BAL = 15000000, SEED = 0x5EED1701;
const SIZES = [10000, 100000, 1000000];

function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- ground truth: plain typed arrays, same distribution as benchmark.js -- */

const gAccount = new Int32Array(N);
const gAmount = new Int32Array(N);
const gCurrency = new Int32Array(N);
const gFlags = new Int32Array(N);
(function generate() {
  const rng = makeRng(SEED);
  for (let i = 0; i < N; i++) {
    const d0 = rng(), d1 = rng(), d2 = rng(), d3 = rng(), d4 = rng();
    let amount;
    if (d0 < 0.010) amount = -1 - ((d1 * 100000) | 0);
    else if (d0 < 0.015) amount = 50000001 + ((d1 * 1000000) | 0);
    else if (d0 < 0.715) amount = 100 + ((d1 * 9900) | 0);
    else if (d0 < 0.915) amount = 10000 + ((d1 * 90000) | 0);
    else if (d0 < 0.995) amount = 100000 + ((d1 * 900000) | 0);
    else amount = 1000000 + ((d1 * 4000000) | 0);
    let currency = d2 < 0.990 ? (d2 * 3.0303030303030303) | 0 : 3 + ((d2 - 0.990) * 500) | 0;
    if (currency > 7) currency = 7;
    let account = d3 < 0.995 ? (d3 * ACCOUNTS * 1.005025125628141) | 0
      : ACCOUNTS + ((d3 - 0.995) * 20000 | 0);
    gAccount[i] = account; gAmount[i] = amount; gCurrency[i] = currency;
    gFlags[i] = d4 < 0.20 ? 1 : 0;
  }
})();

/* ---- materialisations ---------------------------------------------------- */

function makeSeq() {
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = { id: i, accountSlot: gAccount[i], amount: gAmount[i],
      currency: gCurrency[i], flags: gFlags[i] };
  }
  return out;
}

/* allocation order follows a seeded shuffle; array order stays logical */
function makeScattered() {
  const perm = new Int32Array(N);
  for (let i = 0; i < N; i++) perm[i] = i;
  const rng = makeRng(SEED ^ 0x5CA77E7);
  for (let i = N - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const out = new Array(N);
  for (let k = 0; k < N; k++) {
    const i = perm[k];
    out[i] = { id: i, accountSlot: gAccount[i], amount: gAmount[i],
      currency: gCurrency[i], flags: gFlags[i] };
  }
  return out;
}

/* 8 rotating key orders -> 8 hidden classes at every access site */
const POLY_MAKERS = [
  function (i) { return { id: i, accountSlot: gAccount[i], amount: gAmount[i], currency: gCurrency[i], flags: gFlags[i] }; },
  function (i) { return { accountSlot: gAccount[i], id: i, amount: gAmount[i], currency: gCurrency[i], flags: gFlags[i] }; },
  function (i) { return { amount: gAmount[i], id: i, accountSlot: gAccount[i], currency: gCurrency[i], flags: gFlags[i] }; },
  function (i) { return { currency: gCurrency[i], amount: gAmount[i], id: i, accountSlot: gAccount[i], flags: gFlags[i] }; },
  function (i) { return { flags: gFlags[i], currency: gCurrency[i], amount: gAmount[i], id: i, accountSlot: gAccount[i] }; },
  function (i) { return { id: i, amount: gAmount[i], accountSlot: gAccount[i], flags: gFlags[i], currency: gCurrency[i] }; },
  function (i) { return { amount: gAmount[i], flags: gFlags[i], id: i, currency: gCurrency[i], accountSlot: gAccount[i] }; },
  function (i) { return { accountSlot: gAccount[i], currency: gCurrency[i], flags: gFlags[i], amount: gAmount[i], id: i }; }
];
function makePoly() {
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = POLY_MAKERS[i & 7](i);
  return out;
}

/* ---- kernels: one textual copy per variant (see METHODOLOGY) ------------- */

const outStatus = new Uint8Array(N);
const outFee = new Int32Array(N);
const balances = new Float64Array(ACCOUNTS);

/* the kernel body is identical across the three copies below; only the
 * function identity (and therefore its inline caches) differs */
function makePipelineKernel() {
  return function pipeline(records, count) {
    outStatus.fill(0, 0, count); outFee.fill(0, 0, count); balances.fill(BAL);
    let settled = 0, sumAmt = 0, sumFee = 0;
    for (let i = 0; i < count; i++) {
      const r = records[i];
      const amt = r.amount;
      if (amt <= 0) { outStatus[i] = 2; continue; }
      if (amt > 50000000) { outStatus[i] = 3; continue; }
      const cur = r.currency;
      if (cur > 2) { outStatus[i] = 4; continue; }
      const acct = r.accountSlot;
      if (acct >= ACCOUNTS) { outStatus[i] = 5; continue; }
      let f;
      if (amt < 10000) f = ((amt * 290) / 10000 | 0) + 30;
      else if (amt < 100000) f = ((amt * 250) / 10000 | 0) + 25;
      else if (amt < 1000000) f = ((amt * 190) / 10000 | 0) + 20;
      else f = (amt * 120) / 10000 | 0;
      if (cur !== 0) f += (amt * 15) / 10000 | 0;
      if ((r.flags & 1) !== 0) f += f >> 1;
      if (f > 5000) f = 5000; else if (f < 30) f = 30;
      outFee[i] = f;
      const total = amt + f;
      if (balances[acct] < total) { outStatus[i] = 6; continue; }
      balances[acct] -= total;
      outStatus[i] = 1; settled++; sumAmt += amt; sumFee += f;
    }
    return { settled: settled, sumAmt: sumAmt, sumFee: sumFee };
  };
}
const pipeSeq = makePipelineKernel();
const pipeScat = makePipelineKernel();
const pipePoly = makePipelineKernel();

function makePartialKernel() {
  return function partial(records, count) {
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const amt = records[i].amount;
      if (amt > 0 && amt <= 50000000) sum += amt;
    }
    return sum;
  };
}
const partSeq = makePartialKernel();
const partScat = makePartialKernel();
const partPoly = makePartialKernel();

/* idiomatic HOF pipeline — allocation per record by construction */
function hofPipeline(records, count) {
  const slice = records.slice(0, count);
  const bal = new Array(ACCOUNTS).fill(BAL);
  const processed = slice.reduce(function (acc, r) {
    let status;
    if (r.amount <= 0) status = 2;
    else if (r.amount > 50000000) status = 3;
    else if (r.currency > 2) status = 4;
    else if (r.accountSlot >= ACCOUNTS) status = 5;
    else status = 0;
    if (status !== 0) { acc.push({ ...r, fee: 0, status: status }); return acc; }
    let f;
    if (r.amount < 10000) f = Math.floor(r.amount * 290 / 10000) + 30;
    else if (r.amount < 100000) f = Math.floor(r.amount * 250 / 10000) + 25;
    else if (r.amount < 1000000) f = Math.floor(r.amount * 190 / 10000) + 20;
    else f = Math.floor(r.amount * 120 / 10000);
    if (r.currency !== 0) f += Math.floor(r.amount * 15 / 10000);
    if ((r.flags & 1) !== 0) f += Math.floor(f * 5000 / 10000);
    f = Math.min(Math.max(f, 30), 5000);
    if (bal[r.accountSlot] < r.amount + f) { acc.push({ ...r, fee: f, status: 6 }); return acc; }
    bal[r.accountSlot] -= r.amount + f;
    acc.push({ ...r, fee: f, status: 1 });
    return acc;
  }, []);
  const settledRecs = processed.filter(function (p) { return p.status === 1; });
  return {
    settled: settledRecs.length,
    sumAmt: settledRecs.reduce(function (s, p) { return s + p.amount; }, 0),
    sumFee: settledRecs.reduce(function (s, p) { return s + p.fee; }, 0),
    statuses: processed.map(function (p) { return p.status; }),
    fees: processed.map(function (p) { return p.fee; })
  };
}

function hofPartial(records, count) {
  return records.slice(0, count)
    .filter(function (r) { return r.amount > 0 && r.amount <= 50000000; })
    .reduce(function (s, r) { return s + r.amount; }, 0);
}

/* ---- exec ---------------------------------------------------------------- */

const L = X.allocLedger(N, ACCOUNTS);
for (let i = 0; i < N; i++) {
  L.ids[i] = i; L.accounts[i] = gAccount[i]; L.amounts[i] = gAmount[i];
  L.currencies[i] = gCurrency[i]; L.flags[i] = gFlags[i];
}
function execPipeline(count) {
  X.resetLedger(L);
  const b = L.balances;
  for (let i = 0; i < ACCOUNTS; i++) b[i] = BAL;
  X.processBatch(L, count);
  return {
    settled: L.stats[X.STAT_SETTLED_COUNT],
    sumAmt: L.stats[X.STAT_TOTAL_SETTLED_AMOUNT],
    sumFee: L.stats[X.STAT_TOTAL_FEES]
  };
}
function execPartial(count) {
  const amounts = L.amounts;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const amt = amounts[i];
    if (amt > 0 && amt <= 50000000) sum += amt;
  }
  return sum;
}

/* ---- build datasets, gate equivalence ------------------------------------ */

process.stdout.write('\nSINGULARITY :: benchmark matrix\n');
process.stdout.write('node ' + process.version + '  ' + process.platform + '/' + process.arch +
  '   ' + N.toLocaleString('en-US') + ' records, ' + ACCOUNTS.toLocaleString('en-US') + ' accounts\n');
process.stdout.write('forced GC: ' + (typeof global.gc === 'function' ? 'yes' : 'NO — rerun with --expose-gc') + '\n\n');

process.stdout.write('materialising datasets (3 x 1M objects)...\n');
const aosSeq = makeSeq();
const aosScat = makeScattered();
const aosPoly = makePoly();
if (typeof global.gc === 'function') { global.gc(); global.gc(); }

process.stdout.write('gating equivalence (every variant vs exec, per record)...\n');
const ref = execPipeline(N);
const refStatus = Uint8Array.from(L.statuses.subarray(0, N));
const refFee = Int32Array.from(L.fees.subarray(0, N));

function gatePipeline(name, kernel, records) {
  const r = kernel(records, N);
  assert.equal(r.settled, ref.settled, name + ' settled');
  assert.equal(r.sumAmt, ref.sumAmt, name + ' sumAmt');
  assert.equal(r.sumFee, ref.sumFee, name + ' sumFee');
  for (let i = 0; i < N; i++) {
    if (outStatus[i] !== refStatus[i]) throw new Error(name + ' status @' + i);
    if (outFee[i] !== refFee[i]) throw new Error(name + ' fee @' + i);
  }
}
gatePipeline('aos-seq', pipeSeq, aosSeq);
gatePipeline('aos-scat', pipeScat, aosScat);
gatePipeline('aos-poly', pipePoly, aosPoly);
const hofRes = hofPipeline(aosSeq, N);
assert.equal(hofRes.settled, ref.settled, 'hof settled');
assert.equal(hofRes.sumAmt, ref.sumAmt, 'hof sumAmt');
assert.equal(hofRes.sumFee, ref.sumFee, 'hof sumFee');
for (let i = 0; i < N; i++) {
  if (hofRes.statuses[i] !== refStatus[i]) throw new Error('hof status @' + i);
  if (hofRes.fees[i] !== refFee[i]) throw new Error('hof fee @' + i);
}
const refSum = execPartial(N);
assert.equal(partSeq(aosSeq, N), refSum);
assert.equal(partScat(aosScat, N), refSum);
assert.equal(partPoly(aosPoly, N), refSum);
assert.equal(hofPartial(aosSeq, N), refSum);
process.stdout.write('  all variants byte-identical to exec\n\n');

/* ---- timing -------------------------------------------------------------- */

function best(fn, warm, runs) {
  for (let i = 0; i < warm; i++) fn();
  let b = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now(); fn(); const d = performance.now() - t;
    if (d < b) b = d;
  }
  return b;
}
function ms(v) { return v.toFixed(2).padStart(9) + ' ms'; }
function ratio(base, v) { return (base / v).toFixed(2).padStart(7) + 'x'; }
function nsRec(v, n) { return ((v * 1e6) / n).toFixed(1).padStart(8) + ' ns'; }
const W = 78;
function rule(ch) { process.stdout.write(ch.repeat(W) + '\n'); }

/* full pipeline, 1M */
const tHof = best(function () { hofPipeline(aosSeq, N); }, 1, 5);
const tSeq = best(function () { pipeSeq(aosSeq, N); }, 2, 8);
const tScat = best(function () { pipeScat(aosScat, N); }, 2, 8);
const tPoly = best(function () { pipePoly(aosPoly, N); }, 2, 8);
const tExec = best(function () { execPipeline(N); }, 3, 12);

rule('=');
process.stdout.write('FULL PIPELINE  (validate + fee + balance; reads all 5 fields; 1M records)\n');
rule('=');
process.stdout.write('variant'.padEnd(34) + 'best'.padStart(12) + 'per rec'.padStart(11) + 'vs exec'.padStart(9) + '\n');
rule('-');
function row(name, t) {
  process.stdout.write(name.padEnd(34) + ms(t).padStart(12) + nsRec(t, N).padStart(11) + ratio(t, tExec).padStart(9) + '\n');
}
row('hof        (.reduce + spread)', tHof);
row('aos-seq    (plain loop, ordered)', tSeq);
row('aos-scat   (plain loop, scattered)', tScat);
row('aos-poly   (8 shapes, megamorphic)', tPoly);
row('soa-exec   (arena)', tExec);
rule('-');
process.stdout.write('reading: "vs exec" > 1 means the exec unit is faster than that variant\n\n');

/* partial scan, 1M */
const pHof = best(function () { hofPartial(aosSeq, N); }, 1, 5);
const pSeq = best(function () { partSeq(aosSeq, N); }, 2, 10);
const pScat = best(function () { partScat(aosScat, N); }, 2, 10);
const pPoly = best(function () { partPoly(aosPoly, N); }, 2, 10);
const pExec = best(function () { execPartial(N); }, 3, 12);

rule('=');
process.stdout.write('PARTIAL SCAN  (sum valid amounts; reads 1 of 5 fields; 1M records)\n');
rule('=');
process.stdout.write('variant'.padEnd(34) + 'best'.padStart(12) + 'per rec'.padStart(11) + 'vs exec'.padStart(9) + '\n');
rule('-');
function prow(name, t) {
  process.stdout.write(name.padEnd(34) + ms(t).padStart(12) + nsRec(t, N).padStart(11) + ratio(t, pExec).padStart(9) + '\n');
}
prow('hof        (.filter + .reduce)', pHof);
prow('aos-seq    (plain loop, ordered)', pSeq);
prow('aos-scat   (plain loop, scattered)', pScat);
prow('aos-poly   (8 shapes, megamorphic)', pPoly);
prow('soa-exec   (typed array)', pExec);
rule('-');
process.stdout.write('\n');

/* hot-subset sweep: first s records of the 1M pools */
rule('=');
process.stdout.write('HOT-SUBSET SWEEP  (full pipeline over the first s records of a 1M-object pool)\n');
rule('=');
process.stdout.write('records'.padStart(10) + 'aos-seq'.padStart(13) + 'aos-scat'.padStart(13) +
  'soa-exec'.padStart(13) + 'scat/exec'.padStart(12) + '\n');
rule('-');
for (let z = 0; z < SIZES.length; z++) {
  const s = SIZES[z];
  const runs = s <= 100000 ? 20 : 8;
  const a = best(function () { pipeSeq(aosSeq, s); }, 3, runs);
  const b = best(function () { pipeScat(aosScat, s); }, 3, runs);
  const e = best(function () { execPipeline(s); }, 3, runs);
  process.stdout.write(s.toLocaleString('en-US').padStart(10) + ms(a).padStart(13) +
    ms(b).padStart(13) + ms(e).padStart(13) + (b / e).toFixed(2).padStart(11) + 'x\n');
}
rule('-');
process.stdout.write('aos-scat models a hot subset of a long-lived object cache: array order is\n');
process.stdout.write('logical, heap position is not. The exec arena is immune by construction —\n');
process.stdout.write('its "objects" are dense rows, so there is no pointer to chase.\n\n');
