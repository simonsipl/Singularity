#!/usr/bin/env node
'use strict';
/* SINGULARITY CLI
 *
 * The framework's enforcement surface. Everything here is mechanical: no
 * command asks you to trust a claim it has not checked.
 *
 *   singularity verify      run every tests/*.assert.js suite
 *   singularity drift       fail if an intent is newer than its exec unit
 *   singularity decisions   report which intent rules have recorded rationale
 *   singularity layout <m>  print a module's arena layout, byte by byte
 *   singularity bench       run the benchmarks
 *   singularity check       drift + verify + decisions, the pre-commit gate
 *
 * Zero dependencies. Exit code 0 means the repo is in a state you can commit.
 */

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const INTENTS = path.join(ROOT, 'src', 'intents');
const EXECS = path.join(ROOT, 'src', 'exec');
const TESTS = path.join(ROOT, 'tests');
const DECISIONS = path.join(ROOT, 'decisions');

/* colour only when attached to a terminal, so CI logs stay clean */
const TTY = process.stdout.isTTY === true;
function c(code) { return TTY ? '[' + code + 'm' : ''; }
const BOLD = c(1), DIM = c(2), RED = c(31), GREEN = c(32), YELLOW = c(33), RESET = c(0);

function out(s) { process.stdout.write(s + '\n'); }
function head(s) { out('\n' + BOLD + s + RESET); }
function ok(s) { out('  ' + GREEN + 'ok' + RESET + '    ' + s); }
function warn(s) { out('  ' + YELLOW + 'warn' + RESET + '  ' + s); }
function bad(s) { out('  ' + RED + 'FAIL' + RESET + '  ' + s); }

function listFiles(dir, suffix) {
  if (!fs.existsSync(dir)) return [];
  const all = fs.readdirSync(dir);
  const hit = [];
  for (let i = 0, n = all.length; i < n; i++) {
    if (all[i].slice(-suffix.length) === suffix) hit.push(all[i]);
  }
  hit.sort();
  return hit;
}

/* ---- module discovery --------------------------------------------------- */

function modules() {
  const intents = listFiles(INTENTS, '.intent.ts');
  const mods = [];
  for (let i = 0, n = intents.length; i < n; i++) {
    const name = intents[i].slice(0, -'.intent.ts'.length);
    mods.push({
      name: name,
      intent: path.join(INTENTS, intents[i]),
      exec: path.join(EXECS, name + '.exec.js'),
      assert: path.join(TESTS, name + '.assert.js')
    });
  }
  return mods;
}

/* ---- intent rule extraction --------------------------------------------
 * Rules are declared as "key: prose" strings inside the `rules: [ ... ]` block.
 * The key is the stable identifier a decision record points at. */
function intentRules(file) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('rules: [');
  if (start === -1) return [];
  /* walk to the matching close bracket */
  let depth = 0, i = src.indexOf('[', start), end = -1;
  for (let n = src.length; i < n; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return [];
  const block = src.slice(start, end);
  const literals = block.match(/"(?:[^"\\]|\\.)*"/g) || [];
  const rules = [];
  for (let k = 0, n = literals.length; k < n; k++) {
    const text = literals[k].slice(1, -1);
    const colon = text.indexOf(':');
    if (colon === -1) continue;
    const key = text.slice(0, colon).trim();
    if (!/^[A-Za-z0-9_.]+$/.test(key)) continue;
    rules.push({ key: key, text: text.slice(colon + 1).trim() });
  }
  return rules;
}

/* ---- decision records --------------------------------------------------
 * Minimal frontmatter parser: `key: value` and `key:` followed by `- item`
 * lines. Deliberately not a YAML implementation — the format is fixed and
 * documented in docs/DECISIONS.md, and a dependency-free parser keeps the CLI
 * runnable in a bare container. */
function parseFrontmatter(src, file) {
  if (src.slice(0, 4) !== '---\n' && src.slice(0, 5) !== '---\r\n') {
    throw new Error(file + ': missing --- frontmatter block');
  }
  const endIdx = src.indexOf('\n---', 3);
  if (endIdx === -1) throw new Error(file + ': unterminated frontmatter');
  const lines = src.slice(3, endIdx).split(/\r?\n/);
  const meta = Object.create(null);
  let listKey = null;
  for (let i = 0, n = lines.length; i < n; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item !== null) {
      if (listKey === null) throw new Error(file + ': list item outside a key: ' + line);
      let v = item[1].trim();
      if ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'")) {
        v = v.slice(1, -1);
      }
      meta[listKey].push(v);
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (kv === null) throw new Error(file + ': unparseable frontmatter line: ' + line);
    const key = kv[1];
    const val = kv[2].trim();
    if (val === '') { meta[key] = []; listKey = key; }
    else { meta[key] = val; listKey = null; }
  }
  return meta;
}

