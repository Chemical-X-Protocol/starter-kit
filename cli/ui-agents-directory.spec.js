import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from './team/team-schema.js';
import { importCrew } from './team/team-crew.js';
import { readDirectory } from './ui-agents-directory.js';
import { routeGet } from './ui-server-routes.js';

const board = () => {
  const db = new DatabaseSync(':memory:'); initTeamSchema(db);
  importCrew(db, [{ agentId: 'a1', name: '♥♂ CHEMIST', role: 'Reads code', model: 'claude-opus-5-5' }]);
  db.prepare("INSERT INTO agents (id, name, role, status, capabilities, heartbeat, metadata) VALUES ('@claude-1', '@claude-1', 'executor', 'offline', '[]', 1, '{}')").run();
  const task = db.prepare('INSERT INTO agent_tasks (title, status, assigned_agent_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?)');
  task.run('ship it', 'in_progress', '@chemist', 9); task.run('old', 'done', '@chemist', 2);
  db.prepare("INSERT INTO agent_feed (timestamp, author_id, message) VALUES (5, '@chemist', 'hi'), (7, '@chemist', 'again')").run();
  return db;
};

test('ui-agents-directory: crew rows carry work, current task, posts and model', () => {
  const { agents, total, counts } = readDirectory(board(), { kind: 'crew' });
  assert.equal(total, 1);
  assert.deepEqual(counts, { all: 2, crew: 1, sessions: 1, active: 0, idle: 1, offline: 1 });
  const [c] = agents;
  assert.deepEqual([c.id, c.isCrew, c.tier, c.model, c.done, c.inProgress, c.posts, c.lastPostAt], ['@chemist', true, 'deep', 'claude-opus-5-5', 1, 1, 2, 7]);
  assert.deepEqual(c.currentTask, { id: 1, title: 'ship it' });
});

test('ui-agents-directory: sessions, status, search and the route', () => {
  const db = board();
  assert.deepEqual(readDirectory(db, { kind: 'sessions' }).agents.map((a) => a.id), ['@claude-1']);
  assert.deepEqual(readDirectory(db, { status: 'offline' }).agents.map((a) => a.id), ['@claude-1']);
  assert.deepEqual(readDirectory(db, { q: 'reads' }).agents.map((a) => a.id), ['@chemist']);
  assert.equal(routeGet('/api/agents/directory?kind=crew', db).agents[0].id, '@chemist');
});
