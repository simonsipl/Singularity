'use strict';
/* SINGULARITY LOOPBACK VERIFICATION
 * unit under test: src/exec/bulk-settlement.exec.js
 * contract:        features/payments/bulk-settlement.intent.ts
 * zero dependencies, node:assert/strict only. */

const assert = require('node:assert/strict');
const X = require('../../src/exec/bulk-settlement.exec.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  process.stdout.write('  ok  ' + name + '\n');
}

/* ---- harness ------------------------------------------------------------ */

/* seeds a ledger from plain tuples and runs one batch. Test-only convenience;
 * allocation here is irrelevant, this file is not a hot path. */
function run(records, balances, capacityOverride) {
  const cap = capacityOverride === undefined ? Math.max(records.length, 1) : capacityOverride;
  const L = X.allocLedger(cap, balances.length);
  X.resetLedger(L);
  for (let i = 0; i < balances.length; i++) L.balances[i] = balances[i];
  for (let i = 0; i < records.length; i++) {
    L.ids[i] = records[i].id;
    L.accounts[i] = records[i].accountSlot;
    L.amounts[i] = records[i].amount;
    L.currencies[i] = records[i].currency;
    L.flags[i] = records[i].flags;
  }
  const settled = X.processBatch(L, records.length);
  return { L: L, settled: settled };
}

function rec(id, accountSlot, amount, currency, flags) {
  return { id: id, accountSlot: accountSlot, amount: amount, currency: currency, flags: flags };
}

/* independent re-derivation of R3 straight from the intent prose, written
 * deliberately differently from the exec so it is not a copy of the thing
 * it is checking. */
function feeFromSpec(amount, currency, flags) {
  let bps, flat;
  if (amount < 10000) { bps = 290; flat = 30; }
  else if (amount < 100000) { bps = 250; flat = 25; }
  else if (amount < 1000000) { bps = 190; flat = 20; }
  else { bps = 120; flat = 0; }
  let fee = Math.floor((amount * bps) / 10000) + flat;
  if (currency !== 0) fee += Math.floor((amount * 15) / 10000);
  if ((flags & 1) !== 0) fee += Math.floor((fee * 5000) / 10000);
  if (fee > 5000) return 5000;
  if (fee < 30) return 30;
  return fee;
}

process.stdout.write('\nSINGULARITY :: payment-processor loopback\n\n');

/* ---- R6: arena layout -------------------------------------------------- */

check('arena is a SharedArrayBuffer, 8-byte aligned, single allocation', function () {
  const L = X.allocLedger(1000, 64);
  assert.ok(L.arena instanceof SharedArrayBuffer);
  assert.equal(L.byteLength % 8, 0);
  assert.equal(L.arena.byteLength, L.byteLength);
  /* every view must be backed by that one arena — no stray allocations */
  const views = ['stats', 'balances', 'ids', 'accounts', 'amounts', 'fees', 'currencies', 'flags', 'statuses'];
  for (let i = 0; i < views.length; i++) assert.equal(L[views[i]].buffer, L.arena, views[i]);
  assert.equal(L.stats.length, X.STAT_SLOTS);
  assert.equal(L.balances.length, 64);
  assert.equal(L.amounts.length, 1000);
  const expected = (X.STAT_SLOTS << 3) + (64 << 3) + (1000 << 4) + 1000 * 3;
  assert.equal(L.byteLength, (expected + 7) & ~7);
});

check('typed views have the widths the contract demands', function () {
  const L = X.allocLedger(4, 2);
  assert.ok(L.stats instanceof Float64Array);
  assert.ok(L.balances instanceof Float64Array);
  assert.ok(L.ids instanceof Uint32Array);
  assert.ok(L.accounts instanceof Uint32Array);
  assert.ok(L.amounts instanceof Int32Array);
  assert.ok(L.fees instanceof Int32Array);
  assert.ok(L.currencies instanceof Uint8Array);
  assert.ok(L.flags instanceof Uint8Array);
  assert.ok(L.statuses instanceof Uint8Array);
});

/* ---- R3: fee computation, differential + boundaries -------------------- */

check('fee.differential: inlined loop math === computeFee === spec re-derivation', function () {
  /* sweep the interesting neighbourhoods densely, the rest coarsely */
  const probes = [];
  for (let a = 1; a <= 2000; a++) probes.push(a);
  const edges = [9998, 9999, 10000, 10001, 99998, 99999, 100000, 100001,
    999998, 999999, 1000000, 1000001, 49999999, 50000000];
  for (let i = 0; i < edges.length; i++) probes.push(edges[i]);
  for (let a = 2000; a < 50000000; a += 4999) probes.push(a);

  const recs = [];
  for (let p = 0; p < probes.length; p++) {
    for (let cur = 0; cur <= 2; cur++) {
      for (let fl = 0; fl <= 1; fl++) recs.push(rec(0, 0, probes[p], cur, fl));
    }
  }
  /* balance large enough that nothing is rejected for funds */
  const bal = [Number.MAX_SAFE_INTEGER];
  const r = run(recs, bal);
  for (let i = 0; i < recs.length; i++) {
    const spec = feeFromSpec(recs[i].amount, recs[i].currency, recs[i].flags);
    assert.equal(r.L.fees[i], spec, 'loop vs spec @' + JSON.stringify(recs[i]));
    assert.equal(X.computeFee(recs[i].amount, recs[i].currency, recs[i].flags), spec,
      'computeFee vs spec @' + JSON.stringify(recs[i]));
  }
  assert.equal(r.L.stats[X.STAT_SETTLED_COUNT], recs.length);
});

