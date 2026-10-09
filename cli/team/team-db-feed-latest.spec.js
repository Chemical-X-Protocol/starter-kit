/**
 * Feed latest mode and archive filtering (task #1997): without a cursor the feed and the status
 * card show the newest rows; rows archived through metadata drop out of every listing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team-schema.js';
import { postFeedEvent, queryFeed, getSwarmStatus } from './team-db.js';
import { getAgentMailbox, sendDirectMessage } from './team-db-mailbox.js';
import { handleChemxTeamInbox, handleChemxTeamDm } from '../mcp/tools-team-mailbox.js';
import { handleChemxTeamPost } from '../mcp/tools-team-feed.js';

// findChemxDir honours CHEMX_PROJECT_ROOT before the cwd; the temp project below must be the db.
delete process.env.CHEMX_PROJECT_ROOT;

const makeTempProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-feed-latest-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

const createDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

const postMany = (db, count) => Array.from({ length: count }, (_, i) => postFeedEvent(db, { author_id: '@poster', message: `event ${i + 1}` }));

const archive = (db, id) => db.prepare("UPDATE agent_feed SET metadata = json_set(metadata, '$.archived', 1) WHERE id = ?").run(id);

test('queryFeed: without since_id returns the newest rows in chronological order', () => {
  const db = createDb();
  const events = postMany(db, 8);
  const latest = queryFeed(db, { limit: 3 });
  assert.deepEqual(latest.map((e) => e.id), events.slice(-3).map((e) => e.id));
});

test('queryFeed: with since_id reads forward from the cursor in ascending order', () => {
  const db = createDb();
  const events = postMany(db, 6);
  const delta = queryFeed(db, { since_id: events[1].id, limit: 2 });
  assert.deepEqual(delta.map((e) => e.id), [events[2].id, events[3].id]);
});

test('getSwarmStatus: recent feed shows the newest events, not the oldest', () => {
  const db = createDb();
  const events = postMany(db, 10);
  const status = getSwarmStatus(db);
  assert.equal(status.recentFeed.at(-1).id, events.at(-1).id);
  assert.ok(!status.recentFeed.some((e) => e.id === events[0].id));
});

test('queryFeed and status: archived rows are kept in the table but not listed', () => {
  const db = createDb();
  const events = postMany(db, 3);
  archive(db, events[2].id);
  assert.deepEqual(queryFeed(db, {}).map((e) => e.id), [events[0].id, events[1].id]);
  assert.ok(!getSwarmStatus(db).recentFeed.some((e) => e.id === events[2].id));
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM agent_feed').get().c, 3);
});

test('mailbox: archived DMs are neither listed nor counted unread', () => {
  const db = createDb();
  const kept = sendDirectMessage(db, { author_id: '@a', recipient_id: '@inbox-owner', message: 'real' });
  const junk = sendDirectMessage(db, { author_id: '@a', recipient_id: '@inbox-owner', message: 'spec leak' });
  archive(db, junk.id);
  const mailbox = getAgentMailbox(db, '@inbox-owner');
  assert.equal(mailbox.unreadCount, 1);
  assert.deepEqual(mailbox.messages.rows.map((row) => row[0]), [kept.id]);
});

test('mailbox: expired leases are not reported as held', () => {
  const db = createDb();
  const now = Date.now();
  const insert = db.prepare('INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose) VALUES (?, ?, ?, ?, ?)');
  insert.run('src/live.js', '@holder', now, now + 60000, 'live');
  insert.run('src/stale.js', '@holder', now - 120000, now - 60000, 'stale');
  const mailbox = getAgentMailbox(db, '@holder');
  assert.deepEqual(mailbox.leases.rows.map((row) => row[0]), ['src/live.js']);
});

test('mailbox and feed tools: no handle resolves to the caller identity, never the shared @agent inbox', async (t) => {
  const previous = process.env.CHEMX_AGENT_ID;
  process.env.CHEMX_AGENT_ID = '@mailbox-spec';
  try {
    const cwd = makeTempProject(t);
    await handleChemxTeamDm({ recipientId: '@agent', authorId: '@x', message: 'shared junk' }, cwd);
    const sent = await handleChemxTeamDm({ recipientId: '@peer', message: 'no author given' }, cwd);
    assert.equal(sent.author_id, '@mailbox-spec');
    const inbox = await handleChemxTeamInbox({}, cwd);
    assert.equal(inbox.agentId, '@mailbox-spec');
    assert.equal(inbox.unreadCount, 0, 'the shared @agent inbox is not read by default');
    const posted = await handleChemxTeamPost({ message: 'status update' }, cwd);
    assert.equal(posted.author_id, '@mailbox-spec');
  } finally {
    const hadPrevious = previous !== undefined;
    if (hadPrevious) process.env.CHEMX_AGENT_ID = previous;
    else delete process.env.CHEMX_AGENT_ID;
  }
});
