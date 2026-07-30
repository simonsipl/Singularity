'use strict';
/* THE CONTROL THE MAIN BENCHMARK WAS MISSING.
 *
 * tests/benchmark.js compares the exec unit against an idiomatic-HOF baseline,
 * which conflates two variables: AoS object layout AND allocation-heavy style
 * (.reduce, spread per record). This script isolates them: the same AoS objects
 * traversed by a competent plain for-loop with preallocated outputs and zero
 * per-record allocation.
 *
 * Measured result (Node v24, win32/x64): the honest baseline is ~13.0 ms vs the
 * exec's ~14.7 ms — 0.88x. On this workload, which reads EVERY field of every
 * record, the SoA arena contributes no traversal speedup at all; the entire
 * headline ratio in benchmark.js is attributable to the baseline's allocation
 * style. SoA layout earns its keep on partial-field scans, memory density
 * (18 MB off-heap vs 145 MB GC-scanned), zero-copy worker sharing, and
 * allocation churn (4.7 KB vs 210 MB per batch) — not on full-field scan speed.
 *
 * run: node tests/benchmark-honest.js */
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const X = require(path.join(__dirname, '..', 'src', 'exec', 'bulk-settlement.exec.js'));

const N = 1000000, ACCOUNTS = 4096, BAL = 15000000, SEED = 0x5EED1701;

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

/* same distribution as tests/benchmark.js */
const rng = makeRng(SEED);
const records = new Array(N);
for (let i = 0; i < N; i++) {
  const d0 = rng(), d1 = rng(), d2 = rng(), d3 = rng(); rng();
  let amount;
  if (d0 < 0.010) amount = -1 - ((d1 * 100000) | 0);
  else if (d0 < 0.015) amount = 50000001 + ((d1 * 1000000) | 0);
  else if (d0 < 0.715) amount = 100 + ((d1 * 9900) | 0);
  else if (d0 < 0.915) amount = 10000 + ((d1 * 90000) | 0);
  else if (d0 < 0.995) amount = 100000 + ((d1 * 900000) | 0);
  else amount = 1000000 + ((d1 * 4000000) | 0);
  let currency = d2 < 0.990 ? (d2 * 3.0303030303030303) | 0 : 3 + ((d2 - 0.990) * 500) | 0;
  if (currency > 7) currency = 7;
  let accountSlot = d3 < 0.995 ? (d3 * ACCOUNTS * 1.005025125628141) | 0
    : ACCOUNTS + ((d3 - 0.995) * 20000 | 0);
  records[i] = { id: i, accountSlot: accountSlot, amount: amount, currency: currency, flags: 0 };
}
/* reuse benchmark's flag draw position: regenerate flags with a fresh rng pass
 * is unnecessary — flags drawn above as the 5th draw; emulate cheaply */
const rng2 = makeRng(SEED);
for (let i = 0; i < N; i++) { rng2(); rng2(); rng2(); rng2(); records[i].flags = rng2() < 0.20 ? 1 : 0; }

/* HONEST human baseline: AoS objects, plain loop, preallocated outputs,
 * zero per-record allocation. */
const outStatus = new Uint8Array(N);
const outFee = new Int32Array(N);
const balances = new Float64Array(ACCOUNTS);
function honestHuman() {
  outStatus.fill(0); outFee.fill(0); balances.fill(BAL);
  let settled = 0, sumAmt = 0, sumFee = 0;
  for (let i = 0; i < N; i++) {
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
}

const L = X.allocLedger(N, ACCOUNTS);
for (let i = 0; i < N; i++) {
  const r = records[i];
  L.ids[i] = r.id; L.accounts[i] = r.accountSlot; L.amounts[i] = r.amount;
  L.currencies[i] = r.currency; L.flags[i] = r.flags;
}
function execRun() {
  X.resetLedger(L);
  const b = L.balances;
  for (let i = 0; i < ACCOUNTS; i++) b[i] = BAL;
  X.processBatch(L, N);
}

/* equivalence gate first */
const h = honestHuman();
execRun();
assert.equal(L.stats[X.STAT_SETTLED_COUNT], h.settled);
assert.equal(L.stats[X.STAT_TOTAL_SETTLED_AMOUNT], h.sumAmt);
assert.equal(L.stats[X.STAT_TOTAL_FEES], h.sumFee);
for (let i = 0; i < N; i++) {
  if (L.statuses[i] !== outStatus[i]) throw new Error('status divergence @' + i);
  if (L.fees[i] !== outFee[i]) throw new Error('fee divergence @' + i);
}
console.log('equivalence: identical (' + h.settled + ' settled)');

function best(fn, warm, runs) {
  for (let i = 0; i < warm; i++) fn();
  let b = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now(); fn(); const d = performance.now() - t;
    if (d < b) b = d;
  }
  return b;
}
const tHuman = best(honestHuman, 2, 8);
const tExec = best(execRun, 3, 12);
console.log('honest human (AoS, plain loop, zero-alloc): ' + tHuman.toFixed(2) + ' ms');
console.log('exec (SoA arena):                           ' + tExec.toFixed(2) + ' ms');
console.log('residual speedup attributable to layout:    ' + (tHuman / tExec).toFixed(2) + 'x');
