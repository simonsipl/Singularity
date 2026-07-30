'use strict';
/* SINGULARITY RUNTIME VERIFICATION
 * unit under test: src/runtime/ingest.js
 *
 * The claim under test is not "it parses JSON" — it is "it parses JSON into
 * typed arrays without allocating per record". Both halves are checked:
 * equivalence against JSON.parse for correctness, and an amortised heap
 * measurement for the allocation claim. */

const assert = require('node:assert/strict');
const { makeIngester } = require('../src/runtime/ingest.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  process.stdout.write('  ok  ' + name + '\n');
}

const FIELDS = ['id', 'accountSlot', 'amount', 'currency', 'flags'];

function makeViews(cap) {
  return [new Uint32Array(cap), new Uint32Array(cap), new Int32Array(cap),
    new Uint8Array(cap), new Uint8Array(cap)];
}

const ingest = makeIngester(FIELDS);

process.stdout.write('\nSINGULARITY :: json-to-arena ingest\n\n');

/* ---- correctness ------------------------------------------------------- */

check('parses a flat record array into parallel typed arrays', function () {
  const v = makeViews(8);
  const n = ingest('[{"id":1,"accountSlot":3,"amount":5000,"currency":2,"flags":1}]', v, 8);
  assert.equal(n, 1);
  assert.equal(v[0][0], 1);
  assert.equal(v[1][0], 3);
  assert.equal(v[2][0], 5000);
  assert.equal(v[3][0], 2);
  assert.equal(v[4][0], 1);
});

check('key order is irrelevant', function () {
  const a = makeViews(4), b = makeViews(4);
  ingest('[{"id":7,"amount":900,"flags":1}]', a, 4);
  ingest('[{"flags":1,"amount":900,"id":7}]', b, 4);
  for (let f = 0; f < FIELDS.length; f++) assert.equal(a[f][0], b[f][0], FIELDS[f]);
});

check('a missing key means 0, and does not leak the previous record', function () {
  const v = makeViews(4);
  const n = ingest('[{"id":1,"amount":500,"flags":1},{"id":2}]', v, 4);
  assert.equal(n, 2);
  assert.equal(v[2][0], 500);
  assert.equal(v[4][0], 1);
  assert.equal(v[2][1], 0, 'amount must reset between records');
  assert.equal(v[4][1], 0, 'flags must reset between records');
});

check('negative integers survive the round trip', function () {
  const v = makeViews(4);
  ingest('[{"amount":-2147483648},{"amount":-1}]', v, 4);
  assert.equal(v[2][0], -2147483648);
  assert.equal(v[2][1], -1);
});

check('whitespace anywhere structural is tolerated', function () {
  const v = makeViews(4);
  const n = ingest('  [\n  { "id" : 1 ,\t"amount" : 42 }\r\n , {"id":2}  ]  ', v, 4);
  assert.equal(n, 2);
  assert.equal(v[0][0], 1);
  assert.equal(v[2][0], 42);
  assert.equal(v[0][1], 2);
});

check('empty array yields zero records', function () {
  const v = makeViews(4);
  assert.equal(ingest('[]', v, 4), 0);
  assert.equal(ingest('  [  ]  ', v, 4), 0);
});

check('empty record objects are legal and produce zeroed rows', function () {
  const v = makeViews(4);
  v[2][0] = 999;
  const n = ingest('[{},{}]', v, 4);
  assert.equal(n, 2);
  assert.equal(v[2][0], 0, 'stale value must be overwritten');
});

check('equivalence: matches JSON.parse + manual pack over a large batch', function () {
  const N = 5000;
  const parts = [];
  for (let i = 0; i < N; i++) {
    parts.push('{"id":' + i + ',"accountSlot":' + (i % 97) +
      ',"amount":' + ((i % 71 === 0) ? -i : 100 + (i * 613) % 90000) +
      ',"currency":' + (i % 3) + ',"flags":' + (i & 1) + '}');
  }
  const json = '[' + parts.join(',') + ']';

  const fast = makeViews(N);
  const n = ingest(json, fast, N);
  assert.equal(n, N);

  const ref = JSON.parse(json);
  assert.equal(ref.length, N);
  for (let i = 0; i < N; i++) {
    assert.equal(fast[0][i], ref[i].id, 'id @' + i);
    assert.equal(fast[1][i], ref[i].accountSlot, 'accountSlot @' + i);
    assert.equal(fast[2][i], ref[i].amount, 'amount @' + i);
    assert.equal(fast[3][i], ref[i].currency, 'currency @' + i);
    assert.equal(fast[4][i], ref[i].flags, 'flags @' + i);
  }
});

