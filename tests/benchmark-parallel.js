'use strict';
/* SINGULARITY PARALLEL BENCHMARK
 * sequential processBatch vs sharded worker_threads fan-out over one shared
 * arena. Equivalence-gated per worker count before timing, per §7.
 *
 * Two costs are reported separately and honestly:
 *   - steady state: workers already spawned and attached, per-batch wall time
 *     (the shape of a long-lived service)
 *   - cold spawn: what the first batch pays to stand the pool up
 *
 * run: node tests/benchmark-parallel.js
 */

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const os = require('node:os');
const X = require(path.join(__dirname, '..', 'src', 'exec', 'bulk-settlement.exec.js'));

const N = 1000000, ACCOUNTS = 4096, BAL = 15000000, SEED = 0x5EED1701;
const WORKER_COUNTS = [2, 4, 8];
const WARM = 3, RUNS = 10;

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

function seed(L) {
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
    L.ids[i] = i; L.accounts[i] = account; L.amounts[i] = amount;
    L.currencies[i] = currency; L.flags[i] = d4 < 0.20 ? 1 : 0;
  }
}

function prep(L) {
  X.resetLedger(L);
  const b = L.balances;
  for (let i = 0; i < ACCOUNTS; i++) b[i] = BAL;
}

function snapshot(L) {
  return {
    statuses: Buffer.from(L.statuses.subarray(0, N)).toString('base64').slice(0, 64),
    settled: L.stats[X.STAT_SETTLED_COUNT],
    amt: L.stats[X.STAT_TOTAL_SETTLED_AMOUNT],
    fees: L.stats[X.STAT_TOTAL_FEES],
    balSum: (function () { let s = 0; for (let i = 0; i < ACCOUNTS; i++) s += L.balances[i]; return s; })()
  };
}

function ms(v) { return v.toFixed(2).padStart(9) + ' ms'; }

function spawnPool(L, W, statsSAB) {
  return new Promise(function (resolve, reject) {
    const workers = [];
    let ready = 0;
    const workerPath = path.join(__dirname, '..', 'src', 'exec', 'bulk-settlement.worker.js');
    for (let k = 0; k < W; k++) {
      const w = new Worker(workerPath, {
        workerData: { arena: L.arena, capacity: N, accountCount: ACCOUNTS, shard: k, shards: W, statsSAB: statsSAB }
      });
      w.on('error', reject);
      w.on('message', function (msg) {
        if (msg === 'ready' && ++ready === W) resolve(workers);
      });
      workers.push(w);
    }
  });
}

function runBatch(workers, count) {
  return new Promise(function (resolve) {
    let done = 0;
    function onDone(msg) {
      if (msg !== 'done') return;
      if (++done === workers.length) {
        for (let k = 0; k < workers.length; k++) workers[k].off('message', onDone);
        resolve();
      }
    }
    for (let k = 0; k < workers.length; k++) {
      workers[k].on('message', onDone);
      workers[k].postMessage({ count: count });
    }
  });
}

(async function main() {
  process.stdout.write('\nSINGULARITY :: parallel benchmark\n');
  process.stdout.write('node ' + process.version + '  ' + process.platform + '/' + process.arch +
    '   ' + os.cpus().length + ' logical cores\n');
  process.stdout.write(N.toLocaleString('en-US') + ' records, ' + ACCOUNTS.toLocaleString('en-US') +
    ' accounts, shard = account mod workers\n\n');

  const L = X.allocLedger(N, ACCOUNTS);
  seed(L);

  /* sequential reference + baseline timing */
  prep(L);
  X.processBatch(L, N);
  const ref = snapshot(L);

  let tSeq = Infinity;
  for (let i = 0; i < WARM; i++) { prep(L); X.processBatch(L, N); }
  for (let i = 0; i < RUNS; i++) {
    prep(L);
    const t0 = performance.now();
    X.processBatch(L, N);
    const d = performance.now() - t0;
    if (d < tSeq) tSeq = d;
  }

  const W78 = 78;
  process.stdout.write('='.repeat(W78) + '\n');
  process.stdout.write('workers'.padEnd(10) + 'spawn'.padStart(12) + 'steady batch'.padStart(15) +
    'vs sequential'.padStart(16) + '  equivalence\n');
  process.stdout.write('-'.repeat(W78) + '\n');
  process.stdout.write('1 (seq)'.padEnd(10) + '—'.padStart(12) + ms(tSeq).padStart(15) +
    '1.00x'.padStart(16) + '  reference\n');

  for (let wi = 0; wi < WORKER_COUNTS.length; wi++) {
    const W = WORKER_COUNTS[wi];
    const statsSAB = new SharedArrayBuffer(W << 7);
    const t0 = performance.now();
    const workers = await spawnPool(L, W, statsSAB);
    const spawnMs = performance.now() - t0;

    /* equivalence gate before timing */
    prep(L);
    await runBatch(workers, N);
    const slabs = [];
    for (let k = 0; k < W; k++) slabs.push(new Float64Array(statsSAB, k << 7, 16));
    X.foldShardStats(L, slabs, W);
    const got = snapshot(L);
    assert.deepEqual(got, ref, W + ' workers: output diverges from sequential');

    for (let i = 0; i < WARM; i++) { prep(L); await runBatch(workers, N); }
    let best = Infinity;
    for (let i = 0; i < RUNS; i++) {
      prep(L);
      const b0 = performance.now();
      await runBatch(workers, N);
      const d = performance.now() - b0;
      if (d < best) best = d;
    }

    process.stdout.write(String(W).padEnd(10) + ms(spawnMs).padStart(12) + ms(best).padStart(15) +
      ((tSeq / best).toFixed(2) + 'x').padStart(16) + '  byte-identical\n');

    for (let k = 0; k < W; k++) await workers[k].terminate();
  }

  process.stdout.write('-'.repeat(W78) + '\n');
  process.stdout.write('steady batch includes reset + balance seed (paid by both paths).\n');
  process.stdout.write('Every shard scans the full accounts array to find its records, so added\n');
  process.stdout.write('memory traffic grows with worker count — expect sublinear scaling on a\n');
  process.stdout.write('memory-bound kernel, and treat any superlinear number with suspicion.\n\n');
})().catch(function (e) { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
