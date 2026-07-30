'use strict';
/* SINGULARITY EXAMPLE — a salon's nightly client-profiling pass
 *
 *   node examples/salon-profiler.demo.js
 *
 * The adoption scenario this framework is actually for. A booking platform has
 * client cards and an appointment history. Its CRUD endpoints are ordinary and
 * stay ordinary. One nightly analytics pass is compiled.
 *
 * Everything upstream of the arena is mocked: in production the loader is a
 * cursor over Postgres writing straight into the typed arrays, never through
 * intermediate objects (see README §3.3 — that boundary is where an adoption
 * usually loses the win).
 */

const { performance } = require('node:perf_hooks');
const X = require('../src/exec/visit-profiling.exec.js');

const CLIENTS = 50000;
const VISITS = 600000;
const TODAY = 20000;              /* arbitrary fixed epoch, whole days */
const SEED = 0xC0FFEE;

/* ---- mock data ---------------------------------------------------------- */

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

/* Writes mock client cards and appointments straight into the arena. No client
 * object is ever constructed — this is the shape a real loader should have. */
function loadMockSalon(P, clientCount, visitCount) {
  const rng = makeRng(SEED);

  for (let i = 0; i < clientCount; i++) {
    const bad = rng();
    P.cliNameLength[i] = bad < 0.01 ? 0 : 3 + ((rng() * 20) | 0);
    P.cliPhoneDigits[i] = bad < 0.02 && bad >= 0.01 ? 4 : 11;
    /* ~4% share a phone with an earlier client -> DUPLICATE_PHONE */
    P.cliPhoneHash[i] = bad < 0.06 && i > 100 ? (i - 100) * 2654435761 >>> 0
      : (i * 2654435761) >>> 0;
    P.cliCreatedDay[i] = TODAY - 30 - ((rng() * 1500) | 0);
    P.cliConsentFlags[i] = rng() < 0.7 ? 1 : 0;
  }

  /* Visit distribution is deliberately skewed: most clients come rarely, a small
   * tail comes constantly. That tail is what the profiler exists to find. */
  for (let v = 0; v < visitCount; v++) {
    const r = rng();
    let slot;
    if (r < 0.45) slot = (rng() * clientCount * 0.05) | 0;        /* the loyal 5% */
    else if (r < 0.75) slot = (rng() * clientCount * 0.25) | 0;   /* the regulars */
    else slot = (rng() * clientCount) | 0;                        /* everyone else */

    const recencyBias = rng();
    let daysAgo;
    if (recencyBias < 0.55) daysAgo = (rng() * 90) | 0;
    else if (recencyBias < 0.8) daysAgo = 90 + ((rng() * 200) | 0);
    else daysAgo = 300 + ((rng() * 500) | 0);

    P.visClient[v] = slot;
    P.visDay[v] = TODAY - daysAgo;
    P.visSpend[v] = 1500 + ((rng() * 18000) | 0);
    P.visFlags[v] = rng() < 0.07 ? X.FLAG_NO_SHOW : 0;
  }
}

/* ---- run ---------------------------------------------------------------- */

const SEGMENT_NAMES = ['unsegmented', 'never visited', 'new', 'regular',
  'VIP', 'at risk', 'lapsed'];

function money(cents) {
  return (cents / 100).toLocaleString('en-GB', {
    style: 'currency', currency: 'GBP', maximumFractionDigits: 0
  });
}
function pct(a, b) { return b === 0 ? '0.0%' : (100 * a / b).toFixed(1) + '%'; }
function bar(n, max, width) {
  const filled = max === 0 ? 0 : Math.round((n / max) * width);
  return '#'.repeat(filled) + '.'.repeat(width - filled);
}

process.stdout.write('\nSALON NIGHTLY PROFILE\n');
process.stdout.write('node ' + process.version + '   ' +
  CLIENTS.toLocaleString('en-US') + ' client cards, ' +
  VISITS.toLocaleString('en-US') + ' appointments\n\n');

const P = X.allocProfiler(CLIENTS, VISITS);
process.stdout.write('arena: ' + (P.byteLength / 1048576).toFixed(2) +
  ' MB, allocated once, off-heap\n');

X.resetProfiler(P);
const tLoad = performance.now();
loadMockSalon(P, CLIENTS, VISITS);
const loadMs = performance.now() - tLoad;

const t0 = performance.now();
X.registerClients(P, CLIENTS, TODAY);
const t1 = performance.now();
X.foldVisits(P, VISITS, CLIENTS, TODAY);
const t2 = performance.now();
X.segmentClients(P, CLIENTS, TODAY);
const t3 = performance.now();

const s = P.stats;

process.stdout.write('\nCARD REGISTRATION\n');
process.stdout.write('  active                ' + String(s[X.STAT_ACTIVE_CLIENTS]).padStart(9) +
  '   ' + pct(s[X.STAT_ACTIVE_CLIENTS], CLIENTS) + '\n');
