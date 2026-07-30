'use strict';
/* SINGULARITY LOOPBACK VERIFICATION
 * unit under test: src/exec/client-profiler.exec.js
 * contract:        src/intents/client-profiler.intent.ts
 *
 * Run with --allow-natives-syntax to include the hidden-class checks. */

const assert = require('node:assert/strict');
const lint = require('./_source-lint.js');
const X = require('../src/exec/client-profiler.exec.js');

let passed = 0, skipped = 0;
function check(name, fn) {
  fn();
  passed++;
  process.stdout.write('  ok  ' + name + '\n');
}
function skip(name, why) {
  skipped++;
  process.stdout.write('  --  ' + name + '  (skipped: ' + why + ')\n');
}

let hasFastProperties = null;
try {
  hasFastProperties = new Function('a', 'return %HasFastProperties(a);');
  hasFastProperties({});
} catch (e) { hasFastProperties = null; }

const TODAY = 10000;

/* ---- harness ----------------------------------------------------------- */

function card(phoneHash, nameLength, phoneDigits, createdDay, consentFlags) {
  return {
    phoneHash: phoneHash, nameLength: nameLength, phoneDigits: phoneDigits,
    createdDay: createdDay === undefined ? TODAY - 100 : createdDay,
    consentFlags: consentFlags === undefined ? 0 : consentFlags
  };
}
/* a card that passes every validation check */
function goodCard(phoneHash) { return card(phoneHash, 5, 11); }

function visit(clientSlot, day, spend, flags) {
  return {
    clientSlot: clientSlot, day: day, spend: spend === undefined ? 5000 : spend,
    flags: flags === undefined ? 0 : flags
  };
}

function run(clients, visits, asOfDay) {
  const day = asOfDay === undefined ? TODAY : asOfDay;
  const P = X.allocProfiler(Math.max(clients.length, 1), Math.max(visits.length, 1));
  X.resetProfiler(P);
  for (let i = 0; i < clients.length; i++) {
    P.cliPhoneHash[i] = clients[i].phoneHash;
    P.cliNameLength[i] = clients[i].nameLength;
    P.cliPhoneDigits[i] = clients[i].phoneDigits;
    P.cliCreatedDay[i] = clients[i].createdDay;
    P.cliConsentFlags[i] = clients[i].consentFlags;
  }
  for (let i = 0; i < visits.length; i++) {
    P.visClient[i] = visits[i].clientSlot;
    P.visDay[i] = visits[i].day;
    P.visSpend[i] = visits[i].spend;
    P.visFlags[i] = visits[i].flags;
  }
  X.runProfile(P, clients.length, visits.length, day);
  return P;
}

/* n attended visits for slot 0, most recent `recency` days ago, spaced `gap` */
function visitRun(slot, n, recency, gap) {
  const out = [];
  const last = TODAY - recency;
  for (let i = 0; i < n; i++) out.push(visit(slot, last - (n - 1 - i) * gap, 5000, 0));
  return out;
}

process.stdout.write('\nSINGULARITY :: client-profiler loopback\n\n');

/* ---- P8: layout ------------------------------------------------------- */

check('arena is one SharedArrayBuffer; every view shares it', function () {
  const P = X.allocProfiler(1000, 5000);
  assert.ok(P.arena instanceof SharedArrayBuffer);
  const names = X.PROFILER.fieldNames;
  for (let i = 0, n = names.length; i < n; i++) {
    assert.equal(P[names[i]].buffer, P.arena, names[i]);
  }
  assert.equal(P.byteLength % 8, 0);
});

if (hasFastProperties !== null) {
  check('handle stays in fast properties despite 26 keys (past the 20 cliff)', function () {
    const P = X.allocProfiler(64, 128);
    assert.ok(Object.keys(P).length > 20,
      'this module is supposed to exceed 20 properties; got ' + Object.keys(P).length);
    assert.equal(hasFastProperties(P), true,
      'handle fell into dictionary mode — decisions/0006 is violated');
  });
} else {
  skip('handle stays in fast properties past the 20 cliff', 'needs --allow-natives-syntax');
}

