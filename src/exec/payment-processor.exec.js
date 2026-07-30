'use strict';
/* SINGULARITY EXEC UNIT — compiled from src/intents/payment-processor.intent.ts
 * DO NOT HAND-EDIT. DO NOT REFORMAT FOR READABILITY. Regenerate from the intent.
 * Verified by tests/payment-processor.assert.js */

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
const STAT_SLOTS = 16; /* padded to 128B, one cache line pair, keeps balances 8B-aligned */

const LIMIT_MAX_PAYMENT_AMOUNT = 50000000;
const LIMIT_MAX_FEE = 5000;
const LIMIT_MIN_FEE = 30;
const LIMIT_MAX_CURRENCY_CODE = 2;

const FLAG_PRIORITY = 1;

/* arena byte offsets: f64 region first, then 4B region, then 1B region.
 * every 4B view lands on an 8B-aligned base, so no unaligned view construction. */
function allocLedger(capacity, accountCount) {
  const oStats = 0;
  const oBalances = oStats + (STAT_SLOTS << 3);
  const oIds = oBalances + (accountCount << 3);
  const oAccounts = oIds + (capacity << 2);
  const oAmounts = oAccounts + (capacity << 2);
  const oFees = oAmounts + (capacity << 2);
  const oCurrencies = oFees + (capacity << 2);
  const oFlags = oCurrencies + capacity;
  const oStatuses = oFlags + capacity;
  const bytes = (oStatuses + capacity + 7) & ~7;
  const arena = new SharedArrayBuffer(bytes);
  return {
    arena: arena,
    byteLength: bytes,
    capacity: capacity,
    accountCount: accountCount,
    stats: new Float64Array(arena, oStats, STAT_SLOTS),
    balances: new Float64Array(arena, oBalances, accountCount),
    ids: new Uint32Array(arena, oIds, capacity),
    accounts: new Uint32Array(arena, oAccounts, capacity),
    amounts: new Int32Array(arena, oAmounts, capacity),
    fees: new Int32Array(arena, oFees, capacity),
    currencies: new Uint8Array(arena, oCurrencies, capacity),
    flags: new Uint8Array(arena, oFlags, capacity),
    statuses: new Uint8Array(arena, oStatuses, capacity)
  };
}

/* zeroes everything the hot procedure writes. balances are the caller's to seed. */
function resetLedger(L) {
  L.stats.fill(0);
  L.fees.fill(0);
  L.statuses.fill(0);
}

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
  STAT_SLOTS: STAT_SLOTS,
  LIMIT_MAX_PAYMENT_AMOUNT: LIMIT_MAX_PAYMENT_AMOUNT,
  LIMIT_MAX_FEE: LIMIT_MAX_FEE,
  LIMIT_MIN_FEE: LIMIT_MIN_FEE,
  LIMIT_MAX_CURRENCY_CODE: LIMIT_MAX_CURRENCY_CODE,
  FLAG_PRIORITY: FLAG_PRIORITY,
  allocLedger: allocLedger,
  resetLedger: resetLedger,
  computeFee: computeFee,
  processBatch: processBatch
};
