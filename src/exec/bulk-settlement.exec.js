'use strict';
/* SINGULARITY EXEC UNIT — compiled from features/payments/bulk-settlement.intent.ts
 * DO NOT HAND-EDIT. DO NOT REFORMAT FOR READABILITY. Regenerate from the intent.
 * Verified by features/payments/bulk-settlement.assert.js
 * intent-sha256: b9c3d98b3db854a56048eac7d4f16e7dc3f962aba75387199aebf43aef778ceb */

const { defineArena } = require('../runtime/arena.js');

const STATUS_PENDING = 0;
const STATUS_SETTLED = 1;
const STATUS_INVALID_AMOUNT = 2;
const STATUS_AMOUNT_EXCEEDS_LIMIT = 3;
const STATUS_UNSUPPORTED_CURRENCY = 4;
const STATUS_UNKNOWN_ACCOUNT = 5;
const STATUS_INSUFFICIENT_FUNDS = 6;

const STAT_SETTLED_COUNT = 0;
const STAT_REJECTED_COUNT = 1;
const STAT_TOTAL_SETTLED_AMOUNT = 2;
const STAT_TOTAL_FEES = 3;
const STAT_REJ_INVALID_AMOUNT = 4;
const STAT_REJ_AMOUNT_EXCEEDS_LIMIT = 5;
const STAT_REJ_UNSUPPORTED_CURRENCY = 6;
const STAT_REJ_UNKNOWN_ACCOUNT = 7;
const STAT_REJ_INSUFFICIENT_FUNDS = 8;
/* Number of slots actually in use. foldShardStats folds exactly this many, so a
 * new stat MUST bump it or its value silently vanishes after a parallel run.
 * Asserted against the real slot count in the assert suite. */
const STAT_IN_USE = 9;
const STAT_SLOTS = 16; /* padded to 128B, one cache line pair, keeps balances 8B-aligned */

const LIMIT_MAX_PAYMENT_AMOUNT = 50000000;
const LIMIT_MAX_FEE = 5000;
const LIMIT_MIN_FEE = 30;
const LIMIT_MAX_CURRENCY_CODE = 2;

/* fee.bounds_sane: a fee table that cannot clamp coherently is a bad program,
 * not bad data — refuse to load rather than let the ceiling silently win. */
if (LIMIT_MIN_FEE > LIMIT_MAX_FEE) {
  throw new Error('bulk-settlement: MIN_FEE (' + LIMIT_MIN_FEE +
    ') exceeds MAX_FEE (' + LIMIT_MAX_FEE + ') — fee table is incoherent');
}

const FLAG_PRIORITY = 1;

/* Memory layout is DECLARED, not hand-computed. The runtime owns offset
 * arithmetic, alignment, and the single-hidden-class guarantee; this file only
 * says what fields exist. Layout order is derived (widest element first), so the
 * declaration order below is free to read in domain order.
 * See decisions/0006-schema-driven-arena-runtime.md. */
const LEDGER = defineArena({
  name: 'ledger',
  dims: ['capacity', 'accountCount'],
  fields: [
    ['stats', 'f64', STAT_SLOTS],
    ['balances', 'f64', 'accountCount'],
    ['ids', 'u32', 'capacity'],
    ['accounts', 'u32', 'capacity'],
    ['amounts', 'i32', 'capacity'],
    ['fees', 'i32', 'capacity'],
    ['currencies', 'u8', 'capacity'],
    ['flags', 'u8', 'capacity'],
    ['statuses', 'u8', 'capacity']
  ],
  /* balances are the caller's to seed and must survive a reset */
  clearOnReset: ['stats', 'fees', 'statuses']
});

function allocLedger(capacity, accountCount) {
  return LEDGER.alloc(capacity, accountCount);
}

/* rebuilds views over an arena allocated elsewhere — the zero-copy path for
 * worker_threads. No backing store is allocated. */
function attachLedger(arena, capacity, accountCount) {
  return LEDGER.attach(arena, capacity, accountCount);
}

/* zeroes everything the hot procedure writes. balances are the caller's to seed. */
const resetLedger = LEDGER.reset;

/* R3 reference implementation. Hand-inlined at the call site below; exported so
 * the assert suite can differential-test the inlined copy against it. */
function computeFee(amount, currency, flags) {
  let f;
  if (amount < 10000) f = ((amount * 290) / 10000 | 0) + 30;
  else if (amount < 100000) f = ((amount * 250) / 10000 | 0) + 25;
  else if (amount < 1000000) f = ((amount * 190) / 10000 | 0) + 20;
  else f = ((amount * 120) / 10000 | 0);
  if (currency !== 0) f += (amount * 15) / 10000 | 0;
  if ((flags & FLAG_PRIORITY) !== 0) f += f >> 1;
  if (f > LIMIT_MAX_FEE) f = LIMIT_MAX_FEE;
  else if (f < LIMIT_MIN_FEE) f = LIMIT_MIN_FEE;
  return f;
}

