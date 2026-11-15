import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { getPatterns, postPatterns, API_DOCS } from './ui-social-threads.js';

const makeDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  const ins = db.prepare('INSERT INTO agent_feed (timestamp, author_id, event_type, message, thread_id) VALUES (1, ?, ?, ?, ?)');
  ins.run('@a', 'broadcast', 'root', null);
  ins.run('@b', 'status_update', 'reply two', 1);
  ins.run('@c', 'broadcast', 'unrelated', null);
  ins.run('@c', 'status_update', 'reply one', 1);
  return db;
};
const run = (patterns, path) => {
  for (const [re, handler] of patterns) {
    const m = path.match(re);
    if (m) return handler(m);
  }
  return null;
};

test('ui-social-threads: GET returns replies oldest first, only for that post', () => {
  const db = makeDb();
  const r = run(getPatterns(db), '/api/threads/1');
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(r.replies.map((p) => p.message), ['reply two', 'reply one']);
  assert.deepStrictEqual(run(getPatterns(db), '/api/threads/3').replies, []);
  assert.strictEqual(run(getPatterns(db), '/api/threads/abc'), null);
  db.close();
});

test('ui-social-threads: POST adds a status_update reply with thread_id set, visible to GET', () => {
  const db = makeDb();
  const r = run(postPatterns(db, { author: '@me', message: '  hi there ' }), '/api/threads/3');
  assert.strictEqual(r.success, true);
  const row = db.prepare('SELECT * FROM agent_feed WHERE id = ?').get(r.post.id);
  assert.strictEqual(row.thread_id, 3);
  assert.strictEqual(row.event_type, 'status_update');
  assert.strictEqual(row.author_id, '@me');
  assert.strictEqual(row.message, 'hi there');
  assert.deepStrictEqual(run(getPatterns(db), '/api/threads/3').replies.map((p) => p.id), [r.post.id]);
  db.close();
});

test('ui-social-threads: POST rejects an empty message and an unknown post, and adds nothing', () => {
  const db = makeDb();
  assert.strictEqual(run(postPatterns(db, { author: '@me', message: '   ' }), '/api/threads/1').success, false);
  assert.strictEqual(run(postPatterns(db, {}), '/api/threads/1').success, false);
  assert.strictEqual(run(postPatterns(db, { message: 'x' }), '/api/threads/999').success, false);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM agent_feed').get().n, 4);
  db.close();
});

test('ui-social-threads: with no db the routes answer success:false; the route is documented', () => {
  assert.strictEqual(run(getPatterns(null), '/api/threads/1').success, false);
  assert.strictEqual(run(postPatterns(null, { message: 'x' }), '/api/threads/1').success, false);
  assert.ok(API_DOCS.some((d) => d.path === '/api/threads/:id'));
});