check('fee.1_tier: tier selection is exact at every boundary', function () {
  const big = [Number.MAX_SAFE_INTEGER];
  /* 9999 -> T0: trunc(9999*290/10000)=289, +30 = 319 */
  assert.equal(run([rec(0, 0, 9999, 0, 0)], big).L.fees[0], 319);
  /* 10000 -> T1: trunc(10000*250/10000)=250, +25 = 275 */
  assert.equal(run([rec(0, 0, 10000, 0, 0)], big).L.fees[0], 275);
  /* 99999 -> T1: trunc(99999*250/10000)=2499, +25 = 2524 */
  assert.equal(run([rec(0, 0, 99999, 0, 0)], big).L.fees[0], 2524);
  /* 100000 -> T2: trunc(100000*190/10000)=1900, +20 = 1920 */
  assert.equal(run([rec(0, 0, 100000, 0, 0)], big).L.fees[0], 1920);
  /* 999999 -> T2: trunc(999999*190/10000)=18999 +20 = 19019 -> capped 5000 */
  assert.equal(run([rec(0, 0, 999999, 0, 0)], big).L.fees[0], 5000);
  /* 1000000 -> T3: trunc(1000000*120/10000)=12000 -> capped 5000 */
  assert.equal(run([rec(0, 0, 1000000, 0, 0)], big).L.fees[0], 5000);
});

check('fee.2_fx: FX surcharge applies to EUR/GBP only, never to USD', function () {
  const big = [Number.MAX_SAFE_INTEGER];
  /* 50000: T1 -> 1250+25 = 1275. FX: trunc(50000*15/10000)=75 -> 1350 */
  assert.equal(run([rec(0, 0, 50000, 0, 0)], big).L.fees[0], 1275);
  assert.equal(run([rec(0, 0, 50000, 1, 0)], big).L.fees[0], 1350);
  assert.equal(run([rec(0, 0, 50000, 2, 0)], big).L.fees[0], 1350);
});

check('fee.3_priority: +50% truncating, applied after FX', function () {
  const big = [Number.MAX_SAFE_INTEGER];
  /* 1000: T0 -> trunc(1000*290/10000)=29, +30 = 59. priority: +trunc(59/2)=29 -> 88 */
  assert.equal(run([rec(0, 0, 1000, 0, 0)], big).L.fees[0], 59);
  assert.equal(run([rec(0, 0, 1000, 0, 1)], big).L.fees[0], 88);
  /* order proof: FX first then priority. 50000 EUR -> 1350, +675 = 2025.
   * priority-before-FX would give 1275+637=1912 +75 = 1987. */
  assert.equal(run([rec(0, 0, 50000, 1, 1)], big).L.fees[0], 2025);
});

check('fee.3_priority: unset bits above bit 0 do not trigger the surcharge', function () {
  const big = [Number.MAX_SAFE_INTEGER];
  assert.equal(run([rec(0, 0, 1000, 0, 2)], big).L.fees[0], 59);
  assert.equal(run([rec(0, 0, 1000, 0, 254)], big).L.fees[0], 59);
  assert.equal(run([rec(0, 0, 1000, 0, 255)], big).L.fees[0], 88);
});

check('fee.4_ceiling / fee.5_floor clamp on both sides', function () {
  const big = [Number.MAX_SAFE_INTEGER];
  /* floor: amount 1 -> trunc(290/10000)=0, +30 = 30, already at MIN */
  assert.equal(run([rec(0, 0, 1, 0, 0)], big).L.fees[0], X.LIMIT_MIN_FEE);
  /* ceiling, all three points. T2: fee = trunc(a*190/10000) + 20.
   * 262105 -> 4999 (one below cap, unclamped)
   * 262106 -> 5000 (lands exactly on the cap, unclamped)
   * 262158 -> 5001 raw, must be clamped down to 5000 */
  assert.equal(run([rec(0, 0, 262105, 0, 0)], big).L.fees[0], 4999);
  assert.equal(run([rec(0, 0, 262106, 0, 0)], big).L.fees[0], 5000);
  assert.equal(run([rec(0, 0, 262158, 0, 0)], big).L.fees[0], 5000);
  /* and the maximum legal payment clamps too */
  assert.equal(run([rec(0, 0, X.LIMIT_MAX_PAYMENT_AMOUNT, 2, 1)], big).L.fees[0], X.LIMIT_MAX_FEE);
});

