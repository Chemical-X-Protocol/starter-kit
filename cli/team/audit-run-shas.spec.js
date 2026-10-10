/**
 * #4462: commit sha cross-check on a temp git repo and a temp db. Pure git and sqlite: no network.
 * Fixture: @one owns #11 and @two owns #22 (agent_tasks.assigned_agent_id).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { crossCheckShas, shasIn, shaLines } from './audit-run-shas.js';

const run = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

const makeEnv = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-shas-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, 'init', '-q');
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE agent_feed (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, author_id TEXT NOT NULL, recipient_id TEXT, thread_id INTEGER, task_id INTEGER, file_path TEXT, event_type TEXT NOT NULL DEFAULT 'broadcast', message TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', read_at INTEGER);
    CREATE TABLE agent_tasks (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'queued', assigned_agent_id TEXT);
    INSERT INTO agent_tasks (id, assigned_agent_id) VALUES (11, '@one'), (22, '@two');`);
  const now = Date.now();
  const agents = [{ handle: '@one', startedAt: now - 60000, endedAt: now + 60000 }, { handle: '@two', startedAt: now - 60000, endedAt: now + 60000 }];
  return { root, db, agents, now };
};

const commit = (env, file, message) => {
  fs.writeFileSync(path.join(env.root, file), `${message}\n`);
  run(env.root, 'add', file);
  run(env.root, 'commit', '-q', '-m', message);
  return run(env.root, 'rev-parse', 'HEAD').stdout.trim();
};

const report = (env, author, message, type = 'task_comment', meta = {}) => env.db.prepare('INSERT INTO agent_feed (timestamp, author_id, event_type, message, metadata) VALUES (?, ?, ?, ?, ?)').run(env.now, author, type, message, JSON.stringify(meta));

test('a reported sha git does not have is missing', (t) => {
  const env = makeEnv(t);
  commit(env, 'a.txt', 'feat: a (#11)');
  report(env, '@one', 'done, commit 0123456789abcdef0123456789abcdef01234567');
  const out = crossCheckShas(env.db, env.agents, env.root);
  assert.equal(out.missing.length, 1);
  assert.match(shaLines(out).join('\n'), /1 missing/);
});

test('a sha whose task id belongs to another handle is flagged as inferred', (t) => {
  const env = makeEnv(t);
  const sha = commit(env, 'a.txt', 'feat: a (#22)');
  report(env, '@one', `landed commit ${sha.slice(0, 9)}`);
  const out = crossCheckShas(env.db, env.agents, env.root);
  assert.equal(out.otherHandle.length, 1);
  assert.equal(out.otherHandle[0].attributedTo, '@two');
  assert.match(out.otherHandle[0].basis, /inferred/);
});

test('a clean run reports no mismatches', (t) => {
  const env = makeEnv(t);
  const sha = commit(env, 'a.txt', 'feat: a (#11)');
  report(env, '@one', 'commit', 'commit', { sha, subject: 'feat: a (#11)' });
  const out = crossCheckShas(env.db, env.agents, env.root);
  assert.equal(out.items.length, 1);
  assert.deepEqual([out.missing.length, out.otherHandle.length, out.unreported.length], [0, 0, 0]);
});

test('the Chemx-Agent trailer wins over the task id', (t) => {
  const env = makeEnv(t);
  const sha = commit(env, 'a.txt', 'feat: a (#22)\n\nChemx-Agent: @one');
  report(env, '@one', `commit ${sha}`);
  const out = crossCheckShas(env.db, env.agents, env.root);
  assert.equal(out.otherHandle.length, 0);
  assert.equal(out.items[0].basis, 'Chemx-Agent trailer');
});

test('a gone sha whose subject is in the window is rewritten, not missing', (t) => {
  const env = makeEnv(t);
  commit(env, 'a.txt', 'feat: a (#11)');
  report(env, '@one', 'commit', 'commit', { sha: '0123456789abcdef0123456789abcdef01234567', subject: 'feat: a (#11)' });
  const out = crossCheckShas(env.db, env.agents, env.root);
  assert.equal(out.rewritten.length, 1);
  assert.equal(out.missing.length, 0);
});

test('an unreported commit on a run task is listed as info; no db says not checked', (t) => {
  const env = makeEnv(t);
  commit(env, 'a.txt', 'feat: a (#11)');
  assert.equal(crossCheckShas(env.db, env.agents, env.root).unreported.length, 1);
  assert.equal(crossCheckShas(null, env.agents, env.root).available, false);
});

test('shasIn needs the word commit or sha before the hex', () => {
  assert.deepEqual(shasIn('commit e48167e and sha: abcdef1234, deadbeef alone'), ['e48167e', 'abcdef1234']);
});
