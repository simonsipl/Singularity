'use strict';
/* SINGULARITY EXEC UNIT — compiled from features/clients/visit-profiling.intent.ts
 * DO NOT HAND-EDIT. DO NOT REFORMAT FOR READABILITY. Regenerate from the intent.
 * Verified by features/clients/visit-profiling.assert.js
 * intent-sha256: 777b755374b4923682e9aa5361642e785daf23a540d682ec3dd5f13f811ab148 */

const { defineArena } = require('../runtime/arena.js');

const CLIENT_PENDING = 0;
const CLIENT_ACTIVE = 1;
const CLIENT_INVALID_NAME = 2;
const CLIENT_INVALID_PHONE = 3;
const CLIENT_DUPLICATE_PHONE = 4;
const CLIENT_FUTURE_DATED = 5;

const VISIT_PENDING = 0;
const VISIT_COUNTED = 1;
const VISIT_UNKNOWN_CLIENT = 2;
const VISIT_INACTIVE_CLIENT = 3;
const VISIT_FUTURE_DATED = 4;
const VISIT_NEGATIVE_SPEND = 5;
const VISIT_NO_SHOW_RECORDED = 6;

const SEG_UNSEGMENTED = 0;
const SEG_NEVER_VISITED = 1;
const SEG_NEW = 2;
const SEG_REGULAR = 3;
const SEG_VIP = 4;
const SEG_AT_RISK = 5;
const SEG_LAPSED = 6;
const SEG_COUNT = 7;

const FLAG_NO_SHOW = 1;
const RISK_UNRELIABLE = 1;

const LIMIT_MIN_PHONE_DIGITS = 9;
const LIMIT_MAX_PHONE_DIGITS = 15;
const LIMIT_MAX_VISIT_SPEND = 1000000;

const SEG_LAPSED_AFTER_DAYS = 365;
const SEG_VIP_MIN_VISITS = 12;
const SEG_VIP_MAX_RECENCY = 60;
const SEG_REGULAR_MIN_VISITS = 4;
const SEG_REGULAR_MAX_RECENCY = 120;
const SEG_AT_RISK_AFTER_DAYS = 120;

const RISK_UNRELIABLE_BPS = 3000;
const RISK_MIN_BOOKINGS = 4;

/* stats slots */
const STAT_ACTIVE_CLIENTS = 0;
const STAT_REJECTED_CLIENTS = 1;
const STAT_COUNTED_VISITS = 2;
const STAT_NO_SHOW_VISITS = 3;
const STAT_REJECTED_VISITS = 4;
const STAT_TOTAL_SPEND = 5;
const STAT_REJ_INVALID_NAME = 6;
const STAT_REJ_INVALID_PHONE = 7;
const STAT_REJ_DUPLICATE_PHONE = 8;
const STAT_REJ_FUTURE_DATED = 9;
const STAT_REJ_UNKNOWN_CLIENT = 10;
const STAT_REJ_INACTIVE_CLIENT = 11;
const STAT_REJ_VISIT_FUTURE = 12;
const STAT_REJ_BAD_SPEND = 13;
const STAT_UNRELIABLE_CLIENTS = 14;
const STAT_SLOTS = 16;

/* 21 declared fields -> the handle carries 26 properties. That is past the
 * 20-property point where a property-insertion loop deopts to dictionary mode,
 * so this module is a live demonstration of why decisions/0006 chose codegen.
 * tests/client-profiler.assert.js asserts fast properties on this handle. */
