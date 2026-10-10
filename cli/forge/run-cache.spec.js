// run-cache.js: a warm grouping with nothing changed is read back whole and equals the computed run; an
// edit not yet synced turns the cache off, a sync or a suppression makes a new key, and a hit restores
// pattern_groups after another scope's run replaced them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncFingerprints } from './fingerprint-sync.js';
import { runForgeGroups } from './forge-groups.js';
import { suppressGroup } from './group-store.js';
import { isStoredRun, markStoredRun } from './run-cache.js';
import { createBodyEndReader } from './body-ends.js';
import { openIndexDb } from '../search-schema.js';

delete process.env.CHEMX_PROJECT_ROOT;

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(KIT_ROOT, 'cli/team/team-flags.js');

const makeProject = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-forge-runcache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.chemx'));
  fs.mkdirSync(path.join(dir, 'lib'));
  for (const name of ['a.js', 'b.js', 'a.spec.js', 'b.spec.js']) fs.copyFileSync(SOURCE, path.join(dir, 'lib', name));
  syncFingerprints(dir, { log: () => {} });
  return dir;
};

const shapeOf = (result) => result.groups.map((group) => `${group.id} ${group.rank} ${group.foldedInto ?? '-'} ${(group.folded ?? []).length}`).sort();
const storedIds = (dir) => openIndexDb(dir).prepare('SELECT id FROM pattern_groups ORDER BY id').all().map((row) => row.id);

test('a warm run with nothing changed is a hit and equals the computed run', (t) => {
  const dir = makeProject(t);
  const cold = runForgeGroups(dir);
  const warm = runForgeGroups(dir);
  assert.equal(cold.runCache, 'miss');
  assert.equal(warm.runCache, 'hit');
  assert.ok(cold.groups.length > 0);
  assert.deepEqual(shapeOf(warm), shapeOf(cold));
  assert.deepEqual(warm.stats, cold.stats);
  assert.ok(warm.unifyDecisions instanceof Map);
});

test('an unsynced edit turns the cache off; the sync after it makes a new key', (t) => {
  const dir = makeProject(t);
  runForgeGroups(dir);
  fs.appendFileSync(path.join(dir, 'lib', 'b.js'), '\nexport const extra = 1;\n');
  assert.equal(runForgeGroups(dir).runCache, 'off');
  syncFingerprints(dir, { log: () => {} });
  assert.equal(runForgeGroups(dir).runCache, 'miss');
  assert.equal(runForgeGroups(dir).runCache, 'hit');
});

test('restoring a file byte-for-byte after a re-fingerprint is a miss, because the unit row ids changed', (t) => {
  const dir = makeProject(t);
  const file = path.join(dir, 'lib', 'b.js');
  const original = fs.readFileSync(file, 'utf-8');
  assert.equal(runForgeGroups(dir).runCache, 'miss');
  fs.appendFileSync(file, '\nexport const extra = 1;\n');
  syncFingerprints(dir, { log: () => {} });
  fs.writeFileSync(file, original);
  syncFingerprints(dir, { log: () => {} });
  const after = runForgeGroups(dir);
  assert.equal(after.runCache, 'miss');
  const known = new Set(openIndexDb(dir).prepare('SELECT id FROM pattern_units').all().map((row) => row.id));
  const named = after.groups.flatMap((group) => group.instances.flatMap((instance) => instance.unitIds));
  assert.ok(named.length > 0 && named.every((id) => known.has(id)), 'every unit id a group names is in the ledger');
});

test('a suppression makes a new key, and the hit after it is suppressed too', (t) => {
  const dir = makeProject(t);
  const first = runForgeGroups(dir);
  const target = first.groups.find((group) => group.rank === 1);
  suppressGroup(openIndexDb(dir), { group: { id: target.id, path: target.path, suppression_key: target.suppressionKey }, reason: 'spec', agent: '@spec' });
  const after = runForgeGroups(dir);
  assert.equal(after.runCache, 'miss');
  assert.ok(after.suppressed.some((group) => group.id === target.id));
  assert.equal(runForgeGroups(dir).runCache, 'hit');
});

test('stored body ends are reused on a recomputed run and give the same groups', (t) => {
  const dir = makeProject(t);
  const first = runForgeGroups(dir);
  const stored = openIndexDb(dir).prepare('SELECT count(*) AS n FROM pattern_body_end_cache').get().n;
  assert.ok(stored > 0);
  const again = runForgeGroups(dir, { runCache: false });
  assert.equal(again.runCache, 'off');
  assert.deepEqual(shapeOf(again), shapeOf(first));
});

test('a known content key is read from the store, never parsed', () => {
  const known = new Map([['k', ['5:9']]]);
  const reader = createBodyEndReader(() => 'not even javascript (', { keyOf: () => 'k', known });
  assert.equal(reader.endsFunctionBody({ file_path: 'x.js', start: 5, end: 9 }), true);
  assert.deepEqual([...reader.decisions], [['k', ['5:9']]]);
});

test('a hit restores pattern_groups after a run of another scope replaced them', (t) => {
  const dir = makeProject(t);
  runForgeGroups(dir);
  const defaultIds = storedIds(dir);
  syncFingerprints(dir, { includeTests: true, log: () => {} });
  assert.equal(runForgeGroups(dir, { includeSpecs: true }).runCache, 'miss');
  assert.equal(isStoredRun(openIndexDb(dir), 'none'), false);
  openIndexDb(dir).exec('DELETE FROM pattern_groups');
  markStoredRun(openIndexDb(dir), 'another-scope');
  assert.notDeepEqual(storedIds(dir), defaultIds);
  const back = runForgeGroups(dir);
  assert.equal(back.runCache, 'hit');
  assert.deepEqual(storedIds(dir), defaultIds);
});
