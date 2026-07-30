'use strict';
/* SINGULARITY RUNTIME — direct JSON-to-arena ingest
 *
 * The boundary where adoptions die: if a service parses JSON to objects and
 * then packs objects into the arena, it pays allocation for a million records
 * to save arithmetic it was not spending (README §3.3). This scanner parses a
 * flat JSON record array STRAIGHT into typed arrays. No record object, no
 * per-record string, no per-record allocation of any kind — the only scratch
 * is one Float64Array sized to the field count, allocated at ingester build.
 *
 * Supported input, deliberately narrow:
 *   [ {"field": int, ...}, ... ]
 * - keys in any order; a missing key means 0; an UNKNOWN key is an error
 *   (it is a typo or a contract drift, not data)
 * - values are integers, optionally negative — a '.' or exponent is an ERROR,
 *   because money is integer minor units (decision 0001) and rejecting floats
 *   at the boundary enforces the contract where bad data enters
 * - no strings, no nesting, no escapes in keys
 *
 * Malformed input throws with a byte offset. This is boundary code, not a hot
 * procedure: the exec no-throw rule (decision 0005) distinguishes bad DATA
 * inside a batch (status codes) from a payload that is not the contract at all
 * (refuse loudly).
 *
 * NOT ATOMIC. The scan is single-pass, so records before a fault are already
 * written to the views when the throw happens. Atomicity would cost a second
 * scan or a staging buffer and defeat the purpose. The contract is therefore:
 * **the returned count is the commit point.** On success, exactly [0, count)
 * is meaningful and anything beyond it is stale — the same rule an
 * under-filled arena already follows. On throw there is no count, so the
 * caller must treat the entire payload as rejected and read nothing.
 * See decisions/0015.
 */

const CH_SPACE = 32, CH_TAB = 9, CH_LF = 10, CH_CR = 13;
const CH_LBRACKET = 91, CH_RBRACKET = 93, CH_LBRACE = 123, CH_RBRACE = 125;
const CH_QUOTE = 34, CH_COLON = 58, CH_COMMA = 44, CH_MINUS = 45;
const CH_DOT = 46, CH_E_LOW = 101, CH_E_UP = 69, CH_BACKSLASH = 92;
const CH_0 = 48, CH_9 = 57;

function fail(pos, what) {
  throw new Error('[singularity/ingest] byte ' + pos + ': ' + what);
}

/* Builds an ingester for a fixed field set. fieldNames order defines the order
 * of the views array handed to every ingest() call. */