check('fee never leaves the declared [MIN_FEE, MAX_FEE] envelope across a wide sweep', function () {
  for (let a = 1; a < 50000000; a += 7919) {
    for (let cur = 0; cur <= 2; cur++) {
      for (let fl = 0; fl <= 1; fl++) {
        const f = X.computeFee(a, cur, fl);
        assert.ok(f >= X.LIMIT_MIN_FEE && f <= X.LIMIT_MAX_FEE, 'envelope @' + a + '/' + cur + '/' + fl);
        assert.ok(Number.isInteger(f), 'non-integer fee @' + a);
      }
    }
  }
});

/* ---- R2: validation gate, each state in isolation ---------------------- */

check('validate.1_amount_positive: zero and negative -> INVALID_AMOUNT, fee 0', function () {
  const r = run([rec(1, 0, 0, 0, 0), rec(2, 0, -1, 0, 0), rec(3, 0, -50000, 0, 0)], [1000000]);
  for (let i = 0; i < 3; i++) {
    assert.equal(r.L.statuses[i], X.STATUS_INVALID_AMOUNT);
    assert.equal(r.L.fees[i], 0);
  }
  assert.equal(r.L.stats[X.STAT_REJ_INVALID_AMOUNT], 3);
  assert.equal(r.L.balances[0], 1000000, 'balance untouched');
});

check('validate.2_amount_ceiling: MAX valid, MAX+1 rejected', function () {
  const big = [Number.MAX_SAFE_INTEGER];
  const at = run([rec(1, 0, X.LIMIT_MAX_PAYMENT_AMOUNT, 0, 0)], big);
  assert.equal(at.L.statuses[0], X.STATUS_SETTLED);
  const over = run([rec(1, 0, X.LIMIT_MAX_PAYMENT_AMOUNT + 1, 0, 0)], big);
  assert.equal(over.L.statuses[0], X.STATUS_AMOUNT_EXCEEDS_LIMIT);
  assert.equal(over.L.fees[0], 0);
  assert.equal(over.L.stats[X.STAT_REJ_AMOUNT_EXCEEDS_LIMIT], 1);
});

check('validate.3_currency_known: 0..2 accepted, 3+ -> UNSUPPORTED_CURRENCY', function () {
  const big = [Number.MAX_SAFE_INTEGER];
  for (let c = 0; c <= 2; c++) {
    assert.equal(run([rec(1, 0, 5000, c, 0)], big).L.statuses[0], X.STATUS_SETTLED, 'currency ' + c);
  }
  for (let c = 3; c <= 255; c++) {
    const r = run([rec(1, 0, 5000, c, 0)], big);
    assert.equal(r.L.statuses[0], X.STATUS_UNSUPPORTED_CURRENCY, 'currency ' + c);
    assert.equal(r.L.fees[0], 0);
  }
});

check('validate.4_account_known: last slot valid, one past the end rejected', function () {
  const balances = [100000, 100000, 100000];
  const okr = run([rec(1, 2, 5000, 0, 0)], balances);
  assert.equal(okr.L.statuses[0], X.STATUS_SETTLED);
  const bad = run([rec(1, 3, 5000, 0, 0)], balances);
  assert.equal(bad.L.statuses[0], X.STATUS_UNKNOWN_ACCOUNT);
  assert.equal(bad.L.fees[0], 0);
  const way = run([rec(1, 4294967295, 5000, 0, 0)], balances);
  assert.equal(way.L.statuses[0], X.STATUS_UNKNOWN_ACCOUNT);
});

check('validate.order: precedence is amount > ceiling > currency > account', function () {
  const balances = [0];
  /* negative amount AND bad currency AND bad account -> INVALID_AMOUNT wins */
  assert.equal(run([rec(1, 99, -5, 200, 0)], balances).L.statuses[0], X.STATUS_INVALID_AMOUNT);
  /* over-limit AND bad currency AND bad account -> AMOUNT_EXCEEDS_LIMIT wins */
  assert.equal(run([rec(1, 99, 60000000, 200, 0)], balances).L.statuses[0], X.STATUS_AMOUNT_EXCEEDS_LIMIT);
  /* bad currency AND bad account -> UNSUPPORTED_CURRENCY wins */
  assert.equal(run([rec(1, 99, 5000, 200, 0)], balances).L.statuses[0], X.STATUS_UNSUPPORTED_CURRENCY);
  /* bad account AND zero balance -> UNKNOWN_ACCOUNT wins over INSUFFICIENT_FUNDS */
  assert.equal(run([rec(1, 99, 5000, 0, 0)], balances).L.statuses[0], X.STATUS_UNKNOWN_ACCOUNT);
});

/* ---- R4: balance semantics -------------------------------------------- */

