// Forge P2 incrementality (phases doc, P2 acceptance "Incrementality and cost"), on a temp project
// whose files are verbatim copies of kit modules:
//   - a second `chemx patterns --sync` with no edits parses 0 files; editing one re-fingerprints exactly 1;
//     a touch (new mtime, same bytes) parses 0; a deleted file loses its rows
//   - a patch through chemx updates that file's rows without an audit
//   - the audit writes the same rows the standalone sync writes, skips unchanged files when warm, and
//     defers files past its budget instead of fingerprinting them
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncFingerprints } from './fingerprint-sync.js';
import { fingerprintFile } from './fingerprint-file.js';
import { runAudit } from '../audit-engine.js';
import { patchFile } from '../patcher.js';
import { openIndexDb } from '../search-schema.js';

delete process.env.CHEMX_PROJECT_ROOT;

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCES = ['cli/forge/anchors.js', 'cli/forge/exclusions.js', 'cli/team/team-flags.js'];

const makeProject = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-forge-inc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.chemx'));
  fs.mkdirSync(path.join(dir, 'lib'));
  for (const source of SOURCES) fs.copyFileSync(path.join(KIT_ROOT, source), path.join(dir, 'lib', path.basename(source)));
  return dir;
};

const ledgerOf = (dir) => {
  const db = openIndexDb(dir);
  const units = db.prepare('SELECT file_path, kind, start, end, fp1, fp2, fp3, mass, anchors FROM pattern_units ORDER BY file_path, start_line, start, kind, fp1').all();
  const files = db.prepare('SELECT path, unit_count FROM pattern_files ORDER BY path').all();
  return { units: units.map((row) => ({ ...row })), files: files.map((row) => ({ ...row })) };
};

const sync = (dir) => syncFingerprints(dir, { targetDir: dir, log: () => {} });

test('a second sync parses 0 files; an edit re-fingerprints exactly 1; a touch parses 0', (t) => {
  const dir = makeProject(t);
  const first = sync(dir);
  assert.equal(first.status, 'ok');
  assert.equal(first.parsed, SOURCES.length);
  assert.ok(first.ledgerRows > 0);

  const second = sync(dir);
  assert.equal(second.parsed, 0);
  assert.equal(second.unchanged, SOURCES.length);
  assert.equal(second.dirty, 0);

  const anchorsPath = path.join(dir, 'lib/anchors.js');
  fs.appendFileSync(anchorsPath, "\nexport const isOutside = (relative) => relative.startsWith('..') || path.isAbsolute(relative);\n");
  const third = sync(dir);
  assert.equal(third.parsed, 1);
  assert.ok(third.dirty > 0);

  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(dir, 'lib/exclusions.js'), later, later);
  const fourth = sync(dir);
  assert.equal(fourth.parsed, 0);
  assert.equal(fourth.touched, 1);
  assert.equal(sync(dir).touched, 0, 'the touched stamp now passes the mtime prefilter');
});

test('a package.json added or removed re-facets unchanged files without parsing them', (t) => {
  const dir = makeProject(t);
  sync(dir);
  const facetsOf = () => new Set(openIndexDb(dir).prepare('SELECT facet_key FROM pattern_units').all().map((row) => row.facet_key));
  assert.deepEqual([...facetsOf()], ['js:plain:src:.']);
  fs.writeFileSync(path.join(dir, 'lib/package.json'), JSON.stringify({ name: 'lib' }));
  const moved = sync(dir);
  assert.equal(moved.parsed, 0, 'content is unchanged');
  assert.equal(moved.refaceted, SOURCES.length);
  assert.ok(moved.dirty > 0, 'groups of both facets are refreshed');
  assert.deepEqual([...facetsOf()], ['js:plain:src:lib']);
  assert.equal(sync(dir).refaceted, 0, 'the new facet is stored');
  fs.rmSync(path.join(dir, 'lib/package.json'));
  assert.equal(sync(dir).refaceted, SOURCES.length);
  assert.deepEqual([...facetsOf()], ['js:plain:src:.']);
});

test('a deleted file loses its ledger rows', (t) => {
  const dir = makeProject(t);
  sync(dir);
  fs.rmSync(path.join(dir, 'lib/exclusions.js'));
  const result = sync(dir);
  assert.equal(result.removed, 1);
  assert.ok(!ledgerOf(dir).files.some((file) => file.path === 'lib/exclusions.js'));
  assert.ok(!ledgerOf(dir).units.some((unit) => unit.file_path === 'lib/exclusions.js'));
});

test('a patch through chemx updates that file\'s rows without an audit', (t) => {
  const dir = makeProject(t);
  sync(dir);
  const target = path.join(dir, 'lib/anchors.js');
  const before = ledgerOf(dir).units.filter((unit) => unit.file_path === 'lib/anchors.js');
  const patched = patchFile(target, { targetContent: 'total + weightOf(anchor), 0)', replacementContent: 'total + 2 * weightOf(anchor), 0)', cwd: dir, skipCheck: true });
  assert.equal(patched.status, 'ok');
  const after = ledgerOf(dir).units.filter((unit) => unit.file_path === 'lib/anchors.js');
  assert.notDeepEqual(after.map((unit) => unit.fp1), before.map((unit) => unit.fp1));
  assert.equal(sync(dir).parsed, 0, 'the patch already brought the ledger up to date');
});

test('fingerprintFile skips paths outside the project and excluded paths', (t) => {
  const dir = makeProject(t);
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.copyFileSync(path.join(KIT_ROOT, SOURCES[0]), path.join(dir, 'dist/anchors.js'));
  assert.equal(fingerprintFile(path.join(dir, 'dist/anchors.js'), dir).status, 'skipped');
  assert.equal(fingerprintFile(path.join(KIT_ROOT, SOURCES[0]), dir).status, 'skipped');
  assert.equal(fingerprintFile(path.join(dir, 'lib/anchors.js'), dir).status, 'fingerprinted');
  assert.equal(fingerprintFile(path.join(dir, 'lib/anchors.js'), dir).status, 'unchanged');
});

test('the audit writes the rows the standalone sync writes, then skips unchanged files', (t) => {
  const viaAudit = makeProject(t);
  const viaSync = makeProject(t);
  const cold = runAudit(viaAudit, { cwd: viaAudit, fingerprint: true, fingerprintBudget: { share: 1, allowanceChars: Infinity } });
  sync(viaSync);
  assert.equal(cold.fingerprint.fingerprinted, SOURCES.length);
  assert.deepEqual(ledgerOf(viaAudit), ledgerOf(viaSync));

  const warm = runAudit(viaAudit, { cwd: viaAudit, fingerprint: true });
  assert.equal(warm.fingerprint.fingerprinted, 0);
  assert.equal(warm.fingerprint.unchanged, SOURCES.length);
  assert.equal(runAudit(viaAudit, { cwd: viaAudit }).fingerprint, null, 'no session unless asked');
});

test('the audit defers files past its budget and a later sync completes the ledger', (t) => {
  const dir = makeProject(t);
  const report = runAudit(dir, { cwd: dir, fingerprint: true, fingerprintBudget: { share: 0, allowanceChars: 0 } });
  assert.equal(report.fingerprint.fingerprinted, 0);
  assert.equal(report.fingerprint.deferred, SOURCES.length);
  assert.equal(sync(dir).parsed, SOURCES.length);
});