function makeIngester(fieldNames) {
  if (!Array.isArray(fieldNames) || fieldNames.length === 0) {
    throw new Error('[singularity/ingest] fieldNames must be a non-empty array');
  }
  const nFields = fieldNames.length;
  /* per-field char codes, precomputed once so key matching never slices */
  const nameCodes = new Array(nFields);
  const nameLens = new Int32Array(nFields);
  for (let f = 0; f < nFields; f++) {
    const name = fieldNames[f];
    const codes = new Int32Array(name.length);
    for (let c = 0, cn = name.length; c < cn; c++) codes[c] = name.charCodeAt(c);
    nameCodes[f] = codes;
    nameLens[f] = name.length;
  }
  const scratch = new Float64Array(nFields);

  /* str: the JSON text. views: typed arrays parallel to fieldNames.
   * capacity: max records. returns the record count. */
  return function ingest(str, views, capacity) {
    if (views.length !== nFields) {
      throw new Error('[singularity/ingest] expected ' + nFields + ' views, got ' + views.length);
    }
    const len = str.length;
    let i = 0;

    while (i < len) { const c = str.charCodeAt(i); if (c !== CH_SPACE && c !== CH_TAB && c !== CH_LF && c !== CH_CR) break; i++; }
    if (i >= len || str.charCodeAt(i) !== CH_LBRACKET) fail(i, "expected '['");
    i++;

    let count = 0;
    for (;;) {
      while (i < len) { const c = str.charCodeAt(i); if (c !== CH_SPACE && c !== CH_TAB && c !== CH_LF && c !== CH_CR) break; i++; }
      if (i >= len) fail(i, 'unterminated array');
      if (str.charCodeAt(i) === CH_RBRACKET) { i++; break; }
      if (count > 0) {
        if (str.charCodeAt(i) !== CH_COMMA) fail(i, "expected ','");
        i++;
        while (i < len) { const c = str.charCodeAt(i); if (c !== CH_SPACE && c !== CH_TAB && c !== CH_LF && c !== CH_CR) break; i++; }
      }
      if (i >= len || str.charCodeAt(i) !== CH_LBRACE) fail(i, "expected '{'");
      if (count >= capacity) fail(i, 'record ' + count + ' exceeds arena capacity ' + capacity);
      i++;

      for (let f = 0; f < nFields; f++) scratch[f] = 0;

      let first = 1;
      for (;;) {
        while (i < len) { const c = str.charCodeAt(i); if (c !== CH_SPACE && c !== CH_TAB && c !== CH_LF && c !== CH_CR) break; i++; }
        if (i >= len) fail(i, 'unterminated record');
        if (str.charCodeAt(i) === CH_RBRACE) { i++; break; }
        if (first === 0) {
          if (str.charCodeAt(i) !== CH_COMMA) fail(i, "expected ','");
          i++;
          while (i < len) { const c = str.charCodeAt(i); if (c !== CH_SPACE && c !== CH_TAB && c !== CH_LF && c !== CH_CR) break; i++; }
        }
        first = 0;

        if (i >= len || str.charCodeAt(i) !== CH_QUOTE) fail(i, 'expected key');
        i++;
        const keyStart = i;
        while (i < len) {
          const c = str.charCodeAt(i);
          if (c === CH_QUOTE) break;
          if (c === CH_BACKSLASH) fail(i, 'escapes in keys are not supported');
          i++;
        }
        if (i >= len) fail(i, 'unterminated key');
        const keyLen = i - keyStart;
        i++;

        /* match the key against the field set without slicing */
        let field = -1;
        for (let f = 0; f < nFields; f++) {
          if (nameLens[f] !== keyLen) continue;
          const codes = nameCodes[f];
          let hit = 1;
          for (let c = 0; c < keyLen; c++) {
            if (str.charCodeAt(keyStart + c) !== codes[c]) { hit = 0; break; }
          }
          if (hit === 1) { field = f; break; }
        }
        if (field === -1) {
          fail(keyStart, 'unknown key "' + str.slice(keyStart, keyStart + keyLen) +
            '" — typo or contract drift, refusing the payload');
        }

        while (i < len) { const c = str.charCodeAt(i); if (c !== CH_SPACE && c !== CH_TAB && c !== CH_LF && c !== CH_CR) break; i++; }
        if (i >= len || str.charCodeAt(i) !== CH_COLON) fail(i, "expected ':'");
        i++;
        while (i < len) { const c = str.charCodeAt(i); if (c !== CH_SPACE && c !== CH_TAB && c !== CH_LF && c !== CH_CR) break; i++; }

        let neg = 0;
        if (i < len && str.charCodeAt(i) === CH_MINUS) { neg = 1; i++; }
        let c0 = i < len ? str.charCodeAt(i) : -1;
        if (c0 < CH_0 || c0 > CH_9) fail(i, 'expected an integer value');
        let value = 0;
        while (i < len) {
          const c = str.charCodeAt(i);
          if (c >= CH_0 && c <= CH_9) { value = value * 10 + (c - CH_0); i++; continue; }
          if (c === CH_DOT || c === CH_E_LOW || c === CH_E_UP) {
            fail(i, 'fractional value — money is integer minor units (decision 0001); ' +
              'reject floats at the boundary, do not round them');
          }
          break;
        }
        scratch[field] = neg === 1 ? -value : value;
      }

      for (let f = 0; f < nFields; f++) views[f][count] = scratch[f];
      count++;
    }

    while (i < len) { const c = str.charCodeAt(i); if (c !== CH_SPACE && c !== CH_TAB && c !== CH_LF && c !== CH_CR) break; i++; }
    if (i !== len) fail(i, 'trailing content after array');
    return count;
  };
}

module.exports = { makeIngester: makeIngester };