check('hash table capacity is a power of two and at least 2x clients', function () {
  const sizes = [1, 2, 7, 8, 9, 100, 1000, 4096, 5000];
  for (let i = 0; i < sizes.length; i++) {
    const cap = X.hashCapacityFor(sizes[i]);
    assert.equal(cap & (cap - 1), 0, 'not a power of two for ' + sizes[i] + ': ' + cap);
    assert.ok(cap >= sizes[i] * 2 || cap === 16, 'too small for ' + sizes[i] + ': ' + cap);
  }
  const P = X.allocProfiler(1000, 10);
  assert.equal(P.hashCapacity, X.hashCapacityFor(1000));
});

check('attach reproduces the layout without copying', function () {
  const a = X.allocProfiler(256, 512);
  a.cliPhoneHash[7] = 123456;
  a.visSpend[9] = 4242;
  const b = X.attachProfiler(a.arena, 256, 512);
  assert.equal(b.arena, a.arena);
  assert.equal(b.cliPhoneHash[7], 123456);
  assert.equal(b.visSpend[9], 4242);
  b.cliPhoneHash[7] = 999;
  assert.equal(a.cliPhoneHash[7], 999, 'writes must be visible both ways');
});

/* ---- P2: client card creation ----------------------------------------- */

check('client.accept: a well-formed card becomes ACTIVE', function () {
  const P = run([goodCard(111)], []);
  assert.equal(P.cliStatus[0], X.CLIENT_ACTIVE);
  assert.equal(P.stats[X.STAT_ACTIVE_CLIENTS], 1);
  assert.equal(P.stats[X.STAT_REJECTED_CLIENTS], 0);
});

check('client.1_name_present: empty name rejected', function () {
  const P = run([card(111, 0, 11)], []);
  assert.equal(P.cliStatus[0], X.CLIENT_INVALID_NAME);
  assert.equal(P.stats[X.STAT_REJ_INVALID_NAME], 1);
});

check('client.2_phone_plausible: both digit boundaries, inclusive', function () {
  assert.equal(run([card(1, 5, X.LIMIT_MIN_PHONE_DIGITS)], []).cliStatus[0], X.CLIENT_ACTIVE);
  assert.equal(run([card(1, 5, X.LIMIT_MAX_PHONE_DIGITS)], []).cliStatus[0], X.CLIENT_ACTIVE);
  assert.equal(run([card(1, 5, X.LIMIT_MIN_PHONE_DIGITS - 1)], []).cliStatus[0], X.CLIENT_INVALID_PHONE);
  assert.equal(run([card(1, 5, X.LIMIT_MAX_PHONE_DIGITS + 1)], []).cliStatus[0], X.CLIENT_INVALID_PHONE);
  assert.equal(run([card(1, 5, 0)], []).cliStatus[0], X.CLIENT_INVALID_PHONE);
});

check('client.3_not_future: today is fine, tomorrow is not', function () {
  assert.equal(run([card(1, 5, 11, TODAY)], []).cliStatus[0], X.CLIENT_ACTIVE);
  const P = run([card(1, 5, 11, TODAY + 1)], []);
  assert.equal(P.cliStatus[0], X.CLIENT_FUTURE_DATED);
  assert.equal(P.stats[X.STAT_REJ_FUTURE_DATED], 1);
});

check('client.4_phone_unique: duplicate phone rejected, lowest slot wins', function () {
  const P = run([goodCard(777), goodCard(777), goodCard(778)], []);
  assert.equal(P.cliStatus[0], X.CLIENT_ACTIVE, 'first occurrence keeps the number');
  assert.equal(P.cliStatus[1], X.CLIENT_DUPLICATE_PHONE);
  assert.equal(P.cliStatus[2], X.CLIENT_ACTIVE, 'a different hash is unaffected');
  assert.equal(P.stats[X.STAT_REJ_DUPLICATE_PHONE], 1);
  assert.equal(P.stats[X.STAT_ACTIVE_CLIENTS], 2);
});

check('client.4_phone_unique: a rejected card does not claim its phone', function () {
  /* slot 0 fails on name, so slot 1 with the same hash must still be ACTIVE */
  const P = run([card(555, 0, 11), goodCard(555)], []);
  assert.equal(P.cliStatus[0], X.CLIENT_INVALID_NAME);
  assert.equal(P.cliStatus[1], X.CLIENT_ACTIVE,
    'an invalid card must not reserve the phone number');
});

