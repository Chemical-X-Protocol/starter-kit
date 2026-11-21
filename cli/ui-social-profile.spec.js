import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { postFeedEvent, registerAgent, createTask } from './team/team-db.js';
import { API_DOCS, readProfile, PROFILE_POST_LIMIT } from './ui-social-profile.js';
import { routeGet } from './ui-server-routes.js';

const setupDb = () => {
  const db = new DatabaseSync(':memory:');
  initTeamSchema(db);
  return db;
};

const seedAgent = (db) => {
  registerAgent(db, { id: '@ada', name: 'Ada', role: 'builder' });
  registerAgent(db, { id: '@bob', name: 'Bob', role: 'builder' });
  const open = createTask(db, { title: 'Open', priority: 2 });
  const done = createTask(db, { title: 'Done', priority: 2 });
  const other = createTask(db, { title: 'Other', priority: 2 });
  db.prepare("UPDATE agent_tasks SET assigned_agent_id = '@ada', status = 'in_progress' WHERE id = ?").run(open.id ?? open);
  db.prepare("UPDATE agent_tasks SET assigned_agent_id = '@ada', status = 'done' WHERE id = ?").run(done.id ?? done);
  db.prepare("UPDATE agent_tasks SET assigned_agent_id = '@bob', status = 'in_progress' WHERE id = ?").run(other.id ?? other);
  const lease = db.prepare('INSERT INTO file_leases (file_path, locked_by, acquired_at, expires_at, purpose) VALUES (?, ?, ?, ?, ?)');
  lease.run('live.js', '@ada', Date.now(), Date.now() + 60000, 'p');
  lease.run('lapsed.js', '@ada', Date.now() - 90000, Date.now() - 1000, 'p');
  lease.run('bobs.js', '@bob', Date.now(), Date.now() + 60000, 'p');
};

const post = (db, author, type) => postFeedEvent(db, { author_id: author, event_type: type, message: `${type} by ${author}` });

test('agent profile: row, counts, claims and only live leases of that agent', () => {
  const db = setupDb();
  seedAgent(db);
  post(db, '@ada', 'commit');
  post(db, '@ada', 'status_update');
  post(db, '@bob', 'commit');
  const p = readProfile(db, 'ada');
  assert.strictEqual(p.success, true);
  assert.deepStrictEqual([p.agent.id, p.agent.role, p.agent.status], ['@ada', 'builder', 'idle']);
  assert.ok(p.agent.heartbeat > 0);
  assert.deepStrictEqual(p.counts, { posts: 2, commits: 1, tasksDone: 1, tasksInProgress: 1 });
  assert.deepStrictEqual(p.claims.map((c) => c.title), ['Open']);
  assert.deepStrictEqual(p.leases.map((l) => l.filePath), ['live.js']);
  assert.deepStrictEqual(p.feed.map((f) => f.author_id), ['@ada', '@ada']);
});

test('agent profile: the latest 20 posts page backwards with before_id', () => {
  const db = setupDb();
  seedAgent(db);
  for (let i = 0; i < 25; i += 1) post(db, '@ada', 'status_update');
  post(db, '@bob', 'status_update');
  const first = readProfile(db, '@ada');
  assert.strictEqual(first.feed.length, PROFILE_POST_LIMIT);
  assert.strictEqual(first.hasMore, true);
  const second = readProfile(db, '@ada', { before_id: first.oldestId });
  assert.strictEqual(second.feed.length, 5);
  assert.strictEqual(second.hasMore, false);
  assert.ok(second.feed.every((f) => f.id < first.oldestId));
  assert.strictEqual(first.counts.posts, 25);
});

test('agent profile: an unknown handle returns success false', () => {
  const db = setupDb();
  seedAgent(db);
  assert.deepStrictEqual(readProfile(db, '@nobody'), { success: false, error: 'Unknown agent' });
  assert.strictEqual(readProfile(null, '@ada').success, false);
});

test('agent profile: the id path routes through routeGet, with the @ encoded or not', () => {
  const db = setupDb();
  seedAgent(db);
  assert.strictEqual(routeGet('/api/agents/@ada/profile', db).agent.id, '@ada');
  assert.strictEqual(routeGet('/api/agents/%40ada/profile', db).agent.id, '@ada');
  assert.strictEqual(routeGet('/api/agents/ghost/profile', db).success, false);
  assert.strictEqual(API_DOCS[0].path, '/api/agents/:handle/profile');
});

test('ui-social-profile: crew model, tier and source, and recently done tasks (#7650)', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { initTeamSchema } = await import('./team/team-schema.js');
  const { importCrew } = await import('./team/team-crew.js');
  const { readProfile } = await import('./ui-social-profile.js');
  const db = new DatabaseSync(':memory:'); initTeamSchema(db);
  importCrew(db, [{ agentId: 'a1', name: 'CHEMIST', model: 'claude-opus-5-5' }]);
  db.prepare("INSERT INTO agent_tasks (title, status, assigned_agent_id, created_at, updated_at) VALUES ('shipped', 'done', '@chemist', 1, 3)").run();
  const p = readProfile(db, '@chemist');
  assert.deepEqual([p.agent.isCrew, p.agent.tier, p.agent.model, p.agent.source], [true, 'deep', 'claude-opus-5-5', 'starnet']);
  assert.deepEqual(p.recentDone.map((t) => t.title), ['shipped']);
});