const PROFILER = defineArena({
  name: 'profiler',
  dims: ['clientCapacity', 'visitCapacity', 'hashCapacity'],
  fields: [
    ['stats', 'f64', STAT_SLOTS],
    ['segmentCounts', 'f64', SEG_COUNT],
    ['cliTotalSpend', 'f64', 'clientCapacity'],

    ['cliPhoneHash', 'u32', 'clientCapacity'],
    ['cliCreatedDay', 'u32', 'clientCapacity'],
    ['cliVisitCount', 'u32', 'clientCapacity'],
    ['cliNoShowCount', 'u32', 'clientCapacity'],
    ['cliFirstDay', 'u32', 'clientCapacity'],
    ['cliLastDay', 'u32', 'clientCapacity'],
    ['cliCadence', 'u32', 'clientCapacity'],
    ['visClient', 'u32', 'visitCapacity'],
    ['visDay', 'u32', 'visitCapacity'],
    ['visSpend', 'i32', 'visitCapacity'],
    /* 0 = empty, otherwise clientSlot + 1. The +1 bias lets a zero-filled arena
     * mean "empty" without a fill(-1) pass. See decisions/0009. */
    ['hashSlots', 'u32', 'hashCapacity'],

    ['cliNameLength', 'u8', 'clientCapacity'],
    ['cliPhoneDigits', 'u8', 'clientCapacity'],
    ['cliConsentFlags', 'u8', 'clientCapacity'],
    ['cliStatus', 'u8', 'clientCapacity'],
    ['cliSegment', 'u8', 'clientCapacity'],
    ['cliRiskFlags', 'u8', 'clientCapacity'],
    ['visFlags', 'u8', 'visitCapacity'],
    ['visStatus', 'u8', 'visitCapacity']
  ],
  clearOnReset: ['stats', 'segmentCounts', 'cliTotalSpend', 'cliVisitCount',
    'cliNoShowCount', 'cliFirstDay', 'cliLastDay', 'cliCadence', 'hashSlots',
    'cliStatus', 'cliSegment', 'cliRiskFlags', 'visStatus']
});

/* Open-addressed table capacity: next power of two at or above 2x the client
 * capacity, so the table is never more than half full and linear probing stays
 * short. Exported because attach() must compute the identical value. */
function hashCapacityFor(clientCapacity) {
  let cap = 16;
  const target = clientCapacity << 1;
  while (cap < target) cap = cap << 1;
  return cap;
}

function allocProfiler(clientCapacity, visitCapacity) {
  return PROFILER.alloc(clientCapacity, visitCapacity, hashCapacityFor(clientCapacity));
}

function attachProfiler(arena, clientCapacity, visitCapacity) {
  return PROFILER.attach(arena, clientCapacity, visitCapacity,
    hashCapacityFor(clientCapacity));
}

const resetProfiler = PROFILER.reset;

/* ---- pass 1: register client cards ------------------------------------- */

function registerClients(P, clientCount, asOfDay) {
  const nameLength = P.cliNameLength;
  const phoneDigits = P.cliPhoneDigits;
  const phoneHash = P.cliPhoneHash;
  const createdDay = P.cliCreatedDay;
  const status = P.cliStatus;
  const hashSlots = P.hashSlots;
  const hashMask = P.hashCapacity - 1;
  const hashCapacity = P.hashCapacity;

  let active = 0, rejected = 0;
  let rName = 0, rPhone = 0, rDup = 0, rFuture = 0;

  for (let i = 0; i < clientCount; i++) {
    if (nameLength[i] === 0) {
      status[i] = CLIENT_INVALID_NAME; rName++; rejected++; continue;
    }
    const digits = phoneDigits[i];
    if (digits < LIMIT_MIN_PHONE_DIGITS || digits > LIMIT_MAX_PHONE_DIGITS) {
      status[i] = CLIENT_INVALID_PHONE; rPhone++; rejected++; continue;
    }
    if (createdDay[i] > asOfDay) {
      status[i] = CLIENT_FUTURE_DATED; rFuture++; rejected++; continue;
    }

    /* open addressing, linear probe, bitwise mask. probe is bounded by capacity
     * so a corrupted table cannot spin forever. */
    const h = phoneHash[i];
    let slot = (h ^ (h >>> 16)) & hashMask;
    let dup = 0;
    for (let p = 0; p < hashCapacity; p++) {
      const entry = hashSlots[slot];
      if (entry === 0) { hashSlots[slot] = i + 1; break; }
      if (phoneHash[entry - 1] === h) { dup = 1; break; }
      slot = (slot + 1) & hashMask;
    }
    if (dup === 1) {
      status[i] = CLIENT_DUPLICATE_PHONE; rDup++; rejected++; continue;
    }
    status[i] = CLIENT_ACTIVE;
    active++;
  }

  const stats = P.stats;
  stats[STAT_ACTIVE_CLIENTS] += active;
  stats[STAT_REJECTED_CLIENTS] += rejected;
  stats[STAT_REJ_INVALID_NAME] += rName;
  stats[STAT_REJ_INVALID_PHONE] += rPhone;
  stats[STAT_REJ_DUPLICATE_PHONE] += rDup;
  stats[STAT_REJ_FUTURE_DATED] += rFuture;
  return active;
}