check('balance.check_boundary: balance == amount+fee settles to exactly zero', function () {
  const amount = 5000;
  const fee = X.computeFee(amount, 0, 0);
  const exact = run([rec(1, 0, amount, 0, 0)], [amount + fee]);
  assert.equal(exact.L.statuses[0], X.STATUS_SETTLED);
  assert.equal(exact.L.balances[0], 0);
  const short = run([rec(1, 0, amount, 0, 0)], [amount + fee - 1]);
  assert.equal(short.L.statuses[0], X.STATUS_INSUFFICIENT_FUNDS);
  assert.equal(short.L.balances[0], amount + fee - 1, 'nothing debited');
});

check('balance.debit_total: exactly amount+fee leaves the account', function () {
  const amount = 250000;
  const fee = X.computeFee(amount, 1, 1);
  const r = run([rec(1, 0, amount, 1, 1)], [10000000]);
  assert.equal(r.L.statuses[0], X.STATUS_SETTLED);
  assert.equal(r.L.balances[0], 10000000 - amount - fee);
  assert.equal(r.L.fees[0], fee);
});

check('balance.reject_records_fee: INSUFFICIENT_FUNDS reports the fee it would have charged', function () {
  const amount = 400000;
  const fee = X.computeFee(amount, 0, 0);
  const r = run([rec(1, 0, amount, 0, 0)], [amount]); /* enough for amount, not for the fee */
  assert.equal(r.L.statuses[0], X.STATUS_INSUFFICIENT_FUNDS);
  assert.equal(r.L.fees[0], fee);
  assert.ok(fee > 0);
  assert.equal(r.L.balances[0], amount);
  assert.equal(r.L.stats[X.STAT_REJ_INSUFFICIENT_FUNDS], 1);
  assert.equal(r.L.stats[X.STAT_TOTAL_FEES], 0, 'unsettled fee must not enter totals');
});

check('R1 traversal: sequential depletion, later records see earlier debits', function () {
  const amount = 10000;
  const fee = X.computeFee(amount, 0, 0); /* 275 */
  const per = amount + fee;
  /* fund exactly three payments */
  const r = run([
    rec(1, 0, amount, 0, 0),
    rec(2, 0, amount, 0, 0),
    rec(3, 0, amount, 0, 0),
    rec(4, 0, amount, 0, 0)
  ], [per * 3]);
  assert.deepEqual(Array.from(r.L.statuses.subarray(0, 4)), [
    X.STATUS_SETTLED, X.STATUS_SETTLED, X.STATUS_SETTLED, X.STATUS_INSUFFICIENT_FUNDS
  ]);
  assert.equal(r.L.balances[0], 0);
  assert.equal(r.L.stats[X.STAT_SETTLED_COUNT], 3);
  assert.equal(r.L.stats[X.STAT_REJECTED_COUNT], 1);
});

check('balance.no_overdraft: no balance goes negative under adversarial interleaving', function () {
  const balances = [50000, 50000, 50000, 50000];
  const recs = [];
  for (let i = 0; i < 400; i++) recs.push(rec(i, i & 3, 1000 + ((i * 37) % 9000), i % 3, i & 1));
  const r = run(recs, balances);
  for (let i = 0; i < balances.length; i++) {
    assert.ok(r.L.balances[i] >= 0, 'account ' + i + ' overdrawn: ' + r.L.balances[i]);
  }
  /* independently re-derive the final balances */
  const shadow = [50000, 50000, 50000, 50000];
  for (let i = 0; i < recs.length; i++) {
    const f = feeFromSpec(recs[i].amount, recs[i].currency, recs[i].flags);
    const t = recs[i].amount + f;
    if (shadow[recs[i].accountSlot] >= t) shadow[recs[i].accountSlot] -= t;
  }
  assert.deepEqual(Array.from(r.L.balances), shadow);
});

check('multi-account isolation: a debit touches exactly one slot', function () {
  const r = run([rec(1, 1, 20000, 0, 0)], [777, 999999, 555]);
  assert.equal(r.L.statuses[0], X.STATUS_SETTLED);
  assert.equal(r.L.balances[0], 777);
  assert.equal(r.L.balances[2], 555);
  assert.equal(r.L.balances[1], 999999 - 20000 - X.computeFee(20000, 0, 0));
});

/* ---- R5: aggregation --------------------------------------------------- */

