import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb, syncViolationsIndex, queryViolations, inspectIndexedFile, upsertFileIndex } from './search-db.js';
import { assessAuditFreshness } from './search-commands-hazards.js';

const VIOLATION = { filePath: 'src/mechanics/useAuth.ts', rule: 'R', severity: 'HIGH', pillar: 'p', line: 1, hazard: 'h', directive: 'd' };

test('q hazards: violations written by a directory audit count as audit data', () => {
  const db = openIndexDb(':memory:');
  syncViolationsIndex(db, [VIOLATION]);
  const freshness = assessAuditFreshness(db, { root: os.tmpdir() });
  assert.notEqual(freshness.lastAuditAt, null);
  assert.doesNotMatch(String(freshness.reason), /no audit data/);
});

test('q hazards <file> from a subdirectory checks that file, not root/<file>', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-hazards-'));
  try {
    const subdir = path.join(root, 'src', 'mechanics');
    fs.mkdirSync(subdir, { recursive: true });
    const file = path.join(subdir, 'useAuth.ts');
    fs.writeFileSync(file, 'export const useAuth = 1;\n');
    const db = openIndexDb(':memory:');
    syncViolationsIndex(db, [VIOLATION], { scope: 'src' });
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(file, later, later);
    const freshness = assessAuditFreshness(db, { filePath: 'useAuth.ts', root, cwd: subdir });
    assert.equal(freshness.status, 'inconclusive', 'the edited file is newer than the audit');
    assert.match(freshness.reason, /changed after the last audit/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const withAuditedProject = (run) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-hazards-scope-'));
  try {
    for (const rel of ['src/big.ts', 'other/o.ts']) {
      fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), 'export const x = 1;\n');
      const earlier = new Date(Date.now() - 60_000);
      fs.utimesSync(path.join(root, rel), earlier, earlier);
    }
    run(root, openIndexDb(':memory:'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('q hazards <file>: a file outside the last audit scope is inconclusive, not zero hazards', () => {
  withAuditedProject((root, db) => {
    syncViolationsIndex(db, [], { scope: 'other' });
    const freshness = assessAuditFreshness(db, { filePath: 'src/big.ts', root, cwd: root });
    assert.equal(freshness.status, 'inconclusive');
    assert.match(freshness.reason, /outside the last audit scope \(other\)/);
  });
});

test('q hazards <file>: a file that does not exist is inconclusive', () => {
  withAuditedProject((root, db) => {
    syncViolationsIndex(db, [], { scope: 'src' });
    const freshness = assessAuditFreshness(db, { filePath: 'src/nope.ts', root, cwd: root });
    assert.equal(freshness.status, 'inconclusive');
    assert.match(freshness.reason, /file not found: src\/nope\.ts/);
  });
});

test('q hazards <file>: an audit with no recorded scope vouches for no file', () => {
  withAuditedProject((root, db) => {
    syncViolationsIndex(db, []);
    const freshness = assessAuditFreshness(db, { filePath: 'src/big.ts', root, cwd: root });
    assert.equal(freshness.status, 'inconclusive');
  });
});

test('q hazards <file>: an unchanged file inside the audited scope passes', () => {
  withAuditedProject((root, db) => {
    syncViolationsIndex(db, [], { scope: 'src' });
    const freshness = assessAuditFreshness(db, { filePath: 'src/big.ts', root, cwd: root });
    assert.equal(freshness.status, 'pass');
    assert.equal(freshness.relPath, 'src/big.ts');
    assert.equal(freshness.auditScope, 'src');
  });
});

test('queryViolations: delimiter-bounded filePath match prevents false positives', () => {
  const db = openIndexDb(':memory:');
  syncViolationsIndex(db, [
    { filePath: 'src/user.ts', rule: 'R1', severity: 'HIGH', pillar: 'p', line: 1, hazard: 'h1', directive: 'd' },
    { filePath: 'src/super-user.ts', rule: 'R2', severity: 'HIGH', pillar: 'p', line: 2, hazard: 'h2', directive: 'd' },
    { filePath: 'src/user.ts.bak', rule: 'R3', severity: 'HIGH', pillar: 'p', line: 3, hazard: 'h3', directive: 'd' }
  ]);
  const userResults = queryViolations(db, { filePath: 'user.ts' });
  assert.equal(userResults.length, 1);
  assert.equal(userResults[0].filePath, 'src/user.ts');
});

test('inspectIndexedFile: delimiter-bounded path match prevents false positives', () => {
  const db = openIndexDb(':memory:');
  upsertFileIndex(db, { path: 'src/super-a.ts', mtime: 1, size: 10, tier: 'utility', lines: 1, chars: 10, symbols: [], imports: [] });
  upsertFileIndex(db, { path: 'src/a.ts', mtime: 1, size: 10, tier: 'utility', lines: 1, chars: 10, symbols: [], imports: [] });
  const inspected = inspectIndexedFile(db, 'a.ts');
  assert.equal(inspected.path, 'src/a.ts');
});
