#!/usr/bin/env node
'use strict';
/* SINGULARITY CLI
 *
 * The framework's enforcement surface. Everything here is mechanical: no command
 * asks you to trust a claim it has not checked.
 *
 *   singularity map           the human view: features -> workflows -> decisions
 *   singularity verify        run every assert suite
 *   singularity drift         fail if an intent is newer than its exec unit
 *   singularity decisions     report which rules have recorded rationale
 *   singularity layout <wf>   print a workflow's arena layout, byte by byte
 *   singularity bench         run the benchmarks
 *   singularity check         drift + verify + decisions, the pre-commit gate
 *
 * TWO STRUCTURES, ONE SYSTEM
 *
 *   features/<feature>/<workflow>.intent.ts   <- humans navigate here
 *   features/<feature>/<workflow>.assert.js
 *   features/<feature>/decisions/*.md
 *
 *   src/exec/<workflow>.exec.js               <- machines run this, flat
 *   src/runtime/arena.js
 *
 * The exec tree is deliberately NOT organised by feature. Directory layout has
 * no effect on runtime performance — files do not make V8 faster. What actually
 * varies on the machine side is which exec units share an arena and which get
 * bundled into one process, and those are manifest concerns, not directory
 * concerns. Since exec units are generated and never read by a human, the two
 * structures are free to diverge, and each is optimised for its own reader.
 *
 * Zero dependencies. Exit code 0 means the repo is in a state you can commit.
 */

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FEATURES = path.join(ROOT, 'features');
const EXECS = path.join(ROOT, 'src', 'exec');
const TESTS = path.join(ROOT, 'tests');
const FRAMEWORK_DECISIONS = path.join(ROOT, 'decisions');

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

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  const all = fs.readdirSync(dir);
  const hit = [];
  for (let i = 0, n = all.length; i < n; i++) {
    if (all[i][0] === '_' || all[i][0] === '.') continue;
    if (fs.statSync(path.join(dir, all[i])).isDirectory()) hit.push(all[i]);
  }
  hit.sort();
  return hit;
}

/* ---- discovery: the human tree ----------------------------------------- */

function features() {
  const names = listDirs(FEATURES);
  const feats = [];
  for (let i = 0, n = names.length; i < n; i++) {
    const dir = path.join(FEATURES, names[i]);
    const intents = listFiles(dir, '.intent.ts');
    const workflows = [];
    for (let k = 0, kn = intents.length; k < kn; k++) {
      const wf = intents[k].slice(0, -'.intent.ts'.length);
      workflows.push({
        name: wf,
        feature: names[i],
        intent: path.join(dir, intents[k]),
        assert: path.join(dir, wf + '.assert.js'),
        exec: path.join(EXECS, wf + '.exec.js')
      });
    }
    feats.push({
      name: names[i],
      dir: dir,
      readme: path.join(dir, 'feature.md'),
      decisionsDir: path.join(dir, 'decisions'),
      workflows: workflows
    });
  }
  return feats;
}

function allWorkflows() {
  const feats = features();
  const out = [];
  for (let i = 0, n = feats.length; i < n; i++) {
    for (let k = 0, kn = feats[i].workflows.length; k < kn; k++) out.push(feats[i].workflows[k]);
  }
  return out;
}

/* ---- intent rule extraction -------------------------------------------- */

function intentRules(file) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('rules: [');
  if (start === -1) return [];
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
 * Minimal frontmatter parser. Deliberately not YAML — the format is fixed and
 * documented in docs/DECISIONS.md, and no dependency keeps the CLI runnable in
 * a bare container. */
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

function readDecisionsFrom(dir, owner) {
  const files = listFiles(dir, '.md');
  const recs = [];
  for (let i = 0, n = files.length; i < n; i++) {
    if (files[i][0] === '_') continue;
    const file = path.join(dir, files[i]);
    const meta = parseFrontmatter(fs.readFileSync(file, 'utf8'), files[i]);
    recs.push({ file: files[i], dir: dir, owner: owner, meta: meta });
  }
  return recs;
}

/* every decision in the repo: framework-wide plus one folder per feature */
function decisions() {
  let recs = readDecisionsFrom(FRAMEWORK_DECISIONS, '(framework)');
  const feats = features();
  for (let i = 0, n = feats.length; i < n; i++) {
    recs = recs.concat(readDecisionsFrom(feats[i].decisionsDir, feats[i].name));
  }
  return recs;
}

/* ---- commands ---------------------------------------------------------- */

/* Content hash of the intent, newline-normalised so the stamp survives a
 * checkout on a different platform. */
function intentStamp(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return require('node:crypto').createHash('sha256').update(raw, 'utf8').digest('hex');
}