check('client.validate_order: name > phone > future > duplicate', function () {
  /* every check violated at once -> the first must win */
  const P = run([goodCard(9), card(9, 0, 0, TODAY + 50)], []);
  assert.equal(P.cliStatus[1], X.CLIENT_INVALID_NAME);
  /* phone beats future-dated and duplicate */
  const P2 = run([goodCard(9), card(9, 5, 0, TODAY + 50)], []);
  assert.equal(P2.cliStatus[1], X.CLIENT_INVALID_PHONE);
  /* future-dated beats duplicate */
  const P3 = run([goodCard(9), card(9, 5, 11, TODAY + 50)], []);
  assert.equal(P3.cliStatus[1], X.CLIENT_FUTURE_DATED);
});

check('dedupe survives hash collisions (probing, not just masking)', function () {
  /* hashCapacity for 8 clients is 16; these all mask to the same bucket */
  /* every one of these masks to bucket 3, so the table must probe past a run of
   * occupied buckets and still conclude "not present" */
  const cap = X.hashCapacityFor(8);
  const cards = [];
  for (let i = 0; i < 7; i++) cards.push(goodCard(i * cap + 3));
  const P = run(cards, []);
  /* all seven hashes are distinct, so all seven must be ACTIVE */
  const seen = Object.create(null);
  for (let i = 0; i < cards.length; i++) {
    assert.equal(seen[cards[i].phoneHash], undefined, 'test built a real duplicate');
    seen[cards[i].phoneHash] = true;
    assert.equal(P.cliStatus[i], X.CLIENT_ACTIVE,
      'slot ' + i + ' (hash ' + cards[i].phoneHash + ') wrongly rejected');
  }
});

check('dedupe detects duplicates that collide with a third hash', function () {
  const cap = X.hashCapacityFor(8);
  const P = run([goodCard(3), goodCard(3 + cap), goodCard(3)], []);
  assert.equal(P.cliStatus[0], X.CLIENT_ACTIVE);
  assert.equal(P.cliStatus[1], X.CLIENT_ACTIVE, 'colliding but distinct');
  assert.equal(P.cliStatus[2], X.CLIENT_DUPLICATE_PHONE, 'true duplicate past a collision');
});

check('phoneHash 0 is a usable value, not confused with an empty bucket', function () {
  /* the table stores slot+1 precisely so hash 0 / slot 0 is representable */
  const P = run([goodCard(0), goodCard(0)], []);
  assert.equal(P.cliStatus[0], X.CLIENT_ACTIVE);
  assert.equal(P.cliStatus[1], X.CLIENT_DUPLICATE_PHONE);
});

/* ---- P3: visit folding ------------------------------------------------ */

check('visit.count: attended visits accumulate count, spend and window', function () {
  const P = run([goodCard(1)], [
    visit(0, TODAY - 30, 1000), visit(0, TODAY - 10, 2500), visit(0, TODAY - 20, 500)
  ]);
  assert.equal(P.cliVisitCount[0], 3);
  assert.equal(P.cliTotalSpend[0], 4000);
  assert.equal(P.cliFirstDay[0], TODAY - 30);
  assert.equal(P.cliLastDay[0], TODAY - 10);
  assert.equal(P.stats[X.STAT_COUNTED_VISITS], 3);
  assert.equal(P.stats[X.STAT_TOTAL_SPEND], 4000);
});

check('visit.order_independent: shuffling a batch yields identical aggregates', function () {
  const base = [visit(0, TODAY - 40, 700), visit(0, TODAY - 5, 1300), visit(0, TODAY - 22, 100)];
  const a = run([goodCard(1)], base);
  const b = run([goodCard(1)], [base[2], base[0], base[1]]);
  const c = run([goodCard(1)], [base[1], base[2], base[0]]);
  for (const P of [b, c]) {
    assert.equal(P.cliVisitCount[0], a.cliVisitCount[0]);
    assert.equal(P.cliTotalSpend[0], a.cliTotalSpend[0]);
    assert.equal(P.cliFirstDay[0], a.cliFirstDay[0]);
    assert.equal(P.cliLastDay[0], a.cliLastDay[0]);
    assert.equal(P.cliSegment[0], a.cliSegment[0]);
    assert.equal(P.cliCadence[0], a.cliCadence[0]);
  }
});

check('visit.1_client_known: last slot valid, one past the end rejected', function () {
  const P = run([goodCard(1), goodCard(2)], [visit(1, TODAY - 5), visit(2, TODAY - 5)]);
  assert.equal(P.visStatus[0], X.VISIT_COUNTED);
  assert.equal(P.visStatus[1], X.VISIT_UNKNOWN_CLIENT);
  assert.equal(P.stats[X.STAT_REJ_UNKNOWN_CLIENT], 1);
});

