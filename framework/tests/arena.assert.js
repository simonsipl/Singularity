'use strict';
/* SINGULARITY CORE RUNTIME — verification
 * unit under test: src/runtime/arena.js
 *
 * Run plain:                node tests/arena.assert.js
 * Run with hidden-class checks (recommended):
 *   node --allow-natives-syntax tests/arena.assert.js
 */

const assert = require('node:assert/strict');
const { defineArena, TYPES } = require('../src/runtime/arena.js');

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

/* %HaveSameMap is only available under --allow-natives-syntax. When present we
 * verify the monomorphism claim DIRECTLY rather than inferring it from key order. */
let haveSameMap = null, hasFastProperties = null;
try {
  haveSameMap = new Function('a', 'b', 'return %HaveSameMap(a, b);');
  hasFastProperties = new Function('a', 'return %HasFastProperties(a);');
  haveSameMap({}, {}); /* probe: throws a SyntaxError at compile time if unavailable */
} catch (e) {
  haveSameMap = null;
  hasFastProperties = null;
}

const LEDGER = defineArena({
  name: 'ledger',
  dims: ['capacity', 'accountCount'],
  fields: [
    ['stats', 'f64', 16],
    ['balances', 'f64', 'accountCount'],
    ['ids', 'u32', 'capacity'],
    ['accounts', 'u32', 'capacity'],
    ['amounts', 'i32', 'capacity'],
    ['fees', 'i32', 'capacity'],
    ['currencies', 'u8', 'capacity'],
    ['flags', 'u8', 'capacity'],
    ['statuses', 'u8', 'capacity']
  ],
  clearOnReset: ['stats', 'fees', 'statuses']
});

process.stdout.write('\nSINGULARITY :: core runtime (arena)\n\n');

/* ---- layout ------------------------------------------------------------ */

check('single backing buffer, all views share it', function () {
  const L = LEDGER.alloc(1000, 64);
  assert.ok(L.arena instanceof SharedArrayBuffer);
  const names = LEDGER.fieldNames;
  for (let i = 0; i < names.length; i++) {
    assert.equal(L[names[i]].buffer, L.arena, names[i]);
  }
});

check('byteLength matches hand-computed layout and is 8-aligned', function () {
  const L = LEDGER.alloc(1000, 64);
  const expected = (16 * 8) + (64 * 8) + (1000 * 4 * 4) + (1000 * 3);
  assert.equal(L.byteLength, (expected + 7) & ~7);
  assert.equal(L.byteLength % 8, 0);
  assert.equal(L.arena.byteLength, L.byteLength);
  assert.equal(LEDGER.byteLengthFor(1000, 64), L.byteLength);
});

check('fields are laid out widest-first so every view is naturally aligned', function () {
  const d = LEDGER.describe(1000, 64);
  for (let i = 0; i < d.fields.length; i++) {
    const f = d.fields[i];
    const w = TYPES[f.type].width;
    assert.equal(f.byteOffset % w, 0,
      'field ' + f.field + ' at ' + f.byteOffset + ' is not ' + w + '-byte aligned');
  }
  /* widths must be non-increasing across the layout */
  let prev = Infinity;
  for (let i = 0; i < d.fields.length; i++) {
    const w = TYPES[d.fields[i].type].width;
    assert.ok(w <= prev, 'layout is not widest-first at ' + d.fields[i].field);
    prev = w;
  }
});

check('no two fields overlap, and none escapes the buffer', function () {
  const d = LEDGER.describe(4096, 512);
  let cursor = 0;
  for (let i = 0; i < d.fields.length; i++) {
    const f = d.fields[i];
    assert.ok(f.byteOffset >= cursor, 'overlap at ' + f.field);
    assert.ok(f.byteOffset + f.bytes <= d.byteLength, f.field + ' escapes the arena');
    cursor = f.byteOffset + f.bytes;
  }
});