/* ---- pass 2: fold visits into per-client aggregates -------------------- */

function foldVisits(P, visitCount, clientCount, asOfDay) {
  const visClient = P.visClient;
  const visDay = P.visDay;
  const visSpend = P.visSpend;
  const visFlags = P.visFlags;
  const visStatus = P.visStatus;
  const cliStatus = P.cliStatus;
  const cliVisitCount = P.cliVisitCount;
  const cliNoShowCount = P.cliNoShowCount;
  const cliTotalSpend = P.cliTotalSpend;
  const cliFirstDay = P.cliFirstDay;
  const cliLastDay = P.cliLastDay;

  let counted = 0, noShow = 0, rejected = 0;
  let rUnknown = 0, rInactive = 0, rFuture = 0, rSpend = 0;
  let spendTotal = 0;

  for (let i = 0; i < visitCount; i++) {
    const c = visClient[i];
    if (c >= clientCount) {
      visStatus[i] = VISIT_UNKNOWN_CLIENT; rUnknown++; rejected++; continue;
    }
    if (cliStatus[c] !== CLIENT_ACTIVE) {
      visStatus[i] = VISIT_INACTIVE_CLIENT; rInactive++; rejected++; continue;
    }
    const day = visDay[i];
    if (day > asOfDay) {
      visStatus[i] = VISIT_FUTURE_DATED; rFuture++; rejected++; continue;
    }
    const spend = visSpend[i];
    if (spend < 0 || spend > LIMIT_MAX_VISIT_SPEND) {
      visStatus[i] = VISIT_NEGATIVE_SPEND; rSpend++; rejected++; continue;
    }
    if ((visFlags[i] & FLAG_NO_SHOW) !== 0) {
      visStatus[i] = VISIT_NO_SHOW_RECORDED;
      cliNoShowCount[c] = cliNoShowCount[c] + 1;
      noShow++;
      continue;
    }

    const seen = cliVisitCount[c];
    cliVisitCount[c] = seen + 1;
    cliTotalSpend[c] = cliTotalSpend[c] + spend;
    if (seen === 0) { cliFirstDay[c] = day; cliLastDay[c] = day; }
    else {
      if (day < cliFirstDay[c]) cliFirstDay[c] = day;
      if (day > cliLastDay[c]) cliLastDay[c] = day;
    }
    visStatus[i] = VISIT_COUNTED;
    counted++;
    spendTotal += spend;
  }

  const stats = P.stats;
  stats[STAT_COUNTED_VISITS] += counted;
  stats[STAT_NO_SHOW_VISITS] += noShow;
  stats[STAT_REJECTED_VISITS] += rejected;
  stats[STAT_TOTAL_SPEND] += spendTotal;
  stats[STAT_REJ_UNKNOWN_CLIENT] += rUnknown;
  stats[STAT_REJ_INACTIVE_CLIENT] += rInactive;
  stats[STAT_REJ_VISIT_FUTURE] += rFuture;
  stats[STAT_REJ_BAD_SPEND] += rSpend;
  return counted;
}