check('visit.2_client_active: visits for a rejected client contribute nothing', function () {
  const P = run([card(1, 0, 11)], [visit(0, TODAY - 5, 9999)]);
  assert.equal(P.visStatus[0], X.VISIT_INACTIVE_CLIENT);
  assert.equal(P.cliVisitCount[0], 0);
  assert.equal(P.cliTotalSpend[0], 0);
  assert.equal(P.stats[X.STAT_TOTAL_SPEND], 0);
  assert.equal(P.stats[X.STAT_REJ_INACTIVE_CLIENT], 1);
});

check('visit.3_not_future: today counts, tomorrow is rejected', function () {
  const P = run([goodCard(1)], [visit(0, TODAY), visit(0, TODAY + 1)]);
  assert.equal(P.visStatus[0], X.VISIT_COUNTED);
  assert.equal(P.visStatus[1], X.VISIT_FUTURE_DATED);
  assert.equal(P.cliVisitCount[0], 1);
});

check('visit.4_spend_sane: zero legal, negative and over-cap rejected', function () {
  const P = run([goodCard(1)], [
    visit(0, TODAY - 1, 0),
    visit(0, TODAY - 2, -1),
    visit(0, TODAY - 3, X.LIMIT_MAX_VISIT_SPEND),
    visit(0, TODAY - 4, X.LIMIT_MAX_VISIT_SPEND + 1)
  ]);
  assert.equal(P.visStatus[0], X.VISIT_COUNTED, 'zero spend is a real visit');
  assert.equal(P.visStatus[1], X.VISIT_NEGATIVE_SPEND);
  assert.equal(P.visStatus[2], X.VISIT_COUNTED, 'cap is inclusive');
  assert.equal(P.visStatus[3], X.VISIT_NEGATIVE_SPEND);
  assert.equal(P.cliVisitCount[0], 2);
  assert.equal(P.stats[X.STAT_REJ_BAD_SPEND], 2);
});

check('visit.5_no_show: counted separately, no spend, not an attended visit', function () {
  const P = run([goodCard(1)], [
    visit(0, TODAY - 5, 5000, 0),
    visit(0, TODAY - 3, 5000, X.FLAG_NO_SHOW)
  ]);
  assert.equal(P.visStatus[1], X.VISIT_NO_SHOW_RECORDED);
  assert.equal(P.cliVisitCount[0], 1, 'a no-show must not count as a visit');
  assert.equal(P.cliNoShowCount[0], 1);
  assert.equal(P.cliTotalSpend[0], 5000, 'a no-show must not add spend');
  assert.equal(P.cliLastDay[0], TODAY - 5, 'a no-show must not move the recency window');
  assert.equal(P.stats[X.STAT_NO_SHOW_VISITS], 1);
});

check('visit.recency_window: zero visits leaves both days at 0', function () {
  const P = run([goodCard(1)], [visit(0, TODAY - 1, 5000, X.FLAG_NO_SHOW)]);
  assert.equal(P.cliVisitCount[0], 0);
  assert.equal(P.cliFirstDay[0], 0);
  assert.equal(P.cliLastDay[0], 0);
});

/* ---- P4: cadence ----------------------------------------------------- */

check('cadence.definition: truncating mean gap', function () {
  /* 4 visits, 30 days apart -> span 90 / 3 = 30 */
  const P = run([goodCard(1)], visitRun(0, 4, 10, 30));
  assert.equal(P.cliVisitCount[0], 4);
  assert.equal(P.cliCadence[0], 30);
  /* span 100 over 3 gaps -> 33 (truncated from 33.33) */
  const Q = run([goodCard(1)], [
    visit(0, TODAY - 110), visit(0, TODAY - 80), visit(0, TODAY - 40), visit(0, TODAY - 10)
  ]);
  assert.equal(Q.cliCadence[0], 33);
});

check('cadence: fewer than two visits is 0, not a division by zero', function () {
  assert.equal(run([goodCard(1)], []).cliCadence[0], 0);
  assert.equal(run([goodCard(1)], [visit(0, TODAY - 5)]).cliCadence[0], 0);
});

check('cadence.same_day: repeated same-day visits give 0', function () {
  const P = run([goodCard(1)], [visit(0, TODAY - 5), visit(0, TODAY - 5), visit(0, TODAY - 5)]);
  assert.equal(P.cliVisitCount[0], 3);
  assert.equal(P.cliCadence[0], 0);
});