function cmdDrift() {
  head('drift  (was every exec unit compiled from the intent as it stands now?)');
  const wfs = allWorkflows();
  let failed = 0;
  for (let i = 0, n = wfs.length; i < n; i++) {
    const w = wfs[i];
    const label = w.feature + '/' + w.name;
    if (!fs.existsSync(w.exec)) {
      bad(label + ': no exec unit — intent has never been compiled');
      failed++;
      continue;
    }
    if (!fs.existsSync(w.assert)) {
      bad(label + ': exec unit has no assert suite alongside the intent');
      failed++;
      continue;
    }
    /* Content stamp, NOT mtime. mtime does not survive `git clone` — every file
     * gets checkout time — so an mtime comparison silently passes on a fresh CI
     * checkout no matter how stale the exec is. The stamp is written into the
     * exec header at compile time and compared here. */
    const src = fs.readFileSync(w.exec, 'utf8');
    const m = src.match(/intent-sha256:\s*([0-9a-f]{64})/);
    if (m === null) {
      bad(label + ': exec has no `intent-sha256` stamp in its header — recompile');
      failed++;
      continue;
    }
    const actual = intentStamp(w.intent);
    if (m[1] !== actual) {
      bad(label + ': intent has changed since the exec was compiled' +
        '\n        stamped ' + m[1].slice(0, 16) + '...  actual ' + actual.slice(0, 16) + '...');
      failed++;
    } else {
      ok(label + '  ' + DIM + actual.slice(0, 12) + RESET);
    }
  }
  if (wfs.length === 0) warn('no workflows found under features/');
  return failed;
}

function runSuite(file, label, state) {
  /* --allow-natives-syntax lets suites verify hidden-class claims directly;
   * suites that do not use it are unaffected. */
  const r = cp.spawnSync(process.execPath, ['--allow-natives-syntax', file], { encoding: 'utf8' });
  const text = (r.stdout || '') + (r.stderr || '');
  const m = text.match(/(\d+) checks passed/);
  if (r.status === 0 && m !== null) {
    ok(label + '  ' + DIM + m[1] + ' checks' + RESET);
    state.checks += Number(m[1]);
    return 0;
  }
  bad(label);
  out(text.split(/\r?\n/).slice(-14).join('\n'));
  return 1;
}

function cmdVerify() {
  head('verify  (every assert suite)');
  const state = { checks: 0 };
  let failed = 0, suites = 0;

  const framework = listFiles(TESTS, '.assert.js');
  for (let i = 0, n = framework.length; i < n; i++) {
    failed += runSuite(path.join(TESTS, framework[i]), 'framework  ' + framework[i], state);
    suites++;
  }
  const wfs = allWorkflows();
  for (let i = 0, n = wfs.length; i < n; i++) {
    if (!fs.existsSync(wfs[i].assert)) continue;
    failed += runSuite(wfs[i].assert, wfs[i].feature + '/' + wfs[i].name, state);
    suites++;
  }
  if (suites === 0) warn('no assert suites found');
  else out('  ' + DIM + state.checks + ' checks across ' + suites + ' suites' + RESET);
  return failed;
}

