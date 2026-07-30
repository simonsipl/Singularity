'use strict';
/* SINGULARITY CORE RUNTIME — schema-driven arena allocator
 *
 * Owns the single thing every exec unit would otherwise hand-roll: byte-offset
 * arithmetic over one contiguous buffer. Hand-rolled offsets are where the
 * dangerous bugs live (silent overlap, unaligned view construction, forgotten
 * reset), so the framework owns them and the exec units declare instead.
 *
 * An exec unit declares its memory layout once:
 *
 *   const LEDGER = defineArena({
 *     name: 'ledger',
 *     dims: ['capacity', 'accountCount'],
 *     fields: [
 *       ['stats',    'f64', 16],
 *       ['balances', 'f64', 'accountCount'],
 *       ['amounts',  'i32', 'capacity'],
 *       ['statuses', 'u8',  'capacity']
 *     ],
 *     clearOnReset: ['stats', 'statuses']
 *   });
 *
 * and receives alloc / attach / reset for free, with three guarantees the
 * hand-written version had to assert by hand:
 *
 *   1. MONOMORPHISM. Handles are built by a generated factory containing exactly
 *      one object literal, so every handle from a given schema shares one V8
 *      hidden class. Verified directly in tests/arena.assert.js via
 *      %HaveSameMap, not inferred from key order.
 *   2. ALIGNMENT. Fields are laid out widest-element-first, so no TypedArray is
 *      ever constructed on an unaligned byte offset (which throws).
 *   3. NO OVERLAP. Offsets are derived from one cumulative walk and the total is
 *      asserted against the sum of field extents.
 *
 * ---------------------------------------------------------------------------
 * WHY CODEGEN, AND WHY THAT IS SAFE HERE
 *
 * Handles are built by `new Function`. That is a deliberate, measured choice,
 * not convenience — do not "simplify" it into a property-insertion loop.
 *
 * Measured on Node v24.13.1 with --allow-natives-syntax: building a handle by
 * inserting properties in a loop yields the same hidden class per schema, but
 * V8 moves the object into DICTIONARY MODE at exactly 20 properties. Dictionary
 * mode is the permanent deopt this framework exists to avoid (.cursorrules §1.1,
 * §2). A generated single object literal keeps fast properties at 64+ fields.
 * A 13-field ledger is fine either way; a Booksy-scale domain arena is not.
 *
 * Threat model: schema specs are SOURCE-LEVEL developer input, evaluated once at
 * module load. They are never request data, never user input, never deserialised
 * from the network. Attacker control of a schema spec implies attacker control of
 * the source file, at which point `new Function` is not the weak link.
 *
 * Defence in depth, all enforced at define time, all covered by
 * tests/arena.assert.js:
 *   1. Every interpolated token is validated against /^[A-Za-z_$][\w$]*$/, a
 *      grammar that cannot express a quote, paren, semicolon, dot, newline or
 *      space — so no interpolated value can escape its position.
 *   2. Type names come from the closed internal TYPES table, never from the spec.
 *   3. The FULLY GENERATED SOURCE is tokenised and every identifier checked
 *      against an explicit allowlist before it reaches `new Function`. Anything
 *      unexpected throws instead of executing.
 *   4. Adversarial injection attempts through every interpolated path are
 *      asserted to be rejected.
 *
 * See decisions/0006-schema-driven-arena-runtime.md.
 */

const TYPES = {
  f64: { ctor: Float64Array, width: 8, name: 'Float64Array' },
  f32: { ctor: Float32Array, width: 4, name: 'Float32Array' },
  i32: { ctor: Int32Array, width: 4, name: 'Int32Array' },
  u32: { ctor: Uint32Array, width: 4, name: 'Uint32Array' },
  i16: { ctor: Int16Array, width: 2, name: 'Int16Array' },
  u16: { ctor: Uint16Array, width: 2, name: 'Uint16Array' },
  i8: { ctor: Int8Array, width: 1, name: 'Int8Array' },
  u8: { ctor: Uint8Array, width: 1, name: 'Uint8Array' }
};

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/* Names refused everywhere in a spec.
 *
 * The first group is owned by the handle itself. The second group is the
 * dangerous one: these are all valid identifiers, so IDENT alone lets them
 * through, and they corrupt the generated object literal rather than escaping
 * it. `__proto__` is the severe case — in an object literal `__proto__: view`
 * SETS THE PROTOTYPE instead of defining a property, so the field silently
 * disappears from the handle (absent from Object.keys) and the handle's
 * prototype becomes a TypedArray. `constructor` and the Object.prototype
 * methods shadow real machinery on every handle. Caught by the adversarial
 * cases in tests/arena.assert.js. */
const RESERVED = [
  'arena', 'byteLength', 'schema',
  '__proto__', 'constructor', 'prototype',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
  'toString', 'toLocaleString', 'valueOf',
  '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'
];

function fail(msg) {
  throw new Error('[singularity/arena] ' + msg);
}

/* Language and runtime identifiers the generated source is allowed to contain,
 * beyond the schema's own validated names. Anything outside this set plus the
 * schema's names means the generator produced something unintended. */