/* ---- P5: segmentation ------------------------------------------------ */

check('segment.1_never: no attended visits -> NEVER_VISITED even with no-shows', function () {
  const P = run([goodCard(1)], [
    visit(0, TODAY - 5, 0, X.FLAG_NO_SHOW), visit(0, TODAY - 6, 0, X.FLAG_NO_SHOW)
  ]);
  assert.equal(P.cliSegment[0], X.SEG_NEVER_VISITED);
});

check('segment.2_lapsed: boundary at LAPSED_AFTER_DAYS', function () {
  /* exactly 365 days ago is NOT lapsed; 366 is */
  const at = run([goodCard(1)], visitRun(0, 20, X.SEG_LAPSED_AFTER_DAYS, 5));
  assert.notEqual(at.cliSegment[0], X.SEG_LAPSED);
  const over = run([goodCard(1)], visitRun(0, 20, X.SEG_LAPSED_AFTER_DAYS + 1, 5));
  assert.equal(over.cliSegment[0], X.SEG_LAPSED);
});

check('segment.2_lapsed outranks VIP: heavy history but long gone', function () {
  const P = run([goodCard(1)], visitRun(0, 50, 400, 2));
  assert.equal(P.cliVisitCount[0], 50);
  assert.equal(P.cliSegment[0], X.SEG_LAPSED, 'lapsed must beat VIP');
});

check('segment.3_vip: both boundaries', function () {
  const vip = run([goodCard(1)], visitRun(0, X.SEG_VIP_MIN_VISITS, X.SEG_VIP_MAX_RECENCY, 3));
  assert.equal(vip.cliSegment[0], X.SEG_VIP, 'min visits + max recency is VIP');
  /* one visit short -> REGULAR, not VIP */
  const short = run([goodCard(1)], visitRun(0, X.SEG_VIP_MIN_VISITS - 1, X.SEG_VIP_MAX_RECENCY, 3));
  assert.equal(short.cliSegment[0], X.SEG_REGULAR);
  /* one day too stale -> REGULAR, not VIP */
  const stale = run([goodCard(1)], visitRun(0, X.SEG_VIP_MIN_VISITS, X.SEG_VIP_MAX_RECENCY + 1, 3));
  assert.equal(stale.cliSegment[0], X.SEG_REGULAR);
});

check('segment.4_regular: both boundaries', function () {
  const reg = run([goodCard(1)],
    visitRun(0, X.SEG_REGULAR_MIN_VISITS, X.SEG_REGULAR_MAX_RECENCY, 10));
  assert.equal(reg.cliSegment[0], X.SEG_REGULAR);
  /* one visit short and stale enough -> AT_RISK */
  const few = run([goodCard(1)],
    visitRun(0, X.SEG_REGULAR_MIN_VISITS - 1, X.SEG_REGULAR_MAX_RECENCY + 1, 10));
  assert.equal(few.cliSegment[0], X.SEG_AT_RISK);
});

check('segment.5_at_risk / 6_new: light history splits on recency', function () {
  const fresh = run([goodCard(1)], visitRun(0, 2, 10, 5));
  assert.equal(fresh.cliSegment[0], X.SEG_NEW);
  const stale = run([goodCard(1)], visitRun(0, 2, X.SEG_AT_RISK_AFTER_DAYS + 1, 5));
  assert.equal(stale.cliSegment[0], X.SEG_AT_RISK);
  const edge = run([goodCard(1)], visitRun(0, 2, X.SEG_AT_RISK_AFTER_DAYS, 5));
  assert.equal(edge.cliSegment[0], X.SEG_NEW, 'exactly at the threshold is not yet at risk');
});

check('segment.recency_definition: a visit today gives recency 0', function () {
  const P = run([goodCard(1)], [visit(0, TODAY)]);
  assert.equal(P.cliLastDay[0], TODAY);
  assert.equal(P.cliSegment[0], X.SEG_NEW);
});

check('segment.inactive_unsegmented: rejected clients stay UNSEGMENTED', function () {
  const P = run([card(1, 0, 11), goodCard(2)], [visit(1, TODAY - 5)]);
  assert.equal(P.cliSegment[0], X.SEG_UNSEGMENTED);
  assert.equal(P.segmentCounts[X.SEG_UNSEGMENTED], 0,
    'an inactive client must not appear in any segment count');
});