function cmdDecisions() {
  head('decisions  (does every rule have recorded rationale?)');

  let recs;
  try { recs = decisions(); }
  catch (e) { bad(e.message); return 1; }

  const covered = Object.create(null);
  const waived = Object.create(null);
  const ids = Object.create(null);
  let failed = 0;

  const REQUIRED = ['id', 'title', 'status'];
  for (let i = 0, n = recs.length; i < n; i++) {
    const r = recs[i], meta = r.meta;
    for (let f = 0, fn = REQUIRED.length; f < fn; f++) {
      if (meta[REQUIRED[f]] === undefined) {
        bad(r.file + ': frontmatter is missing `' + REQUIRED[f] + '`');
        failed++;
      }
    }
    /* a record must say what it belongs to: a feature/workflow, or the framework */
    if (meta.workflow === undefined && meta.scope === undefined) {
      bad(r.file + ': needs either `workflow:` or `scope: framework`');
      failed++;
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

  const known = Object.create(null);
  const feats = features();
  for (let i = 0, n = feats.length; i < n; i++) {
    const f = feats[i];
    for (let k = 0, kn = f.workflows.length; k < kn; k++) {
      const w = f.workflows[k];
      const rules = intentRules(w.intent);
      const undoc = [];
      let documented = 0, waivedCount = 0;

      for (let r = 0, rn = rules.length; r < rn; r++) {
        const key = rules[r].key;
        known[key] = true;
        if (covered[key] !== undefined) documented++;
        else if (waived[key] !== undefined) waivedCount++;
        else undoc.push(rules[r]);
      }

      out('  ' + BOLD + f.name + '/' + w.name + RESET + '  ' + rules.length + ' rules: ' +
        GREEN + documented + ' documented' + RESET + ', ' +
        DIM + waivedCount + ' waived' + RESET + ', ' +
        (undoc.length > 0 ? YELLOW : GREEN) + undoc.length + ' undocumented' + RESET);
      for (let u = 0, un = undoc.length; u < un; u++) {
        warn('no rationale recorded for ' + BOLD + undoc[u].key + RESET);
      }
    }
  }

  /* A decision pointing at a rule key that no longer exists is stale — usually
   * the rule was renamed. This is what stops the log from rotting silently. */
  for (const key in covered) {
    if (known[key] === undefined) {
      bad('decision ' + covered[key].join(', ') + ' references unknown rule `' + key + '`' +
        ' — renamed or deleted?');
      failed++;
    }
  }
  for (const key in waived) {
    if (known[key] === undefined) {
      bad('decision ' + waived[key] + ' waives unknown rule `' + key + '`' +
        ' — renamed or deleted?');
      failed++;
    }
  }
  return failed;
}

function cmdMap() {
  head('map  (the human view)');
  let recs = [];
  try { recs = decisions(); } catch (e) { bad(e.message); return 1; }

  /* index decisions by owning workflow */
  const byWorkflow = Object.create(null);
  const frameworkRecs = [];
  for (let i = 0, n = recs.length; i < n; i++) {
    const wf = recs[i].meta.workflow;
    if (wf === undefined) { frameworkRecs.push(recs[i]); continue; }
    if (byWorkflow[wf] === undefined) byWorkflow[wf] = [];
    byWorkflow[wf].push(recs[i]);
  }

  const feats = features();
  for (let i = 0, n = feats.length; i < n; i++) {
    const f = feats[i];
    out('\n  ' + BOLD + f.name + RESET + DIM + '  features/' + f.name + '/' + RESET);
    for (let k = 0, kn = f.workflows.length; k < kn; k++) {
      const w = f.workflows[k];
      const rules = intentRules(w.intent);
      out('    ' + BOLD + w.name + RESET + '  ' + DIM + rules.length + ' rules -> src/exec/' +
        w.name + '.exec.js' + RESET);
      const ds = byWorkflow[w.name] === undefined ? [] : byWorkflow[w.name];
      for (let d = 0, dn = ds.length; d < dn; d++) {
        const meta = ds[d].meta;
        const kind = meta.rules !== undefined && meta.rules.length > 0
          ? String(meta.rules.length) + ' rules' : 'waivers';
        out('      ' + DIM + meta.id + RESET + '  ' + meta.title +
          '  ' + DIM + '(' + kind + ')' + RESET);
      }
    }
  }
  if (frameworkRecs.length > 0) {
    out('\n  ' + BOLD + '(framework)' + RESET + DIM + '  decisions/' + RESET);
    for (let i = 0, n = frameworkRecs.length; i < n; i++) {
      out('      ' + DIM + frameworkRecs[i].meta.id + RESET + '  ' + frameworkRecs[i].meta.title);
    }
  }
  out('\n  ' + DIM + 'machine view: src/exec/*.exec.js (flat, generated), src/runtime/arena.js' + RESET);
  return 0;
}

function cmdLayout(name) {
  const wfs = allWorkflows();
  let target = null;
  for (let i = 0, n = wfs.length; i < n; i++) if (wfs[i].name === name) target = wfs[i];
  if (target === null) {
    const names = [];
    for (let i = 0, n = wfs.length; i < n; i++) names.push(wfs[i].name);
    out('unknown workflow "' + name + '". known: ' + names.join(', '));
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
    for (let i = 0, n = schema.dims.length; i < n; i++) dimDesc.push(schema.dims[i] + '=' + probe[i]);
    head('layout  ' + name + ' :: ' + d.name + '  (' + dimDesc.join(', ') + ')');
    out('  ' + 'field'.padEnd(18) + 'type'.padEnd(6) + 'offset'.padStart(10) +
      'length'.padStart(10) + 'bytes'.padStart(12));
    for (let i = 0, n = d.fields.length; i < n; i++) {
      const f = d.fields[i];
      out('  ' + f.field.padEnd(18) + f.type.padEnd(6) +
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
else if (cmd === 'map') failures = cmdMap();
else if (cmd === 'layout') failures = cmdLayout(arg);
else if (cmd === 'bench') failures = cmdBench();
else if (cmd === 'check' || cmd === undefined) {
  failures += cmdDrift();
  failures += cmdVerify();
  failures += cmdDecisions();
} else {
  out('usage: singularity <map|verify|drift|decisions|layout <workflow>|bench|check>');
  process.exit(2);
}

out('');
if (failures > 0) {
  out(RED + BOLD + failures + ' problem(s). Exit 1.' + RESET);
  process.exit(1);
}
out(GREEN + BOLD + 'clean' + RESET);