function decisions() {
  const files = listFiles(DECISIONS, '.md');
  const recs = [];
  for (let i = 0, n = files.length; i < n; i++) {
    if (files[i][0] === '_') continue; /* _template.md and friends */
    const file = path.join(DECISIONS, files[i]);
    const meta = parseFrontmatter(fs.readFileSync(file, 'utf8'), files[i]);
    recs.push({ file: files[i], meta: meta });
  }
  return recs;
}

/* ---- commands ----------------------------------------------------------- */

function cmdDrift() {
  head('drift  (is any exec unit older than the intent it was compiled from?)');
  const mods = modules();
  let failed = 0;
  for (let i = 0, n = mods.length; i < n; i++) {
    const m = mods[i];
    if (!fs.existsSync(m.exec)) {
      bad(m.name + ': no exec unit — intent has never been compiled');
      failed++;
      continue;
    }
    const iT = fs.statSync(m.intent).mtimeMs;
    const eT = fs.statSync(m.exec).mtimeMs;
    if (iT > eT) {
      bad(m.name + ': intent is NEWER than exec — recompile before committing');
      failed++;
    } else if (!fs.existsSync(m.assert)) {
      bad(m.name + ': exec unit has no assert suite');
      failed++;
    } else {
      ok(m.name);
    }
  }
  if (mods.length === 0) warn('no intents found under src/intents/');
  return failed;
}

function cmdVerify() {
  head('verify  (every tests/*.assert.js suite)');
  const suites = listFiles(TESTS, '.assert.js');
  let failed = 0;
  for (let i = 0, n = suites.length; i < n; i++) {
    const file = path.join(TESTS, suites[i]);
    /* --allow-natives-syntax lets suites verify hidden-class claims directly;
     * suites that do not use it are unaffected. */
    const r = cp.spawnSync(process.execPath, ['--allow-natives-syntax', file],
      { encoding: 'utf8' });
    const text = (r.stdout || '') + (r.stderr || '');
    const m = text.match(/(\d+) checks passed/);
    if (r.status === 0 && m !== null) {
      ok(suites[i] + '  ' + DIM + m[1] + ' checks' + RESET);
    } else {
      bad(suites[i]);
      out(text.split(/\r?\n/).slice(-14).join('\n'));
      failed++;
    }
  }
  if (suites.length === 0) warn('no assert suites found under tests/');
  return failed;
}

function cmdDecisions() {
  head('decisions  (does every intent rule have recorded rationale?)');

  let recs;
  try { recs = decisions(); }
  catch (e) { bad(e.message); return 1; }

  /* rule key -> [decision ids], plus explicit waivers */
  const covered = Object.create(null);
  const waived = Object.create(null);
  const ids = Object.create(null);
  let failed = 0;

  for (let i = 0, n = recs.length; i < n; i++) {
    const r = recs[i], meta = r.meta;
    for (let f = 0, fn = ['id', 'title', 'status', 'module'].length; f < fn; f++) {
      const need = ['id', 'title', 'status', 'module'][f];
      if (meta[need] === undefined) {
        bad(r.file + ': frontmatter is missing `' + need + '`');
        failed++;
      }
    }
    if (ids[meta.id] !== undefined) {
      bad(r.file + ': duplicate decision id ' + meta.id + ' (also ' + ids[meta.id] + ')');
      failed++;
    }
    ids[meta.id] = r.file;
    if (['accepted', 'proposed', 'superseded'].indexOf(meta.status) === -1) {
      bad(r.file + ': status must be accepted | proposed | superseded, got ' + meta.status);
      failed++;
    }
    if (meta.status === 'superseded') continue;

    const rules = meta.rules === undefined ? [] : meta.rules;
    for (let k = 0, kn = rules.length; k < kn; k++) {
      if (covered[rules[k]] === undefined) covered[rules[k]] = [];
      covered[rules[k]].push(meta.id);
    }
    const w = meta.waives === undefined ? [] : meta.waives;
    for (let k = 0, kn = w.length; k < kn; k++) waived[w[k]] = meta.id;
  }

  const mods = modules();
  for (let i = 0, n = mods.length; i < n; i++) {
    const m = mods[i];
    const rules = intentRules(m.intent);
    const known = Object.create(null);
    const undoc = [];
    let documented = 0, waivedCount = 0;

    for (let k = 0, kn = rules.length; k < kn; k++) {
      const key = rules[k].key;
      known[key] = true;
      if (covered[key] !== undefined) documented++;
      else if (waived[key] !== undefined) waivedCount++;
      else undoc.push(rules[k]);
    }

    out('  ' + BOLD + m.name + RESET + '  ' + rules.length + ' rules: ' +
      GREEN + documented + ' documented' + RESET + ', ' +
      DIM + waivedCount + ' waived' + RESET + ', ' +
      (undoc.length > 0 ? YELLOW : GREEN) + undoc.length + ' undocumented' + RESET);

    for (let k = 0, kn = undoc.length; k < kn; k++) {
      warn('no rationale recorded for ' + BOLD + undoc[k].key + RESET);
    }

    /* A decision pointing at a rule key that no longer exists is a stale
     * decision — usually the rule was renamed. This is the check that keeps the
     * two sides from drifting silently. */
    for (const key in covered) {
      if (known[key] === undefined) {
        const owners = covered[key].join(', ');
        if (!ruleExistsInAnyModule(mods, key)) {
          bad('decision ' + owners + ' references unknown rule `' + key +
            '` — renamed or deleted?');
          failed++;
        }
      }
    }
  }
  return failed;
}