/* ---- P6: reliability ------------------------------------------------- */

check('risk.no_show_rate: rate is over BOOKED appointments', function () {
  /* 3 attended + 3 no-shows = 6 booked, rate 5000 bps -> unreliable */
  const v = [];
  for (let i = 0; i < 3; i++) v.push(visit(0, TODAY - 10 - i, 1000, 0));
  for (let i = 0; i < 3; i++) v.push(visit(0, TODAY - 20 - i, 0, X.FLAG_NO_SHOW));
  const P = run([goodCard(1)], v);
  assert.equal(P.cliVisitCount[0], 3);
  assert.equal(P.cliNoShowCount[0], 3);
  assert.equal(P.cliRiskFlags[0], X.RISK_UNRELIABLE);
  assert.equal(P.stats[X.STAT_UNRELIABLE_CLIENTS], 1);
});

check('risk.unreliable: threshold boundary, truncating', function () {
  /* 3 of 10 booked = exactly 3000 bps -> flagged (>=) */
  const at = [];
  for (let i = 0; i < 7; i++) at.push(visit(0, TODAY - 10 - i, 100, 0));
  for (let i = 0; i < 3; i++) at.push(visit(0, TODAY - 40 - i, 0, X.FLAG_NO_SHOW));
  assert.equal(run([goodCard(1)], at).cliRiskFlags[0], X.RISK_UNRELIABLE);
  /* 2 of 10 = 2000 bps -> not flagged */
  const below = [];
  for (let i = 0; i < 8; i++) below.push(visit(0, TODAY - 10 - i, 100, 0));
  for (let i = 0; i < 2; i++) below.push(visit(0, TODAY - 40 - i, 0, X.FLAG_NO_SHOW));
  assert.equal(run([goodCard(1)], below).cliRiskFlags[0], 0);
});

check('risk.min_sample: a tiny sample is never flagged', function () {
  /* 1 no-show out of 1 booking is 10000 bps but below the minimum sample */
  const P = run([goodCard(1)], [visit(0, TODAY - 5, 0, X.FLAG_NO_SHOW)]);
  assert.equal(P.cliNoShowCount[0], 1);
  assert.equal(P.cliRiskFlags[0], 0, 'must not flag on a single booking');
  /* exactly at the minimum, all no-shows -> flagged */
  const v = [];
  for (let i = 0; i < X.RISK_MIN_BOOKINGS; i++) v.push(visit(0, TODAY - 5 - i, 0, X.FLAG_NO_SHOW));
  assert.equal(run([goodCard(1)], v).cliRiskFlags[0], X.RISK_UNRELIABLE);
});

check('risk.orthogonal: a VIP can be flagged UNRELIABLE', function () {
  const v = visitRun(0, 20, 5, 3);
  for (let i = 0; i < 12; i++) v.push(visit(0, TODAY - 200 - i, 0, X.FLAG_NO_SHOW));
  const P = run([goodCard(1)], v);
  assert.equal(P.cliSegment[0], X.SEG_VIP);
  assert.equal(P.cliRiskFlags[0], X.RISK_UNRELIABLE);
});

/* ---- P7: aggregation ------------------------------------------------- */

check('aggregate.client_counts and visit_counts partition exactly', function () {
  const clients = [goodCard(1), card(2, 0, 11), goodCard(1), goodCard(3), card(4, 5, 2)];
  const visits = [
    visit(0, TODAY - 5), visit(1, TODAY - 5), visit(9, TODAY - 5),
    visit(3, TODAY + 9), visit(3, TODAY - 1, -5), visit(3, TODAY - 2, 100, X.FLAG_NO_SHOW),
    visit(3, TODAY - 3, 100)
  ];
  const P = run(clients, visits);
  const s = P.stats;
  assert.equal(s[X.STAT_ACTIVE_CLIENTS] + s[X.STAT_REJECTED_CLIENTS], clients.length);
  assert.equal(s[X.STAT_COUNTED_VISITS] + s[X.STAT_NO_SHOW_VISITS] + s[X.STAT_REJECTED_VISITS],
    visits.length);
  const rejTally = s[X.STAT_REJ_INVALID_NAME] + s[X.STAT_REJ_INVALID_PHONE] +
    s[X.STAT_REJ_DUPLICATE_PHONE] + s[X.STAT_REJ_FUTURE_DATED];
  assert.equal(rejTally, s[X.STAT_REJECTED_CLIENTS]);
  const visRejTally = s[X.STAT_REJ_UNKNOWN_CLIENT] + s[X.STAT_REJ_INACTIVE_CLIENT] +
    s[X.STAT_REJ_VISIT_FUTURE] + s[X.STAT_REJ_BAD_SPEND];
  assert.equal(visRejTally, s[X.STAT_REJECTED_VISITS]);
});