/* ---- rejection: the contract is enforced at the boundary ---------------- */

check('fractional values are REJECTED, never rounded (decision 0001)', function () {
  const v = makeViews(4);
  assert.throws(function () { ingest('[{"amount":3.50}]', v, 4); }, /fractional value/);
  assert.throws(function () { ingest('[{"amount":1e3}]', v, 4); }, /fractional value/);
  assert.throws(function () { ingest('[{"amount":1E3}]', v, 4); }, /fractional value/);
  assert.throws(function () { ingest('[{"amount":-0.01}]', v, 4); }, /fractional value/);
});

check('values too large for the destination view are REJECTED, not wrapped', function () {
  /* Writing 2200000000 into an Int32Array silently yields -2094967296. Silent
   * truncation is precisely the corruption this scanner exists to prevent, so
   * an out-of-range value is refused like a float or an unknown key. */
  const v = makeViews(4);
  assert.throws(function () { ingest('[{"amount":2200000000}]', v, 4); },
    /does not fit field "amount"/);
  assert.throws(function () { ingest('[{"amount":9999999999}]', v, 4); },
    /would wrap silently/);
  /* per-view ranges, not one global range: flags is a u8 */
  assert.throws(function () { ingest('[{"flags":256}]', v, 4); }, /does not fit field "flags"/);
  assert.throws(function () { ingest('[{"flags":-1}]', v, 4); }, /range 0\.\.255/);
  /* unsigned views reject negatives; signed views accept them */
  assert.throws(function () { ingest('[{"accountSlot":-1}]', v, 4); }, /does not fit/);
  assert.doesNotThrow(function () { ingest('[{"amount":-2147483648}]', v, 4); });
});

check('exact boundary values are accepted on every view width', function () {
  const v = makeViews(4);
  ingest('[{"amount":2147483647,"flags":255,"accountSlot":4294967295,"currency":0}]', v, 4);
  assert.equal(v[1][0], 4294967295, 'u32 max');
  assert.equal(v[2][0], 2147483647, 'i32 max');
  assert.equal(v[3][0], 0);
  assert.equal(v[4][0], 255, 'u8 max');
  ingest('[{"amount":-2147483648}]', v, 4);
  assert.equal(v[2][0], -2147483648, 'i32 min');
});

check('unknown keys are REJECTED as contract drift, not ignored', function () {
  const v = makeViews(4);
  assert.throws(function () { ingest('[{"amonut":5}]', v, 4); }, /unknown key "amonut"/);
  assert.throws(function () { ingest('[{"id":1,"extra":2}]', v, 4); }, /unknown key "extra"/);
});

check('capacity overflow is refused before any row is written past the end', function () {
  const v = makeViews(2);
  assert.throws(function () { ingest('[{"id":1},{"id":2},{"id":3}]', v, 2); },
    /exceeds arena capacity 2/);
});

check('malformed payloads throw with a byte offset', function () {
  const v = makeViews(4);
  assert.throws(function () { ingest('{"id":1}', v, 4); }, /expected '\['/);
  assert.throws(function () { ingest('[{"id":1}', v, 4); }, /unterminated array/);
  assert.throws(function () { ingest('[{"id":1]', v, 4); }, /expected ','/);
  assert.throws(function () { ingest('[{"id" 1}]', v, 4); }, /expected ':'/);
  assert.throws(function () { ingest('[{"id":}]', v, 4); }, /expected an integer/);
  assert.throws(function () { ingest('[{id:1}]', v, 4); }, /expected key/);
  assert.throws(function () { ingest('[{"id":1}] trailing', v, 4); }, /trailing content/);
  assert.throws(function () { ingest('[{"id":1}{"id":2}]', v, 4); }, /expected ','/);
  assert.throws(function () { ingest('[{"a\\\\b":1}]', v, 4); }, /escapes in keys/);
});