check('odd dims still align correctly (no lucky-multiple-of-8 illusion)', function () {
  const A = defineArena({
    name: 'odd',
    dims: ['n'],
    fields: [
      ['tag', 'u8', 3],      /* 3 bytes, deliberately unaligned tail */
      ['big', 'f64', 'n'],
      ['mid', 'i32', 'n']
    ]
  });
  const h = A.alloc(7);
  const d = A.describe(7);
  for (let i = 0; i < d.fields.length; i++) {
    assert.equal(d.fields[i].byteOffset % TYPES[d.fields[i].type].width, 0, d.fields[i].field);
  }
  assert.equal(h.big.length, 7);
  assert.equal(h.mid.length, 7);
  assert.equal(h.tag.length, 3);
});

check('zero-length dims and zero-length fields are legal', function () {
  const h = LEDGER.alloc(0, 0);
  assert.equal(h.amounts.length, 0);
  assert.equal(h.balances.length, 0);
  assert.equal(h.stats.length, 16);
  assert.doesNotThrow(function () { LEDGER.reset(h); });
});

/* ---- monomorphism ------------------------------------------------------ */

if (haveSameMap !== null) {
  check('handles from one schema share a V8 hidden class (%HaveSameMap)', function () {
    const a = LEDGER.alloc(8, 2);
    const b = LEDGER.alloc(4096, 512);
    const c = LEDGER.attach(a.arena, 8, 2);
    assert.equal(haveSameMap(a, b), true, 'alloc vs alloc');
    assert.equal(haveSameMap(a, c), true, 'alloc vs attach');
  });

  check('handles keep fast properties past the 20-field dictionary threshold', function () {
    const fields = [];
    for (let i = 0; i < 40; i++) fields.push(['f' + i, 'i32', 'n']);
    const Wide = defineArena({ name: 'wide', dims: ['n'], fields: fields });
    const h = Wide.alloc(4);
    assert.equal(hasFastProperties(h), true,
      'handle fell into dictionary mode — the codegen guarantee is broken');
    assert.equal(haveSameMap(h, Wide.alloc(9)), true);
  });
} else {
  skip('hidden-class identity (%HaveSameMap)', 'rerun with --allow-natives-syntax');
  skip('fast properties past 20 fields', 'rerun with --allow-natives-syntax');
}

check('key order is declaration order and identical across allocations', function () {
  const a = LEDGER.alloc(8, 2);
  const b = LEDGER.alloc(4096, 512);
  const ka = Object.keys(a);
  assert.deepEqual(ka, Object.keys(b));
  assert.deepEqual(ka, ['arena', 'byteLength', 'capacity', 'accountCount',
    'stats', 'balances', 'ids', 'accounts', 'amounts', 'fees',
    'currencies', 'flags', 'statuses']);
});

/* ---- attach (zero-copy worker path) ------------------------------------ */

check('attach rebuilds byte-identical views over an existing buffer', function () {
  const a = LEDGER.alloc(256, 16);
  for (let i = 0; i < 256; i++) { a.amounts[i] = i * 7; a.currencies[i] = i % 3; }
  for (let i = 0; i < 16; i++) a.balances[i] = 1000 + i;

  const b = LEDGER.attach(a.arena, 256, 16);
  assert.equal(b.arena, a.arena, 'attach must not copy the backing store');
  assert.equal(b.byteLength, a.byteLength);
  const da = LEDGER.describe(256, 16), db = LEDGER.describe(256, 16);
  assert.deepEqual(db, da);
  for (let i = 0; i < 256; i++) {
    assert.equal(b.amounts[i], i * 7);
    assert.equal(b.currencies[i], i % 3);
  }
  for (let i = 0; i < 16; i++) assert.equal(b.balances[i], 1000 + i);
});

check('attach shares memory both ways (writes are visible across handles)', function () {
  const a = LEDGER.alloc(64, 4);
  const b = LEDGER.attach(a.arena, 64, 4);
  a.amounts[10] = 12345;
  assert.equal(b.amounts[10], 12345, 'write via a not visible via b');
  b.balances[2] = 999;
  assert.equal(a.balances[2], 999, 'write via b not visible via a');
});

check('attach rejects a buffer too small for the claimed dims', function () {
  const a = LEDGER.alloc(64, 4);
  assert.throws(function () { LEDGER.attach(a.arena, 4096, 512); },
    /buffer is .* bytes but this layout needs/);
});