check('aggregate.segment_counts sums to activeClients', function () {
  const clients = [];
  for (let i = 0; i < 40; i++) {
    clients.push(i % 7 === 0 ? card(1000 + i, 0, 11) : goodCard(1000 + i));
  }
  const visits = [];
  for (let i = 0; i < 40; i++) {
    const n = i % 15;
    for (let k = 0; k < n; k++) visits.push(visit(i, TODAY - (i * 11) - k * 4, 1000 + k));
  }
  const P = run(clients, visits);
  let sum = 0;
  for (let s = 0; s < X.SEG_COUNT; s++) sum += P.segmentCounts[s];
  assert.equal(sum, P.stats[X.STAT_ACTIVE_CLIENTS]);
  assert.ok(P.stats[X.STAT_ACTIVE_CLIENTS] > 0);
});

check('aggregate.spend: totals above 2^31 stay exact in the Float64 slot', function () {
  const n = 5000;
  const clients = [goodCard(1)];
  const visits = [];
  for (let i = 0; i < n; i++) visits.push(visit(0, TODAY - 1, X.LIMIT_MAX_VISIT_SPEND));
  const P = run(clients, visits);
  const expected = n * X.LIMIT_MAX_VISIT_SPEND; /* 5e9, past 2^31 */
  assert.ok(expected > 2147483647);
  assert.equal(P.stats[X.STAT_TOTAL_SPEND], expected);
  assert.equal(P.cliTotalSpend[0], expected);
});

/* ---- P1: pipeline ---------------------------------------------------- */

check('pipeline.replayable: reset + identical replay is byte-identical', function () {
  const clients = [];
  for (let i = 0; i < 200; i++) {
    clients.push(i % 11 === 0 ? card(500 + i, 0, 11) : goodCard(500 + (i % 150)));
  }
  const visits = [];
  for (let i = 0; i < 900; i++) {
    visits.push(visit(i % 210, TODAY - (i % 500), (i * 37) % 9000, i % 9 === 0 ? X.FLAG_NO_SHOW : 0));
  }
  const P = X.allocProfiler(clients.length, visits.length);

  function pass() {
    X.resetProfiler(P);
    for (let i = 0; i < clients.length; i++) {
      P.cliPhoneHash[i] = clients[i].phoneHash;
      P.cliNameLength[i] = clients[i].nameLength;
      P.cliPhoneDigits[i] = clients[i].phoneDigits;
      P.cliCreatedDay[i] = clients[i].createdDay;
    }
    for (let i = 0; i < visits.length; i++) {
      P.visClient[i] = visits[i].clientSlot;
      P.visDay[i] = visits[i].day;
      P.visSpend[i] = visits[i].spend;
      P.visFlags[i] = visits[i].flags;
    }
    X.runProfile(P, clients.length, visits.length, TODAY);
    return {
      status: Array.from(P.cliStatus), seg: Array.from(P.cliSegment),
      cad: Array.from(P.cliCadence), risk: Array.from(P.cliRiskFlags),
      spend: Array.from(P.cliTotalSpend), vstat: Array.from(P.visStatus),
      stats: Array.from(P.stats), segCounts: Array.from(P.segmentCounts)
    };
  }
  const a = pass(), b = pass(), c = pass();
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  /* and the run is non-trivial */
  assert.ok(a.stats[X.STAT_ACTIVE_CLIENTS] > 0);
  assert.ok(a.stats[X.STAT_REJ_DUPLICATE_PHONE] > 0);
  assert.ok(a.stats[X.STAT_NO_SHOW_VISITS] > 0);
});

check('empty batch is a no-op', function () {
  const P = X.allocProfiler(8, 8);
  X.resetProfiler(P);
  assert.doesNotThrow(function () { X.runProfile(P, 0, 0, TODAY); });
  for (let i = 0; i < X.STAT_SLOTS; i++) assert.equal(P.stats[i], 0);
  for (let i = 0; i < 8; i++) {
    assert.equal(P.cliStatus[i], X.CLIENT_PENDING);
    assert.equal(P.visStatus[i], X.VISIT_PENDING);
  }
});

