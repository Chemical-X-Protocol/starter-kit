import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { buildNotifications, mentions, normalizeHandle, getRoutes, API_DOCS } from './ui-social-notify.js';
import { socialGetRoutes } from './ui-social-routes.js';

const ME = '@me';

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};
const post = (db, author, message, extra = {}) => Number(db
  .prepare('INSERT INTO agent_feed (timestamp, author_id, recipient_id, thread_id, task_id, event_type, message, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  .run(1000, author, extra.recipient || null, extra.thread || null, extra.task || null, 'status_update', message, extra.metadata || '{}').lastInsertRowid);

test('ui-social-notify: handle is normalized and required', () => {
  assert.strictEqual(normalizeHandle('me'), '@me');
  assert.strictEqual(normalizeHandle(' @me '), '@me');
  assert.strictEqual(normalizeHandle(''), '');
  assert.strictEqual(buildNotifications(setupDb(), {}).success, false);
});

test('ui-social-notify: mention matching is whole-handle', () => {
  assert.strictEqual(mentions('hi @me!', ME), true);
  assert.strictEqual(mentions('hi @me', ME), true);
  assert.strictEqual(mentions('hi @me-two', ME), false);
  assert.strictEqual(mentions('hi @mex @me', ME), true);
  assert.strictEqual(mentions('nothing', ME), false);
});

test('ui-social-notify: DMs, mentions and replies come back newest first with kinds', () => {
  const db = setupDb();
  const mine = post(db, ME, 'my post');
  const dm = post(db, '@a', 'private', { recipient: ME });
  const mention = post(db, '@b', 'cc @me please');
  const reply = post(db, '@c', 'answering', { thread: mine });
  post(db, '@d', 'unrelated');
  post(db, '@e', 'mentions @me-two only');
  post(db, ME, 'self mention @me');
  post(db, '@a', 'archived @me', { metadata: '{"archived":1}' });
  const d = buildNotifications(db, { handle: 'me' });
  assert.deepStrictEqual(d.notifications.map((n) => [n.id, n.kind]), [[reply, 'reply'], [mention, 'mention'], [dm, 'dm']]);
  assert.strictEqual(d.unread, 3);
});

test('ui-social-notify: unread counts only ids above since', () => {
  const db = setupDb();
  const first = post(db, '@a', 'hey @me');
  const second = post(db, '@a', 'again @me');
  const d = buildNotifications(db, { handle: ME, since: String(first) });
  assert.strictEqual(d.unread, 1);
  assert.deepStrictEqual(d.notifications.map((n) => [n.id, n.unread]), [[second, true], [first, false]]);
  assert.strictEqual(buildNotifications(db, { handle: ME, since: 'junk' }).unread, 2);
});

test('ui-social-notify: served at /api/notifications through the social routes and documented', () => {
  const db = setupDb();
  post(db, '@a', 'hi @me');
  const route = socialGetRoutes(db, { handle: ME })['/api/notifications'];
  assert.strictEqual(route().unread, 1);
  assert.strictEqual(getRoutes(db, { handle: ME })['/api/notifications']().success, true);
  assert.strictEqual(API_DOCS[0].path, '/api/notifications');
});
