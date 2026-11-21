import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { getRoutes, API_DOCS } from './ui-social-mentions.js';

const makeDb = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE agent_feed (id INTEGER PRIMARY KEY, author_id TEXT, message TEXT);
    CREATE TABLE agents (id TEXT, name TEXT, role TEXT, status TEXT, heartbeat INTEGER)`);
  const ins = db.prepare('INSERT INTO agent_feed (author_id, message) VALUES (?, ?)');
  ins.run('@b', 'hello @alice please look');
  ins.run('@c', 'ping @alicia not alice');
  ins.run('@alice', 'my own post, 100% done');
  ins.run('@c', '(@Alice) again');
  db.prepare('INSERT INTO agents VALUES (?, ?, ?, ?, ?)').run('@alice', 'Alice', 'builder', 'idle', 5);
  return db;
};
const call = (db, path, params) => getRoutes(db, params)[path]();

test('ui-social-mentions: finds mentions at a word boundary, newest first, case-insensitive, paged', () => {
  const db = makeDb();
  const r = call(db, '/api/mentions', { handle: 'alice' });
  assert.deepStrictEqual(r.posts.map((p) => p.id), [4, 1]);
  assert.strictEqual(r.total, 2);
  const page = call(db, '/api/mentions', { handle: '@alice', limit: '1' });
  assert.strictEqual(page.posts.length, 1);
  assert.strictEqual(page.hasMore, true);
  db.close();
});

test('ui-social-mentions: a missing handle or db is success:false', () => {
  const db = makeDb();
  assert.strictEqual(call(db, '/api/mentions', {}).success, false);
  assert.strictEqual(call(null, '/api/handles', {}).success, false);
  db.close();
});

test('ui-social-mentions: handles lists agents first, then other authors, and treats % literally', () => {
  const db = makeDb();
  const r = call(db, '/api/handles', { q: 'ali' });
  assert.deepStrictEqual(r.handles.map((h) => h.handle), ['@alice']);
  assert.strictEqual(r.handles[0].isAgent, true);
  assert.deepStrictEqual(call(db, '/api/handles', { q: 'c' }).handles.map((h) => h.handle), ['@alice', '@c']);
  assert.deepStrictEqual(call(db, '/api/handles', { q: '%' }).handles, []);
  db.close();
});

test('ui-social-mentions: documents both routes', () => {
  assert.deepStrictEqual(API_DOCS.map((d) => d.path), ['/api/mentions', '/api/handles']);
});

test('xo-composer: ChemxUi.linkMentions splits text into plain and #/agents links', () => {
  const sandbox = { window: { ChemxUi: { components: {} } } };
  vm.runInNewContext(fs.readFileSync(new URL('./ui-page/components/xo-composer.js', import.meta.url), 'utf8'), sandbox);
  const link = (text) => JSON.parse(JSON.stringify(sandbox.window.ChemxUi.linkMentions(text)));
  assert.deepStrictEqual(link('hi @bob, a@b.c'), [{ text: 'hi ' }, { text: '@bob', handle: '@bob', href: '#/agents/@bob' }, { text: ', a@b.c' }]);
  assert.deepStrictEqual(link(''), []);
});