check('count < capacity leaves the tail untouched', function () {
  const P = X.allocProfiler(64, 64);
  X.resetProfiler(P);
  P.cliNameLength[0] = 5; P.cliPhoneDigits[0] = 11; P.cliPhoneHash[0] = 1;
  X.runProfile(P, 1, 0, TODAY);
  assert.equal(P.cliStatus[0], X.CLIENT_ACTIVE);
  for (let i = 1; i < 64; i++) {
    assert.equal(P.cliStatus[i], X.CLIENT_PENDING, 'tail status @' + i);
    assert.equal(P.cliSegment[i], X.SEG_UNSEGMENTED, 'tail segment @' + i);
  }
});

check('exec.no_throw: adversarial garbage yields status codes, never exceptions', function () {
  const P = X.allocProfiler(6, 6);
  X.resetProfiler(P);
  for (let i = 0; i < 6; i++) {
    P.cliNameLength[i] = 255;
    P.cliPhoneDigits[i] = 255;
    P.cliPhoneHash[i] = 4294967295;
    P.cliCreatedDay[i] = 4294967295;
    P.visClient[i] = 4294967295;
    P.visDay[i] = 4294967295;
    P.visSpend[i] = -2147483648;
    P.visFlags[i] = 255;
  }
  assert.doesNotThrow(function () { X.runProfile(P, 6, 6, TODAY); });
  for (let i = 0; i < 6; i++) {
    assert.equal(P.cliStatus[i], X.CLIENT_INVALID_PHONE);
    assert.equal(P.visStatus[i], X.VISIT_UNKNOWN_CLIENT);
    assert.equal(P.cliSegment[i], X.SEG_UNSEGMENTED);
  }
});

check('a full hash table cannot spin: probe is bounded', function () {
  /* fill every client slot with distinct hashes that all mask to one bucket */
  const cap = 64;
  const P = X.allocProfiler(cap, 1);
  X.resetProfiler(P);
  const hcap = X.hashCapacityFor(cap);
  for (let i = 0; i < cap; i++) {
    P.cliNameLength[i] = 5;
    P.cliPhoneDigits[i] = 11;
    P.cliPhoneHash[i] = i * hcap; /* every one masks to the same bucket */
  }
  assert.doesNotThrow(function () { X.registerClients(P, cap, TODAY); });
  let active = 0;
  for (let i = 0; i < cap; i++) if (P.cliStatus[i] === X.CLIENT_ACTIVE) active++;
  assert.equal(active, cap, 'distinct hashes must all register despite total collision');
});

/* ---- ruleset compliance --------------------------------------------- */

check('exec source obeys the ruleset', function () {
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../src/exec/client-profiler.exec.js'), 'utf8');
  assert.ok(/^'use strict';/.test(src));
  lint.assertNoBannedConstructs(assert, src);
  lint.assertLoopBoundsCached(assert, src);
  const code = lint.stripCommentsAndStrings(src);
  assert.equal(/\bthis\b/.test(code), false, '`this` in an exec unit');
  assert.equal(/\btry\b/.test(code), false, 'try/catch in an exec unit');
  assert.ok(/defineArena\(/.test(code), 'must declare its arena');
  assert.equal(/new SharedArrayBuffer\(/.test(code), false, 'must not allocate its own store');
  /* P8: no Map/Set/object used for de-duplication */
  assert.equal(/new Map\(|new Set\(|Object\.create/.test(code), false,
    'de-duplication must be open-addressed, not a Map/Set/object');
});

check('exec.no_pii: the arena declares no string or free-text field', function () {
  const names = X.PROFILER.fieldNames;
  for (let i = 0, n = names.length; i < n; i++) {
    assert.equal(/name$|phone$|email|text|note/i.test(names[i]), false,
      'field "' + names[i] + '" looks like it holds PII');
  }
  /* the only name/phone-derived fields are a length and a digit count */
  assert.ok(names.indexOf('cliNameLength') !== -1);
  assert.ok(names.indexOf('cliPhoneDigits') !== -1);
  assert.ok(names.indexOf('cliPhoneHash') !== -1);
});

process.stdout.write('\n  ' + passed + ' checks passed' +
  (skipped > 0 ? ', ' + skipped + ' skipped' : '') + '\n\n');