/* ---- pass 3: derive cadence, segment and risk -------------------------- */

function segmentClients(P, clientCount, asOfDay) {
  const cliStatus = P.cliStatus;
  const cliVisitCount = P.cliVisitCount;
  const cliNoShowCount = P.cliNoShowCount;
  const cliFirstDay = P.cliFirstDay;
  const cliLastDay = P.cliLastDay;
  const cliCadence = P.cliCadence;
  const cliSegment = P.cliSegment;
  const cliRiskFlags = P.cliRiskFlags;
  const segmentCounts = P.segmentCounts;

  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0;
  let unreliable = 0;

  for (let i = 0; i < clientCount; i++) {
    if (cliStatus[i] !== CLIENT_ACTIVE) { cliSegment[i] = SEG_UNSEGMENTED; continue; }

    const visits = cliVisitCount[i];
    const noShows = cliNoShowCount[i];

    if (visits >= 2) {
      cliCadence[i] = ((cliLastDay[i] - cliFirstDay[i]) / (visits - 1)) | 0;
    } else {
      cliCadence[i] = 0;
    }

    let seg;
    if (visits === 0) seg = SEG_NEVER_VISITED;
    else {
      const recency = asOfDay - cliLastDay[i];
      if (recency > SEG_LAPSED_AFTER_DAYS) seg = SEG_LAPSED;
      else if (visits >= SEG_VIP_MIN_VISITS && recency <= SEG_VIP_MAX_RECENCY) seg = SEG_VIP;
      else if (visits >= SEG_REGULAR_MIN_VISITS && recency <= SEG_REGULAR_MAX_RECENCY) seg = SEG_REGULAR;
      else if (recency > SEG_AT_RISK_AFTER_DAYS) seg = SEG_AT_RISK;
      else seg = SEG_NEW;
    }
    cliSegment[i] = seg;
    if (seg === 0) s0++; else if (seg === 1) s1++; else if (seg === 2) s2++;
    else if (seg === 3) s3++; else if (seg === 4) s4++; else if (seg === 5) s5++;
    else s6++;

    const booked = visits + noShows;
    let risk = 0;
    if (booked >= RISK_MIN_BOOKINGS) {
      if (((noShows * 10000) / booked | 0) >= RISK_UNRELIABLE_BPS) {
        risk = RISK_UNRELIABLE;
        unreliable++;
      }
    }
    cliRiskFlags[i] = risk;
  }

  segmentCounts[0] += s0; segmentCounts[1] += s1; segmentCounts[2] += s2;
  segmentCounts[3] += s3; segmentCounts[4] += s4; segmentCounts[5] += s5;
  segmentCounts[6] += s6;
  P.stats[STAT_UNRELIABLE_CLIENTS] += unreliable;
}

/* ---- convenience: the whole nightly pass ------------------------------- */

function runProfile(P, clientCount, visitCount, asOfDay) {
  registerClients(P, clientCount, asOfDay);
  foldVisits(P, visitCount, clientCount, asOfDay);
  segmentClients(P, clientCount, asOfDay);
  return P.stats[STAT_ACTIVE_CLIENTS];
}