check('attach rejects a non-buffer and wrong dim arity', function () {
  const a = LEDGER.alloc(64, 4);
  assert.throws(function () { LEDGER.attach({}, 64, 4); }, /expects a SharedArrayBuffer/);
  assert.throws(function () { LEDGER.attach(a.arena, 64); }, /expects 2 dim/);
  assert.throws(function () { LEDGER.alloc(64); }, /expects 2 dim/);
  assert.throws(function () { LEDGER.alloc(64, 4, 9); }, /expects 2 dim/);
});

check('non-shared mode yields a plain ArrayBuffer (browser fallback path)', function () {
  const Local = defineArena({
    name: 'local',
    dims: ['n'],
    fields: [['v', 'i32', 'n']],
    shared: false
  });
  const h = Local.alloc(32);
  assert.ok(h.arena instanceof ArrayBuffer);
  assert.ok(!(h.arena instanceof SharedArrayBuffer));
  h.v[3] = 42;
  assert.equal(Local.attach(h.arena, 32).v[3], 42);
});

/* ---- reset ------------------------------------------------------------- */

check('reset zeroes exactly the declared fields and nothing else', function () {
  const h = LEDGER.alloc(32, 4);
  for (let i = 0; i < 32; i++) { h.amounts[i] = 5; h.fees[i] = 9; h.statuses[i] = 3; h.ids[i] = 7; }
  for (let i = 0; i < 4; i++) h.balances[i] = 100;
  h.stats[0] = 123;

  LEDGER.reset(h);

  for (let i = 0; i < 32; i++) {
    assert.equal(h.fees[i], 0, 'fees must be cleared');
    assert.equal(h.statuses[i], 0, 'statuses must be cleared');
    assert.equal(h.amounts[i], 5, 'amounts must NOT be cleared');
    assert.equal(h.ids[i], 7, 'ids must NOT be cleared');
  }
  for (let i = 0; i < 4; i++) assert.equal(h.balances[i], 100, 'balances must NOT be cleared');
  assert.equal(h.stats[0], 0, 'stats must be cleared');
});

check('a fresh arena is zero-filled', function () {
  const h = LEDGER.alloc(64, 8);
  for (let i = 0; i < 64; i++) {
    assert.equal(h.amounts[i], 0);
    assert.equal(h.statuses[i], 0);
  }
  for (let i = 0; i < 16; i++) assert.equal(h.stats[i], 0);
});

/* ---- spec validation --------------------------------------------------- */

check('rejects malformed specs at define time', function () {
  assert.throws(function () { defineArena(null); }, /spec must be an object/);
  assert.throws(function () { defineArena({ name: 'x' }); }, /fields must be a non-empty array/);
  assert.throws(function () { defineArena({ name: 'x', fields: [] }); }, /non-empty/);
  assert.throws(function () {
    defineArena({ name: 'x', fields: [['a', 'i32']] });
  }, /must be \[name, type, length\]/);
  assert.throws(function () {
    defineArena({ name: 'x', fields: [['a', 'quantum', 4]] });
  }, /unknown type/);
  assert.throws(function () {
    defineArena({ name: 'x', fields: [['a', 'i32', 'nope']] });
  }, /not a declared dim/);
  assert.throws(function () {
    defineArena({ name: 'x', fields: [['a', 'i32', -1]] });
  }, /non-negative integer/);
  assert.throws(function () {
    defineArena({ name: 'x', fields: [['a', 'i32', 4], ['a', 'u8', 4]] });
  }, /duplicate field name/);
  assert.throws(function () {
    defineArena({ name: 'x', dims: ['n'], fields: [['n', 'i32', 4]] });
  }, /collides with a dim name/);
  assert.throws(function () {
    defineArena({ name: 'x', fields: [['a', 'i32', 4]], clearOnReset: ['ghost'] });
  }, /unknown field/);
});

check('rejects field names that collide with runtime-reserved keys', function () {
  assert.throws(function () {
    defineArena({ name: 'x', fields: [['arena', 'i32', 4]] });
  }, /reserved by the runtime/);
  assert.throws(function () {
    defineArena({ name: 'x', fields: [['byteLength', 'i32', 4]] });
  }, /reserved by the runtime/);
});