check('aggregate.counters: settled + rejected === count, one counter per record', function () {
  const recs = [
    rec(1, 0, 5000, 0, 0),        /* settled */
    rec(2, 0, 0, 0, 0),           /* invalid */
    rec(3, 0, 99999999, 0, 0),    /* over limit */
    rec(4, 0, 5000, 9, 0),        /* bad currency */
    rec(5, 7, 5000, 0, 0),        /* bad account */
    rec(6, 0, 40000000, 0, 0),    /* insufficient */
    rec(7, 0, 5000, 1, 1)         /* settled */
  ];
  const r = run(recs, [200000]);
  const s = r.L.stats;
  assert.equal(s[X.STAT_SETTLED_COUNT], 2);
  assert.equal(s[X.STAT_REJECTED_COUNT], 5);
  assert.equal(s[X.STAT_SETTLED_COUNT] + s[X.STAT_REJECTED_COUNT], recs.length);
  assert.equal(s[X.STAT_REJ_INVALID_AMOUNT], 1);
  assert.equal(s[X.STAT_REJ_AMOUNT_EXCEEDS_LIMIT], 1);
  assert.equal(s[X.STAT_REJ_UNSUPPORTED_CURRENCY], 1);
  assert.equal(s[X.STAT_REJ_UNKNOWN_ACCOUNT], 1);
  assert.equal(s[X.STAT_REJ_INSUFFICIENT_FUNDS], 1);
  const tally = s[X.STAT_REJ_INVALID_AMOUNT] + s[X.STAT_REJ_AMOUNT_EXCEEDS_LIMIT] +
    s[X.STAT_REJ_UNSUPPORTED_CURRENCY] + s[X.STAT_REJ_UNKNOWN_ACCOUNT] + s[X.STAT_REJ_INSUFFICIENT_FUNDS];
  assert.equal(tally, s[X.STAT_REJECTED_COUNT]);
  assert.equal(r.settled, 2, 'return value mirrors settled count');
});

check('aggregate.totals_settled_only: rejected amounts and fees excluded', function () {
  const r = run([
    rec(1, 0, 5000, 0, 0),
    rec(2, 0, 7000, 0, 0),
    rec(3, 0, -9, 0, 0),
    rec(4, 1, 999999, 0, 0)  /* unknown account */
  ], [1000000]);
  const f1 = X.computeFee(5000, 0, 0), f2 = X.computeFee(7000, 0, 0);
  assert.equal(r.L.stats[X.STAT_TOTAL_SETTLED_AMOUNT], 12000);
  assert.equal(r.L.stats[X.STAT_TOTAL_FEES], f1 + f2);
});

check('aggregate.precision: totals above 2^31 stay exact in the Float64 slots', function () {
  const n = 200;
  const amount = X.LIMIT_MAX_PAYMENT_AMOUNT;       /* 5e7 */
  const fee = X.computeFee(amount, 0, 0);          /* 5000 */
  const recs = [];
  for (let i = 0; i < n; i++) recs.push(rec(i, 0, amount, 0, 0));
  const r = run(recs, [(amount + fee) * n]);
  const total = amount * n;                        /* 1e10, well past 2^31 */
  assert.ok(total > 2147483647);
  assert.equal(r.L.stats[X.STAT_TOTAL_SETTLED_AMOUNT], total);
  assert.equal(r.L.stats[X.STAT_TOTAL_FEES], fee * n);
  assert.equal(r.L.stats[X.STAT_SETTLED_COUNT], n);
  assert.equal(r.L.balances[0], 0);
});

/* ---- R6: reentrancy, degenerate shapes -------------------------------- */

check('empty batch is a no-op', function () {
  const L = X.allocLedger(16, 4);
  X.resetLedger(L);
  L.balances[0] = 5000;
  const settled = X.processBatch(L, 0);
  assert.equal(settled, 0);
  for (let i = 0; i < X.STAT_SLOTS; i++) assert.equal(L.stats[i], 0);
  assert.equal(L.balances[0], 5000);
  for (let i = 0; i < 16; i++) assert.equal(L.statuses[i], X.STATUS_PENDING);
});

check('single-element batch', function () {
  const r = run([rec(1, 0, 12345, 0, 0)], [999999]);
  assert.equal(r.settled, 1);
  assert.equal(r.L.statuses[0], X.STATUS_SETTLED);
});

check('count < capacity: the tail stays PENDING and untouched', function () {
  const recs = [rec(1, 0, 5000, 0, 0), rec(2, 0, 5000, 0, 0)];
  const r = run(recs, [999999], 64);
  assert.equal(r.L.statuses[0], X.STATUS_SETTLED);
  assert.equal(r.L.statuses[1], X.STATUS_SETTLED);
  for (let i = 2; i < 64; i++) {
    assert.equal(r.L.statuses[i], X.STATUS_PENDING, 'tail status @' + i);
    assert.equal(r.L.fees[i], 0, 'tail fee @' + i);
  }
  assert.equal(r.L.stats[X.STAT_SETTLED_COUNT], 2);
});