check('ingest is NOT atomic: a throw may leave partial rows, so read nothing', function () {
  /* Single-pass streaming means rows before the fault are already written.
   * Atomicity would cost a second scan or a staging buffer, defeating the
   * purpose. The contract is therefore: the RETURNED COUNT is the commit
   * point. On throw there is no count, so the caller must treat the whole
   * payload as rejected. This test pins that behaviour so nobody "fixes" it
   * into a silent partial-accept. See decisions/0015. */
  const v = makeViews(8);
  assert.throws(function () { ingest('[{"id":11},{"id":22},{"amount":9.5}]', v, 8); },
    /fractional value/);
  assert.equal(v[0][0], 11, 'rows before the fault ARE written — documented, not a bug');
  assert.equal(v[0][1], 22);
  /* and a later successful call only guarantees [0, count) */
  const n = ingest('[{"id":5}]', v, 8);
  assert.equal(n, 1);
  assert.equal(v[0][0], 5);
  assert.equal(v[0][1], 22, 'beyond the count is stale, exactly like an under-filled arena');
});

check('string and null values are refused (integers only)', function () {
  const v = makeViews(4);
  assert.throws(function () { ingest('[{"amount":"500"}]', v, 4); }, /expected an integer/);
  assert.throws(function () { ingest('[{"amount":null}]', v, 4); }, /expected an integer/);
  assert.throws(function () { ingest('[{"amount":true}]', v, 4); }, /expected an integer/);
});

check('view-count mismatch is caught before parsing', function () {
  assert.throws(function () { ingest('[]', [new Int32Array(2)], 2); }, /expected 5 views, got 1/);
});

check('makeIngester validates its field list', function () {
  assert.throws(function () { makeIngester([]); }, /non-empty array/);
  assert.throws(function () { makeIngester('id'); }, /non-empty array/);
});

/* ---- the allocation claim ---------------------------------------------- */

check('ingest allocates ~nothing per record (amortised, vs JSON.parse)', function () {
  const N = 20000;
  const parts = [];
  for (let i = 0; i < N; i++) {
    parts.push('{"id":' + i + ',"accountSlot":' + (i % 97) + ',"amount":' + (i * 7) +
      ',"currency":' + (i % 3) + ',"flags":' + (i & 1) + '}');
  }
  const json = '[' + parts.join(',') + ']';
  const v = makeViews(N);

  const hasGc = typeof global.gc === 'function';
  function settle() { if (hasGc) { global.gc(); global.gc(); } }

  /* warm both paths so JIT state is not part of the measurement */
  for (let i = 0; i < 3; i++) { ingest(json, v, N); JSON.parse(json); }

  const REPS = 20;
  settle();
  const a0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < REPS; i++) ingest(json, v, N);
  const ingestPer = (process.memoryUsage().heapUsed - a0) / REPS;

  settle();
  const b0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < REPS; i++) {
    const parsed = JSON.parse(json);
    if (parsed.length !== N) throw new Error('unreachable');
  }
  const parsePer = (process.memoryUsage().heapUsed - b0) / REPS;

  /* JSON.parse must materialise N objects; ingest must not. Without a forced
   * GC the numbers are noisy, so the assertion is deliberately loose — it
   * catches a regression that starts allocating per record, not small drift. */
  if (hasGc) {
    assert.ok(ingestPer < parsePer / 10,
      'ingest allocated ' + (ingestPer / 1024).toFixed(1) + ' KB/batch vs JSON.parse ' +
      (parsePer / 1024).toFixed(1) + ' KB/batch — the zero-allocation claim is broken');
  }
  process.stdout.write('      ' + (ingestPer / 1024).toFixed(1) + ' KB/batch vs JSON.parse ' +
    (parsePer / 1024).toFixed(1) + ' KB/batch' +
    (hasGc ? '' : '  (unforced GC — rerun with --expose-gc to assert)') + '\n');
});

check('runtime source obeys the ruleset', function () {
  const fs = require('node:fs');
  const lint = require('./_source-lint.js');
  const src = fs.readFileSync(require.resolve('../src/runtime/ingest.js'), 'utf8');
  assert.ok(/^'use strict';/.test(src));
  lint.assertNoBannedConstructs(assert, src);
  lint.assertLoopBoundsCached(assert, src);
  const code = lint.stripCommentsAndStrings(src);
  assert.equal(/\bthis\b/.test(code), false);
  /* the scanner must never slice per record — slicing allocates a string */
  const slices = code.match(/\.slice\(/g) || [];
  assert.equal(slices.length, 1,
    'expected exactly one .slice(), in the unknown-key error path; found ' + slices.length);
});

process.stdout.write('\n  ' + passed + ' checks passed\n\n');
