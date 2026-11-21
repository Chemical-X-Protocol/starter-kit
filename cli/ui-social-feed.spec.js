import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { postFeedEvent } from './team/team-db.js';
import { API_DOCS, getRoutes, readStoryPage, rollUpRows } from './ui-social-feed.js';

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

const post = (db, author, type, file) => postFeedEvent(db, {
  author_id: author, event_type: type, message: `${type} ${file || ''}`.trim(), file_path: file
});

const seedChurn = (db) => {
  post(db, '@a', 'lock_acquired', 'x.js');
  post(db, '@a', 'lock_acquired', 'y.js');
  post(db, '@a', 'lock_released', 'x.js');
  post(db, '@a', 'commit');
  post(db, '@b', 'lock_acquired', 'z.js');
  post(db, '@a', 'lock_acquired', 'x.js');
  post(db, '@a', 'guard-bypass', 'x.js');
};

test('story feed: a run of one author lock churn becomes one rollup row', () => {
  const db = setupDb();
  seedChurn(db);
  const { feed } = readStoryPage(db, {});
  assert.deepStrictEqual(feed.map((r) => r.eventType || r.event_type), ['rollup', 'commit', 'rollup', 'rollup']);
  const [first, , other, last] = feed;
  assert.strictEqual(first.author, '@a');
  assert.strictEqual(first.count, 3);
  assert.deepStrictEqual(first.files, ['x.js', 'y.js']);
  assert.ok(first.from <= first.to);
  assert.strictEqual(other.author, '@b');
  assert.strictEqual(other.count, 1);
  assert.strictEqual(last.author, '@a');
  assert.strictEqual(last.count, 2);
  assert.deepStrictEqual(last.files, ['x.js']);
});

test('story feed: meaningful events pass through unchanged and in order', () => {
  const db = setupDb();
  post(db, '@a', 'commit');
  post(db, '@a', 'decision');
  const { feed, hasMore } = readStoryPage(db, {});
  assert.deepStrictEqual(feed.map((r) => r.event_type), ['commit', 'decision']);
  assert.strictEqual(hasMore, false);
});

test('story feed: limit counts story rows and before_id walks back without losing or splitting a run', () => {
  const db = setupDb();
  seedChurn(db);
  const first = readStoryPage(db, { limit: '2' });
  assert.deepStrictEqual(first.feed.map((r) => r.author || r.author_id), ['@b', '@a']);
  assert.strictEqual(first.hasMore, true);
  const second = readStoryPage(db, { limit: '2', before_id: first.oldestId });
  assert.deepStrictEqual(second.feed.map((r) => r.eventType || r.event_type), ['rollup', 'commit']);
  assert.strictEqual(second.feed[0].count, 3);
  assert.strictEqual(second.hasMore, false);
});

test('story feed: a run longer than one raw chunk is still one row', () => {
  const db = setupDb();
  post(db, '@a', 'commit');
  for (let i = 0; i < 205; i += 1) post(db, '@a', 'lock_acquired', `f${i % 3}.js`);
  const { feed } = readStoryPage(db, { limit: '5' });
  assert.strictEqual(feed.length, 2);
  assert.strictEqual(feed[1].count, 205);
  assert.strictEqual(feed[1].files.length, 3);
});

test('story feed: an empty feed returns an empty page, and the route and doc row exist', () => {
  const db = setupDb();
  assert.deepStrictEqual(readStoryPage(db, {}), { success: true, feed: [], hasMore: false, oldestId: null });
  assert.deepStrictEqual(Object.keys(getRoutes(db, {})), ['/api/feed/story']);
  assert.strictEqual(API_DOCS[0].path, '/api/feed/story');
  assert.deepStrictEqual(rollUpRows([]), []);
});