check('exec.reentrant: reset + replay is byte-identical', function () {
  const cap = 500;
  const accounts = 8;
  const L = X.allocLedger(cap, accounts);
  const seedBalances = [];
  for (let i = 0; i < accounts; i++) seedBalances.push(300000 + i * 1000);

  for (let i = 0; i < cap; i++) {
    L.ids[i] = i;
    L.accounts[i] = i % (accounts + 1);              /* every 9th is an unknown account */
    L.amounts[i] = (i % 71 === 0) ? -i : 900 + ((i * 613) % 60000);
    L.currencies[i] = (i % 29 === 0) ? 5 : i % 3;     /* sprinkle bad currencies */
    L.flags[i] = i & 1;
  }

  function pass() {
    X.resetLedger(L);
    for (let i = 0; i < accounts; i++) L.balances[i] = seedBalances[i];
    X.processBatch(L, cap);
    return {
      statuses: Array.from(L.statuses),
      fees: Array.from(L.fees),
      stats: Array.from(L.stats),
      balances: Array.from(L.balances)
    };
  }

  const a = pass();
  const b = pass();
  const c = pass();
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  /* and the run is non-trivial */
  assert.ok(a.stats[X.STAT_SETTLED_COUNT] > 0);
  assert.ok(a.stats[X.STAT_REJ_INVALID_AMOUNT] > 0);
  assert.ok(a.stats[X.STAT_REJ_UNSUPPORTED_CURRENCY] > 0);
  assert.ok(a.stats[X.STAT_REJ_UNKNOWN_ACCOUNT] > 0);
});

check('stats accumulate across successive batches without reset', function () {
  const L = X.allocLedger(4, 1);
  X.resetLedger(L);
  L.balances[0] = 1000000;
  for (let i = 0; i < 2; i++) {
    L.amounts[0] = 5000; L.accounts[0] = 0; L.currencies[0] = 0; L.flags[0] = 0;
    X.processBatch(L, 1);
  }
  assert.equal(L.stats[X.STAT_SETTLED_COUNT], 2);
  assert.equal(L.stats[X.STAT_TOTAL_SETTLED_AMOUNT], 10000);
});

check('exec.no_throw: adversarial garbage produces status codes, never exceptions', function () {
  const L = X.allocLedger(6, 2);
  X.resetLedger(L);
  L.balances[0] = 0;
  L.balances[1] = -1;                 /* pre-corrupted balance, must not settle */
  L.amounts[0] = -2147483648;         /* Int32 min */
  L.amounts[1] = 2147483647;          /* Int32 max */
  L.amounts[2] = 0;
  L.amounts[3] = 1;
  L.amounts[4] = X.LIMIT_MAX_PAYMENT_AMOUNT;
  L.amounts[5] = 1;
  for (let i = 0; i < 6; i++) { L.accounts[i] = 255; L.currencies[i] = 255; L.flags[i] = 255; }
  L.accounts[5] = 1; L.currencies[5] = 0;
  assert.doesNotThrow(function () { X.processBatch(L, 6); });
  assert.equal(L.statuses[0], X.STATUS_INVALID_AMOUNT);
  assert.equal(L.statuses[1], X.STATUS_AMOUNT_EXCEEDS_LIMIT);
  assert.equal(L.statuses[2], X.STATUS_INVALID_AMOUNT);
  assert.equal(L.statuses[3], X.STATUS_UNSUPPORTED_CURRENCY);
  assert.equal(L.statuses[4], X.STATUS_UNSUPPORTED_CURRENCY);
  assert.equal(L.statuses[5], X.STATUS_INSUFFICIENT_FUNDS, 'negative balance must never settle');
  assert.equal(L.balances[1], -1, 'corrupted balance untouched');
});

check('zero-account ledger rejects everything as UNKNOWN_ACCOUNT', function () {
  const L = X.allocLedger(3, 0);
  X.resetLedger(L);
  for (let i = 0; i < 3; i++) { L.amounts[i] = 5000; L.accounts[i] = i; L.currencies[i] = 0; L.flags[i] = 0; }
  X.processBatch(L, 3);
  for (let i = 0; i < 3; i++) assert.equal(L.statuses[i], X.STATUS_UNKNOWN_ACCOUNT);
  assert.equal(L.stats[X.STAT_REJ_UNKNOWN_ACCOUNT], 3);
});

/* ---- V8 discipline: static shape -------------------------------------- */

check('ledger handle keeps one static shape across allocations', function () {
  const a = X.allocLedger(8, 2);
  const b = X.allocLedger(4096, 512);
  const ka = Object.keys(a), kb = Object.keys(b);
  assert.deepEqual(ka, kb, 'key order must be identical -> same hidden class');
  assert.equal(ka.length, 13);
  for (let i = 0; i < ka.length; i++) {
    assert.equal(typeof a[ka[i]], typeof b[ka[i]], 'field type drift on ' + ka[i]);
  }
});

check('exec source contains no banned constructs', function () {
  const fs = require('node:fs');
  const lint = require('../../tests/_source-lint.js');
  const src = fs.readFileSync(require.resolve('../../src/exec/bulk-settlement.exec.js'), 'utf8');
  assert.ok(/^'use strict';/.test(src), "missing 'use strict'");
  lint.assertNoBannedConstructs(assert, src);
  lint.assertLoopBoundsCached(assert, src);
  /* exec units additionally must not use `this` or wrap hot loops in try/catch */
  const code = lint.stripCommentsAndStrings(src);
  assert.equal(/\bthis\b/.test(code), false, '`this` in an exec unit');
  assert.equal(/\btry\b/.test(code), false, 'try/catch in an exec unit');
});

