'use strict';
/* SINGULARITY FRAMEWORK-SYNC VERIFICATION
 *
 * framework/ is the copy-to-bootstrap kit. Its mechanical core must stay
 * byte-identical to the live files this repo actually runs, or the kit ships
 * something untested. This suite is what stops the two copies from drifting —
 * the same reason drift checking exists for intents.
 *
 * Deliberately NOT synced: CLAUDE.md, package.json, README.md, docs/*, the
 * decisions/0006 copy, features/_example/*, and .gitignore — those are
 * generalised for a fresh project and are expected to differ. (.gitignore
 * diverges legitimately: this repo ignores its own private notes, which is
 * meaningless in a bootstrap kit. It is checked for existence and for the
 * entries every project needs, not for byte equality.) */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  process.stdout.write('  ok  ' + name + '\n');
}

/* files that must be byte-identical between the live tree and the kit */
const SYNCED = [
  ['.cursorrules', 'framework/.cursorrules'],
  ['.gitattributes', 'framework/.gitattributes'],
  ['bin/singularity.js', 'framework/bin/singularity.js'],
  ['src/runtime/arena.js', 'framework/src/runtime/arena.js'],
  ['src/runtime/ingest.js', 'framework/src/runtime/ingest.js'],
  ['tests/ingest.assert.js', 'framework/tests/ingest.assert.js'],
  ['tests/_source-lint.js', 'framework/tests/_source-lint.js'],
  ['tests/arena.assert.js', 'framework/tests/arena.assert.js'],
  ['decisions/_template.md', 'framework/decisions/_template.md']
];

process.stdout.write('\nSINGULARITY :: framework kit sync\n\n');

for (let i = 0, n = SYNCED.length; i < n; i++) {
  const live = SYNCED[i][0], kit = SYNCED[i][1];
  check(live + ' === ' + kit, function () {
    const a = fs.readFileSync(path.join(ROOT, live));
    const b = fs.readFileSync(path.join(ROOT, kit));
    assert.ok(a.equals(b),
      'kit copy has drifted from the live file — re-copy ' + live + ' into framework/');
  });
}

check('kit .gitignore exists and covers what every project needs', function () {
  const src = fs.readFileSync(path.join(ROOT, 'framework/.gitignore'), 'utf8');
  const required = ['node_modules', 'dist', '*.heapsnapshot', '*.cpuprofile',
    'isolate-*.log', 'v8.log'];
  for (let i = 0, n = required.length; i < n; i++) {
    assert.ok(src.indexOf(required[i]) !== -1,
      'kit .gitignore is missing "' + required[i] + '"');
  }
});

check('kit ships the files a fresh project cannot run without', function () {
  const required = [
    'framework/README.md',
    'framework/CLAUDE.md',
    'framework/package.json',
    'framework/docs/STRUCTURE.md',
    'framework/docs/DECISIONS.md',
    'framework/decisions/0006-schema-driven-arena-runtime.md',
    'framework/features/_example/example-workflow.intent.ts',
    'framework/features/_example/feature.md',
    'framework/src/exec/README.md'
  ];
  for (let i = 0, n = required.length; i < n; i++) {
    assert.ok(fs.existsSync(path.join(ROOT, required[i])), 'missing: ' + required[i]);
  }
});

check('kit 0006 carries no rules: entries (fresh projects have no intents)', function () {
  const src = fs.readFileSync(
    path.join(ROOT, 'framework/decisions/0006-schema-driven-arena-runtime.md'), 'utf8');
  const fm = src.slice(0, src.indexOf('\n---', 3));
  assert.equal(/^rules:/m.test(fm), false,
    'kit 0006 lists rules: — a fresh copy would fail `singularity decisions` ' +
    'with unknown-rule references before any intent exists');
  assert.ok(/^scope: framework$/m.test(fm), 'kit 0006 must be scope: framework');
});

check('example feature stays underscore-hidden so the CLI skips it', function () {
  assert.ok(fs.existsSync(path.join(ROOT, 'framework/features/_example')),
    'skeleton feature missing');
  const entries = fs.readdirSync(path.join(ROOT, 'framework/features'));
  for (let i = 0, n = entries.length; i < n; i++) {
    assert.equal(entries[i][0], '_',
      'framework/features contains an ACTIVE feature "' + entries[i] +
      '" — the kit must bootstrap empty');
  }
});

process.stdout.write('\n  ' + passed + ' checks passed\n\n');