const GENERATED_ALLOWED = ['use', 'strict', 'return', 'function', 'new',
  'buffer', 'byteLength', 'dims', 'off', 'len', 'h', 'arena', 'fill'];

/* Defence in depth: tokenise the generated source and refuse to evaluate it if a
 * single identifier is not accounted for. Cheap — runs once per schema. */
function compileGuarded(src, allowedNames) {
  const allowed = Object.create(null);
  for (let i = 0, n = GENERATED_ALLOWED.length; i < n; i++) allowed[GENERATED_ALLOWED[i]] = true;
  for (const key in TYPES) allowed[TYPES[key].name] = true;
  for (let i = 0, n = allowedNames.length; i < n; i++) allowed[allowedNames[i]] = true;

  const tokens = src.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
  for (let i = 0, n = tokens.length; i < n; i++) {
    if (allowed[tokens[i]] === undefined) {
      fail('refusing to compile generated source: unexpected identifier ' +
        JSON.stringify(tokens[i]) + '. This is a runtime bug or a rejected ' +
        'injection attempt; the schema was not accepted.');
    }
  }
  /* no string or template literals belong in the body beyond the prologue */
  if (src.replace("'use strict';", '').indexOf("'") !== -1 || src.indexOf('`') !== -1) {
    fail('refusing to compile generated source: unexpected literal');
  }
  return new Function(src)();
}

/* Field names and dim names are interpolated into generated source, so they are
 * validated as strict identifiers. Anything else is rejected at define time. */
function requireIdent(what, value) {
  if (typeof value !== 'string' || !IDENT.test(value)) {
    fail(what + ' must be a valid identifier, got ' + JSON.stringify(value));
  }
  if (RESERVED.indexOf(value) !== -1) {
    fail(what + ' "' + value + '" is reserved by the runtime');
  }
}