check('exec delegates memory layout to the runtime rather than hand-rolling it', function () {
  const fs = require('node:fs');
  const lint = require('../../tests/_source-lint.js');
  const code = lint.stripCommentsAndStrings(
    fs.readFileSync(require.resolve('../../src/exec/bulk-settlement.exec.js'), 'utf8'));
  assert.ok(/defineArena\(/.test(code), 'exec must declare its arena via defineArena');
  assert.equal(/new SharedArrayBuffer\(/.test(code), false,
    'exec must not allocate its own backing store — the runtime owns that');
  assert.equal(/new (?:Float64|Int32|Uint32|Uint8)Array\(\s*\w*arena/.test(code), false,
    'exec must not construct views over the arena by hand');
});

/* ---- R7: sharded parallel execution ------------------------------------ */

/* deterministic non-trivial batch reused by every shard test */
function seedShardBatch(L, n, accounts) {
  for (let i = 0; i < n; i++) {
    L.ids[i] = i;
    L.accounts[i] = (i % 89 === 0) ? 4000000000 + i : (i * 613) % accounts;
    L.amounts[i] = (i % 71 === 0) ? -i : 900 + ((i * 379) % 90000);
    L.currencies[i] = (i % 29 === 0) ? 9 : i % 3;
    L.flags[i] = i & 1;
  }
  for (let a = 0; a < accounts; a++) L.balances[a] = 250000 + a * 7;
}

function runSequentialReference(n, accounts) {
  const L = X.allocLedger(n, accounts);
  X.resetLedger(L);
  seedShardBatch(L, n, accounts);
  X.processBatch(L, n);
  return L;
}

check('shard.equivalence: any shard count reproduces sequential byte-for-byte', function () {
  const n = 5000, accounts = 64;
  const ref = runSequentialReference(n, accounts);
  const shardCounts = [1, 2, 3, 4, 8];
  for (let s = 0; s < shardCounts.length; s++) {
    const W = shardCounts[s];
    const L = X.allocLedger(n, accounts);
    X.resetLedger(L);
    seedShardBatch(L, n, accounts);
    const slabs = [];
    for (let k = 0; k < W; k++) {
      const slab = new Float64Array(16);
      X.processBatchShard(L, n, k, W, slab);
      slabs.push(slab);
    }
    X.foldShardStats(L, slabs, W);
    assert.deepEqual(Array.from(L.statuses.subarray(0, n)), Array.from(ref.statuses.subarray(0, n)), W + ' shards: statuses');
    assert.deepEqual(Array.from(L.fees.subarray(0, n)), Array.from(ref.fees.subarray(0, n)), W + ' shards: fees');
    assert.deepEqual(Array.from(L.balances), Array.from(ref.balances), W + ' shards: balances');
    assert.deepEqual(Array.from(L.stats), Array.from(ref.stats), W + ' shards: stats');
  }
});

check('shard.ownership: every record has exactly one owner, none left PENDING', function () {
  const n = 3000, accounts = 64, W = 5;
  const L = X.allocLedger(n, accounts);
  X.resetLedger(L);
  seedShardBatch(L, n, accounts);
  const slabs = [];
  let processed = 0;
  for (let k = 0; k < W; k++) {
    const slab = new Float64Array(16);
    X.processBatchShard(L, n, k, W, slab);
    processed += slab[X.STAT_SETTLED_COUNT] + slab[X.STAT_REJECTED_COUNT];
    slabs.push(slab);
  }
  assert.equal(processed, n, 'ownership must partition the batch exactly');
  for (let i = 0; i < n; i++) {
    assert.notEqual(L.statuses[i], X.STATUS_PENDING, 'record ' + i + ' unowned');
  }
});

check('shard.stats_isolation: shards never touch the shared stats block', function () {
  const n = 2000, accounts = 32, W = 4;
  const L = X.allocLedger(n, accounts);
  X.resetLedger(L);
  seedShardBatch(L, n, accounts);
  for (let k = 0; k < W; k++) {
    X.processBatchShard(L, n, k, W, new Float64Array(16));
  }
  for (let s = 0; s < X.STAT_SLOTS; s++) {
    assert.equal(L.stats[s], 0, 'stats slot ' + s + ' written before fold');
  }
});

check('shard order beats validation order for foreign records (owner runs all checks)', function () {
  /* a record with a bad amount AND a foreign account must be untouched by
   * non-owner shards even though sequential validation checks amount first */
  const L = X.allocLedger(4, 8);
  X.resetLedger(L);
  L.amounts[0] = -5; L.accounts[0] = 3;      /* owner: 3 % 2 = shard 1 */
  L.amounts[1] = 5000; L.accounts[1] = 2;    /* owner: shard 0 */
  L.balances.fill(100000);
  const slab = new Float64Array(16);
  X.processBatchShard(L, 2, 0, 2, slab);     /* run only shard 0 */
  assert.equal(L.statuses[0], X.STATUS_PENDING, 'foreign record touched by non-owner');
  assert.equal(L.statuses[1], X.STATUS_SETTLED);
  X.processBatchShard(L, 2, 1, 2, slab);
  assert.equal(L.statuses[0], X.STATUS_INVALID_AMOUNT, 'owner must apply full validation');
});

check('STAT_IN_USE covers every stat slot actually written (regression guard)', function () {
  /* If a new STAT_* is added without bumping STAT_IN_USE, foldShardStats would
   * silently drop it after a parallel run. Derive the real count from the
   * exported STAT_* indices and compare. */
  let maxIdx = -1;
  for (const key in X) {
    if (key.indexOf('STAT_') !== 0) continue;
    if (key === 'STAT_SLOTS' || key === 'STAT_IN_USE') continue;
    if (X[key] > maxIdx) maxIdx = X[key];
  }
  assert.equal(X.STAT_IN_USE, maxIdx + 1,
    'STAT_IN_USE is ' + X.STAT_IN_USE + ' but the highest stat index is ' + maxIdx +
    ' — foldShardStats would silently drop stat slots after a parallel run');
  assert.ok(X.STAT_IN_USE <= X.STAT_SLOTS, 'STAT_IN_USE exceeds allocated slots');
});

check('every stat a shard writes survives the fold (no silent drop)', function () {
  const n = 400, accounts = 16, W = 3;
  const L = X.allocLedger(n, accounts);
  X.resetLedger(L);
  seedShardBatch(L, n, accounts);
  const slabs = [];
  for (let k = 0; k < W; k++) {
    const slab = new Float64Array(16);
    X.processBatchShard(L, n, k, W, slab);
    slabs.push(slab);
  }
  /* sum the slabs independently, then compare against the fold */
  const expected = new Float64Array(16);
  for (let k = 0; k < W; k++) {
    for (let s = 0; s < X.STAT_SLOTS; s++) expected[s] += slabs[k][s];
  }
  X.foldShardStats(L, slabs, W);
  for (let s = 0; s < X.STAT_IN_USE; s++) {
    assert.equal(L.stats[s], expected[s], 'stat slot ' + s + ' lost in the fold');
  }
});

check('fee.bounds_sane: load-time guard exists in the exec source', function () {
  const fs = require('node:fs');
  const lint = require('../../tests/_source-lint.js');
  const code = lint.stripCommentsAndStrings(
    fs.readFileSync(require.resolve('../../src/exec/bulk-settlement.exec.js'), 'utf8'));
  assert.ok(/if \(LIMIT_MIN_FEE > LIMIT_MAX_FEE\)/.test(code), 'guard missing');
  assert.ok(/throw new Error/.test(code), 'guard must throw, not warn');
});

/* ---- R7 across real threads: byte-identical through worker_threads ------ */

(function workerEquivalence() {
  const { Worker } = require('node:worker_threads');
  const path = require('node:path');
  const n = 100000, accounts = 1024, W = 4;

  const ref = runSequentialReference(n, accounts);

  const L = X.allocLedger(n, accounts);
  X.resetLedger(L);
  seedShardBatch(L, n, accounts);
  const statsSAB = new SharedArrayBuffer(W << 7);
  const workerPath = path.join(__dirname, '..', '..', 'src', 'exec', 'bulk-settlement.worker.js');

  const workers = [];
  let ready = 0, done = 0, failed = false;

  function finish() {
    for (let k = 0; k < W; k++) workers[k].terminate();
    if (failed) process.exit(1);
    const slabs = [];
    for (let k = 0; k < W; k++) slabs.push(new Float64Array(statsSAB, k << 7, 16));
    X.foldShardStats(L, slabs, W);
    assert.deepEqual(Array.from(L.statuses.subarray(0, n)), Array.from(ref.statuses.subarray(0, n)), 'worker statuses');
    assert.deepEqual(Array.from(L.fees.subarray(0, n)), Array.from(ref.fees.subarray(0, n)), 'worker fees');
    assert.deepEqual(Array.from(L.balances), Array.from(ref.balances), 'worker balances');
    assert.deepEqual(Array.from(L.stats), Array.from(ref.stats), 'worker stats');
    passed++;
    process.stdout.write('  ok  shard.equivalence holds across real worker_threads (' +
      W + ' workers, ' + n + ' records, zero-copy)\n');
    process.stdout.write('\n  ' + passed + ' checks passed\n\n');
  }

  for (let k = 0; k < W; k++) {
    const w = new Worker(workerPath, {
      workerData: { arena: L.arena, capacity: n, accountCount: accounts, shard: k, shards: W, statsSAB: statsSAB }
    });
    w.on('error', function (e) { failed = true; process.stderr.write('worker error: ' + e.message + '\n'); });
    w.on('message', function (msg) {
      if (msg === 'ready') {
        ready++;
        if (ready === W) { for (let j = 0; j < W; j++) workers[j].postMessage({ count: n }); }
      } else if (msg === 'done') {
        done++;
        if (done === W) finish();
      }
    });
    workers.push(w);
  }
})();
