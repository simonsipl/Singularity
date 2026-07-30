'use strict';
/* SINGULARITY INGEST BENCHMARK
 * JSON.parse + manual pack  vs  direct JSON-to-arena scan.
 *
 * This measures the boundary README §3.3 calls the most common way an adoption
 * loses its win: if you parse to objects and then pack, you pay allocation for
 * every record to save arithmetic you were not spending.
 *
 * Equivalence-gated: both paths must produce identical typed arrays before any
 * timing is reported (§7).
 *
 * run: node --expose-gc tests/benchmark-ingest.js
 */

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const { makeIngester } = require(path.join(__dirname, '..', 'src', 'runtime', 'ingest.js'));

const N = 200000;
const FIELDS = ['id', 'accountSlot', 'amount', 'currency', 'flags'];
const WARM = 3, RUNS = 10;
const HAS_GC = typeof global.gc === 'function';

/* ---- payload ------------------------------------------------------------ */

const parts = new Array(N);
for (let i = 0; i < N; i++) {
  parts[i] = '{"id":' + i + ',"accountSlot":' + (i % 4096) +
    ',"amount":' + ((i % 71 === 0) ? -i : 100 + (i * 613) % 90000) +
    ',"currency":' + (i % 3) + ',"flags":' + (i & 1) + '}';
}
const json = '[' + parts.join(',') + ']';
const payloadMB = Buffer.byteLength(json) / 1048576;

function makeViews() {
  return [new Uint32Array(N), new Uint32Array(N), new Int32Array(N),
    new Uint8Array(N), new Uint8Array(N)];
}

/* ---- path A: JSON.parse then pack (what most services do) --------------- */

const viewsA = makeViews();
function parseAndPack() {
  const records = JSON.parse(json);
  const ids = viewsA[0], acc = viewsA[1], amt = viewsA[2], cur = viewsA[3], fl = viewsA[4];
  for (let i = 0, n = records.length; i < n; i++) {
    const r = records[i];
    ids[i] = r.id; acc[i] = r.accountSlot; amt[i] = r.amount;
    cur[i] = r.currency; fl[i] = r.flags;
  }
  return records.length;
}

/* ---- path B: direct scan into the arena --------------------------------- */

const ingest = makeIngester(FIELDS);
const viewsB = makeViews();
function directIngest() { return ingest(json, viewsB, N); }

/* ---- gate --------------------------------------------------------------- */

const nA = parseAndPack();
const nB = directIngest();
assert.equal(nA, N);
assert.equal(nB, N);
for (let f = 0; f < FIELDS.length; f++) {
  for (let i = 0; i < N; i++) {
    if (viewsA[f][i] !== viewsB[f][i]) {
      throw new Error('divergence in ' + FIELDS[f] + ' @' + i);
    }
  }
}

/* ---- measure ------------------------------------------------------------ */

function best(fn) {
  for (let i = 0; i < WARM; i++) fn();
  let b = Infinity;
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now(); fn(); const d = performance.now() - t;
    if (d < b) b = d;
  }
  return b;
}
function allocPerCall(fn, reps) {
  if (HAS_GC) { global.gc(); global.gc(); }
  const m0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < reps; i++) fn();
  return (process.memoryUsage().heapUsed - m0) / reps;
}

const tA = best(parseAndPack);
const tB = best(directIngest);
const aA = allocPerCall(parseAndPack, 10);
const aB = allocPerCall(directIngest, 10);

function ms(v) { return v.toFixed(2).padStart(9) + ' ms'; }
function mem(v) {
  if (Math.abs(v) < 1048576) return (v / 1024).toFixed(1).padStart(9) + ' KB';
  return (v / 1048576).toFixed(2).padStart(9) + ' MB';
}

const W = 74;
process.stdout.write('\nSINGULARITY :: ingest benchmark\n');
process.stdout.write('node ' + process.version + '   ' + N.toLocaleString('en-US') +
  ' records, ' + payloadMB.toFixed(1) + ' MB of JSON\n');
process.stdout.write('forced GC: ' + (HAS_GC ? 'yes' : 'NO — rerun with --expose-gc') + '\n');
process.stdout.write('output asserted identical across both paths\n\n');
process.stdout.write('='.repeat(W) + '\n');
process.stdout.write('path'.padEnd(30) + 'best'.padStart(12) + 'alloc/call'.padStart(14) +
  'per rec'.padStart(11) + '\n');
process.stdout.write('-'.repeat(W) + '\n');
process.stdout.write('JSON.parse + pack'.padEnd(30) + ms(tA).padStart(12) + mem(aA).padStart(14) +
  ((tA * 1e6 / N).toFixed(0) + ' ns').padStart(11) + '\n');
process.stdout.write('direct scan to arena'.padEnd(30) + ms(tB).padStart(12) + mem(aB).padStart(14) +
  ((tB * 1e6 / N).toFixed(0) + ' ns').padStart(11) + '\n');
process.stdout.write('-'.repeat(W) + '\n');
const faster = tA / tB;
process.stdout.write('time       ' + faster.toFixed(2) + 'x' +
  (faster < 1 ? '  — the direct scan is SLOWER' : '  — the direct scan is faster') + '\n');
process.stdout.write('allocation ' + (aB > 0 ? (aA / aB).toFixed(0) + 'x less' : 'unmeasurably less') + '\n');
process.stdout.write('-'.repeat(W) + '\n');
if (faster < 1) {
  process.stdout.write('\nRead this honestly: V8\'s JSON.parse is native C++ and hand-written\n');
  process.stdout.write('JavaScript does not beat it on raw parse throughput. Direct ingest is not\n');
  process.stdout.write('a speed optimisation — it is an ALLOCATION optimisation. It trades a few\n');
  process.stdout.write('ns/record for eliminating megabytes of per-batch garbage, which is what\n');
  process.stdout.write('actually drives GC pauses and tail latency.\n');
}
process.stdout.write('\nThe arena only pays off if data enters it ONCE. A service that parses to\n');
process.stdout.write('objects and then packs has paid both costs to save neither.\n\n');
