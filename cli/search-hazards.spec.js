import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb, syncViolationsIndex } from './search-db.js';
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
    syncViolationsIndex(db, [VIOLATION]);
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(file, later, later);
    const freshness = assessAuditFreshness(db, { filePath: 'useAuth.ts', root, cwd: subdir });
    assert.equal(freshness.status, 'inconclusive', 'the edited file is newer than the audit');
    assert.match(freshness.reason, /changed after the last audit/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
