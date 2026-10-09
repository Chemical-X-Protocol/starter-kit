/**
 * Activity renewal (#2493): any chemx command or MCP call by a lease holder extends the holder's live
 * leases, and a long command keeps extending them while it runs. Temp projects only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock } from './team-db-locks.js';
import { executeMcpTool } from '../mcp/tools.js';
import {
  renewHolderLeases, startLeaseKeepalive, trackLeaseActivity, agentFromArgs, activityHolder, LONG_RUNNING_COMMANDS
} from './lease-activity.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const FIVE_MINUTES = 5 * 60 * 1000;

const makeProject = (t) => {
  delete process.env.CHEMX_PROJECT_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lease-activity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, db: openIndexDb(root, { fresh: true }) };
};

test('every router alias of a long command keeps leases alive', () => {
  const router = fs.readFileSync(path.join(path.dirname(CLI), 'commands', 'cmd-router.js'), 'utf-8');
  const groups = [['test', 'tests', 'check:test'], ['lint', 'check:lint', 'eslint']];
  const missing = groups.flat().filter((alias) => !router.includes(`case '${alias}':`) || !LONG_RUNNING_COMMANDS.has(alias));
  assert.deepEqual(missing, []);
});

const expiryOf = (db, file) => Number(db.prepare('SELECT expires_at FROM file_leases WHERE file_path = ?').get(file).expires_at);
test('renewHolderLeases extends every live lease of the holder and nobody else\'s', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root, ttlMs: 60000 });
  requestFileLock(db, 'src/b.js', '@spec-a', { cwd: root, ttlMs: 60000 });
  requestFileLock(db, 'src/c.js', '@spec-b', { cwd: root, ttlMs: 60000 });
  const before = expiryOf(db, 'src/c.js');

  const renewed = renewHolderLeases(root, '@spec-a', { ttlMs: FIVE_MINUTES });

  assert.equal(renewed, 2);
  assert.ok(expiryOf(db, 'src/a.js') > Date.now() + FIVE_MINUTES - 5000, 'a.js extended to about now + TTL');
  assert.ok(expiryOf(db, 'src/b.js') > Date.now() + FIVE_MINUTES - 5000, 'b.js extended');
  assert.equal(expiryOf(db, 'src/c.js'), before, 'another handle\'s lease is untouched');
});

test('renewHolderLeases never revives an expired lease and never shortens a longer one', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/long.js', '@spec-a', { cwd: root, ttlMs: 60 * 60 * 1000 });
  requestFileLock(db, 'src/old.js', '@spec-a', { cwd: root, ttlMs: 60000 });
  db.prepare('UPDATE file_leases SET expires_at = ? WHERE file_path = ?').run(Date.now() - 1000, 'src/old.js');
  const longBefore = expiryOf(db, 'src/long.js');

  renewHolderLeases(root, '@spec-a', { ttlMs: FIVE_MINUTES });

  assert.ok(expiryOf(db, 'src/old.js') < Date.now(), 'a lapsed lease stays lapsed');
  assert.equal(expiryOf(db, 'src/long.js'), longBefore);
});

test('renewHolderLeases does nothing for an anonymous caller or when there is no lock db', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root, ttlMs: 60000 });
  const before = expiryOf(db, 'src/a.js');

  assert.equal(activityHolder(undefined, {}), null, 'no handle, no env, no session means anonymous');
  assert.equal(renewHolderLeases(root, undefined, { env: {}, ttlMs: FIVE_MINUTES }), 0);
  assert.equal(expiryOf(db, 'src/a.js'), before);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lease-none-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.equal(renewHolderLeases(empty, '@spec-a'), 0, 'fails open with no db');
});

test('agentFromArgs reads --as=@x and --as @x', () => {
  assert.equal(agentFromArgs(['status', '--as=@spec-a']), '@spec-a');
  assert.equal(agentFromArgs(['status', '--as', '@spec-b']), '@spec-b');
  assert.equal(agentFromArgs(['status']), undefined);
});

test('CLI path: a chemx command run as the holder extends the holder\'s lease', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root, ttlMs: 60000 });
  const before = expiryOf(db, 'src/a.js');

  execFileSync('node', [CLI, 'team', 'status'], { cwd: root, env: { ...process.env, CHEMX_AGENT_ID: '@spec-a' }, stdio: 'ignore' });

  assert.ok(expiryOf(db, 'src/a.js') > before + FIVE_MINUTES - 120000, 'extended to about now + TTL');
});

test('CLI path: --as names the holder when the environment does not', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root, ttlMs: 60000 });
  const before = expiryOf(db, 'src/a.js');
  const env = { ...process.env };
  delete env.CHEMX_AGENT_ID;

  execFileSync('node', [CLI, 'team', 'status', '--as=@spec-a'], { cwd: root, env, stdio: 'ignore' });

  assert.ok(expiryOf(db, 'src/a.js') > before + FIVE_MINUTES - 120000);
});

test('MCP path: a chemx call with params.agentId extends that holder\'s lease', async (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root, ttlMs: 60000 });
  const before = expiryOf(db, 'src/a.js');

  await executeMcpTool('chemx', { action: 'team_status', projectRoot: root, params: { agentId: '@spec-a' } }, root);

  assert.ok(expiryOf(db, 'src/a.js') > before + FIVE_MINUTES - 120000);
});

test('startLeaseKeepalive renews while a command runs, and stops when told to', async (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root, ttlMs: 300 });

  const stop = startLeaseKeepalive(root, '@spec-a', { ttlMs: 300, intervalMs: 50 });
  await sleep(900);
  assert.ok(expiryOf(db, 'src/a.js') > Date.now(), 'three TTLs later the lease is still live');

  stop();
  await sleep(500);
  assert.ok(expiryOf(db, 'src/a.js') <= Date.now(), 'with the keepalive stopped it lapses');
});

test('trackLeaseActivity keeps a lease alive for long commands only', async (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/long.js', '@spec-a', { cwd: root, ttlMs: 300 });
  requestFileLock(db, 'src/short.js', '@spec-b', { cwd: root, ttlMs: 300 });
  const opts = { ttlMs: 300, intervalMs: 50 };

  const stopLong = trackLeaseActivity(root, '@spec-a', 'test', opts);
  const stopShort = trackLeaseActivity(root, '@spec-b', 'read', opts);
  await sleep(800);
  stopLong();
  stopShort();

  assert.ok(expiryOf(db, 'src/long.js') > Date.now(), 'test is long running: renewed throughout');
  assert.ok(expiryOf(db, 'src/short.js') <= Date.now(), 'read renews once at the start only');
  for (const name of ['test', 'verify', 'typecheck', 'build', 'audit']) assert.ok(LONG_RUNNING_COMMANDS.has(name), name);
});

test('the keepalive timer is unref\'d so it never holds a process open', (t) => {
  const { root, db } = makeProject(t);
  requestFileLock(db, 'src/a.js', '@spec-a', { cwd: root, ttlMs: 60000 });
  const script = `import('${path.join(path.dirname(CLI), 'team', 'lease-activity.js')}').then((m) => { m.startLeaseKeepalive(${JSON.stringify(root)}, '@spec-a', { intervalMs: 60000 }); });`;
  const started = Date.now();
  execFileSync('node', ['--input-type=module', '-e', script], { timeout: 20000, stdio: 'ignore' });
  assert.ok(Date.now() - started < 15000, 'the process exited without waiting for the timer');
  t.diagnostic('unref check ok');
});
