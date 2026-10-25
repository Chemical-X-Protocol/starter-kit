/**
 * K16 (#6761): a read runs under a derived handle, '@session-<id8>'. It names the read's caller and holds nothing:
 * the lease, claim, agent-row and feed primitives refuse the reserved prefix, so no path can make it a board actor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { requestFileLock } from './team-db-locks.js';
import { registerAgent, getAgent } from './team-db-agents.js';
import { postFeedEvent } from './team-db-feed.js';
import { createTask, claimTask, getTask } from './team-db-tasks.js';
import { resolveReadIdentity, DERIVED_PREFIX } from './agent-identity.js';

delete process.env.CHEMX_PROJECT_ROOT;

const DERIVED = resolveReadIdentity(undefined, {}).id;

const makeDb = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-derived-handle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 1;\n');
  return { root, db: openIndexDb(root, { fresh: true }) };
};

test('the derived handle takes no lease, and a stable handle still does', (t) => {
  const { root, db } = makeDb(t);
  const refused = requestFileLock(db, 'src/a.js', DERIVED, { cwd: root });
  assert.equal(refused.granted, false);
  assert.equal(refused.reason, 'derived_handle');
  assert.match(refused.message, /derived/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM file_leases').get().n, 0);
  assert.equal(requestFileLock(db, 'src/a.js', '@alice', { cwd: root }).granted, true);
});

test('the derived handle is never registered as an agent', (t) => {
  const { db } = makeDb(t);
  assert.equal(registerAgent(db, { id: DERIVED, role: 'executor' }), null);
  assert.equal(getAgent(db, DERIVED), null);
  assert.equal(registerAgent(db, { id: '@alice', role: 'executor' }).id, '@alice');
});

test('a feed event the derived handle would author is attributed to @system', (t) => {
  const { db } = makeDb(t);
  postFeedEvent(db, { author_id: DERIVED, event_type: 'broadcast', message: 'from a read' });
  postFeedEvent(db, { author_id: '@alice', event_type: 'broadcast', message: 'from alice' });
  const authors = db.prepare('SELECT author_id FROM agent_feed ORDER BY id').all().map((row) => row.author_id);
  assert.deepEqual(authors, ['@system', '@alice']);
});

test('the derived handle claims no task', (t) => {
  const { db } = makeDb(t);
  const task = createTask(db, { title: 'x' });
  const refused = claimTask(db, task.id, DERIVED);
  assert.equal(refused.success, false);
  assert.equal(refused.reason, 'derived_handle');
  assert.equal(getTask(db, task.id).status, 'queued');
  assert.equal(claimTask(db, task.id, '@alice').success, true);
});

test('the reserved prefix refuses a handle someone typed too', (t) => {
  const { root, db } = makeDb(t);
  assert.equal(requestFileLock(db, 'src/a.js', `${DERIVED_PREFIX}abcd1234`, { cwd: root }).reason, 'derived_handle');
  assert.equal(requestFileLock(db, 'src/a.js', 'session-abcd1234', { cwd: root }).reason, 'derived_handle');
});