function defineArena(spec) {
  if (spec === null || typeof spec !== 'object') fail('spec must be an object');
  requireIdent('schema name', spec.name);

  const dims = spec.dims === undefined ? [] : spec.dims;
  if (!Array.isArray(dims)) fail('dims must be an array of names');
  for (let i = 0, n = dims.length; i < n; i++) requireIdent('dim name', dims[i]);

  const fields = spec.fields;
  if (!Array.isArray(fields) || fields.length === 0) fail('fields must be a non-empty array');

  const shared = spec.shared === undefined ? true : spec.shared === true;

  /* ---- validate + normalise fields ------------------------------------- */
  const seen = Object.create(null);
  const norm = [];
  for (let i = 0, n = fields.length; i < n; i++) {
    const f = fields[i];
    if (!Array.isArray(f) || f.length !== 3) {
      fail('field ' + i + ' must be [name, type, length]');
    }
    const fname = f[0], ftype = f[1], flen = f[2];
    requireIdent('field name', fname);
    if (seen[fname] !== undefined) fail('duplicate field name "' + fname + '"');
    if (dims.indexOf(fname) !== -1) fail('field "' + fname + '" collides with a dim name');
    seen[fname] = true;

    if (TYPES[ftype] === undefined) {
      fail('field "' + fname + '" has unknown type "' + ftype + '"; expected one of ' +
        Object.keys(TYPES).join(', '));
    }

    if (typeof flen === 'number') {
      if (!Number.isInteger(flen) || flen < 0) {
        fail('field "' + fname + '" fixed length must be a non-negative integer');
      }
    } else if (typeof flen === 'string') {
      if (dims.indexOf(flen) === -1) {
        fail('field "' + fname + '" length "' + flen + '" is not a declared dim');
      }
    } else {
      fail('field "' + fname + '" length must be an integer or a dim name');
    }

    norm.push({ name: fname, type: ftype, len: flen, decl: i, width: TYPES[ftype].width });
  }

  const clearOnReset = spec.clearOnReset === undefined ? [] : spec.clearOnReset;
  if (!Array.isArray(clearOnReset)) fail('clearOnReset must be an array of field names');
  for (let i = 0, n = clearOnReset.length; i < n; i++) {
    if (seen[clearOnReset[i]] === undefined) {
      fail('clearOnReset names unknown field "' + clearOnReset[i] + '"');
    }
  }

  /* ---- layout order: widest element first ------------------------------
   * Guarantees every view's byte offset is a multiple of its element width, so
   * no TypedArray constructor ever throws on alignment. Stable within a width,
   * so declaration order is preserved among same-width fields. */
  const layoutOrder = norm.slice().sort(function (a, b) {
    if (b.width !== a.width) return b.width - a.width;
    return a.decl - b.decl;
  });

  /* Resolves dim values -> per-field byte offsets and element counts, both
   * indexed by DECLARATION order so the generated factory can index directly. */
  function layout(dimValues) {
    const off = new Array(norm.length);
    const len = new Array(norm.length);
    let cursor = 0;
    for (let i = 0, n = layoutOrder.length; i < n; i++) {
      const f = layoutOrder[i];
      const count = typeof f.len === 'number' ? f.len : dimValues[dims.indexOf(f.len)];
      if (!Number.isInteger(count) || count < 0) {
        fail('dim "' + f.len + '" must resolve to a non-negative integer, got ' + count);
      }
      /* align up to this field's element width */
      const w = f.width;
      cursor = (cursor + w - 1) & ~(w - 1);
      off[f.decl] = cursor;
      len[f.decl] = count;
      cursor += count * w;
    }
    const byteLength = (cursor + 7) & ~7; /* keep the whole arena 8-aligned */
    return { off: off, len: len, byteLength: byteLength };
  }

  /* ---- generated handle factory ---------------------------------------
   * One object literal, one hidden class, for every handle this schema makes.
   * Key order is DECLARATION order (not layout order) so handles read the way
   * the schema was written. */
  let src = "'use strict';\nreturn function make_" + spec.name +
    '(buffer, byteLength, dims, off, len) {\n  return {\n';
  src += '    arena: buffer,\n';
  src += '    byteLength: byteLength,\n';
  for (let i = 0, n = dims.length; i < n; i++) {
    src += '    ' + dims[i] + ': dims[' + i + '],\n';
  }
  for (let i = 0, n = norm.length; i < n; i++) {
    src += '    ' + norm[i].name + ': new ' + TYPES[norm[i].type].name +
      '(buffer, off[' + i + '], len[' + i + ']),\n';
  }
  src += '  };\n};\n';

  /* names the generated source is permitted to mention */
  const allowedNames = ['make_' + spec.name, 'reset_' + spec.name];
  for (let i = 0, n = dims.length; i < n; i++) allowedNames.push(dims[i]);
  for (let i = 0, n = norm.length; i < n; i++) allowedNames.push(norm[i].name);

  const make = compileGuarded(src, allowedNames);

  /* generated reset: direct fill calls, no iteration over names */
  let rsrc = "'use strict';\nreturn function reset_" + spec.name + '(h) {\n';
  for (let i = 0, n = clearOnReset.length; i < n; i++) {
    rsrc += '  h.' + clearOnReset[i] + '.fill(0);\n';
  }
  rsrc += '};\n';
  const reset = compileGuarded(rsrc, allowedNames);

  function checkDims(args) {
    if (args.length !== dims.length) {
      fail(spec.name + '.alloc/attach expects ' + dims.length + ' dim value(s) (' +
        dims.join(', ') + '), got ' + args.length);
    }
  }

  /* allocates a fresh zero-filled arena */
  function alloc() {
    const dimValues = Array.prototype.slice.call(arguments);
    checkDims(dimValues);
    const L = layout(dimValues);
    const buffer = shared ? new SharedArrayBuffer(L.byteLength) : new ArrayBuffer(L.byteLength);
    return make(buffer, L.byteLength, dimValues, L.off, L.len);
  }

  /* rebuilds views over an EXISTING buffer — the zero-copy path for
   * worker_threads. Same dims in, byte-identical layout out, no allocation of
   * the backing store. */
  function attach(buffer) {
    const dimValues = Array.prototype.slice.call(arguments, 1);
    checkDims(dimValues);
    if (!(buffer instanceof SharedArrayBuffer) && !(buffer instanceof ArrayBuffer)) {
      fail(spec.name + '.attach expects a SharedArrayBuffer or ArrayBuffer');
    }
    const L = layout(dimValues);
    if (buffer.byteLength < L.byteLength) {
      fail(spec.name + '.attach: buffer is ' + buffer.byteLength +
        ' bytes but this layout needs ' + L.byteLength +
        ' — dims almost certainly disagree with the allocating side');
    }
    return make(buffer, L.byteLength, dimValues, L.off, L.len);
  }

  function byteLengthFor() {
    const dimValues = Array.prototype.slice.call(arguments);
    checkDims(dimValues);
    return layout(dimValues).byteLength;
  }

  /* introspection for the CLI and for debugging a layout without a debugger */
  function describe() {
    const dimValues = Array.prototype.slice.call(arguments);
    checkDims(dimValues);
    const L = layout(dimValues);
    const rows = [];
    for (let i = 0, n = norm.length; i < n; i++) {
      rows.push({
        field: norm[i].name,
        type: norm[i].type,
        byteOffset: L.off[i],
        length: L.len[i],
        bytes: L.len[i] * norm[i].width
      });
    }
    rows.sort(function (a, b) { return a.byteOffset - b.byteOffset; });
    return { name: spec.name, shared: shared, byteLength: L.byteLength, fields: rows };
  }

  return {
    name: spec.name,
    shared: shared,
    dims: dims.slice(),
    fieldNames: (function () {
      const out = new Array(norm.length);
      for (let i = 0, n = norm.length; i < n; i++) out[i] = norm[i].name;
      return out;
    })(),
    clearOnReset: clearOnReset.slice(),
    alloc: alloc,
    attach: attach,
    reset: reset,
    byteLengthFor: byteLengthFor,
    describe: describe
  };
}

module.exports = { defineArena: defineArena, TYPES: TYPES };
