/**
 * #2488 part A: a file locked from the monorepo root and from its submodule is one lease key
 * (root-relative), and the edit guard and renew-on-edit read that same row.
 * Temp monorepo only (fs.mkdtemp via coordination-fixture.js); CHEMX_PROJECT_ROOT is deleted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildMonorepo } from './coordination-fixture.js';
import { runTeamCli } from './team-commands.js';
import { openTeamContext } from './coordination-db.js';
import { findForeignLease } from '../edit-locks.js';
import { renewLeasesAfterEdit } from './lease-renew.js';

delete process.env.CHEMX_PROJECT_ROOT;

const withFixture = async (fn) => {
  const repo = buildMonorepo('chemx-locks-');
  try {
    return await fn(repo);
  } finally {
    repo.cleanup();
  }
};

const leaseKeys = (repo) => openTeamContext(repo.root).db.prepare('SELECT file_path, locked_by FROM file_leases ORDER BY file_path').all().map((row) => ({ ...row }));

test('locks: the same file locked from the root and from its submodule collide on one root-relative key', () => withFixture((repo) => {
  const first = runTeamCli(['lock', 'acquire', 'packages/a/src/x.js', '--as=@spec-root-agent'], false, repo.root);
  assert.equal(first.success ?? first.acquired ?? Boolean(first.lease), true);
  const second = runTeamCli(['lock', 'acquire', 'src/x.js', '--as=@spec-sub-agent'], false, repo.pkgA);
  const isGranted = Boolean(second?.success) && second?.lease?.locked_by === '@spec-sub-agent';
  assert.equal(isGranted, false, 'the submodule agent does not get a second lease on the same file');
  assert.deepEqual(leaseKeys(repo), [{ file_path: 'packages/a/src/x.js', locked_by: '@spec-root-agent' }]);
}));

test('locks: the edit guard from the package root sees the coordination lease; renew-on-edit extends it', () => withFixture((repo) => {
  runTeamCli(['lock', 'acquire', 'src/x.js', '--as=@spec-sub-agent'], false, repo.pkgA);
  const absolute = path.join(repo.pkgA, 'src', 'x.js');
  const foreign = findForeignLease(repo.pkgA, absolute, '@spec-other');
  assert.equal(foreign?.lockedBy, '@spec-sub-agent');
  assert.equal(foreign?.file, 'packages/a/src/x.js');
  assert.equal(findForeignLease(repo.pkgA, absolute, '@spec-sub-agent'), null, 'the holder is not blocked');
  const renewed = renewLeasesAfterEdit(repo.pkgA, [absolute], '@spec-sub-agent', { ttlMs: 600000 });
  assert.deepEqual(renewed, [absolute]);
}));