check('rejects dims that do not resolve to non-negative integers', function () {
  assert.throws(function () { LEDGER.alloc(1.5, 4); }, /non-negative integer/);
  assert.throws(function () { LEDGER.alloc(-1, 4); }, /non-negative integer/);
  assert.throws(function () { LEDGER.alloc('64', 4); }, /non-negative integer/);
  assert.throws(function () { LEDGER.alloc(NaN, 4); }, /non-negative integer/);
});

/* ---- codegen hardening ------------------------------------------------- */

check('SECURITY: injection through every interpolated path is rejected', function () {
  /* the generated source interpolates: schema name, dim names, field names,
   * clearOnReset entries. each must be rejected before reaching new Function. */
  const payloads = [
    "x'); globalThis.PWNED = 1; ('",
    'x, y',
    'x;y',
    'x)',
    'x}',
    'x.y',
    'x y',
    'x\n',
    'x`y',
    'x/*',
    '0x',
    '',
    /* valid identifiers that corrupt the generated literal rather than escaping
     * it. __proto__ is the severe one: in a literal it sets the prototype, so
     * the field silently vanishes from the handle. */
    '__proto__',
    'constructor',
    'prototype',
    'hasOwnProperty',
    'toString',
    'valueOf'
  ];

  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i];
    /* as schema name */
    assert.throws(function () {
      defineArena({ name: p, fields: [['a', 'i32', 4]] });
    }, /valid identifier|reserved/, 'schema name accepted: ' + JSON.stringify(p));
    /* as field name */
    assert.throws(function () {
      defineArena({ name: 'ok', fields: [[p, 'i32', 4]] });
    }, /valid identifier|reserved/, 'field name accepted: ' + JSON.stringify(p));
    /* as dim name */
    assert.throws(function () {
      defineArena({ name: 'ok', dims: [p], fields: [['a', 'i32', 4]] });
    }, /valid identifier|reserved/, 'dim name accepted: ' + JSON.stringify(p));
    /* as clearOnReset entry — must not be silently ignored either */
    assert.throws(function () {
      defineArena({ name: 'ok', fields: [['a', 'i32', 4]], clearOnReset: [p] });
    }, /unknown field/, 'clearOnReset accepted: ' + JSON.stringify(p));
  }

  assert.equal(globalThis.PWNED, undefined, 'injection executed — hardening failed');
});

check('SECURITY: type is looked up in a closed table, never interpolated raw', function () {
  assert.throws(function () {
    defineArena({ name: 'ok', fields: [['a', 'Float64Array(buffer,0,1)); globalThis.X=1;(', 4]] });
  }, /unknown type/);
  assert.equal(globalThis.X, undefined);
  /* only the documented type codes exist */
  assert.deepEqual(Object.keys(TYPES).sort(),
    ['f32', 'f64', 'i16', 'i32', 'i8', 'u16', 'u32', 'u8']);
});

check('runtime source contains no banned constructs', function () {
  const fs = require('node:fs');
  const lint = require('./_source-lint.js');
  const src = fs.readFileSync(require.resolve('../src/runtime/arena.js'), 'utf8');
  assert.ok(/^'use strict';/.test(src));
  /* the runtime legitimately uses for...in over the closed TYPES table and
   * Array.prototype.slice on `arguments`; both are startup-only, never in a hot
   * path, and neither is reachable per-record. */
  lint.assertNoBannedConstructs(assert, src, ['for...in']);
  lint.assertLoopBoundsCached(assert, src);
});

check('the sole new Function call site is the guarded one', function () {
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../src/runtime/arena.js'), 'utf8');
  const sites = src.match(/new Function\(/g) || [];
  assert.equal(sites.length, 1, 'expected exactly one new Function call site, found ' + sites.length);
  assert.ok(/function compileGuarded\([\s\S]*?new Function\(src\)\(\)/.test(src),
    'the sole new Function must live inside compileGuarded');
  /* and every compile path must route through the guard */
  assert.equal((src.match(/compileGuarded\(/g) || []).length, 3,
    'expected compileGuarded to be defined once and called exactly twice');
});

process.stdout.write('\n  ' + passed + ' checks passed' +
  (skipped > 0 ? ', ' + skipped + ' skipped' : '') + '\n\n');