function processBatch(L, count) {
  const amounts = L.amounts;
  const accounts = L.accounts;
  const currencies = L.currencies;
  const flags = L.flags;
  const fees = L.fees;
  const statuses = L.statuses;
  const balances = L.balances;
  const accountCount = L.accountCount;

  let cSettled = 0, cRejected = 0, cInvalid = 0, cLimit = 0, cCurrency = 0, cAccount = 0, cFunds = 0;
  let sumAmount = 0, sumFees = 0;

  for (let i = 0; i < count; i++) {
    const amt = amounts[i];
    if (amt <= 0) { statuses[i] = STATUS_INVALID_AMOUNT; cInvalid++; cRejected++; continue; }
    if (amt > LIMIT_MAX_PAYMENT_AMOUNT) { statuses[i] = STATUS_AMOUNT_EXCEEDS_LIMIT; cLimit++; cRejected++; continue; }
    const cur = currencies[i];
    if (cur > LIMIT_MAX_CURRENCY_CODE) { statuses[i] = STATUS_UNSUPPORTED_CURRENCY; cCurrency++; cRejected++; continue; }
    const acct = accounts[i];
    if (acct >= accountCount) { statuses[i] = STATUS_UNKNOWN_ACCOUNT; cAccount++; cRejected++; continue; }

    let f;
    if (amt < 10000) f = ((amt * 290) / 10000 | 0) + 30;
    else if (amt < 100000) f = ((amt * 250) / 10000 | 0) + 25;
    else if (amt < 1000000) f = ((amt * 190) / 10000 | 0) + 20;
    else f = ((amt * 120) / 10000 | 0);
    if (cur !== 0) f += (amt * 15) / 10000 | 0;
    if ((flags[i] & FLAG_PRIORITY) !== 0) f += f >> 1;
    if (f > LIMIT_MAX_FEE) f = LIMIT_MAX_FEE;
    else if (f < LIMIT_MIN_FEE) f = LIMIT_MIN_FEE;

    fees[i] = f;
    const total = amt + f;
    const bal = balances[acct];
    if (bal < total) { statuses[i] = STATUS_INSUFFICIENT_FUNDS; cFunds++; cRejected++; continue; }
    balances[acct] = bal - total;
    statuses[i] = STATUS_SETTLED;
    cSettled++; sumAmount += amt; sumFees += f;
  }

  const stats = L.stats;
  stats[STAT_SETTLED_COUNT] += cSettled;
  stats[STAT_REJECTED_COUNT] += cRejected;
  stats[STAT_TOTAL_SETTLED_AMOUNT] += sumAmount;
  stats[STAT_TOTAL_FEES] += sumFees;
  stats[STAT_REJ_INVALID_AMOUNT] += cInvalid;
  stats[STAT_REJ_AMOUNT_EXCEEDS_LIMIT] += cLimit;
  stats[STAT_REJ_UNSUPPORTED_CURRENCY] += cCurrency;
  stats[STAT_REJ_UNKNOWN_ACCOUNT] += cAccount;
  stats[STAT_REJ_INSUFFICIENT_FUNDS] += cFunds;
  return cSettled;
}

/* Sharded traversal for worker fan-out. Record i is processed iff
 * accounts[i] % shards === shard, so every record has exactly one owner and
 * per-account ordering is preserved — the union over shards is byte-identical
 * to processBatch. Counters go to the caller-provided outStats slab (>= 9
 * f64 slots), NEVER to L.stats: shards must not race on the shared block.
 * The caller sums slabs after join. See decisions/0014. */
