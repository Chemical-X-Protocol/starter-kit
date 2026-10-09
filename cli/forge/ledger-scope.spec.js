// Default-scope grouping after an --include-tests sync (#2604): the spec-facet rows that sync left in the
// ledger, and the stored run it wrote, never change what a default `patterns --forge` groups, and the
// sync reports the rows that scope reads apart from the spec rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncFingerprints } from './fingerprint-sync.js';
import { runForgeGroups } from './forge-groups.js';

delete process.env.CHEMX_PROJECT_ROOT;

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(KIT_ROOT, 'cli/team/team-flags.js');

const makeProject = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-forge-scope-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.chemx'));
  fs.mkdirSync(path.join(dir, 'lib'));
  for (const name of ['a.js', 'b.js', 'a.spec.js', 'b.spec.js']) fs.copyFileSync(SOURCE, path.join(dir, 'lib', name));
  return dir;
};

const idsOf = (result) => result.groups.map((group) => `${group.id} ${group.rank}`).sort();

test('a default run groups the same after an --include-tests sync as on a ledger that never had spec rows', (t) => {
  const withSpecs = makeProject(t);
  const specSync = syncFingerprints(withSpecs, { includeTests: true, log: () => {} });
  runForgeGroups(withSpecs, { includeSpecs: true });
  const defaultSync = syncFingerprints(withSpecs, { log: () => {} });
  const afterSpecs = runForgeGroups(withSpecs);
  const fresh = makeProject(t);
  syncFingerprints(fresh, { log: () => {} });
  const clean = runForgeGroups(fresh);
  assert.ok(specSync.specRows > 0);
  assert.equal(defaultSync.scopeRows, defaultSync.ledgerRows - defaultSync.specRows);
  assert.ok(afterSpecs.groups.length > 0);
  assert.ok(afterSpecs.groups.every((group) => !group.facetKey.includes(':spec:')));
  assert.deepEqual(idsOf(afterSpecs), idsOf(clean));
  assert.equal(afterSpecs.stats.rows, clean.stats.rows);
});
