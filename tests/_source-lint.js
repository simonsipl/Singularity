'use strict';
/* Shared source-level lint used by the assert suites.
 *
 * The ruleset in .cursorrules bans certain constructs from exec units and from
 * the runtime. Checking that by regex over raw file text produces false
 * positives against PROSE — a comment containing the words "hidden class per
 * schema" matches /\bclass\s+\w/ perfectly well. So strip comments and string
 * literals first, then match only real code.
 *
 * Zero dependencies, per .cursorrules §6.1. */

/* Not a full JS parser, and does not need to be: it only has to remove comments
 * and string bodies from files this repo controls. Handles line comments, block
 * comments, single/double quotes, template literals, and regex literals well
 * enough that the banned-construct scan sees code and nothing else. */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const len = src.length;
  while (i < len) {
    const c = src[i];
    const d = src[i + 1];

    if (c === '/' && d === '/') {
      while (i < len && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < len && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < len && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      out += quote + quote; /* keep an empty literal so syntax stays plausible */
      continue;
    }
    /* regex literal: only when '/' is in a position where a value is expected */
    if (c === '/') {
      let j = out.length - 1;
      while (j >= 0 && /\s/.test(out[j])) j--;
      const prev = j >= 0 ? out[j] : '';
      if (prev === '' || '(,=:[!&|?{};+-*%~^<>'.indexOf(prev) !== -1) {
        i++;
        while (i < len && src[i] !== '/') {
          if (src[i] === '\\') i++;
          if (src[i] === '[') { /* char class may contain an unescaped '/' */
            while (i < len && src[i] !== ']') { if (src[i] === '\\') i++; i++; }
          }
          i++;
        }
        i++;
        out += '/x/';
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/* The constructs .cursorrules §1.1 bans outright. */
const BANNED = [
  [/\bclass\s+\w/, 'class declaration'],
  [/\bextends\b/, 'inheritance'],
  [/=>/, 'arrow function'],
  [/\.map\(/, '.map()'],
  [/\.filter\(/, '.filter()'],
  [/\.reduce\(/, '.reduce()'],
  [/\.forEach\(/, '.forEach()'],
  [/\.some\(/, '.some()'],
  [/\.every\(/, '.every()'],
  [/\bfor\s*\(\s*(?:const|let|var)\s+\w+\s+of\b/, 'for...of'],
  [/\bfor\s*\(\s*(?:const|let|var)\s+\w+\s+in\b/, 'for...in'],
  [/\bdelete\s+\w+\./, 'delete on a property'],
  [/\basync\b/, 'async'],
  [/\bawait\b/, 'await'],
  [/\bconsole\./, 'console.*'],
  [/\.\.\./, 'spread/rest']
];

/* `assert` is passed in so this helper stays dependency-free and the caller's
 * assertion counts stay accurate. `allow` lists rule descriptions to skip. */
function assertNoBannedConstructs(assert, rawSource, allow) {
  const skip = allow === undefined ? [] : allow;
  const code = stripCommentsAndStrings(rawSource);
  for (let i = 0; i < BANNED.length; i++) {
    const pattern = BANNED[i][0], label = BANNED[i][1];
    if (skip.indexOf(label) !== -1) continue;
    assert.equal(pattern.test(code), false, 'banned construct present: ' + label);
  }
}

/* Every indexed loop must cache its bound in a local rather than re-reading
 * `.length` each iteration (.cursorrules §1.2). */
function assertLoopBoundsCached(assert, rawSource) {
  const code = stripCommentsAndStrings(rawSource);
  const loops = code.match(/for\s*\([^)]*\)/g) || [];
  for (let i = 0, n = loops.length; i < n; i++) {
    /* Only the CONDITION clause matters. `.length` in the initialiser is exactly
     * the caching this rule asks for:
     *   for (let i = 0, len = a.length; i < len; i++)   <- correct
     *   for (let i = 0; i < a.length; i++)              <- re-reads every step */
    const parts = loops[i].split(';');
    if (parts.length < 2) continue;
    assert.equal(/\.length/.test(parts[1]), false,
      'uncached loop bound (reads .length in the condition): ' + loops[i].trim());
  }
}

module.exports = {
  stripCommentsAndStrings: stripCommentsAndStrings,
  assertNoBannedConstructs: assertNoBannedConstructs,
  assertLoopBoundsCached: assertLoopBoundsCached,
  BANNED: BANNED
};