function processBatchShard(L, count, shard, shards, outStats) {
  const amounts = L.amounts;
  const accounts = L.accounts;
  const currencies = L.currencies;
  const flags = L.flags;
  const fees = L.fees;
  const statuses = L.statuses;
  const balances = L.balances;
  const accountCount = L.accountCount;

  let cSettled = 0, cRejected = 0, cInvalid = 0, cLimit = 0, cCurrency = 0, cAccount = 0, cFunds = 0;
  let sumAmount = 0, sumFees = 0;

  for (let i = 0; i < count; i++) {
    const acct = accounts[i];
    if (acct % shards !== shard) continue;
    const amt = amounts[i];
    if (amt <= 0) { statuses[i] = STATUS_INVALID_AMOUNT; cInvalid++; cRejected++; continue; }
    if (amt > LIMIT_MAX_PAYMENT_AMOUNT) { statuses[i] = STATUS_AMOUNT_EXCEEDS_LIMIT; cLimit++; cRejected++; continue; }
    const cur = currencies[i];
    if (cur > LIMIT_MAX_CURRENCY_CODE) { statuses[i] = STATUS_UNSUPPORTED_CURRENCY; cCurrency++; cRejected++; continue; }
    if (acct >= accountCount) { statuses[i] = STATUS_UNKNOWN_ACCOUNT; cAccount++; cRejected++; continue; }

    let f;
    if (amt < 10000) f = ((amt * 290) / 10000 | 0) + 30;
    else if (amt < 100000) f = ((amt * 250) / 10000 | 0) + 25;
    else if (amt < 1000000) f = ((amt * 190) / 10000 | 0) + 20;
    else f = ((amt * 120) / 10000 | 0);
    if (cur !== 0) f += (amt * 15) / 10000 | 0;
    if ((flags[i] & FLAG_PRIORITY) !== 0) f += f >> 1;
    if (f > LIMIT_MAX_FEE) f = LIMIT_MAX_FEE;
    else if (f < LIMIT_MIN_FEE) f = LIMIT_MIN_FEE;

    fees[i] = f;
    const total = amt + f;
    const bal = balances[acct];
    if (bal < total) { statuses[i] = STATUS_INSUFFICIENT_FUNDS; cFunds++; cRejected++; continue; }
    balances[acct] = bal - total;
    statuses[i] = STATUS_SETTLED;
    cSettled++; sumAmount += amt; sumFees += f;
  }

  outStats[STAT_SETTLED_COUNT] = cSettled;
  outStats[STAT_REJECTED_COUNT] = cRejected;
  outStats[STAT_TOTAL_SETTLED_AMOUNT] = sumAmount;
  outStats[STAT_TOTAL_FEES] = sumFees;
  outStats[STAT_REJ_INVALID_AMOUNT] = cInvalid;
  outStats[STAT_REJ_AMOUNT_EXCEEDS_LIMIT] = cLimit;
  outStats[STAT_REJ_UNSUPPORTED_CURRENCY] = cCurrency;
  outStats[STAT_REJ_UNKNOWN_ACCOUNT] = cAccount;
  outStats[STAT_REJ_INSUFFICIENT_FUNDS] = cFunds;
  return cSettled;
}

/* folds per-shard slabs into the shared stats block; main thread only, after join */
function foldShardStats(L, slabs, shards) {
  const stats = L.stats;
  for (let k = 0; k < shards; k++) {
    const slab = slabs[k];
    for (let s = 0; s < STAT_IN_USE; s++) stats[s] += slab[s];
  }
}

module.exports = {
  STATUS_PENDING: STATUS_PENDING,
  STATUS_SETTLED: STATUS_SETTLED,
  STATUS_INVALID_AMOUNT: STATUS_INVALID_AMOUNT,
  STATUS_AMOUNT_EXCEEDS_LIMIT: STATUS_AMOUNT_EXCEEDS_LIMIT,
  STATUS_UNSUPPORTED_CURRENCY: STATUS_UNSUPPORTED_CURRENCY,
  STATUS_UNKNOWN_ACCOUNT: STATUS_UNKNOWN_ACCOUNT,
  STATUS_INSUFFICIENT_FUNDS: STATUS_INSUFFICIENT_FUNDS,
  STAT_SETTLED_COUNT: STAT_SETTLED_COUNT,
  STAT_REJECTED_COUNT: STAT_REJECTED_COUNT,
  STAT_TOTAL_SETTLED_AMOUNT: STAT_TOTAL_SETTLED_AMOUNT,
  STAT_TOTAL_FEES: STAT_TOTAL_FEES,
  STAT_REJ_INVALID_AMOUNT: STAT_REJ_INVALID_AMOUNT,
  STAT_REJ_AMOUNT_EXCEEDS_LIMIT: STAT_REJ_AMOUNT_EXCEEDS_LIMIT,
  STAT_REJ_UNSUPPORTED_CURRENCY: STAT_REJ_UNSUPPORTED_CURRENCY,
  STAT_REJ_UNKNOWN_ACCOUNT: STAT_REJ_UNKNOWN_ACCOUNT,
  STAT_REJ_INSUFFICIENT_FUNDS: STAT_REJ_INSUFFICIENT_FUNDS,
  STAT_IN_USE: STAT_IN_USE,
  STAT_SLOTS: STAT_SLOTS,
  LIMIT_MAX_PAYMENT_AMOUNT: LIMIT_MAX_PAYMENT_AMOUNT,
  LIMIT_MAX_FEE: LIMIT_MAX_FEE,
  LIMIT_MIN_FEE: LIMIT_MIN_FEE,
  LIMIT_MAX_CURRENCY_CODE: LIMIT_MAX_CURRENCY_CODE,
  FLAG_PRIORITY: FLAG_PRIORITY,
  LEDGER: LEDGER,
  allocLedger: allocLedger,
  attachLedger: attachLedger,
  resetLedger: resetLedger,
  computeFee: computeFee,
  processBatch: processBatch,
  processBatchShard: processBatchShard,
  foldShardStats: foldShardStats
};