function ruleExistsInAnyModule(mods, key) {
  for (let i = 0, n = mods.length; i < n; i++) {
    const rules = intentRules(mods[i].intent);
    for (let k = 0, kn = rules.length; k < kn; k++) {
      if (rules[k].key === key) return true;
    }
  }
  return false;
}

function cmdLayout(name) {
  const mods = modules();
  let target = null;
  for (let i = 0, n = mods.length; i < n; i++) if (mods[i].name === name) target = mods[i];
  if (target === null) {
    const names = [];
    for (let i = 0, n = mods.length; i < n; i++) names.push(mods[i].name);
    out('unknown module "' + name + '". known: ' + names.join(', '));
    return 1;
  }
  const mod = require(target.exec);
  const schemas = [];
  for (const key in mod) {
    const v = mod[key];
    if (v !== null && typeof v === 'object' && typeof v.describe === 'function') schemas.push(v);
  }
  if (schemas.length === 0) { warn(name + ' exposes no arena schema'); return 0; }

  for (let s = 0, sn = schemas.length; s < sn; s++) {
    const schema = schemas[s];
    const probe = [];
    for (let d = 0, dn = schema.dims.length; d < dn; d++) probe.push(d === 0 ? 1000 : 64);
    const d = schema.describe.apply(null, probe);
    const dimDesc = [];
    for (let i = 0, n = schema.dims.length; i < n; i++) {
      dimDesc.push(schema.dims[i] + '=' + probe[i]);
    }
    head('layout  ' + name + ' :: ' + d.name + '  (' + dimDesc.join(', ') + ')');
    out('  ' + 'field'.padEnd(14) + 'type'.padEnd(6) + 'offset'.padStart(10) +
      'length'.padStart(10) + 'bytes'.padStart(12));
    for (let i = 0, n = d.fields.length; i < n; i++) {
      const f = d.fields[i];
      out('  ' + f.field.padEnd(14) + f.type.padEnd(6) +
        String(f.byteOffset).padStart(10) + String(f.length).padStart(10) +
        String(f.bytes).padStart(12));
    }
    out('  ' + DIM + 'total ' + d.byteLength + ' bytes, ' +
      (d.shared ? 'SharedArrayBuffer' : 'ArrayBuffer') + RESET);
  }
  return 0;
}

function cmdBench() {
  head('bench');
  const r = cp.spawnSync(process.execPath,
    ['--expose-gc', '--max-old-space-size=6144', path.join(TESTS, 'benchmark.js')],
    { stdio: 'inherit' });
  return r.status === 0 ? 0 : 1;
}

/* ---- entry ------------------------------------------------------------- */

const cmd = process.argv[2];
const arg = process.argv[3];
let failures = 0;

if (cmd === 'verify') failures = cmdVerify();
else if (cmd === 'drift') failures = cmdDrift();
else if (cmd === 'decisions') failures = cmdDecisions();
else if (cmd === 'layout') failures = cmdLayout(arg);
else if (cmd === 'bench') failures = cmdBench();
else if (cmd === 'check' || cmd === undefined) {
  failures += cmdDrift();
  failures += cmdVerify();
  failures += cmdDecisions();
} else {
  out('usage: singularity <verify|drift|decisions|layout <module>|bench|check>');
  process.exit(2);
}

out('');
if (failures > 0) {
  out(RED + BOLD + failures + ' problem(s). Exit 1.' + RESET);
  process.exit(1);
}
out(GREEN + BOLD + 'clean' + RESET);
