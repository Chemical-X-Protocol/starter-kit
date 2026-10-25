/**
 * The index step of `chemx worktree add` (#6769, K8b): the worktree's own db is opened whatever root the
 * shell exports, seeded when a parent index exists, and reported in one line or none.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearDbCache } from './search-db.js';
import { seedWorktreeIndex, formatSeedLine } from './worktree-index.js';

const tempDir = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-wt-index-')));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"wt-index-spec"}\n');
  t.after(() => { clearDbCache(); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
};

test('formatSeedLine: one line for seeded and skipped, none otherwise', () => {
  assert.equal(formatSeedLine({ status: 'seeded', seeded: 2, parentFiles: 4, mainRoot: '/m', ms: 12 }), 'index: seeded 2 of 4 files from /m (12ms)\n');
  assert.equal(formatSeedLine({ status: 'skipped', reason: 'the parent index is extractor v1, this chemx is v2' }), 'index: seed from parent skipped: the parent index is extractor v1, this chemx is v2\n');
  assert.equal(formatSeedLine({ status: 'none', reason: 'not a linked worktree' }), '');
  assert.equal(formatSeedLine(null), '');
});

test('seedWorktreeIndex: a plain directory gets its own db and nothing to seed', (t) => {
  const dir = tempDir(t);
  const seed = seedWorktreeIndex(dir);
  assert.equal(seed.status, 'none');
  assert.match(seed.reason, /not a linked worktree/);
  assert.ok(fs.existsSync(path.join(dir, '.chemx', 'index.db')));
});

test('seedWorktreeIndex: an exported CHEMX_PROJECT_ROOT neither redirects the open nor survives changed', (t) => {
  const dir = tempDir(t);
  const elsewhere = tempDir(t);
  const previous = process.env.CHEMX_PROJECT_ROOT;
  process.env.CHEMX_PROJECT_ROOT = elsewhere;
  t.after(() => {
    const hadPrevious = previous !== undefined;
    if (hadPrevious) process.env.CHEMX_PROJECT_ROOT = previous;
    else delete process.env.CHEMX_PROJECT_ROOT;
  });

  seedWorktreeIndex(dir);

  assert.ok(fs.existsSync(path.join(dir, '.chemx', 'index.db')), 'the worktree gets the db');
  assert.equal(fs.existsSync(path.join(elsewhere, '.chemx', 'index.db')), false, 'the exported root does not');
  assert.equal(process.env.CHEMX_PROJECT_ROOT, elsewhere, 'the env is put back');
});