module.exports = {
  CLIENT_PENDING: CLIENT_PENDING,
  CLIENT_ACTIVE: CLIENT_ACTIVE,
  CLIENT_INVALID_NAME: CLIENT_INVALID_NAME,
  CLIENT_INVALID_PHONE: CLIENT_INVALID_PHONE,
  CLIENT_DUPLICATE_PHONE: CLIENT_DUPLICATE_PHONE,
  CLIENT_FUTURE_DATED: CLIENT_FUTURE_DATED,
  VISIT_PENDING: VISIT_PENDING,
  VISIT_COUNTED: VISIT_COUNTED,
  VISIT_UNKNOWN_CLIENT: VISIT_UNKNOWN_CLIENT,
  VISIT_INACTIVE_CLIENT: VISIT_INACTIVE_CLIENT,
  VISIT_FUTURE_DATED: VISIT_FUTURE_DATED,
  VISIT_NEGATIVE_SPEND: VISIT_NEGATIVE_SPEND,
  VISIT_NO_SHOW_RECORDED: VISIT_NO_SHOW_RECORDED,
  SEG_UNSEGMENTED: SEG_UNSEGMENTED,
  SEG_NEVER_VISITED: SEG_NEVER_VISITED,
  SEG_NEW: SEG_NEW,
  SEG_REGULAR: SEG_REGULAR,
  SEG_VIP: SEG_VIP,
  SEG_AT_RISK: SEG_AT_RISK,
  SEG_LAPSED: SEG_LAPSED,
  SEG_COUNT: SEG_COUNT,
  FLAG_NO_SHOW: FLAG_NO_SHOW,
  RISK_UNRELIABLE: RISK_UNRELIABLE,
  LIMIT_MIN_PHONE_DIGITS: LIMIT_MIN_PHONE_DIGITS,
  LIMIT_MAX_PHONE_DIGITS: LIMIT_MAX_PHONE_DIGITS,
  LIMIT_MAX_VISIT_SPEND: LIMIT_MAX_VISIT_SPEND,
  SEG_LAPSED_AFTER_DAYS: SEG_LAPSED_AFTER_DAYS,
  SEG_VIP_MIN_VISITS: SEG_VIP_MIN_VISITS,
  SEG_VIP_MAX_RECENCY: SEG_VIP_MAX_RECENCY,
  SEG_REGULAR_MIN_VISITS: SEG_REGULAR_MIN_VISITS,
  SEG_REGULAR_MAX_RECENCY: SEG_REGULAR_MAX_RECENCY,
  SEG_AT_RISK_AFTER_DAYS: SEG_AT_RISK_AFTER_DAYS,
  RISK_UNRELIABLE_BPS: RISK_UNRELIABLE_BPS,
  RISK_MIN_BOOKINGS: RISK_MIN_BOOKINGS,
  STAT_ACTIVE_CLIENTS: STAT_ACTIVE_CLIENTS,
  STAT_REJECTED_CLIENTS: STAT_REJECTED_CLIENTS,
  STAT_COUNTED_VISITS: STAT_COUNTED_VISITS,
  STAT_NO_SHOW_VISITS: STAT_NO_SHOW_VISITS,
  STAT_REJECTED_VISITS: STAT_REJECTED_VISITS,
  STAT_TOTAL_SPEND: STAT_TOTAL_SPEND,
  STAT_REJ_INVALID_NAME: STAT_REJ_INVALID_NAME,
  STAT_REJ_INVALID_PHONE: STAT_REJ_INVALID_PHONE,
  STAT_REJ_DUPLICATE_PHONE: STAT_REJ_DUPLICATE_PHONE,
  STAT_REJ_FUTURE_DATED: STAT_REJ_FUTURE_DATED,
  STAT_REJ_UNKNOWN_CLIENT: STAT_REJ_UNKNOWN_CLIENT,
  STAT_REJ_INACTIVE_CLIENT: STAT_REJ_INACTIVE_CLIENT,
  STAT_REJ_VISIT_FUTURE: STAT_REJ_VISIT_FUTURE,
  STAT_REJ_BAD_SPEND: STAT_REJ_BAD_SPEND,
  STAT_UNRELIABLE_CLIENTS: STAT_UNRELIABLE_CLIENTS,
  STAT_SLOTS: STAT_SLOTS,
  PROFILER: PROFILER,
  hashCapacityFor: hashCapacityFor,
  allocProfiler: allocProfiler,
  attachProfiler: attachProfiler,
  resetProfiler: resetProfiler,
  registerClients: registerClients,
  foldVisits: foldVisits,
  segmentClients: segmentClients,
  runProfile: runProfile
};