process.stdout.write('  rejected              ' + String(s[X.STAT_REJECTED_CLIENTS]).padStart(9) + '\n');
process.stdout.write('    empty name          ' + String(s[X.STAT_REJ_INVALID_NAME]).padStart(9) + '\n');
process.stdout.write('    implausible phone   ' + String(s[X.STAT_REJ_INVALID_PHONE]).padStart(9) + '\n');
process.stdout.write('    duplicate phone     ' + String(s[X.STAT_REJ_DUPLICATE_PHONE]).padStart(9) + '\n');
process.stdout.write('    future dated        ' + String(s[X.STAT_REJ_FUTURE_DATED]).padStart(9) + '\n');

process.stdout.write('\nAPPOINTMENTS\n');
process.stdout.write('  attended              ' + String(s[X.STAT_COUNTED_VISITS]).padStart(9) + '\n');
process.stdout.write('  no-show               ' + String(s[X.STAT_NO_SHOW_VISITS]).padStart(9) +
  '   ' + pct(s[X.STAT_NO_SHOW_VISITS], s[X.STAT_COUNTED_VISITS] + s[X.STAT_NO_SHOW_VISITS]) +
  ' of bookings\n');
process.stdout.write('  rejected              ' + String(s[X.STAT_REJECTED_VISITS]).padStart(9) + '\n');
process.stdout.write('  revenue               ' + money(s[X.STAT_TOTAL_SPEND]).padStart(9) + '\n');

process.stdout.write('\nSEGMENTS\n');
let maxSeg = 0;
for (let i = 1; i < X.SEG_COUNT; i++) {
  if (P.segmentCounts[i] > maxSeg) maxSeg = P.segmentCounts[i];
}
for (let i = 1; i < X.SEG_COUNT; i++) {
  const n = P.segmentCounts[i];
  process.stdout.write('  ' + SEGMENT_NAMES[i].padEnd(15) + String(n).padStart(8) +
    '  ' + pct(n, s[X.STAT_ACTIVE_CLIENTS]).padStart(6) + '  ' + bar(n, maxSeg, 32) + '\n');
}

/* ---- "who is visiting a lot?" ------------------------------------------ */

process.stdout.write('\nMOST FREQUENT CLIENTS\n');
process.stdout.write('  ' + 'slot'.padStart(7) + 'visits'.padStart(8) + 'no-show'.padStart(9) +
  'cadence'.padStart(9) + 'spend'.padStart(12) + '   segment\n');

/* top-N by attended visits, selected with a fixed-size insertion scan so the
 * scan itself allocates nothing per client */
const TOP = 12;
const topSlot = new Int32Array(TOP).fill(-1);
const topVisits = new Int32Array(TOP);
for (let i = 0; i < CLIENTS; i++) {
  if (P.cliStatus[i] !== X.CLIENT_ACTIVE) continue;
  const v = P.cliVisitCount[i];
  if (v <= topVisits[TOP - 1]) continue;
  let k = TOP - 1;
  while (k > 0 && topVisits[k - 1] < v) {
    topVisits[k] = topVisits[k - 1];
    topSlot[k] = topSlot[k - 1];
    k--;
  }
  topVisits[k] = v;
  topSlot[k] = i;
}
for (let i = 0; i < TOP; i++) {
  const slot = topSlot[i];
  if (slot < 0) continue;
  const flagged = (P.cliRiskFlags[slot] & X.RISK_UNRELIABLE) !== 0;
  process.stdout.write('  ' + String(slot).padStart(7) +
    String(P.cliVisitCount[slot]).padStart(8) +
    String(P.cliNoShowCount[slot]).padStart(9) +
    (String(P.cliCadence[slot]) + 'd').padStart(9) +
    money(P.cliTotalSpend[slot]).padStart(12) +
    '   ' + SEGMENT_NAMES[P.cliSegment[slot]] +
    (flagged ? '  [UNRELIABLE]' : '') + '\n');
}

process.stdout.write('\n  clients flagged unreliable: ' + s[X.STAT_UNRELIABLE_CLIENTS] +
  '  (no-show rate >= 30% over >= 4 bookings)\n');

process.stdout.write('\nTIMING\n');
process.stdout.write('  load into arena       ' + loadMs.toFixed(2).padStart(8) + ' ms   (mocked; a real loader streams from the DB)\n');
process.stdout.write('  register cards        ' + (t1 - t0).toFixed(2).padStart(8) + ' ms\n');
process.stdout.write('  fold visits           ' + (t2 - t1).toFixed(2).padStart(8) + ' ms\n');
process.stdout.write('  segment               ' + (t3 - t2).toFixed(2).padStart(8) + ' ms\n');
process.stdout.write('  ------------------------------\n');
process.stdout.write('  profiling pass        ' + (t3 - t0).toFixed(2).padStart(8) + ' ms   for ' +
  (CLIENTS + VISITS).toLocaleString('en-US') + ' records\n\n');
