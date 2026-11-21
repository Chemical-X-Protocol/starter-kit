import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { getPatterns, API_DOCS } from './ui-social-posts.js';

const makeDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE agent_feed (id INTEGER PRIMARY KEY, timestamp INTEGER, author_id TEXT, thread_id INTEGER, task_id INTEGER, message TEXT)`);
  const ins = db.prepare('INSERT INTO agent_feed (id, timestamp, author_id, thread_id, task_id, message) VALUES (?, 1, ?, ?, ?, ?)');
  for (let i = 1; i <= 8; i++) ins.run(i, '@a', null, 7, `m${i}`);
  ins.run(9, '@a', null, 8, 'other task');
  ins.run(10, '@b', 4, null, 'reply to 4');
  ins.run(11, '@b', 4, null, 'second reply to 4');
  return db;
};
const get = (db, path) => {
  for (const [re, handler] of getPatterns(db)) {
    const m = path.match(re);
    if (m) return handler(m);
  }
  return null;
};

test('ui-social-posts: returns the post, up to 5 earlier same-task posts oldest first, and its replies', () => {
  const db = makeDb();
  const r = get(db, '/api/posts/4');
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.post.id, 4);
  assert.deepStrictEqual(r.before.map((p) => p.id), [1, 2, 3]);
  assert.deepStrictEqual(r.replies.map((p) => p.id), [10, 11]);
  assert.deepStrictEqual(get(db, '/api/posts/8').before.map((p) => p.id), [3, 4, 5, 6, 7]);
  db.close();
});

test('ui-social-posts: a reply sees its parent as earlier context; a missing id is success:false', () => {
  const db = makeDb();
  assert.deepStrictEqual(get(db, '/api/posts/10').before.map((p) => p.id), [4]);
  assert.strictEqual(get(db, '/api/posts/999').success, false);
  assert.strictEqual(get(db, '/api/posts/abc'), null);
  db.close();
});

test('ui-social-posts: documents the route', () => {
  assert.strictEqual(get(null, '/api/posts/9'), null, 'no db: no match');
  assert.ok(API_DOCS.some((d) => d.path === '/api/posts/:id'));
});
