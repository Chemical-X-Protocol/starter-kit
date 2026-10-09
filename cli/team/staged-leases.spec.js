/**
 * Commit guard (#2492): staged files under another handle's live lease refuse; a lapsed lease of the
 * committer warns; the hook scripts call `chemx team lock check-staged`. Temp projects only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock, cleanExpiredLeases } from './team-db-locks.js';
import { checkStagedLeases } from './staged-leases.js';
import { formatStagedReport } from './team-commands-lock-staged.js';
import { buildPreCommitHookScript } from '../installer-templates.js';

const KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(KIT, 'cli', 'index.js');

const makeProject = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-staged-leases-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, db: openIndexDb(root, { fresh: true }) };
};

const runCheck = (root, args, committer) => {
  const env = { ...process.env };
  delete env.CHEMX_AGENT_ID;
  delete env.CLAUDE_SESSION_ID;
  delete env.CHEMX_SESSION_ID;
  if (committer) env.CHEMX_AGENT_ID = committer;
  return spawnSync('node', [CLI, 'team', 'lock', 'check-staged', ...args], { cwd: root, env, encoding: 'utf-8' });
};

test('a staged file with a live lease held by another handle refuses and names holder, purpose and expiry', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-b', { cwd: root, purpose: '#9 spec work' });

  const result = checkStagedLeases(['src/a.js', 'src/free.js'], '@spec-a', { root });

  assert.equal(result.ok, false);
  assert.equal(result.refusals.length, 1);
  assert.deepEqual({ file: result.refusals[0].file, holder: result.refusals[0].holder, purpose: result.refusals[0].purpose }, { file: 'src/a.js', holder: '@spec-b', purpose: '#9 spec work' });
  assert.ok(result.refusals[0].expiresAt > Date.now());
  const report = formatStagedReport(result);
  assert.match(report, /^Commit blocked: 1 staged file\(s\) are leased by another handle\./);
  assert.match(report, /src\/a\.js: leased by @spec-b \(#9 spec work\) until \d\d:\d\d:\d\d/);
  assert.match(report, /wait for the lease to end/);
  assert.match(report, /chemx team dm @<holder>/);
  assert.match(report, /chemx team task handoff/);
});

test('the committer\'s own live lease and unleased files pass', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });

  const result = checkStagedLeases(['src/a.js', 'src/free.js'], '@spec-a', { root });

  assert.equal(result.ok, true);
  assert.deepEqual(result.refusals, []);
  assert.deepEqual(result.warnings, []);
});

test('an expired lease of another handle does not refuse', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-b', { cwd: root });
  db.prepare('UPDATE file_leases SET expires_at = ?').run(Date.now() - 1000);

  assert.equal(checkStagedLeases(['src/a.js'], '@spec-a', { root }).ok, true);
});

test('a lapsed lease of the committer warns and the commit proceeds', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root });
  db.prepare('UPDATE file_leases SET expires_at = ?').run(Date.now() - 120000);
  cleanExpiredLeases(db);

  const result = checkStagedLeases(['src/a.js'], '@spec-a', { root });

  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.match(formatStagedReport(result), /^Warning: src\/a\.js: your lease expired at \d\d:\d\d:\d\d \(2 min ago\); nobody holds it now\. The commit goes ahead\./);
});

test('with no committer handle, any live agent lease refuses and the report names the skip variable', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-b', { cwd: root });

  const result = checkStagedLeases(['src/a.js'], null, { root });

  assert.equal(result.ok, false);
  assert.equal(result.isHuman, true);
  assert.match(formatStagedReport(result), /No CHEMX_AGENT_ID is set, so any live agent lease blocks\. To commit anyway, accept the risk with: CHEMX_SKIP_PRECOMMIT=1 git commit/);
});

test('CLI: exit 1 with the report on a foreign live lease, exit 0 when clear or lapsed', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-b', { cwd: root });

  const refused = runCheck(root, ['src/a.js'], '@spec-a');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /^Commit blocked:/);

  const human = runCheck(root, ['src/a.js'], null);
  assert.equal(human.status, 1);
  assert.match(human.stderr, /CHEMX_SKIP_PRECOMMIT=1/);

  const clear = runCheck(root, ['src/other.js'], '@spec-a');
  assert.equal(clear.status, 0);
  assert.equal(clear.stderr, '');

  db.prepare('UPDATE file_leases SET expires_at = ?').run(Date.now() - 1000);
  assert.equal(runCheck(root, ['src/a.js'], '@spec-a').status, 0);
});

test('CLI: with no file arguments it reads the staged files from git', (t) => {
  const { root, db } = makeProject(t);
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  git('init', '-q');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  git('add', 'src/a.js');
  requestFileLock(db, 'src/a.js', '@spec-b', { cwd: root });

  const refused = runCheck(root, [], '@spec-a');

  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /src\/a\.js: leased by @spec-b/);
});

test('CLI: the check never creates a team db where there is none', (t) => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-staged-nodb-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));

  const res = runCheck(empty, ['src/a.js'], '@spec-a');

  assert.equal(res.status, 0);
  assert.equal(fs.existsSync(path.join(empty, '.chemx')), false);
});

test('both hook scripts call chemx team lock check-staged and refuse only on a Commit blocked report', () => {
  const shipped = fs.readFileSync(path.join(KIT, 'scripts', 'pre-commit.sh'), 'utf-8');
  const template = buildPreCommitHookScript();

  for (const [name, text] of [['scripts/pre-commit.sh', shipped], ['installer template', template]]) {
    assert.match(text, /team lock check-staged/, `${name} calls the guard`);
    assert.match(text, /"Commit blocked:"\*\)/, `${name} refuses only on a blocked report`);
    assert.match(text, /exit 1/, name);
  }
  assert.ok(template.indexOf('check-staged') > template.indexOf('exec "$REPO_ROOT/scripts/pre-commit.sh"'), 'the template does not run the guard twice when it delegates');
});
